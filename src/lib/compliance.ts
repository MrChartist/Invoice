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

import { QRMP_3B_CATEGORY_Y, compositionDueDays, returnDueDays } from './tax-rules';
import { getTable, setTable } from './storage';

/** `composition` (5.9): CMP-08 every quarter and GSTR-4 every year instead of GSTR-1 / 3B / 9. */
export type FilerFrequency = 'monthly' | 'qrmp' | 'composition';
export type ReturnForm = 'GSTR1' | 'IFF' | 'PMT06' | 'GSTR3B' | 'GSTR9' | 'CMP08' | 'GSTR4';

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
  CMP08: 'CMP-08',
  GSTR4: 'GSTR-4',
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
  if (frequency === 'composition') return compositionReturnsForMonth(y, m);
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

/** Composition dealer: CMP-08 for the quarter ending in month `m`, and GSTR-4 after March (Rule 62). */
function compositionReturnsForMonth(y: number, m: number): ReturnDue[] {
  if (m % 3 !== 0) return [];
  const out: ReturnDue[] = [];
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const fyStart = m >= 4 ? y : y - 1;
  const q = Math.floor(((m - 4 + 12) % 12) / 3) + 1;
  const qFrom = `${y}-${pad(m - 2)}-01`;
  const qLabel = `Q${q} ${fyLabel(fyStart)} (${MONTHS[m - 3].slice(0, 3)}-${MONTHS[m - 1].slice(0, 3)})`;
  out.push(mk('CMP08', `${fyStart}-Q${q}`, qLabel, qFrom, day(y, m, 31), day(ny, nm, compositionDueDays(qFrom).cmp08)));
  if (m === 3) {
    const from = `${fyStart}-04-01`;
    out.push(mk('GSTR4', `FY${fyStart}`, fyLabel(fyStart), from, day(y, 3, 31), `${y}-${compositionDueDays(from).gstr4}`));
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
  /** Day the return was filed, `YYYY-MM-DD`; '' on a row that only remembers the download (R6-C4). */
  filed_on: string;
  /** ISO timestamp of the click. */
  marked_at: string;
  /** Additive (R6-C4): ISO timestamp the return's JSON was downloaded from the filing strip (survives reloads). */
  downloaded_at?: string;
}

const sameGstin = (a: string, b: string) => !a || !b || a.toUpperCase() === b.toUpperCase();

const markOf = (rows: readonly FiledReturn[], r: Pick<ReturnDue, 'form' | 'periodKey'>, gstin: string) =>
  rows.find((x) => x && x.form === r.form && x.period_key === r.periodKey && sameGstin(x.gstin ?? '', gstin));

/** The filed mark of `r` (a row that only remembers a download is not one). */
export function filedFor(rows: readonly FiledReturn[], r: ReturnDue, gstin = ''): FiledReturn | undefined {
  return rows.find((x) => x && !!x.filed_on && x.form === r.form && x.period_key === r.periodKey && sameGstin(x.gstin ?? '', gstin));
}

/** Marks `r` filed on `filedOn`, or clears the mark when `filedOn` is null (a remembered download stays). Pure. */
export function setFiled(rows: readonly FiledReturn[], r: ReturnDue, gstin: string, filedOn: string | null, now = new Date()): FiledReturn[] {
  const g = gstin.trim().toUpperCase();
  const prev = markOf(rows, r, g);
  const rest = rows.filter((x) => !(x && x.form === r.form && x.period_key === r.periodKey && sameGstin(x.gstin ?? '', g)));
  const downloaded = prev?.downloaded_at ? { downloaded_at: prev.downloaded_at } : {};
  if (!filedOn) return prev?.downloaded_at ? [...rest, { ...prev, filed_on: '', ...downloaded }] : rest;
  return [...rest, { id: `${r.id}:${g}`, form: r.form, period_key: r.periodKey, gstin: g, filed_on: filedOn.slice(0, 10), marked_at: now.toISOString(), ...downloaded }];
}

/** R6-C4: when the JSON of `r` was downloaded from the filing strip ('' = never). */
export function downloadedFor(rows: readonly FiledReturn[], r: Pick<ReturnDue, 'form' | 'periodKey'>, gstin = ''): string {
  return markOf(rows, r, gstin)?.downloaded_at ?? '';
}

/** R6-C4: remember the download of `r` on its compliance row (created with `filed_on: ''` when not filed yet). Pure. */
export function setDownloaded(rows: readonly FiledReturn[], r: ReturnDue, gstin: string, now = new Date()): FiledReturn[] {
  const g = gstin.trim().toUpperCase();
  const prev = markOf(rows, r, g);
  const rest = rows.filter((x) => x !== prev);
  return [...rest, prev ? { ...prev, downloaded_at: now.toISOString() } : { id: `${r.id}:${g}`, form: r.form, period_key: r.periodKey, gstin: g, filed_on: '', marked_at: now.toISOString(), downloaded_at: now.toISOString() }];
}

/**
 * R6-C4: the forms the GST filing strip offers for a period — GSTR-1 + GSTR-3B (a monthly period, or a QRMP quarter),
 * IFF in QRMP months 1–2, CMP-08 for a composition quarter. A whole FY offers none (mark per period).
 */
export function stripForms(period: { kind: 'month'; month: number } | { kind: 'quarter' } | { kind: string }, frequency: FilerFrequency): ReturnForm[] {
  if (frequency === 'composition') return period.kind === 'quarter' ? ['CMP08'] : [];
  if (period.kind === 'month') {
    const m = (period as { month: number }).month;
    if (frequency === 'qrmp' && m % 3 !== 0) return ['IFF'];
    return ['GSTR1', 'GSTR3B']; // monthly; in QRMP the quarter's last month files the quarter's GSTR-1 / 3B
  }
  if (period.kind === 'quarter') return ['GSTR1', 'GSTR3B'];
  return [];
}

/**
 * R6-C4: the compliance row a filing-strip button marks — IFF by month; CMP-08 and a QRMP filer's GSTR-1 / 3B by FY
 * quarter (a QRMP quarter's last month files the quarter); otherwise by month. Same ids as the Compliance calendar.
 */
export function stripReturn(
  period: { kind: string; fyStart: number; month?: number; quarter?: number },
  form: ReturnForm,
  frequency: FilerFrequency,
  range: { from: string; to: string },
  label: string,
): ReturnDue {
  const monthKey = range.from.slice(0, 7);
  const m = +range.from.slice(5, 7);
  const quarterOfMonth = Math.floor(((m - 4 + 12) % 12) / 3) + 1;
  const quarterKey = `${period.fyStart}-Q${period.kind === 'quarter' ? period.quarter : quarterOfMonth}`;
  const byQuarter = form === 'CMP08' || (form !== 'IFF' && (period.kind === 'quarter' || (frequency === 'qrmp' && m % 3 === 0)));
  const periodKey = byQuarter ? quarterKey : monthKey;
  return { id: `${form}:${periodKey}`, form, periodKey, label, from: range.from, to: range.to, due: range.to, optional: form === 'IFF' };
}

export const loadFiled = (): FiledReturn[] => getTable<FiledReturn>(COMPLIANCE_TABLE);
export const saveFiled = (rows: FiledReturn[]): void => setTable(COMPLIANCE_TABLE, rows);

/** R6-C4: remember the download of `r` for this GSTIN (fail-soft: the file already went out). */
export function rememberDownload(r: ReturnDue, gstin: string): boolean {
  try {
    saveFiled(setDownloaded(loadFiled(), r, gstin));
    return true;
  } catch {
    return false;
  }
}

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
