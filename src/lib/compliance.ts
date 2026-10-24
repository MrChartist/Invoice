/**
 * GST compliance calendar: return due dates per tax period (monthly or QRMP)
 * and filed status. Interest / late-fee estimates live in `gst-penalties.ts`
 * (kept apart: this module is loaded early by the notification bell).
 *
 * Pure date maths on bare `YYYY-MM-DD` strings (never `new Date(str)`, AGENTS.md
 * rule 8); every statutory number comes from the date-keyed rules in
 * `tax-rules.ts`. Due-date extensions notified ad hoc by CBIC are not tracked,
 * so this is a working paper — verify with your CA / the GST portal.
 *
 * Filed marks live in the `compliance` table (`mrchartist_inv_compliance`).
 */

import { QRMP_3B_CATEGORY_Y, returnDueDays } from './tax-rules';
import { getTable, setTable } from './storage';

export type FilerFrequency = 'monthly' | 'qrmp';
export type ReturnForm = 'GSTR1' | 'IFF' | 'PMT06' | 'GSTR3B' | 'GSTR9';

export interface ReturnDue {
  /** `${form}:${periodKey}` */
  id: string;
  form: ReturnForm;
  /** `2025-04` (month), `2025-Q1` (FY quarter, Q1 = Apr-Jun) or `FY2025` (FY starting 2025). */
  periodKey: string;
  label: string;
  /** Inclusive period range. */
  from: string;
  to: string;
  due: string;
  /** IFF and PMT-06: shown on the calendar, never overdue and never notified. */
  optional: boolean;
}

export const FORM_LABELS: Record<ReturnForm, string> = {
  GSTR1: 'GSTR-1',
  IFF: 'IFF (optional)',
  PMT06: 'PMT-06 payment',
  GSTR3B: 'GSTR-3B',
  GSTR9: 'GSTR-9',
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad = (n: number) => String(n).padStart(2, '0');
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const day = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(Math.min(d, lastDay(y, m)))}`;
const fyLabel = (fyStart: number) => `FY ${String(fyStart).slice(2)}-${String(fyStart + 1).slice(2)}`;

/** Whole days from `a` to `b` (both `YYYY-MM-DD`; positive when `b` is later). */
export function daysBetween(a: string, b: string): number {
  const t = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  return Math.round((t(b) - t(a)) / 86400000);
}

/** QRMP GSTR-3B day for the filer's state (category Y → 24th, else 22nd). */
export function qrmp3bDay(stateCode: string | undefined, periodStart: string): number {
  const r = returnDueDays(periodStart);
  return QRMP_3B_CATEGORY_Y.includes((stateCode ?? '').padStart(2, '0')) ? r.gstr3bQrmpY : r.gstr3bQrmpX;
}

function mk(form: ReturnForm, periodKey: string, label: string, from: string, to: string, due: string, optional = false): ReturnDue {
  return { id: `${form}:${periodKey}`, form, periodKey, label, from, to, due, optional };
}

/** Every return (and the optional IFF / PMT-06) for tax-period month `m` of calendar year `y`. */
export function returnsForMonth(y: number, m: number, frequency: FilerFrequency, stateCode?: string): ReturnDue[] {
  const from = `${y}-${pad(m)}-01`;
  const to = day(y, m, 31);
  const rules = returnDueDays(from);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const key = `${y}-${pad(m)}`;
  const label = `${MONTHS[m - 1]} ${y}`;
  const out: ReturnDue[] = [];
  // QRMP exists only from the rule set that defines a quarterly day (1 Jan 2021).
  const qrmp = frequency === 'qrmp' && rules.gstr1Qrmp > 0;

  if (!qrmp) {
    out.push(mk('GSTR1', key, label, from, to, day(ny, nm, rules.gstr1)));
    out.push(mk('GSTR3B', key, label, from, to, day(ny, nm, rules.gstr3b)));
  } else if (m % 3 === 0) {
    // Jun / Sep / Dec / Mar close a quarter.
    const fyStart = m >= 4 ? y : y - 1;
    const q = Math.floor(((m - 4 + 12) % 12) / 3) + 1;
    const qFrom = `${y}-${pad(m - 2)}-01`;
    const qKey = `${fyStart}-Q${q}`;
    const qLabel = `Q${q} ${fyLabel(fyStart)} (${MONTHS[m - 3].slice(0, 3)}-${MONTHS[m - 1].slice(0, 3)})`;
    out.push(mk('GSTR1', qKey, qLabel, qFrom, to, day(ny, nm, returnDueDays(qFrom).gstr1Qrmp)));
    out.push(mk('GSTR3B', qKey, qLabel, qFrom, to, day(ny, nm, qrmp3bDay(stateCode, qFrom))));
  } else {
    out.push(mk('IFF', key, label, from, to, day(ny, nm, rules.iff), true));
    out.push(mk('PMT06', key, label, from, to, day(ny, nm, rules.pmt06), true));
  }

  if (m === 3) {
    const fyStart = y - 1;
    out.push(mk('GSTR9', `FY${fyStart}`, fyLabel(fyStart), `${fyStart}-04-01`, to, `${y}-${returnDueDays(`${fyStart}-04-01`).gstr9}`));
  }
  return out;
}

export interface CalendarOptions {
  frequency: FilerFrequency;
  stateCode?: string;
  /** Today, `YYYY-MM-DD`. */
  today: string;
  /** First day with activity (e.g. the earliest tax invoice); earlier periods are left out. */
  since?: string;
  /** How many months back to look (default 12). */
  monthsBack?: number;
}

/** Returns for every tax period from max(since, today − monthsBack) to the current month, by due date. */
export function complianceCalendar(o: CalendarOptions): ReturnDue[] {
  const ty = +o.today.slice(0, 4);
  const tm = +o.today.slice(5, 7);
  let idx = ty * 12 + tm - 1 - (o.monthsBack ?? 12);
  if (o.since && /^\d{4}-\d{2}/.test(o.since)) idx = Math.max(idx, +o.since.slice(0, 4) * 12 + +o.since.slice(5, 7) - 1);
  const out: ReturnDue[] = [];
  for (; idx <= ty * 12 + tm - 1; idx++) {
    out.push(...returnsForMonth(Math.floor(idx / 12), (idx % 12) + 1, o.frequency, o.stateCode));
  }
  return out.sort((a, b) => a.due.localeCompare(b.due) || a.form.localeCompare(b.form));
}

/* ── Filed status ─────────────────────────────────────────── */

export const COMPLIANCE_TABLE = 'compliance';

export interface FiledReturn {
  /** `${form}:${period_key}:${gstin}` */
  id: string;
  form: ReturnForm;
  period_key: string;
  /** Filer GSTIN the mark belongs to ('' = any). */
  gstin: string;
  /** Day the return was filed, `YYYY-MM-DD`. */
  filed_on: string;
  /** ISO timestamp of the click. */
  marked_at: string;
}

const sameGstin = (a: string, b: string) => !a || !b || a.toUpperCase() === b.toUpperCase();

export function filedFor(rows: readonly FiledReturn[], r: ReturnDue, gstin = ''): FiledReturn | undefined {
  return rows.find((x) => x && x.form === r.form && x.period_key === r.periodKey && sameGstin(x.gstin ?? '', gstin));
}

/** Marks `r` filed on `filedOn`, or clears the mark when `filedOn` is null. Pure. */
export function setFiled(rows: readonly FiledReturn[], r: ReturnDue, gstin: string, filedOn: string | null, now = new Date()): FiledReturn[] {
  const g = gstin.trim().toUpperCase();
  const rest = rows.filter((x) => !(x && x.form === r.form && x.period_key === r.periodKey && sameGstin(x.gstin ?? '', g)));
  if (!filedOn) return rest;
  return [...rest, { id: `${r.id}:${g}`, form: r.form, period_key: r.periodKey, gstin: g, filed_on: filedOn.slice(0, 10), marked_at: now.toISOString() }];
}

export const loadFiled = (): FiledReturn[] => getTable<FiledReturn>(COMPLIANCE_TABLE);
export const saveFiled = (rows: FiledReturn[]): void => setTable(COMPLIANCE_TABLE, rows);

export type ReturnStatus = 'filed' | 'overdue' | 'due-soon' | 'upcoming';

/** Due within this many days (inclusive) counts as "due soon". */
export const DUE_SOON_RETURN_DAYS = 3;

export function returnStatus(r: ReturnDue, today: string, filed?: FiledReturn | null): ReturnStatus {
  if (filed) return 'filed';
  const d = daysBetween(today, r.due);
  if (d < 0) return r.optional ? 'upcoming' : 'overdue';
  return d <= DUE_SOON_RETURN_DAYS ? 'due-soon' : 'upcoming';
}

/** Non-optional, unfiled returns that are overdue or due within 3 days (for notifications). */
export function pendingReturns(o: CalendarOptions, filed: readonly FiledReturn[], gstin = ''): { overdue: ReturnDue[]; soon: ReturnDue[] } {
  const overdue: ReturnDue[] = [];
  const soon: ReturnDue[] = [];
  for (const r of complianceCalendar(o)) {
    if (r.optional) continue;
    const s = returnStatus(r, o.today, filedFor(filed, r, gstin));
    if (s === 'overdue') overdue.push(r);
    else if (s === 'due-soon') soon.push(r);
  }
  return { overdue, soon };
}
