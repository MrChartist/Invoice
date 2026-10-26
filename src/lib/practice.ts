/**
 * R3-C6 practice desk: one read-only board row per company on this device, built from tables peeked
 * out of each company's database (`peekCompliance` in `company-peek.ts`) or, for the open company, from
 * the live storage. Pure: the input is never changed (tests pass frozen objects).
 *
 * Due dates come from the standard compliance calendar (`compliance.ts`, date-keyed in `tax-rules.ts`);
 * notified extensions are not tracked — the board says "due dates as per the standard calendar; check
 * notified extensions — verify with your CA".
 */

import { FORM_LABELS, complianceCalendar, daysBetween, filedFor, returnStatus, type FiledReturn, type FilerFrequency, type ReturnDue } from './compliance';
import { daysToExpiry, nearestExpiry, type DscRow } from './dsc-register';
import { readPurchase } from './purchase-normalize';
import { BUILTIN_TEMPLATE, monthChecklist, progress, type ChecklistMonth } from './client-checklist';

/** The tables the board reads for one company (all optional: a fresh company has none). */
export interface PracticeTables {
  settings?: unknown;
  compliance?: readonly FiledReturn[];
  tds_returns?: readonly { id?: string; form?: string; fy?: number; quarter?: number; filed_on?: string }[];
  dsc_register?: readonly DscRow[];
  client_checklist?: readonly ChecklistMonth[];
  checklist_template?: readonly string[];
  invoices?: readonly { issue_date?: string; status?: string; doc_type?: string }[];
  vouchers?: readonly { date?: string }[];
  /** Raw `purchases` rows (read through `readPurchase`, the shared purchase contract). */
  purchases?: readonly unknown[];
}

export interface PeekedCompany {
  id: string;
  name: string;
  /** Vault-sealed or unreadable: the row shows "Locked — open to see". */
  locked?: boolean;
  current?: boolean;
  tables?: PracticeTables;
}

export interface PracticeRow {
  id: string;
  name: string;
  current: boolean;
  locked: boolean;
  gstins: string[];
  frequency: FilerFrequency;
  /** Next unfiled, non-optional return due today or later. */
  nextDue?: { form: string; label: string; due: string };
  overdue: number;
  overdueForms: string[];
  /** Latest TDS / TCS return marked filed ("26Q FY25 Q3"). */
  lastTds?: string;
  tdsFiledThisFy: number;
  lastVoucher?: string;
  lockUntil?: string;
  drafts: number;
  checklist: { done: number; total: number };
  dsc?: { holder: string; validTo: string; days: number };
}

type Settings = { profiles?: { companyGstin?: string; stateCode?: string; gst_scheme?: string }[]; gst_filing_frequency?: string; lock_until?: string };

const DAY = /^\d{4}-\d{2}-\d{2}/;
const maxDay = (vals: readonly (string | undefined)[]) => vals.reduce<string>((m, v) => (v && DAY.test(v) && v.slice(0, 10) > m ? v.slice(0, 10) : m), '');
const fyStartOf = (day: string) => (+day.slice(5, 7) >= 4 ? +day.slice(0, 4) : +day.slice(0, 4) - 1);

function frequencyOf(s: Settings): FilerFrequency {
  const f = s.gst_filing_frequency;
  if (f === 'qrmp' || f === 'composition') return f;
  if ((s.profiles ?? []).some((p) => p?.gst_scheme === 'composition')) return 'composition';
  return 'monthly';
}

/** One board row. `today` is a local day YYYY-MM-DD. */
export function buildPracticeRow(c: PeekedCompany, today: string): PracticeRow {
  const base: PracticeRow = {
    id: c.id, name: c.name, current: !!c.current, locked: !!c.locked, gstins: [], frequency: 'monthly',
    overdue: 0, overdueForms: [], tdsFiledThisFy: 0, drafts: 0, checklist: { done: 0, total: 0 },
  };
  if (c.locked || !c.tables) return base;
  const t = c.tables;
  const s = (t.settings && typeof t.settings === 'object' ? t.settings : {}) as Settings;
  const gstins = [...new Set((s.profiles ?? []).map((p) => String(p?.companyGstin ?? '').trim().toUpperCase()).filter(Boolean))];
  const frequency = frequencyOf(s);
  const stateCode = (s.profiles ?? []).find((p) => p?.stateCode)?.stateCode;
  const invoices = t.invoices ?? [];
  const issued = invoices.filter((i) => i && i.status !== 'Draft');
  const since = issued.map((i) => String(i.issue_date ?? '')).filter((d) => DAY.test(d)).sort()[0];
  const filed = t.compliance ?? [];

  // Overdue / next due across the company's GSTINs (one pass with '' when none is set).
  const overdueForms: string[] = [];
  let next: ReturnDue | undefined;
  if (since) {
    const cal = complianceCalendar({ frequency, stateCode, today, since, monthsBack: 12 });
    for (const g of gstins.length ? gstins : ['']) {
      for (const r of cal) {
        if (r.optional) continue;
        const st = returnStatus(r, today, filedFor(filed, r, g));
        if (st === 'overdue') overdueForms.push(`${FORM_LABELS[r.form]} ${r.label}${gstins.length > 1 ? ` (${g})` : ''}`);
        else if (st !== 'filed' && daysBetween(today, r.due) >= 0 && (!next || r.due < next.due)) next = r;
      }
    }
  }

  const tds = [...(t.tds_returns ?? [])].filter((m) => m && m.form && m.fy && m.quarter).sort((a, b) => (b.fy! - a.fy!) || (b.quarter! - a.quarter!));
  const fy = fyStartOf(today);
  const dsc = nearestExpiry(t.dsc_register ?? []);
  const month = today.slice(0, 7);

  return {
    ...base,
    gstins,
    frequency,
    ...(next ? { nextDue: { form: FORM_LABELS[next.form], label: next.label, due: next.due } } : {}),
    overdue: overdueForms.length,
    overdueForms,
    ...(tds[0] ? { lastTds: `${tds[0].form} FY${String(tds[0].fy).slice(2)} Q${tds[0].quarter}` } : {}),
    tdsFiledThisFy: tds.filter((m) => m.fy === fy).length,
    ...(() => {
      const v = maxDay([...issued.map((i) => i.issue_date), ...(t.vouchers ?? []).map((x) => x?.date), ...(t.purchases ?? []).map((p) => readPurchase(p)?.date)]);
      return v ? { lastVoucher: v } : {};
    })(),
    ...(s.lock_until && DAY.test(s.lock_until) ? { lockUntil: s.lock_until.slice(0, 10) } : {}),
    drafts: invoices.filter((i) => i?.status === 'Draft').length,
    checklist: progress(monthChecklist(t.client_checklist ?? [], month, t.checklist_template?.length ? t.checklist_template : BUILTIN_TEMPLATE)),
    ...(dsc ? { dsc: { holder: dsc.holder, validTo: dsc.valid_to, days: daysToExpiry(dsc, today) } } : {}),
  };
}

export function buildPracticeBoard(companies: readonly PeekedCompany[], today: string): PracticeRow[] {
  return companies.map((c) => buildPracticeRow(c, today));
}

/** Board rows for CSV / XLSX export (header first). Statutory columns keep the "verify" note. */
export function boardTable(rows: readonly PracticeRow[]): (string | number)[][] {
  return [
    ['Company', 'GSTIN(s)', 'Filing', 'Next due return', 'Due on', 'Overdue returns', 'Last TDS/TCS return filed', 'TDS/TCS returns filed this FY', 'Last voucher', 'Books locked up to', 'Drafts', 'Checklist done', 'Checklist items', 'Nearest DSC expiry', 'DSC holder', 'Note'],
    ...rows.map((r) => r.locked
      ? [r.name, '', '', '', '', '', '', '', '', '', '', '', '', '', '', 'Locked — open the company to see']
      : [r.name, r.gstins.join(' '), r.frequency, r.nextDue ? `${r.nextDue.form} ${r.nextDue.label}` : '', r.nextDue?.due ?? '', r.overdue, r.lastTds ?? '', r.tdsFiledThisFy, r.lastVoucher ?? '', r.lockUntil ?? '', r.drafts, r.checklist.done, r.checklist.total, r.dsc?.validTo ?? '', r.dsc?.holder ?? '', 'Due dates as per the standard calendar; check notified extensions — verify with your CA']),
  ];
}
