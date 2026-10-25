/**
 * Comparative columns (WP-2, P1-2 — Tally Alt+C "New Column" / "Auto Repeat Columns"): a report is
 * computed once per column period and laid side by side.
 *
 *   previous   the current period and the one before it (previous FY for a whole FY, the same number
 *              of months before for whole months, else the same number of days before)
 *   monthly    one column per month of the period
 *   quarterly  one column per Indian-FY quarter (Apr–Jun, Jul–Sep, Oct–Dec, Jan–Mar)
 *
 * Pure. Working papers — verify with your CA.
 */

import { dayBefore, monthLabel, type Period } from '../books';
import type { Ledger } from './postings';
import { groupSummary, monthPeriods, type GroupSummaryOptions, type GroupSummaryRow } from './group-summary';
import { natureOfGroup, isPnlNature } from './report-groups';
import { groupOf, isGroupId } from './accounts';

export type ColumnMode = 'none' | 'previous' | 'monthly' | 'quarterly';

export interface ReportColumn {
  key: string;
  label: string;
  period: Period;
}

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const monthEnd = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const parts = (s: string) => s.split('-').map(Number) as [number, number, number];

function addMonths(y: number, m: number, k: number): [number, number] {
  const t = y * 12 + (m - 1) + k;
  return [Math.floor(t / 12), (t % 12) + 1];
}

function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = parts(a);
  const [by, bm, bd] = parts(b);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

function shiftDays(s: string, k: number): string {
  const [y, m, d] = parts(s);
  const t = new Date(Date.UTC(y, m - 1, d + k));
  return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

const label = (p: Period) => (p.start.slice(0, 7) === p.end.slice(0, 7) ? monthLabel(p.start.slice(0, 7)) : `${p.start} – ${p.end}`);

/** The comparable period just before `p`. */
export function previousPeriod(p: Period): Period {
  const [sy, sm, sd] = parts(p.start);
  const [ey, em, ed] = parts(p.end);
  if (sd === 1 && ed === monthEnd(ey, em)) {
    const months = (ey - sy) * 12 + (em - sm) + 1;
    const [psy, psm] = addMonths(sy, sm, -months);
    const [pey, pem] = addMonths(ey, em, -months);
    return { start: iso(psy, psm, 1), end: iso(pey, pem, monthEnd(pey, pem)) };
  }
  const len = daysBetween(p.start, p.end) + 1;
  return { start: shiftDays(p.start, -len), end: dayBefore(p.start) };
}

export function columnsFor(period: Period, mode: ColumnMode): ReportColumn[] {
  if (mode === 'previous') {
    const prev = previousPeriod(period);
    return [
      { key: 'cur', label: label(period), period },
      { key: 'prev', label: label(prev), period: prev },
    ];
  }
  if (mode === 'monthly') return monthPeriods(period).map((m) => ({ key: m.key, label: m.label, period: m.period }));
  if (mode === 'quarterly') {
    const out: ReportColumn[] = [];
    for (const m of monthPeriods(period)) {
      const [y, mo] = m.key.split('-').map(Number);
      const fy = mo >= 4 ? y : y - 1;
      const q = Math.floor(((mo + 8) % 12) / 3) + 1;
      const key = `${fy}-Q${q}`;
      const last = out[out.length - 1];
      if (last?.key === key) last.period = { ...last.period, end: m.period.end };
      else out.push({ key, label: `Q${q} FY${String(fy).slice(2)}-${String(fy + 1).slice(2)}`, period: { ...m.period } });
    }
    return out;
  }
  return [{ key: 'cur', label: label(period), period }];
}

/** P&L-type rows compare movements; balance-sheet rows compare closing balances. */
export function columnValue(row: Pick<GroupSummaryRow, 'debit' | 'credit' | 'closing'>, pnl: boolean): number {
  return pnl ? row.debit - row.credit : row.closing;
}

export interface ColumnarRow {
  id: string;
  label: string;
  kind: GroupSummaryRow['kind'];
  depth: number;
  accountId?: string;
  party?: string;
  /** One signed (debit-positive) value per column. */
  values: number[];
}

export interface ColumnarGroupSummary {
  columns: ReportColumn[];
  rows: ColumnarRow[];
  totals: number[];
  /** True when the values are movements (income / expense group). */
  pnl: boolean;
}

/**
 * Group Summary with comparative columns. Rows are the union over all columns (a ledger that only
 * moved in one month still gets a row). `detailed` flattens sub-groups and ledgers (Alt+F1).
 */
export function groupSummaryColumns(
  ledger: Ledger,
  columns: readonly ReportColumn[],
  groupId: string | null,
  opts: GroupSummaryOptions & { detailed?: boolean } = {},
): ColumnarGroupSummary {
  const nature = groupId ? natureOfGroup(groupId) : undefined;
  const pnl = isPnlNature(nature);
  const order: string[] = [];
  const rows = new Map<string, ColumnarRow>();
  const totals = columns.map(() => 0);
  columns.forEach((c, ci) => {
    const gs = groupSummary(ledger, c.period, groupId, opts);
    const walk = (list: GroupSummaryRow[], depth: number, inherited: boolean | null) => {
      for (const r of list) {
        let row = rows.get(r.id);
        if (!row) {
          row = { id: r.id, label: r.label, kind: r.kind, depth, accountId: r.accountId, party: r.party, values: columns.map(() => 0) };
          rows.set(r.id, row);
          order.push(r.id);
        }
        // Within a root summary each primary group decides its own basis.
        const rowPnl = inherited ?? (groupId ? pnl : rowIsPnl(r));
        row.values[ci] = columnValue(r, rowPnl);
        if (depth === 0) totals[ci] += row.values[ci];
        if (opts.detailed) walk(r.children, depth + 1, rowPnl);
      }
    };
    walk(gs.rows, 0, groupId ? pnl : null);
  });
  return { columns: [...columns], rows: order.map((id) => rows.get(id)!), totals, pnl };
}

function rowIsPnl(r: GroupSummaryRow): boolean {
  if (r.kind !== 'group') return false;
  const n = natureOfGroup(r.id) ?? (isGroupId(r.id) ? groupOf(r.id).nature : undefined);
  return isPnlNature(n);
}
