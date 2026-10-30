/**
 * R20-C: the report keys' pure helpers — the plain filter (Ctrl+F), the totals of the rows shown (Ctrl+F12), the
 * selection / hide model (Space, Ctrl+Alt+I, Ctrl+R, Ctrl+U, Alt+U) and period stepping (+ / −). No run-time imports,
 * so it sits in the `f-keys` group. Amounts are paise, signed debit-positive. Nothing here is ever saved (PRD Q7).
 */

/** What the filter and the totals read from one report row. */
export interface RowFact {
  /** Every word shown on the row (party, ledger, voucher no …). */
  text: string;
  /** Local day `YYYY-MM-DD` (voucher rows). */
  date?: string;
  narr?: string;
  /** Signed paise: debit +, credit −. */
  amt: number;
  /** Indent of the row; a row followed by a deeper shown row is its parent and is left out of the totals. */
  depth?: number;
}

/** Ctrl+F: every part optional; amounts in paise compare with the row's amount without its sign. */
export interface ReportFilter {
  min?: number;
  max?: number;
  from?: string;
  to?: string;
  text?: string;
  narr?: string;
  side?: 'dr' | 'cr';
}

const has = (hay: string | undefined, needle: string | undefined) => !needle?.trim() || (hay ?? '').toLowerCase().includes(needle.trim().toLowerCase());

export function rowMatches(r: RowFact, f: ReportFilter): boolean {
  const a = Math.abs(r.amt);
  if ((f.min !== undefined && a < f.min) || (f.max !== undefined && a > f.max)) return false;
  if ((f.from && !(r.date && r.date >= f.from)) || (f.to && !(r.date && r.date <= f.to))) return false;
  if ((f.side === 'dr' && !(r.amt > 0)) || (f.side === 'cr' && !(r.amt < 0))) return false;
  return has(r.text, f.text) && has(r.narr, f.narr);
}

/** Indexes of the rows the filter keeps. */
export const filterRows = (facts: readonly RowFact[], f: ReportFilter): number[] => facts.flatMap((r, i) => (rowMatches(r, f) ? [i] : []));

/** True when the filter asks for nothing. */
export const emptyFilter = (f: ReportFilter): boolean => !Object.values(f).some((v) => v !== undefined && v !== '');

export interface ShownTotals {
  count: number;
  dr: number;
  cr: number;
  /** dr − cr (debit-positive). */
  net: number;
}

/** "Totals of what you see": shown rows in order; a parent row followed by its own shown child is not counted twice. */
export function totalsOf(facts: readonly RowFact[], shown: readonly number[]): ShownTotals {
  let dr = 0;
  let cr = 0;
  shown.forEach((i, k) => {
    const next = shown[k + 1];
    if (next !== undefined && (facts[next]?.depth ?? 0) > (facts[i]?.depth ?? 0)) return;
    const a = facts[i]?.amt ?? 0;
    if (a > 0) dr += a;
    else cr -= a;
  });
  return { count: shown.length, dr, cr, net: dr - cr };
}

/* ── Selection and hidden rows (per visit) ─────────────────────────── */

export interface RowTools {
  /** The active filter and the rows it keeps (null = no filter). */
  filter: ReportFilter | null;
  match: number[] | null;
  /** Ticked rows (Space). */
  sel: number[];
  /** Hidden rows, one batch per Ctrl+R (Ctrl+U restores the last batch). */
  hid: number[][];
}
export const NO_TOOLS: RowTools = { filter: null, match: null, sel: [], hid: [] };
export const toolsActive = (t: RowTools): boolean => !!(t.filter || t.sel.length || t.hid.length);

/** Rows on screen: not hidden and kept by the filter. */
export function shownRows(count: number, t: RowTools): number[] {
  const hid = new Set(t.hid.flat());
  const keep = t.match ? new Set(t.match) : null;
  const out: number[] = [];
  for (let i = 0; i < count; i++) if (!hid.has(i) && (!keep || keep.has(i))) out.push(i);
  return out;
}

export const toggleSel = (t: RowTools, i: number): RowTools => ({ ...t, sel: t.sel.includes(i) ? t.sel.filter((x) => x !== i) : [...t.sel, i] });
export const addSel = (t: RowTools, rows: readonly number[]): RowTools => ({ ...t, sel: [...new Set([...t.sel, ...rows])] });
/** Ctrl+Alt+I: tick the shown rows that were not ticked. */
export const invertSel = (t: RowTools, shown: readonly number[]): RowTools => ({ ...t, sel: shown.filter((i) => !t.sel.includes(i)) });
/** Ctrl+R: hide the ticked rows, else the focused one; ticks are cleared. */
export const hideRows = (t: RowTools, focused: number): RowTools => {
  const batch = t.sel.length ? [...t.sel] : focused >= 0 ? [focused] : [];
  return batch.length ? { ...t, sel: [], hid: [...t.hid, batch] } : t;
};
export const unhideLast = (t: RowTools): RowTools => ({ ...t, hid: t.hid.slice(0, -1) });
export const unhideAll = (t: RowTools): RowTools => ({ ...t, hid: [] });

/** The next / previous shown row from `from` (`dir` ±1), or `from` when there is none. */
export function stepShown(shown: readonly number[], from: number, dir: number): number {
  if (!shown.length) return from;
  if (dir > 0) return shown.find((i) => i > from) ?? shown[shown.length - 1];
  for (let k = shown.length - 1; k >= 0; k--) if (shown[k] < from) return shown[k];
  return shown[0];
}

/* ── Period stepping (+ / −) ──────────────────────────────────────── */

const pad = (n: number) => String(n).padStart(2, '0');
/** Local day from parts (month 0-based; overflow rolls like Date). */
const day = (y: number, m: number, d: number) => {
  const t = new Date(y, m, d);
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
};
const parts = (s: string) => s.split('-').map(Number);

/**
 * One step of the report period: a month / quarter / financial year by the preset (MTD, QTD, YTD step whole months,
 * quarters, years from their start); a custom range of whole months steps by its months, any other range by its days.
 */
export function stepPeriod(preset: string, p: { start: string; end: string }, dir: 1 | -1): { start: string; end: string } {
  const [y, m, d] = parts(p.start);
  const [ey, em, ed] = parts(p.end);
  let months = /month|mtd/.test(preset) ? 1 : /quarter|qtd/.test(preset) ? 3 : /fy|ytd/.test(preset) ? 12 : 0;
  if (!months && d === 1 && day(ey, em, 0) === p.end) months = (ey - y) * 12 + em - m + 1;
  if (months) return { start: day(y, m - 1 + dir * months, 1), end: day(y, m - 1 + dir * months + months, 0) };
  const len = Math.round((Date.UTC(ey, em - 1, ed) - Date.UTC(y, m - 1, d)) / 864e5) + 1;
  return { start: day(y, m - 1, d + dir * len), end: day(ey, em - 1, ed + dir * len) };
}
