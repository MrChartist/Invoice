/**
 * 8D — GST statutory guards 2025–26 (lazy: loaded by the GST page, the e-Invoice dialogs and the
 * on-demand bell provider, never by the shell).
 *
 *  - e-Invoice IRP reporting window (30 days for AATO ≥ ₹10 crore from 1 Apr 2025) and the e-invoicing mandate;
 *  - three-year time bar on furnishing returns (Sec 37(5) / 39(11) / 44(2) / 52(13));
 *  - GSTR-1 "as filed" snapshot → GSTR-1A working paper and the GSTR-3B Table 3.2 comparison;
 *  - date-keyed GST slab table and the "uncertain transactions" style exceptions list.
 *
 * Every statutory value is date-keyed (`Versioned`, append-only — add a version, never edit an old one) and kept
 * here rather than in `tax-rules.ts` so the first-paint chunk does not grow. Pure functions on bare `YYYY-MM-DD`
 * strings (AGENTS.md rule 8). Working papers only: nothing is sent to a portal — verify with your CA.
 */

import { isNonGstFinancialNote } from './financial-note';
import { ruleAt, type Versioned, b2clThreshold, rateInSlabs } from './tax-rules';
import { complianceCalendar, daysBetween, filedFor, type CalendarOptions, type FiledReturn, type ReturnDue, type ReturnForm } from './compliance';
import { shiftDay } from './dates';
import { getTable, setTable } from './storage';
import { isOwnGstin } from './gstin';
import type { InvoiceRecord, SenderProfile } from '../types/invoice';

const r2 = (n: number) => Math.round(n * 100) / 100;
const day10 = (s: unknown) => String(s ?? '').slice(0, 10);
const GSTIN_RE = /^[0-9]{2}[A-Z0-9]{13}$/;
export const isGstinShaped = (g: unknown) => GSTIN_RE.test(String(g ?? '').trim().toUpperCase());

/* ── e-Invoice: mandate and IRP reporting window ─────────────────────── */

export type IrnDocType = 'INV' | 'CRN' | 'DBN';

/**
 * Aggregate turnover (₹, any preceding FY from 2017-18) ABOVE which e-invoicing applies, keyed by the document
 * date. Notifications 13/2020, 61/2020, 88/2020, 5/2021, 1/2022, 17/2022, 10/2023-CT. `null` = not in force.
 */
export const EINVOICE_MANDATE_RULES: readonly Versioned<number | null>[] = [
  { from: '2017-07-01', value: null, source: 'e-invoicing not yet notified' },
  { from: '2020-10-01', value: 5e9, source: 'Notification 13/2020-CT as amended by 61/2020-CT (₹500 crore)' },
  { from: '2021-01-01', value: 1e9, source: 'Notification 88/2020-CT (₹100 crore)' },
  { from: '2021-04-01', value: 5e8, source: 'Notification 5/2021-CT (₹50 crore)' },
  { from: '2022-04-01', value: 2e8, source: 'Notification 1/2022-CT (₹20 crore)' },
  { from: '2022-10-01', value: 1e8, source: 'Notification 17/2022-CT (₹10 crore)' },
  { from: '2023-08-01', value: 5e7, source: 'Notification 10/2023-CT (₹5 crore)' },
];

export const einvoiceMandateAbove = (date?: string) => ruleAt(EINVOICE_MANDATE_RULES, date);

/** True when e-invoicing applies to a document dated `date` for this AATO (₹). Unknown AATO → false. */
export function einvoiceMandatory(aato: number | undefined, date?: string): boolean {
  const limit = einvoiceMandateAbove(date);
  return limit !== null && Number(aato) > limit;
}

export interface IrpWindowRule {
  /** AATO (₹) at or above which the window applies. */
  aatoFrom: number;
  /** Days, counting the document date as day 1. */
  days: number;
  docTypes: readonly IrnDocType[];
}

/**
 * IRP reporting window, keyed by the REPORTING day (the portal validates on upload):
 *  - 1 Nov 2023: AATO ≥ ₹100 crore may not report invoices older than 30 days (credit / debit notes free) —
 *    GSTN advisory 13 Sep 2023, UNVERIFIED on the notes exclusion;
 *  - 1 Apr 2025: AATO ≥ ₹10 crore, all IRN document types (invoices, credit and debit notes) — GSTN advisory
 *    5 Nov 2024. GSTN's example: a document dated 1 April must be reported by 30 April (day 30).
 */
export const IRP_REPORTING_WINDOW_RULES: readonly Versioned<IrpWindowRule | null>[] = [
  { from: '2020-10-01', value: null, source: 'No reporting time limit on the IRP' },
  { from: '2023-11-01', value: { aatoFrom: 1e9, days: 30, docTypes: ['INV'] }, source: 'GSTN advisory 13 Sep 2023 (AATO ≥ ₹100 crore, invoices) — verify' },
  { from: '2025-04-01', value: { aatoFrom: 1e8, days: 30, docTypes: ['INV', 'CRN', 'DBN'] }, source: 'GSTN advisory 5 Nov 2024 (AATO ≥ ₹10 crore, invoices / credit / debit notes)' },
];

/** Bell reminders on these days of the window (day 1 = the document date). */
export const IRP_ALERT_DAYS = [20, 27] as const;

export function irnDocType(docType: string | undefined): IrnDocType | null {
  if (docType === 'INVOICE' || docType === 'TAX_INVOICE' || !docType) return 'INV';
  if (docType === 'CREDIT_NOTE') return 'CRN';
  if (docType === 'DEBIT_NOTE') return 'DBN';
  return null;
}

export type IrpStage = 'open' | 'day20' | 'day27' | 'closed';

export interface IrpWindow {
  /** Last day the IRP accepts the document. */
  deadline: string;
  /** Day of the window today (1 = the document date). */
  day: number;
  /** Days left after today (0 = today is the last day; negative once closed). */
  daysLeft: number;
  stage: IrpStage;
  days: number;
}

/** The reporting window for one document, or null when no window applies (AATO unknown / below, type outside it). */
export function irpWindow(doc: Pick<InvoiceRecord, 'doc_type' | 'issue_date'>, aato: number | undefined, today: string): IrpWindow | null {
  const rule = ruleAt(IRP_REPORTING_WINDOW_RULES, today);
  const type = irnDocType(doc.doc_type);
  const date = day10(doc.issue_date);
  if (!rule || !type || !rule.docTypes.includes(type) || !(Number(aato) >= rule.aatoFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const deadline = shiftDay(date, rule.days - 1);
  const day = daysBetween(date, today) + 1;
  const daysLeft = daysBetween(today, deadline);
  const stage: IrpStage = daysLeft < 0 ? 'closed' : day >= IRP_ALERT_DAYS[1] ? 'day27' : day >= IRP_ALERT_DAYS[0] ? 'day20' : 'open';
  return { deadline, day, daysLeft, stage, days: rule.days };
}

/** Would the IRP take this document at all (B2B / SEZ / export tax documents from a regular taxpayer)? */
export function needsIrn(inv: InvoiceRecord): boolean {
  if (!inv || inv.status === 'Draft' || inv.status === 'Cancelled') return false;
  if (!irnDocType(inv.doc_type)) return false;
  if (inv.sender?.gst_scheme === 'composition') return false;
  const pos = String(inv.place_of_supply ?? '').trim();
  return isGstinShaped(inv.client?.gstin) || pos === '96' || pos === '99';
}

/** AATO entered on the profile that issued `inv` (live profile matched by GSTIN, else the snapshot / active one). */
export function aatoFor(inv: Pick<InvoiceRecord, 'sender'> | null, profiles: readonly SenderProfile[], active?: SenderProfile | null): number | undefined {
  const g = (inv?.sender?.companyGstin ?? '').trim().toUpperCase();
  const live = g ? profiles.find((p) => (p?.companyGstin ?? '').trim().toUpperCase() === g) : undefined;
  const v = live?.einvoice_aato ?? inv?.sender?.einvoice_aato ?? (g ? undefined : active?.einvoice_aato);
  return Number(v) > 0 ? Number(v) : undefined;
}

export interface IrnPending {
  invoice: InvoiceRecord;
  window: IrpWindow;
}

/** Documents still without an IRN whose reporting window is running (or closed within `closedDays`). */
export function irnWindowList(
  invoices: readonly InvoiceRecord[],
  irnIds: ReadonlySet<string>,
  aato: (inv: InvoiceRecord) => number | undefined,
  today: string,
  closedDays = 30,
): IrnPending[] {
  const out: IrnPending[] = [];
  for (const inv of invoices) {
    if (!inv?.id || irnIds.has(inv.id) || !needsIrn(inv)) continue;
    const w = irpWindow(inv, aato(inv), today);
    if (!w || w.daysLeft < -closedDays || w.day < 1) continue;
    out.push({ invoice: inv, window: w });
  }
  return out.sort((a, b) => a.window.daysLeft - b.window.daysLeft || String(a.invoice.invoice_number).localeCompare(String(b.invoice.invoice_number)));
}

/* ── Three-year time bar on returns ──────────────────────────────────── */

export interface TimeBarRule {
  years: number;
  /** First day the GST portal blocks barred returns. */
  enforcedFrom: string;
  forms: readonly ReturnForm[];
}

/**
 * Keyed by the evaluation day. Sec 37(5), 39(11), 44(2) and 52(13) CGST Act (Finance Act 2023, in force 1 Oct 2023 by
 * Notification 28/2023-CT): a return cannot be furnished after three years from its due date. The portal enforces it
 * from the July 2025 tax period, i.e. from 1 Aug 2025 (GSTN advisories 29 Oct 2024 and 7 Jun 2025). Forms tracked
 * here: GSTR-1, GSTR-3B, GSTR-4, GSTR-9 (CMP-08, IFF and PMT-06 are not on the advisory's list).
 */
export const RETURN_TIME_BAR_RULES: readonly Versioned<TimeBarRule | null>[] = [
  { from: '2017-07-01', value: null, source: 'No time bar on furnishing returns' },
  {
    from: '2023-10-01',
    value: { years: 3, enforcedFrom: '2025-08-01', forms: ['GSTR1', 'GSTR3B', 'GSTR4', 'GSTR9'] },
    source: 'Sec 37(5) / 39(11) / 44(2) / 52(13) (Finance Act 2023; Notification 28/2023-CT); GSTN advisory 7 Jun 2025',
  },
];

/** Same day `years` later (29 Feb → 28 Feb). */
export function addYears(day: string, years: number): string {
  const y = +day.slice(0, 4) + years;
  const md = day.slice(5, 10);
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  return `${y}-${md === '02-29' && !leap ? '02-28' : md}`;
}

export interface TimeBar {
  /** Last day the return can still be furnished. */
  lastDay: string;
  /** First day the portal refuses it. */
  barredOn: string;
  barred: boolean;
  /** Days from today to `barredOn` (≤ 0 once barred). */
  daysLeft: number;
}

export function timeBarFor(r: Pick<ReturnDue, 'form' | 'due' | 'optional'>, today: string): TimeBar | null {
  const rule = ruleAt(RETURN_TIME_BAR_RULES, today);
  if (!rule || r.optional || !rule.forms.includes(r.form)) return null;
  const lastDay = addYears(r.due, rule.years);
  const next = shiftDay(lastDay, 1);
  const barredOn = next > rule.enforcedFrom ? next : rule.enforcedFrom;
  const daysLeft = daysBetween(today, barredOn);
  return { lastDay, barredOn, barred: daysLeft <= 0, daysLeft };
}

export interface TimeBarRow {
  r: ReturnDue;
  bar: TimeBar;
}

/** Unfiled returns (since the first activity, up to 6 years back) that are barred or become barred within `horizonDays`. */
export function timeBarList(o: CalendarOptions, filed: readonly FiledReturn[], gstin = '', horizonDays = 365): TimeBarRow[] {
  const out: TimeBarRow[] = [];
  for (const r of complianceCalendar({ ...o, monthsBack: Math.max(o.monthsBack ?? 0, 72) })) {
    if (filedFor(filed, r, gstin)) continue;
    const bar = timeBarFor(r, o.today);
    if (bar && bar.daysLeft <= horizonDays) out.push({ r, bar });
  }
  return out.sort((a, b) => a.bar.barredOn.localeCompare(b.bar.barredOn));
}

/* ── GST rate slabs by date ──────────────────────────────────────────── */

// The date-keyed slab table lives in tax-rules.ts (QA-3 F9: the rate pickers read it too).
export { GST_SLAB_RULES, slabsAt, rateInSlabs } from './tax-rules';

/* ── Exceptions ("uncertain transactions") ───────────────────────────── */

export { isOwnGstin } from './gstin';

export type GstExceptionCode = 'IRN_MISSING' | 'IRP_WINDOW_CLOSED' | 'B2B_NO_HSN' | 'POS_STATE_MISMATCH' | 'RATE_NOT_IN_SLABS' | 'B2CL_EDGE' | 'OWN_GSTIN' | 'BAND_RATE' | 'BAND_EDGE' | 'BAND_DISCOUNT';

export interface GstException {
  code: GstExceptionCode;
  severity: 'error' | 'warning';
  invoiceId: string;
  number: string;
  date: string;
  /** Values for the message (`{name}` placeholders in the i18n area). */
  vars: Record<string, string | number>;
}

/** ± share of the B2CL threshold counted as "on the edge". */
export const B2CL_EDGE_BAND = 0.05;
const TAX_DOCS = new Set(['INVOICE', 'TAX_INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE']);

export interface ExceptionOptions {
  from: string;
  to: string;
  /** Invoice ids with an IRN recorded. */
  irnIds: ReadonlySet<string>;
  aato: (inv: InvoiceRecord) => number | undefined;
  today: string;
  /** Only documents of this sender GSTIN ('' = all). */
  gstin?: string;
}

// R9 (RT-C1): price-band lines (rate vs the band, near the limit, decided by a discount) — one lazy check. The caller
// passes the loader (its chunk already lists the deps); loaded only for a company with band lines or the apparel pack.
type BandCheck = (inv: InvoiceRecord) => { code: GstExceptionCode; vars: Record<string, string | number> }[];
let bandCheck: BandCheck | null = null;
let bandLoad: Promise<boolean> | null = null;
/** Resolves true once the check has just loaded (re-run the exceptions then). */
export function loadBandCheck(invoices: readonly InvoiceRecord[], force: boolean, load: () => Promise<{ liveBandExceptions: BandCheck }>): Promise<boolean> {
  if (bandCheck || (!force && !invoices.some((i) => i?.items?.some((l) => l?.band_rate)))) return Promise.resolve(false);
  return (bandLoad ??= load().then((m) => { bandCheck = m.liveBandExceptions; return true; }, () => false));
}

/** GST exceptions for documents dated in [from, to]. Errors first, then by date. */
export function gstExceptions(invoices: readonly InvoiceRecord[], o: ExceptionOptions): GstException[] {
  const out: GstException[] = [];
  const g = (o.gstin ?? '').trim().toUpperCase();
  for (const inv of invoices) {
    if (!inv?.id || !TAX_DOCS.has(inv.doc_type) || inv.status === 'Draft' || inv.status === 'Cancelled' || isNonGstFinancialNote(inv)) continue;
    if (inv.sender?.gst_scheme === 'composition') continue;
    const date = day10(inv.issue_date);
    if (date < o.from || date > o.to) continue;
    const sg = (inv.sender?.companyGstin ?? '').trim().toUpperCase();
    if (g && sg && sg !== g) continue;
    const base = { invoiceId: inv.id, number: inv.invoice_number || '—', date };
    const push = (code: GstExceptionCode, severity: 'error' | 'warning', vars: Record<string, string | number> = {}) => out.push({ code, severity, ...base, vars });
    const ctin = String(inv.client?.gstin ?? '').trim().toUpperCase();
    const b2b = isGstinShaped(ctin);
    const pos = String(inv.place_of_supply ?? '').trim();
    const lines = (inv.items ?? []).filter((it) => it && (String(it.name ?? '').trim() || Number(it.rate) || Number(it.quantity)));

    // Mandatory e-invoice without an IRN.
    if (needsIrn(inv) && !o.irnIds.has(inv.id)) {
      const aato = o.aato(inv);
      if (einvoiceMandatory(aato, date)) {
        const w = irpWindow(inv, aato, o.today);
        if (w?.stage === 'closed') push('IRP_WINDOW_CLOSED', 'error', { deadline: w.deadline });
        else push('IRN_MISSING', 'error', { deadline: w ? w.deadline : '' });
      }
    }
    // The buyer GSTIN is our own: not a supply to a registered recipient — usually a typo or the wrong party.
    if (b2b && isOwnGstin(ctin, sg)) push('OWN_GSTIN', 'warning', { gstin: ctin });
    if (b2b) {
      const noHsn = lines.filter((it) => !String(it.hsn ?? '').trim()).length;
      if (noHsn) push('B2B_NO_HSN', 'warning', { n: noHsn });
      if (/^\d{2}$/.test(pos) && pos !== '96' && pos !== '97' && pos !== '99' && ctin.slice(0, 2) !== pos) push('POS_STATE_MISMATCH', 'warning', { gstinState: ctin.slice(0, 2), pos });
    }
    if (inv.gst_mode !== 'NONE') {
      const bad = [...new Set(lines.map((it) => Number(it.tax_rate ?? 0)).filter((r) => Number.isFinite(r) && !rateInSlabs(r, date)))];
      if (bad.length) push('RATE_NOT_IN_SLABS', 'warning', { rates: bad.join(', ') });
    }
    // Unregistered inter-state invoice close to the B2CL line (freight / round-off can move it between B2CL and B2CS).
    const senderState = sg.slice(0, 2) || String(inv.sender?.stateCode ?? '').padStart(2, '0');
    if (!b2b && (inv.doc_type === 'INVOICE' || inv.doc_type === 'TAX_INVOICE') && /^\d{2}$/.test(pos) && pos !== '96' && pos !== '97' && senderState && pos !== senderState) {
      const t = b2clThreshold(date);
      const v = Number(inv.total) || 0;
      if (v >= t * (1 - B2CL_EDGE_BAND) && v <= t * (1 + B2CL_EDGE_BAND)) push('B2CL_EDGE', 'warning', { value: r2(v), threshold: t, section: v > t ? 'B2CL' : 'B2CS' });
    }
    for (const b of bandCheck?.(inv) ?? []) push(b.code, 'warning', b.vars);
  }
  const rank = (e: GstException) => (e.severity === 'error' ? 0 : 1);
  return out.sort((a, b) => rank(a) - rank(b) || a.date.localeCompare(b.date) || a.number.localeCompare(b.number));
}

/* ── GSTR-1 as filed → GSTR-1A, and GSTR-3B Table 3.2 ────────────────── */

/**
 * GSTR-1A (Rule 59(4A), Notification 12/2024-CT of 10 Jul 2024): optional, to add or amend records of the SAME tax
 * period after GSTR-1 is filed and before GSTR-3B of that period is filed. Keyed by the tax period's first day;
 * available from the July 2024 tax period as understood — verify with your CA.
 */
export const GSTR1A_RULES: readonly Versioned<boolean>[] = [
  { from: '2017-07-01', value: false, source: 'No GSTR-1A (same-period amendment) form' },
  { from: '2024-07-01', value: true, source: 'Rule 59(4A), Notification 12/2024-CT — verify the first period' },
];

export const gstr1aAvailable = (periodStart: string) => ruleAt(GSTR1A_RULES, periodStart);

/**
 * GSTR-3B Table 3.2 lock, keyed by the day the return is prepared. GSTN advisory 11 Apr 2025: Table 3.2 auto-populated
 * from GSTR-1 / 1A / IFF and NON-editable from the April 2025 tax period. GSTN advisory 16 May 2025: kept EDITABLE
 * until further notice after representations. `null` = editable. Append a version when the portal locks it again.
 */
export const GSTR3B_T32_LOCK_RULES: readonly Versioned<{ fromPeriod: string } | null>[] = [
  { from: '2017-07-01', value: null, source: 'Table 3.2 editable' },
  { from: '2025-04-11', value: { fromPeriod: '2025-04-01' }, source: 'GSTN advisory 11 Apr 2025 (non-editable from the April 2025 period)' },
  { from: '2025-05-16', value: null, source: 'GSTN advisory 16 May 2025 (editable until further notice)' },
];

/** Is Table 3.2 locked for the period starting `periodStart` when filed on `today`? */
export function table32Locked(periodStart: string, today: string): boolean {
  const rule = ruleAt(GSTR3B_T32_LOCK_RULES, today);
  return !!rule && periodStart >= rule.fromPeriod;
}

export const GSTR1_SNAPSHOT_TABLE = 'gstr1_snapshots';

export type SnapSection = 'b2b' | 'b2cl' | 'cdnr' | 'cdnur' | 'exp';

export interface SnapDoc {
  id: string;
  section: SnapSection;
  number: string;
  date: string;
  ctin: string;
  pos: string;
  value: number;
  taxable: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
}

export interface SnapB2cs {
  key: string;
  supply: 'INTRA' | 'INTER';
  pos: string;
  rate: number;
  txval: number;
  igst: number;
  cgst: number;
  sgst: number;
}

export interface Gstr1Snapshot {
  /** `${fp}|${gstin}` */
  id: string;
  /** MMYYYY of the period's last month. */
  fp: string;
  gstin: string;
  frozen_at: string;
  docs: SnapDoc[];
  b2cs: SnapB2cs[];
  t32: { pos: string; taxable: number; igst: number }[];
}

interface DocLike { invoiceId: string; number: string; date: string; ctin?: string; pos: string; value: number; taxable: number; igst: number; cgst: number; sgst: number; cess?: number }
interface G1Like {
  fp: string;
  b2b: DocLike[];
  b2cl: DocLike[];
  cdnr: DocLike[];
  cdnur: DocLike[];
  exp: DocLike[];
  b2cs: { supply: 'INTRA' | 'INTER'; pos: string; rate: number; txval: number; igst: number; cgst: number; sgst: number; etin?: string }[];
}

function snapDocs(g1: G1Like): SnapDoc[] {
  const out: SnapDoc[] = [];
  for (const section of ['b2b', 'b2cl', 'cdnr', 'cdnur', 'exp'] as const) {
    for (const d of g1[section] ?? []) {
      out.push({
        id: d.invoiceId, section, number: d.number, date: day10(d.date), ctin: d.ctin ?? '', pos: d.pos,
        value: r2(d.value), taxable: r2(d.taxable), igst: r2(d.igst), cgst: r2(d.cgst), sgst: r2(d.sgst), cess: r2(d.cess ?? 0),
      });
    }
  }
  return out;
}

const b2csKey = (r: { supply: string; pos: string; rate: number; etin?: string }) => `${r.supply}|${r.pos}|${r.rate}|${r.etin ?? ''}`;
const snapB2cs = (g1: G1Like): SnapB2cs[] =>
  (g1.b2cs ?? []).map((r) => ({ key: b2csKey(r), supply: r.supply, pos: r.pos, rate: r.rate, txval: r2(r.txval), igst: r2(r.igst), cgst: r2(r.cgst), sgst: r2(r.sgst) }));

/** Freeze the period's GSTR-1 (and 3B Table 3.2) as filed. Pure. */
export function snapshotFromReport(g1: G1Like, t32: readonly { pos: string; taxable: number; igst: number }[], gstin: string, now = new Date()): Gstr1Snapshot {
  const g = gstin.trim().toUpperCase();
  return {
    id: `${g1.fp}|${g}`, fp: g1.fp, gstin: g, frozen_at: now.toISOString(),
    docs: snapDocs(g1), b2cs: snapB2cs(g1),
    t32: t32.map((x) => ({ pos: x.pos, taxable: r2(x.taxable), igst: r2(x.igst) })),
  };
}

export const loadSnapshots = (): Gstr1Snapshot[] => getTable<Gstr1Snapshot>(GSTR1_SNAPSHOT_TABLE).filter((s) => s && typeof s.id === 'string');
export const snapshotFor = (fp: string, gstin: string) => loadSnapshots().find((s) => s.id === `${fp}|${gstin.trim().toUpperCase()}`) ?? null;
export function saveSnapshot(s: Gstr1Snapshot): void {
  setTable(GSTR1_SNAPSHOT_TABLE, [...loadSnapshots().filter((x) => x.id !== s.id), s]);
}
export function deleteSnapshot(id: string): void {
  setTable(GSTR1_SNAPSHOT_TABLE, loadSnapshots().filter((x) => x.id !== id));
}

export type DiffKind = 'added' | 'changed' | 'removed';
const MONEY_FIELDS = ['value', 'taxable', 'igst', 'cgst', 'sgst', 'cess'] as const;

export interface Gstr1aDocRow {
  kind: DiffKind;
  section: SnapSection;
  id: string;
  number: string;
  before?: SnapDoc;
  after?: SnapDoc;
  /** Fields that differ (`changed`). */
  fields: string[];
}

export interface Gstr1aB2csRow {
  kind: DiffKind;
  key: string;
  before?: SnapB2cs;
  after?: SnapB2cs;
}

export interface Gstr1aPaper {
  docs: Gstr1aDocRow[];
  b2cs: Gstr1aB2csRow[];
}

/** Differences between the GSTR-1 as filed (snapshot) and the books now — what a GSTR-1A would add or amend. */
export function gstr1aDiff(snap: Gstr1Snapshot, g1: G1Like, tolerance = 1): Gstr1aPaper {
  const now = new Map(snapDocs(g1).map((d) => [d.id, d]));
  const was = new Map(snap.docs.map((d) => [d.id, d]));
  const docs: Gstr1aDocRow[] = [];
  for (const [id, a] of now) {
    const b = was.get(id);
    if (!b) {
      docs.push({ kind: 'added', section: a.section, id, number: a.number, after: a, fields: [] });
      continue;
    }
    const fields: string[] = [];
    for (const k of ['section', 'number', 'date', 'ctin', 'pos'] as const) if (String(a[k]) !== String(b[k])) fields.push(k);
    for (const k of MONEY_FIELDS) if (Math.abs(a[k] - b[k]) > tolerance) fields.push(k);
    if (fields.length) docs.push({ kind: 'changed', section: a.section, id, number: a.number, before: b, after: a, fields });
  }
  for (const [id, b] of was) if (!now.has(id)) docs.push({ kind: 'removed', section: b.section, id, number: b.number, before: b, fields: [] });

  const nb = new Map(snapB2cs(g1).map((r) => [r.key, r]));
  const wb = new Map(snap.b2cs.map((r) => [r.key, r]));
  const b2cs: Gstr1aB2csRow[] = [];
  for (const [key, a] of nb) {
    const b = wb.get(key);
    if (!b) b2cs.push({ kind: 'added', key, after: a });
    else if (Math.abs(a.txval - b.txval) > tolerance || Math.abs(a.igst + a.cgst + a.sgst - b.igst - b.cgst - b.sgst) > tolerance) b2cs.push({ kind: 'changed', key, before: b, after: a });
  }
  for (const [key, b] of wb) if (!nb.has(key)) b2cs.push({ kind: 'removed', key, before: b });
  const order: Record<DiffKind, number> = { changed: 0, added: 1, removed: 2 };
  docs.sort((x, y) => order[x.kind] - order[y.kind] || x.number.localeCompare(y.number));
  return { docs, b2cs };
}

export interface T32Row {
  pos: string;
  /** As auto-populated from the GSTR-1 as filed (null without a snapshot). */
  gstr1Taxable: number | null;
  gstr1Igst: number | null;
  booksTaxable: number;
  booksIgst: number;
  diffTaxable: number;
  diffIgst: number;
}

/** GSTR-3B Table 3.2 per place of supply: as per GSTR-1 (snapshot) vs books now. */
export function table32Diff(snap: Gstr1Snapshot | null, books: readonly { pos: string; taxable: number; igst: number }[]): T32Row[] {
  const map = new Map<string, T32Row>();
  const row = (pos: string) => {
    let r = map.get(pos);
    if (!r) map.set(pos, (r = { pos, gstr1Taxable: snap ? 0 : null, gstr1Igst: snap ? 0 : null, booksTaxable: 0, booksIgst: 0, diffTaxable: 0, diffIgst: 0 }));
    return r;
  };
  for (const b of books) {
    const r = row(b.pos);
    r.booksTaxable = r2(r.booksTaxable + b.taxable);
    r.booksIgst = r2(r.booksIgst + b.igst);
  }
  for (const s of snap?.t32 ?? []) {
    const r = row(s.pos);
    r.gstr1Taxable = r2((r.gstr1Taxable ?? 0) + s.taxable);
    r.gstr1Igst = r2((r.gstr1Igst ?? 0) + s.igst);
  }
  for (const r of map.values()) {
    r.diffTaxable = snap ? r2(r.booksTaxable - (r.gstr1Taxable ?? 0)) : 0;
    r.diffIgst = snap ? r2(r.booksIgst - (r.gstr1Igst ?? 0)) : 0;
  }
  return [...map.values()].sort((a, b) => a.pos.localeCompare(b.pos));
}
