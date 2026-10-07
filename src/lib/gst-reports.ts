/**
 * GST return preparation — GSTR-1 sections and a GSTR-3B summary.
 *
 * Pure logic only (no React, no storage, no browser APIs) so it is unit-tested
 * in Node. Inputs are the persisted `invoices` rows and, defensively, whatever
 * is in the `purchases` table. Nothing here files a return: the output is a
 * working paper to be verified by a CA / checked against the GST portal.
 *
 * Key assumptions (also surfaced on the page):
 *  - Period filter uses the document's issue date.
 *  - Only INVOICE / TAX_INVOICE / CREDIT_NOTE that are not Draft/Cancelled are
 *    reported. Quotations, proformas and delivery challans are never tax docs.
 *  - Credit notes are stored as positive amounts and are netted (negative) in
 *    aggregated tables (B2CS, nil, HSN, 3B).
 *  - Per-line taxable value / tax is recomputed from the items with the
 *    invoice's own settings so rate-wise splits are exact.
 *  - Cess is carried through per rate row / HSN row / 3B; it is paid in cash (no ITC set-off).
 *  - Supply type drives placement: EXPORT_* -> exp (WPAY/WOPAY); SEZ_* -> b2b with inv_typ
 *    SEWP/SEWOP; both are zero-rated (3B 3.1(b)) and keep their nominal rate in the rate rows.
 */

import type { InvoiceRecord, GstMode } from '../types/invoice';
import { calcInputFromRecord, calculateInvoice, isIgstZeroRated, isZeroRated, num, round2 } from './invoice-calc';
import { checkGstin } from './gstin';
import { stateByCode, stateByName } from './india-states';
import { isVoidStatus, pickNum, readPurchase } from './purchase-normalize';

/* ───────────────────────── Period ───────────────────────── */

export type PeriodKind = 'month' | 'quarter' | 'fy';

export interface ReportPeriod {
  kind: PeriodKind;
  /** Calendar year in which the Indian FY starts (FY 25-26 -> 2025). */
  fyStart: number;
  /** Calendar month 1-12 (kind === 'month'). */
  month?: number;
  /** FY quarter 1-4, Q1 = Apr-Jun (kind === 'quarter'). */
  quarter?: 1 | 2 | 3 | 4;
}

const pad = (n: number) => String(n).padStart(2, '0');
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function daysIn(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Calendar year of a calendar month inside the FY starting `fyStart`. */
function yearOfMonth(fyStart: number, month: number): number {
  return month >= 4 ? fyStart : fyStart + 1;
}

/** Inclusive ISO date range [from, to] of the period. */
export function periodRange(p: ReportPeriod): { from: string; to: string } {
  if (p.kind === 'month') {
    const m = p.month ?? 4;
    const y = yearOfMonth(p.fyStart, m);
    return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(daysIn(y, m))}` };
  }
  if (p.kind === 'quarter') {
    const q = p.quarter ?? 1;
    const startM = 4 + (q - 1) * 3;
    const sm = ((startM - 1) % 12) + 1;
    const em = ((startM + 2 - 1) % 12) + 1;
    const sy = yearOfMonth(p.fyStart, sm);
    const ey = yearOfMonth(p.fyStart, em);
    return { from: `${sy}-${pad(sm)}-01`, to: `${ey}-${pad(em)}-${pad(daysIn(ey, em))}` };
  }
  return { from: `${p.fyStart}-04-01`, to: `${p.fyStart + 1}-03-31` };
}

/** GSTN "return period": MMYYYY of the last month covered by the period. */
export function periodFp(p: ReportPeriod): string {
  const { to } = periodRange(p);
  return `${to.slice(5, 7)}${to.slice(0, 4)}`;
}

export function periodLabel(p: ReportPeriod): string {
  const fy = `FY ${String(p.fyStart).slice(2)}-${String(p.fyStart + 1).slice(2)}`;
  if (p.kind === 'fy') return fy;
  if (p.kind === 'quarter') {
    const q = p.quarter ?? 1;
    const names = ['Apr-Jun', 'Jul-Sep', 'Oct-Dec', 'Jan-Mar'];
    return `Q${q} ${fy} (${names[q - 1]})`;
  }
  const m = p.month ?? 4;
  return `${MONTH_NAMES[m - 1]} ${yearOfMonth(p.fyStart, m)}`;
}

/** The period of the given kind that contains `date` (ISO string or Date). */
export function periodForDate(kind: PeriodKind, date: string | Date): ReportPeriod {
  const iso =
    typeof date === 'string'
      ? date.slice(0, 10)
      : `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const y = parseInt(iso.slice(0, 4), 10);
  const m = parseInt(iso.slice(5, 7), 10);
  const fyStart = m >= 4 ? y : y - 1;
  if (kind === 'month') return { kind, fyStart, month: m };
  if (kind === 'quarter') {
    const idx = (m - 4 + 12) % 12;
    return { kind, fyStart, quarter: (Math.floor(idx / 3) + 1) as 1 | 2 | 3 | 4 };
  }
  return { kind, fyStart };
}

export function inPeriod(date: string | undefined, p: ReportPeriod): boolean {
  if (!date) return false;
  const d = String(date).slice(0, 10);
  const { from, to } = periodRange(p);
  return d >= from && d <= to;
}

/** 2025-04-09 -> 09-04-2025 (GSTN date format). */
export function toGstnDate(iso: string): string {
  const d = String(iso).slice(0, 10);
  return `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}`;
}

/* ───────────────────────── Types ───────────────────────── */

export const B2CL_THRESHOLD = 250000;

export type Severity = 'error' | 'warning' | 'info';

export interface ReconIssue {
  id: string;
  severity: Severity;
  code: string;
  message: string;
  invoiceId?: string;
  invoiceNumber?: string;
  /** In-app route that lets the user fix it. */
  link?: string;
  linkLabel?: string;
}

export interface RateRow {
  rate: number;
  txval: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
}

export interface DocRow {
  invoiceId: string;
  number: string;
  date: string; // ISO
  /** Document value (grand total). */
  value: number;
  pos: string;
  rchrg: 'Y' | 'N';
  partyName: string;
  ctin: string;
  items: RateRow[];
  taxable: number;
  igst: number;
  cgst: number;
  sgst: number;
  /** Additive: cess across the document. */
  cess?: number;
  /** Additive: GSTN invoice type (R regular, SEWP/SEWOP SEZ, DE deemed export). */
  invTyp?: 'R' | 'SEWP' | 'SEWOP' | 'DE';
}

export interface B2csRow {
  supply: 'INTRA' | 'INTER';
  pos: string;
  rate: number;
  txval: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
}

export interface ExportRow extends DocRow {
  expType: 'WPAY' | 'WOPAY';
}

export interface CdnRow extends DocRow {
  noteType: 'C';
  /** CDNUR only. */
  unregType?: 'B2CL' | 'EXPWP' | 'EXPWOP';
}

export type NilSupplyType = 'INTRB2B' | 'INTRAB2B' | 'INTRB2C' | 'INTRAB2C';

export interface NilRow {
  type: NilSupplyType;
  nil: number;
  exempt: number;
  nonGst: number;
}

export interface HsnRow {
  hsn: string;
  description: string;
  uqc: string;
  qty: number;
  value: number;
  taxable: number;
  rate: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
}

export interface DocIssueRow {
  docType: string;
  series: string;
  from: string;
  to: string;
  total: number;
  cancelled: number;
  netIssued: number;
}

export interface Gstr1Report {
  period: ReportPeriod;
  gstin: string;
  fp: string;
  b2b: DocRow[];
  b2cl: DocRow[];
  b2cs: B2csRow[];
  cdnr: CdnRow[];
  cdnur: CdnRow[];
  exp: ExportRow[];
  nil: NilRow[];
  hsn: HsnRow[];
  docIssue: DocIssueRow[];
  /** Totals across every outward table (net of credit notes). */
  totals: { taxable: number; igst: number; cgst: number; sgst: number; value: number; cess?: number };
  counts: { included: number; drafts: number; cancelled: number; notTaxDocs: number };
}

export interface ItcHeads {
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
}

export interface Gstr3bTaxRow {
  taxable: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
}

export interface SetOffResult {
  liability: { igst: number; cgst: number; sgst: number };
  rcLiability: { igst: number; cgst: number; sgst: number };
  /** ITC consumed: [credit head][liability head]. */
  itcUsed: {
    igst: { igst: number; cgst: number; sgst: number };
    cgst: { cgst: number; igst: number };
    sgst: { sgst: number; igst: number };
  };
  /** Tax payable in cash (liability after ITC + whole reverse-charge liability). */
  cash: { igst: number; cgst: number; sgst: number };
  /** ITC left after set-off (carried forward). */
  itcCarry: { igst: number; cgst: number; sgst: number };
  /** Additive: cess liability, payable in cash (no ITC is modelled for cess). */
  cess?: number;
}

export interface Gstr3bReport {
  /** 3.1 */
  outward: {
    taxable: Gstr3bTaxRow; // (a)
    zeroRated: Gstr3bTaxRow; // (b)
    nilExempt: { inter: number; intra: number }; // (c) value only
    inwardRcm: Gstr3bTaxRow; // (d)
    nonGst: number; // (e)
  };
  /** 3.2 inter-state supplies to unregistered persons, by place of supply. */
  interStateUnreg: { pos: string; taxable: number; igst: number }[];
  /** 4 */
  itc: {
    availableRcm: ItcHeads; // 4A(3)
    availableOther: ItcHeads; // 4A(5)
    reversedOther: ItcHeads; // 4B(2)
    net: ItcHeads; // 4C
    ineligible: ItcHeads; // 4D(2)
  };
  /** 5 — inward supplies from composition / exempt / nil suppliers (value). */
  inwardExempt: { inter: number; intra: number };
  /** 6.1 */
  payment: SetOffResult;
  /** Net negative liability (credit notes exceeding sales) that cannot be adjusted this period. */
  unadjustedCredit: { igst: number; cgst: number; sgst: number };
  purchasesConsidered: number;
  /** Outward reverse-charge invoices (tax payable by the recipient, so not in 3.1). */
  outwardRcmTaxable: number;
}

export interface GstReport {
  gstr1: Gstr1Report;
  gstr3b: Gstr3bReport;
  issues: ReconIssue[];
}

export interface BuildOptions {
  period: ReportPeriod;
  /** Filer GSTIN. If set, invoices whose sender snapshot has a different GSTIN are skipped. */
  gstin?: string;
  /** Fallback state code of the filer when an invoice has no sender snapshot. */
  filerStateCode?: string;
}

/* ───────────────────────── Prepared documents ───────────────────────── */

interface PLine {
  rate: number;
  hsn: string;
  uqc: string;
  desc: string;
  qty: number;
  taxable: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
  lineTotal: number;
}

export interface PDoc {
  rec: InvoiceRecord;
  sign: 1 | -1;
  isNote: boolean;
  number: string;
  date: string;
  pos: string;
  supply: 'INTRA' | 'INTER';
  registered: boolean;
  ctin: string;
  isExport: boolean;
  /** Zero-rated supply: export or SEZ (GSTR-3B 3.1(b)). */
  zeroRated: boolean;
  invTyp: 'R' | 'SEWP' | 'SEWOP' | 'DE';
  rcm: boolean;
  senderGstin: string;
  value: number;
  lines: PLine[];
}

const TAX_DOC_TYPES = new Set(['INVOICE', 'TAX_INVOICE', 'CREDIT_NOTE']);

const UQC: Record<string, string> = {
  NOS: 'NOS', PCS: 'PCS', KG: 'KGS', KGS: 'KGS', LTR: 'LTR', MTR: 'MTR', SQF: 'SQF', SET: 'SET', BOX: 'BOX',
  HRS: 'OTH', DAY: 'OTH', MONTH: 'OTH', LOT: 'OTH',
};

export function toUqc(unit: string | undefined, hsn: string): string {
  if (hsn.startsWith('99')) return 'NA'; // SAC — services carry no quantity
  const u = (unit ?? '').trim().toUpperCase();
  return UQC[u] ?? (u ? 'OTH' : 'NOS');
}

function filerState(gstin: string, fallback?: string): string {
  return checkGstin(gstin).stateCode ?? stateByCode(fallback)?.code ?? '';
}

/** The app's own "Other Country (Export)" code is 99; GSTN calls it 96. Both mean an export. */
const FOREIGN_POS = new Set(['96', '99']);

function recipientState(rec: InvoiceRecord): { pos: string; missing: boolean } {
  if (FOREIGN_POS.has((rec.place_of_supply ?? '').trim())) return { pos: '96', missing: false }; // Other Countries
  const direct = stateByCode(rec.place_of_supply)?.code;
  if (direct) return { pos: direct, missing: false };
  const c = rec.client ?? ({} as InvoiceRecord['client']);
  const viaClient =
    stateByCode(c.state_code)?.code ?? checkGstin(c.gstin).stateCode ?? stateByName(c.state)?.code ?? '';
  return { pos: viaClient, missing: true };
}

function effectiveMode(mode: GstMode | undefined, from: string, pos: string): GstMode {
  if (mode === 'CGST_SGST' || mode === 'IGST' || mode === 'NONE') return mode;
  // SINGLE / undefined (legacy): decide the split from the states, else IGST.
  if (from && pos) return from === pos ? 'CGST_SGST' : 'IGST';
  return mode === 'SINGLE' ? 'IGST' : 'NONE';
}

function prepare(rec: InvoiceRecord, opts: BuildOptions, issues: ReconIssue[]): PDoc {
  const isNote = rec.doc_type === 'CREDIT_NOTE';
  const sender = rec.sender;
  const senderGstin = (sender?.companyGstin ?? opts.gstin ?? '').trim().toUpperCase();
  const from = filerState(senderGstin, sender?.stateCode ?? opts.filerStateCode);
  const { pos: posRaw, missing } = recipientState(rec);
  const label = rec.invoice_number || rec.id;

  const push = (severity: Severity, code: string, message: string, link?: string, linkLabel?: string) =>
    issues.push({
      id: `${code}:${rec.id}`,
      severity,
      code,
      message: `${label}: ${message}`,
      invoiceId: rec.id,
      invoiceNumber: rec.invoice_number,
      link: link ?? `/invoice/${rec.id}`,
      linkLabel: linkLabel ?? 'Open invoice',
    });

  const st = rec.supply_type;
  const isSez = st === 'SEZ_WITH_PAYMENT' || st === 'SEZ_WITHOUT_PAYMENT';
  const isExport =
    posRaw === '96' ||
    st === 'EXPORT_LUT' ||
    st === 'EXPORT_WITH_PAYMENT' ||
    (!!rec.currency && rec.currency !== 'INR' && !posRaw);
  const zeroRated = isExport || isSez || isZeroRated(st) || isIgstZeroRated(st);
  const invTyp: PDoc['invTyp'] =
    st === 'SEZ_WITH_PAYMENT' ? 'SEWP' : st === 'SEZ_WITHOUT_PAYMENT' ? 'SEWOP' : st === 'DEEMED_EXPORT' ? 'DE' : 'R';
  const pos = posRaw || from;
  if (missing && !isExport) {
    push(
      'error',
      'POS_MISSING',
      posRaw
        ? `place of supply not set; assumed ${posRaw} from the client record.`
        : 'place of supply is missing and could not be inferred; assumed the filer state.',
    );
  }
  if (rec.currency && rec.currency !== 'INR') {
    push('warning', 'FOREIGN_CCY', `amounts are in ${rec.currency}; GST returns need INR values. Reported as-is.`);
  }

  const mode = effectiveMode(rec.gst_mode, from, pos);
  // Full record in: supply type, tax-inclusive pricing, cess, TCS and round mode all change the split.
  const calc = calculateInvoice(calcInputFromRecord(rec, { gst_mode: mode, amount_paid: 0 }));

  const supply: 'INTRA' | 'INTER' =
    mode === 'CGST_SGST' ? 'INTRA' : mode === 'IGST' ? 'INTER' : from && pos && from !== pos ? 'INTER' : 'INTRA';
  if (mode === 'CGST_SGST' && from && pos && from !== pos && !isExport) {
    push('warning', 'MODE_MISMATCH', `charged CGST+SGST but place of supply (${pos}) differs from your state (${from}); IGST may apply.`);
  }
  if (mode === 'IGST' && from && pos && from === pos) {
    push('warning', 'MODE_MISMATCH', `charged IGST but place of supply equals your state (${from}); CGST+SGST may apply.`);
  }

  const gstinRaw = (rec.client?.gstin ?? '').trim().toUpperCase();
  const chk = checkGstin(gstinRaw);
  if (gstinRaw && !chk.valid) {
    push('error', 'GSTIN_INVALID', `client GSTIN "${gstinRaw}" is invalid (${chk.message}); treated as unregistered.`, '/clients', 'Fix client');
  }
  const registered = chk.valid;
  if (registered && chk.stateCode && pos && chk.stateCode !== pos && !isExport) {
    push('info', 'POS_VS_GSTIN', `place of supply ${pos} differs from client GSTIN state ${chk.stateCode}; correct only for ship-to / bill-to cases.`);
  }

  const recorded = num(rec.total, NaN);
  const value = Number.isFinite(recorded) && recorded > 0 ? round2(recorded) : calc.total;
  if (Number.isFinite(recorded) && Math.abs(recorded - calc.total) > 1.01) {
    push('warning', 'TOTAL_MISMATCH', `stored total ${recorded} differs from recomputed ${calc.total}; the report uses the recomputed tax split.`);
  }

  const lines: PLine[] = calc.lines.map((l) => ({
    // Zero-rated supplies keep the slab they were priced at (GSTR-1 reports txval against it).
    rate: mode === 'NONE' ? 0 : zeroRated ? l.nominal_rate : l.tax_rate,
    hsn: l.hsn,
    uqc: toUqc(l.unit, l.hsn),
    desc: l.name,
    qty: l.quantity,
    taxable: l.taxable,
    igst: l.igst,
    cgst: l.cgst,
    sgst: l.sgst,
    cess: l.cess,
    lineTotal: l.total,
  }));

  if (lines.some((l) => l.taxable > 0 && !l.hsn)) {
    push('warning', 'HSN_MISSING', 'one or more line items have no HSN/SAC code (mandatory in the HSN summary).');
  }
  if (!senderGstin && lines.some((l) => l.igst + l.cgst + l.sgst > 0)) {
    push('warning', 'NO_FILER_GSTIN', 'tax is charged but the sender profile has no GSTIN.', '/settings', 'Open settings');
  }
  if (!rec.invoice_number) push('warning', 'NO_NUMBER', 'document has no number.');

  return {
    rec,
    sign: isNote ? -1 : 1,
    isNote,
    number: rec.invoice_number,
    date: String(rec.issue_date).slice(0, 10),
    pos,
    supply,
    registered,
    ctin: registered ? gstinRaw : '',
    isExport,
    zeroRated,
    invTyp,
    rcm: !!rec.reverse_charge,
    senderGstin,
    value,
    lines,
  };
}

const taxOf = (l: PLine) => l.igst + l.cgst + l.sgst;
/** A nil / exempt / non-GST line: no rate, no tax and no cess. */
const isNilLine = (l: PLine) => l.rate <= 0 && taxOf(l) === 0 && l.cess === 0;

function rateRows(lines: PLine[]): RateRow[] {
  const map = new Map<number, RateRow>();
  for (const l of lines) {
    if (isNilLine(l)) continue; // nil lines go to table 8
    const r = map.get(l.rate) ?? { rate: l.rate, txval: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 };
    r.txval = round2(r.txval + l.taxable);
    r.igst = round2(r.igst + l.igst);
    r.cgst = round2(r.cgst + l.cgst);
    r.sgst = round2(r.sgst + l.sgst);
    r.cess = round2(r.cess + l.cess);
    map.set(l.rate, r);
  }
  return [...map.values()].sort((a, b) => a.rate - b.rate);
}

function docRow(d: PDoc, items: RateRow[]): DocRow {
  const sum = (k: 'txval' | 'igst' | 'cgst' | 'sgst' | 'cess') => round2(items.reduce((s, r) => s + r[k], 0));
  return {
    invoiceId: d.rec.id,
    number: d.number,
    date: d.date,
    value: d.value,
    pos: d.pos,
    rchrg: d.rcm ? 'Y' : 'N',
    partyName: d.rec.client?.company || d.rec.client?.name || '',
    ctin: d.ctin,
    items,
    taxable: sum('txval'),
    igst: sum('igst'),
    cgst: sum('cgst'),
    sgst: sum('sgst'),
    cess: sum('cess'),
    invTyp: d.invTyp,
  };
}

/* ───────────────────────── GSTR-1 ───────────────────────── */

function parseSeries(s: string): { prefix: string; n: number; width: number } | null {
  const m = /^(.*?)(\d+)$/.exec((s ?? '').trim());
  if (!m) return null;
  return { prefix: m[1], n: parseInt(m[2], 10), width: m[2].length };
}

function buildDocIssue(all: InvoiceRecord[]): DocIssueRow[] {
  interface Bucket { docType: string; prefix: string; width: number; nums: Set<number>; cancelled: Set<number> }
  const buckets = new Map<string, Bucket>();
  for (const rec of all) {
    if (!TAX_DOC_TYPES.has(rec.doc_type)) continue;
    const s = parseSeries(rec.invoice_number);
    if (!s) continue;
    const docType = rec.doc_type === 'CREDIT_NOTE' ? 'Credit Note' : 'Invoices for outward supply';
    const key = `${docType}|${s.prefix}`;
    const b = buckets.get(key) ?? { docType, prefix: s.prefix, width: s.width, nums: new Set<number>(), cancelled: new Set<number>() };
    b.nums.add(s.n);
    b.width = Math.max(b.width, s.width);
    // A draft consumed a number but was never issued — treated like a cancelled one.
    if (rec.status === 'Cancelled' || rec.status === 'Draft') b.cancelled.add(s.n);
    buckets.set(key, b);
  }
  const rows: DocIssueRow[] = [];
  for (const b of buckets.values()) {
    const sorted = [...b.nums].sort((x, y) => x - y);
    const lo = sorted[0];
    const hi = sorted[sorted.length - 1];
    const total = hi - lo + 1;
    const gaps = total - sorted.length;
    const cancelled = b.cancelled.size + gaps;
    const fmt = (n: number) => `${b.prefix}${String(n).padStart(b.width, '0')}`;
    rows.push({
      docType: b.docType,
      series: b.prefix.replace(/[/\-\s]+$/, '') || '(no prefix)',
      from: fmt(lo),
      to: fmt(hi),
      total,
      cancelled,
      netIssued: total - cancelled,
    });
  }
  return rows.sort((a, b) => a.docType.localeCompare(b.docType) || a.series.localeCompare(b.series));
}

type Acc = { txval: number; igst: number; cgst: number; sgst: number; cess: number };
function addLine(target: Acc, l: PLine, sign: number) {
  target.txval = round2(target.txval + sign * l.taxable);
  target.igst = round2(target.igst + sign * l.igst);
  target.cgst = round2(target.cgst + sign * l.cgst);
  target.sgst = round2(target.sgst + sign * l.sgst);
  target.cess = round2(target.cess + sign * l.cess);
}

export interface PreparedGstr1 {
  docs: PDoc[];
  gstr1: Gstr1Report;
}

export function buildGstr1(invoices: InvoiceRecord[], opts: BuildOptions, issues: ReconIssue[] = []): PreparedGstr1 {
  const wantGstin = (opts.gstin ?? '').trim().toUpperCase();
  const counts = { included: 0, drafts: 0, cancelled: 0, notTaxDocs: 0 };
  const inScope = (invoices ?? []).filter((r) => {
    if (!r || !inPeriod(r.issue_date, opts.period)) return false;
    const sg = (r.sender?.companyGstin ?? '').trim().toUpperCase();
    return !(wantGstin && sg && sg !== wantGstin);
  });

  const docs: PDoc[] = [];
  for (const rec of inScope) {
    if (!TAX_DOC_TYPES.has(rec.doc_type)) {
      counts.notTaxDocs++;
      continue;
    }
    if (rec.status === 'Draft') {
      counts.drafts++;
      continue;
    }
    if (rec.status === 'Cancelled') {
      counts.cancelled++;
      continue;
    }
    counts.included++;
    docs.push(prepare(rec, opts, issues));
  }

  const b2b: DocRow[] = [];
  const b2cl: DocRow[] = [];
  const cdnr: CdnRow[] = [];
  const cdnur: CdnRow[] = [];
  const exp: ExportRow[] = [];
  const b2csMap = new Map<string, B2csRow>();
  const nilMap = new Map<NilSupplyType, NilRow>();
  const hsnMap = new Map<string, HsnRow>();
  const totals = { taxable: 0, igst: 0, cgst: 0, sgst: 0, value: 0, cess: 0 };

  const nilKey = (d: PDoc): NilSupplyType =>
    d.supply === 'INTER' ? (d.registered ? 'INTRB2B' : 'INTRB2C') : d.registered ? 'INTRAB2B' : 'INTRAB2C';

  for (const d of docs) {
    const items = rateRows(d.lines);
    const row = docRow(d, items);
    const label = d.number || d.rec.id;

    // ── Section routing (taxable lines only; nil lines go to table 8) ──
    if (d.isExport) {
      if (d.isNote) cdnur.push({ ...row, noteType: 'C', unregType: row.igst > 0 ? 'EXPWP' : 'EXPWOP' });
      else exp.push({ ...row, expType: row.igst > 0 ? 'WPAY' : 'WOPAY' });
    } else if (d.registered) {
      if (items.length > 0) {
        if (d.isNote) cdnr.push({ ...row, noteType: 'C' });
        else b2b.push(row);
      }
    } else if (d.supply === 'INTER' && d.value > B2CL_THRESHOLD) {
      if (items.length > 0) {
        if (d.isNote) cdnur.push({ ...row, noteType: 'C', unregType: 'B2CL' });
        else b2cl.push(row);
      }
      if (!d.isNote) {
        issues.push({
          id: `B2CL_REVIEW:${d.rec.id}`,
          severity: 'warning',
          code: 'B2CL_REVIEW',
          message: `${label}: inter-state sale of ${d.value.toFixed(2)} to an unregistered buyer (above ₹2.5 lakh) is reported as B2CL. If the buyer has a GSTIN, add it so this moves to B2B.`,
          invoiceId: d.rec.id,
          invoiceNumber: d.number,
          link: '/clients',
          linkLabel: 'Add client GSTIN',
        });
      }
    } else {
      for (const l of d.lines) {
        if (isNilLine(l)) continue;
        const key = `${d.supply}|${d.pos}|${l.rate}`;
        const r = b2csMap.get(key) ?? { supply: d.supply, pos: d.pos, rate: l.rate, txval: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 };
        addLine(r, l, d.sign);
        b2csMap.set(key, r);
      }
    }

    // ── Net totals, nil table, HSN table (sign-aware) ──
    totals.value = round2(totals.value + d.sign * d.value);
    for (const l of d.lines) {
      totals.taxable = round2(totals.taxable + d.sign * l.taxable);
      totals.igst = round2(totals.igst + d.sign * l.igst);
      totals.cgst = round2(totals.cgst + d.sign * l.cgst);
      totals.sgst = round2(totals.sgst + d.sign * l.sgst);
      totals.cess = round2(totals.cess + d.sign * l.cess);

      const isNil = isNilLine(l) && l.taxable !== 0;
      if (isNil && !d.zeroRated) {
        const k = nilKey(d);
        const n = nilMap.get(k) ?? { type: k, nil: 0, exempt: 0, nonGst: 0 };
        // No GSTIN on the sender means the supply is outside GST altogether.
        if (d.senderGstin) n.nil = round2(n.nil + d.sign * l.taxable);
        else n.nonGst = round2(n.nonGst + d.sign * l.taxable);
        nilMap.set(k, n);
      }

      if (!d.senderGstin && taxOf(l) === 0 && l.cess === 0) continue; // outside GST — not in the HSN summary
      const hsn = l.hsn || 'NA';
      const key = `${hsn}|${l.uqc}|${l.rate}`;
      const h =
        hsnMap.get(key) ??
        { hsn, description: l.desc, uqc: l.uqc, qty: 0, value: 0, taxable: 0, rate: l.rate, igst: 0, cgst: 0, sgst: 0, cess: 0 };
      h.qty = round2(h.qty + d.sign * (l.uqc === 'NA' ? 0 : l.qty));
      h.value = round2(h.value + d.sign * l.lineTotal);
      h.taxable = round2(h.taxable + d.sign * l.taxable);
      h.igst = round2(h.igst + d.sign * l.igst);
      h.cgst = round2(h.cgst + d.sign * l.cgst);
      h.sgst = round2(h.sgst + d.sign * l.sgst);
      h.cess = round2(h.cess + d.sign * l.cess);
      hsnMap.set(key, h);
    }
  }

  const byDate = <T extends { date: string; number: string }>(a: T, b: T) =>
    a.date.localeCompare(b.date) || a.number.localeCompare(b.number);
  b2b.sort(byDate);
  b2cl.sort(byDate);
  cdnr.sort(byDate);
  cdnur.sort(byDate);
  exp.sort(byDate);

  const gstr1: Gstr1Report = {
    period: opts.period,
    gstin: wantGstin,
    fp: periodFp(opts.period),
    b2b,
    b2cl,
    b2cs: [...b2csMap.values()].sort((a, b) => a.pos.localeCompare(b.pos) || a.rate - b.rate),
    cdnr,
    cdnur,
    exp,
    nil: [...nilMap.values()].sort((a, b) => a.type.localeCompare(b.type)),
    hsn: [...hsnMap.values()].sort((a, b) => a.hsn.localeCompare(b.hsn) || a.rate - b.rate),
    docIssue: buildDocIssue(inScope),
    // `cess` only appears when there is some, so reports without cess keep their exact shape.
    totals: totals.cess === 0 ? { taxable: totals.taxable, igst: totals.igst, cgst: totals.cgst, sgst: totals.sgst, value: totals.value } : totals,
    counts,
  };
  return { docs, gstr1 };
}

/* ───────────────────────── Purchases (defensive) ───────────────────────── */

export interface NormalizedPurchase {
  id: string;
  number: string;
  date: string;
  supplierName: string;
  supplierGstin: string;
  supplierState: string;
  reverseCharge: boolean;
  itcEligible: boolean;
  taxable: number;
  igst: number;
  cgst: number;
  sgst: number;
  /** ITC reversed against this bill (amount, spread pro-rata over the heads). */
  itcReversed: number;
}

/**
 * Reads a purchase row through the shared purchases reader. Returns null for
 * rows that must not count (drafts, cancelled, no usable date).
 * `itc_eligible === false` marks ineligible ITC; anything else is eligible.
 * With an explicit cgst/sgst/igst split (what the purchases module writes) that
 * split is used as-is; otherwise a lump `tax_amount` (or taxable x rate) is split
 * by supplier state vs the filer's state.
 */
export function normalizePurchase(raw: unknown, filerStateCode: string): NormalizedPurchase | null {
  const c = readPurchase(raw);
  if (!c || isVoidStatus(c.status)) return null;
  const o = raw as Record<string, unknown>;
  const supState =
    checkGstin(c.partyGstin).stateCode ?? stateByCode(c.vendorStateCode || c.placeOfSupply)?.code ?? '';

  let { igst, cgst, sgst } = c;
  let taxable = c.taxable;
  if (!c.hasSplit) {
    let tax = c.taxField;
    if (tax === undefined) {
      const rate = pickNum(o, ['tax_rate', 'gst_rate']);
      if (rate !== undefined) tax = round2((taxable * rate) / 100);
    }
    tax = tax ?? 0;
    const inter = supState && filerStateCode ? supState !== filerStateCode : false;
    if (inter) igst = round2(tax);
    else {
      sgst = round2(tax / 2);
      cgst = round2(tax - sgst);
    }
    // A lump tax_amount was not available to the taxable fallback inside readPurchase.
    if (c.taxField === undefined && pickNum(o, ['taxable', 'taxable_value', 'taxable_amount', 'subtotal']) === undefined) {
      taxable = round2(Math.max(c.total - tax, 0));
    }
  }

  return {
    id: c.id || `${c.date}:${c.number}`,
    number: c.number,
    date: c.date,
    supplierName: c.partyName,
    supplierGstin: c.partyGstin,
    supplierState: supState,
    reverseCharge: c.reverseCharge,
    itcEligible: c.itcEligible,
    taxable: round2(taxable),
    igst: round2(igst),
    cgst: round2(cgst),
    sgst: round2(sgst),
    itcReversed: c.itcReversed,
  };
}

/* ───────────────────────── GSTR-3B ───────────────────────── */

const zeroHeads = (): ItcHeads => ({ igst: 0, cgst: 0, sgst: 0, cess: 0 });
const zeroRow = (): Gstr3bTaxRow => ({ taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 });

/**
 * Table 6.1 set-off, following the GST ordering rules:
 *  1. IGST credit settles IGST, then CGST, then SGST liability.
 *  2. CGST credit then settles CGST, then IGST (never SGST).
 *  3. SGST credit then settles SGST, then IGST (never CGST).
 * Reverse-charge tax can only be paid in cash, so it bypasses ITC entirely.
 */
export function computeSetOff(
  liability: { igst: number; cgst: number; sgst: number },
  credit: { igst: number; cgst: number; sgst: number },
  rcLiability: { igst: number; cgst: number; sgst: number } = { igst: 0, cgst: 0, sgst: 0 },
): SetOffResult {
  const L = { igst: Math.max(round2(liability.igst), 0), cgst: Math.max(round2(liability.cgst), 0), sgst: Math.max(round2(liability.sgst), 0) };
  const C = { igst: Math.max(round2(credit.igst), 0), cgst: Math.max(round2(credit.cgst), 0), sgst: Math.max(round2(credit.sgst), 0) };
  const rem = { ...L };
  const avail = { ...C };
  const used = {
    igst: { igst: 0, cgst: 0, sgst: 0 },
    cgst: { cgst: 0, igst: 0 },
    sgst: { sgst: 0, igst: 0 },
  };
  const take = (credHead: 'igst' | 'cgst' | 'sgst', liabHead: 'igst' | 'cgst' | 'sgst') => {
    const amt = Math.min(avail[credHead], rem[liabHead]);
    if (amt <= 0) return;
    avail[credHead] = round2(avail[credHead] - amt);
    rem[liabHead] = round2(rem[liabHead] - amt);
    (used[credHead] as Record<string, number>)[liabHead] = round2(((used[credHead] as Record<string, number>)[liabHead] ?? 0) + amt);
  };
  take('igst', 'igst');
  take('igst', 'cgst');
  take('igst', 'sgst');
  take('cgst', 'cgst');
  take('cgst', 'igst');
  take('sgst', 'sgst');
  take('sgst', 'igst');
  return {
    liability: L,
    rcLiability: { igst: round2(rcLiability.igst), cgst: round2(rcLiability.cgst), sgst: round2(rcLiability.sgst) },
    itcUsed: used,
    cash: {
      igst: round2(rem.igst + rcLiability.igst),
      cgst: round2(rem.cgst + rcLiability.cgst),
      sgst: round2(rem.sgst + rcLiability.sgst),
    },
    itcCarry: { igst: avail.igst, cgst: avail.cgst, sgst: avail.sgst },
  };
}

export function buildGstr3b(
  docs: PDoc[],
  purchases: NormalizedPurchase[],
  opts: BuildOptions,
  filerStateCode: string,
): Gstr3bReport {
  const taxable = zeroRow();
  const zero = zeroRow();
  const nil = { inter: 0, intra: 0 };
  let nonGst = 0;
  let outwardRcmTaxable = 0;
  const unregInter = new Map<string, { pos: string; taxable: number; igst: number }>();

  for (const d of docs) {
    for (const l of d.lines) {
      const s = d.sign;
      if (d.rcm && !d.zeroRated) {
        outwardRcmTaxable = round2(outwardRcmTaxable + s * l.taxable);
        continue;
      }
      if (d.zeroRated) {
        // 3.1(b): exports and SEZ supplies (with or without IGST payment).
        zero.taxable = round2(zero.taxable + s * l.taxable);
        zero.igst = round2(zero.igst + s * l.igst);
        zero.cess = round2(zero.cess + s * l.cess);
        continue;
      }
      if (isNilLine(l)) {
        if (!d.senderGstin) nonGst = round2(nonGst + s * l.taxable);
        else if (d.supply === 'INTER') nil.inter = round2(nil.inter + s * l.taxable);
        else nil.intra = round2(nil.intra + s * l.taxable);
        continue;
      }
      taxable.taxable = round2(taxable.taxable + s * l.taxable);
      taxable.igst = round2(taxable.igst + s * l.igst);
      taxable.cgst = round2(taxable.cgst + s * l.cgst);
      taxable.sgst = round2(taxable.sgst + s * l.sgst);
      taxable.cess = round2(taxable.cess + s * l.cess);
      if (!d.registered && d.supply === 'INTER') {
        const u = unregInter.get(d.pos) ?? { pos: d.pos, taxable: 0, igst: 0 };
        u.taxable = round2(u.taxable + s * l.taxable);
        u.igst = round2(u.igst + s * l.igst);
        unregInter.set(d.pos, u);
      }
    }
  }

  const rcm = zeroRow();
  const availRcm = zeroHeads();
  const availOther = zeroHeads();
  const reversed = zeroHeads();
  const ineligible = zeroHeads();
  const inwardExempt = { inter: 0, intra: 0 };

  const add = (h: ItcHeads, p: { igst: number; cgst: number; sgst: number }, f = 1) => {
    h.igst = round2(h.igst + f * p.igst);
    h.cgst = round2(h.cgst + f * p.cgst);
    h.sgst = round2(h.sgst + f * p.sgst);
  };

  for (const p of purchases) {
    const tax = round2(p.igst + p.cgst + p.sgst);
    if (p.reverseCharge) {
      rcm.taxable = round2(rcm.taxable + p.taxable);
      add(rcm, p);
      if (p.itcEligible) add(availRcm, p);
      else add(ineligible, p);
    } else if (tax === 0) {
      const inter = p.supplierState && filerStateCode ? p.supplierState !== filerStateCode : false;
      if (inter) inwardExempt.inter = round2(inwardExempt.inter + p.taxable);
      else inwardExempt.intra = round2(inwardExempt.intra + p.taxable);
    } else if (p.itcEligible) {
      add(availOther, p);
    } else {
      add(ineligible, p);
    }
    if (p.itcReversed > 0 && tax > 0 && p.itcEligible) {
      const ratio = Math.min(p.itcReversed, tax) / tax;
      add(reversed, { igst: p.igst * ratio, cgst: p.cgst * ratio, sgst: p.sgst * ratio });
    }
  }

  const net: ItcHeads = {
    igst: Math.max(round2(availRcm.igst + availOther.igst - reversed.igst), 0),
    cgst: Math.max(round2(availRcm.cgst + availOther.cgst - reversed.cgst), 0),
    sgst: Math.max(round2(availRcm.sgst + availOther.sgst - reversed.sgst), 0),
    cess: 0,
  };

  const liab = {
    igst: round2(taxable.igst + zero.igst),
    cgst: round2(taxable.cgst + zero.cgst),
    sgst: round2(taxable.sgst + zero.sgst),
  };
  const unadjusted = {
    igst: Math.max(round2(-liab.igst), 0),
    cgst: Math.max(round2(-liab.cgst), 0),
    sgst: Math.max(round2(-liab.sgst), 0),
  };
  const payment = computeSetOff(liab, net, { igst: rcm.igst, cgst: rcm.cgst, sgst: rcm.sgst });
  // Cess cannot be settled with IGST/CGST/SGST credit, so the whole (net) liability is cash.
  payment.cess = Math.max(round2(taxable.cess + zero.cess), 0);

  void opts;
  return {
    outward: { taxable, zeroRated: zero, nilExempt: nil, inwardRcm: rcm, nonGst },
    interStateUnreg: [...unregInter.values()].sort((a, b) => a.pos.localeCompare(b.pos)),
    itc: { availableRcm: availRcm, availableOther: availOther, reversedOther: reversed, net, ineligible },
    inwardExempt,
    payment,
    unadjustedCredit: unadjusted,
    purchasesConsidered: purchases.length,
    outwardRcmTaxable,
  };
}

/* ───────────────────────── Orchestrator ───────────────────────── */

export function buildGstReport(
  invoices: InvoiceRecord[],
  rawPurchases: unknown[],
  opts: BuildOptions,
): GstReport {
  const issues: ReconIssue[] = [];
  const { docs, gstr1 } = buildGstr1(invoices, opts, issues);

  // Filer state: explicit GSTIN, else first included document's sender, else fallback.
  const filerSt =
    filerState(opts.gstin ?? '', opts.filerStateCode) ||
    filerState(docs.find((d) => d.senderGstin)?.senderGstin ?? '', opts.filerStateCode);

  const purchases: NormalizedPurchase[] = [];
  let skipped = 0;
  for (const raw of rawPurchases ?? []) {
    const p = normalizePurchase(raw, filerSt);
    if (!p) {
      skipped++;
      continue;
    }
    if (!inPeriod(p.date, opts.period)) continue;
    purchases.push(p);
    const claimed = p.itcEligible && p.igst + p.cgst + p.sgst > 0;
    if (claimed && !p.reverseCharge && !checkGstin(p.supplierGstin).valid) {
      issues.push({
        id: `ITC_NO_GSTIN:${p.id}`,
        severity: p.supplierGstin ? 'error' : 'warning',
        code: 'ITC_NO_GSTIN',
        message: `Purchase ${p.number || p.id}: ITC is claimed but the supplier GSTIN is ${p.supplierGstin ? 'invalid' : 'missing'}; it will not match GSTR-2B.`,
        link: '/purchases',
        linkLabel: 'Open purchases',
      });
    }
  }
  if (purchases.length === 0) {
    issues.push({
      id: 'NO_PURCHASES',
      severity: 'info',
      code: 'NO_PURCHASES',
      message: 'No purchase bills found in this period, so GSTR-3B shows no input tax credit. Add purchases to claim ITC.',
      link: '/purchases',
      linkLabel: 'Open purchases',
    });
  }

  const c = gstr1.counts;
  if (c.drafts > 0) {
    issues.push({ id: 'DRAFTS', severity: 'info', code: 'DRAFTS', message: `${c.drafts} draft document(s) in this period were excluded. Send or finalise them if they are real sales.`, link: '/transactions', linkLabel: 'Open ledger' });
  }
  if (c.cancelled > 0) {
    issues.push({ id: 'CANCELLED', severity: 'info', code: 'CANCELLED', message: `${c.cancelled} cancelled document(s) are excluded from tax tables and counted in the document summary.` });
  }
  for (const r of gstr1.docIssue) {
    const gaps = r.cancelled; // includes cancelled + drafts + missing; flag only when sequence has holes
    if (gaps > 0 && r.total > 0) {
      issues.push({
        id: `SERIES:${r.docType}:${r.series}`,
        severity: 'info',
        code: 'SERIES_CANCELLED',
        message: `${r.series}: ${gaps} of ${r.total} numbers (${r.from} to ${r.to}) are cancelled, draft or missing and are reported as cancelled.`,
      });
    }
  }
  void skipped;

  const order: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
  issues.sort((a, b) => order[a.severity] - order[b.severity]);
  return { gstr1, gstr3b: buildGstr3b(docs, purchases, opts, filerSt), issues };
}
