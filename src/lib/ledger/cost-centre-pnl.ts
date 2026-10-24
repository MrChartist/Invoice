/**
 * Project P&L (roadmap 6.16): income, direct costs, margin, indirect expenses and net result per
 * cost centre for a period, read from the ledger's posting lines (`PostingLine.cost_centre`).
 *
 * Every income / expense line lands in exactly one column — its cost centre, or "Unallocated" —
 * so the columns always add up to the overall P&L (`ledgerProfitAndLoss`); `tests/cost-centres.test.ts`
 * checks that reconciliation. Amounts are integer PAISE. Pure. Working papers — verify with your CA.
 */

import type { Period } from '../books';
import { toCsv } from '../csv';
import type { CostCentre, CostCentreKind } from '../cost-centres';
import { groupOf, type Account } from './accounts';
import type { Ledger } from './postings';

/** Column key for lines with no cost centre. */
export const UNALLOCATED = '';
/** Column key for lines whose cost centre no longer exists in the master. */
export const UNKNOWN_CENTRE = '?';

export type CcSection = 'income' | 'direct' | 'indirect';

export interface CcColumn {
  /** Cost centre id, `UNALLOCATED` or `UNKNOWN_CENTRE`. */
  key: string;
  label: string;
  kind?: CostCentreKind;
  active?: boolean;
}

export interface CcPnlRow {
  account: Account;
  section: CcSection;
  /** Column key → amount (income rows: credit-positive; expense rows: debit-positive). */
  amounts: Record<string, number>;
  total: number;
}

export interface CcTotals {
  income: number;
  directCosts: number;
  /** Income − direct costs (contribution / gross margin). */
  margin: number;
  indirectExpenses: number;
  netProfit: number;
}

export interface CostCentrePnl {
  period: Period;
  columns: CcColumn[];
  rows: CcPnlRow[];
  totals: Record<string, CcTotals>;
  grand: CcTotals;
}

const zero = (): CcTotals => ({ income: 0, directCosts: 0, margin: 0, indirectExpenses: 0, netProfit: 0 });

/** Margin as a percent of income (null when there is no income). */
export function marginPercent(t: CcTotals): number | null {
  return t.income ? Math.round((t.margin / t.income) * 1000) / 10 : null;
}

export interface CostCentrePnlOptions {
  /** Merge each child centre into its parent's column (one level of grouping). */
  rollUp?: boolean;
}

export function costCentrePnl(ledger: Ledger, period: Period, centres: readonly CostCentre[], opts: CostCentrePnlOptions = {}): CostCentrePnl {
  const byId = new Map(centres.map((c) => [c.id, c]));
  const columnOf = (cc: string | undefined): string => {
    if (!cc) return UNALLOCATED;
    const c = byId.get(cc);
    if (!c) return UNKNOWN_CENTRE;
    return opts.rollUp && c.parent_id && byId.has(c.parent_id) ? c.parent_id : c.id;
  };

  const rowsById = new Map<string, CcPnlRow>();
  const used = new Set<string>();
  for (const v of ledger.vouchers) {
    if (v.date < period.start || v.date > period.end) continue;
    for (const l of v.lines) {
      const account = ledger.byId.get(l.account);
      if (!account) continue;
      const g = groupOf(account.group);
      if (g.nature !== 'income' && g.nature !== 'expense') continue;
      const section: CcSection = g.nature === 'income' ? 'income' : g.direct ? 'direct' : 'indirect';
      const amount = g.nature === 'income' ? l.cr - l.dr : l.dr - l.cr;
      if (!amount) continue;
      const key = columnOf(l.cost_centre);
      used.add(key);
      const row = rowsById.get(account.id) ?? { account, section, amounts: {}, total: 0 };
      row.amounts[key] = (row.amounts[key] ?? 0) + amount;
      row.total += amount;
      rowsById.set(account.id, row);
    }
  }

  // Columns: every centre with postings in the period (sorted parents → children, by name),
  // then "deleted centre" if any, then Unallocated (always shown).
  const centreCols: CcColumn[] = [];
  const ordered = [...centres].sort((a, b) => a.name.localeCompare(b.name));
  for (const c of ordered.filter((x) => !x.parent_id || !byId.has(x.parent_id))) {
    for (const x of [c, ...ordered.filter((k) => k.parent_id === c.id)]) {
      if (used.has(x.id)) {
        const parent = x.parent_id ? byId.get(x.parent_id) : undefined;
        centreCols.push({ key: x.id, label: parent ? `${parent.name} › ${x.name}` : x.name, kind: x.kind, active: x.active });
      }
    }
  }
  const columns: CcColumn[] = [
    ...centreCols,
    ...(used.has(UNKNOWN_CENTRE) ? [{ key: UNKNOWN_CENTRE, label: 'Deleted cost centre' }] : []),
    { key: UNALLOCATED, label: 'Unallocated' },
  ];

  const rows = [...rowsById.values()]
    .filter((r) => r.total !== 0 || Object.values(r.amounts).some(Boolean))
    .sort((a, b) => sectionOrder(a.section) - sectionOrder(b.section) || a.account.code.localeCompare(b.account.code));

  const totals: Record<string, CcTotals> = {};
  for (const c of columns) totals[c.key] = zero();
  const grand = zero();
  for (const r of rows) {
    for (const [key, amt] of Object.entries(r.amounts)) add(totals[key] ?? (totals[key] = zero()), r.section, amt);
    add(grand, r.section, r.total);
  }
  for (const t of [...Object.values(totals), grand]) {
    t.margin = t.income - t.directCosts;
    t.netProfit = t.margin - t.indirectExpenses;
  }
  return { period, columns, rows, totals, grand };
}

function sectionOrder(s: CcSection): number {
  return s === 'income' ? 0 : s === 'direct' ? 1 : 2;
}

function add(t: CcTotals, section: CcSection, amt: number) {
  if (section === 'income') t.income += amt;
  else if (section === 'direct') t.directCosts += amt;
  else t.indirectExpenses += amt;
}

export const CC_SECTION_LABELS: Record<CcSection, string> = {
  income: 'Income',
  direct: 'Direct costs',
  indirect: 'Indirect expenses',
};

/** CSV (rupees): one row per account, then the totals; one column per cost centre + Unallocated + Total. */
export function costCentrePnlRows(p: CostCentrePnl): (string | number)[][] {
  const r = (paise: number) => Math.round(paise) / 100;
  const head = ['Section', 'Code', 'Account', ...p.columns.map((c) => c.label), 'Total'];
  const out: (string | number)[][] = [head];
  for (const row of p.rows) {
    out.push([CC_SECTION_LABELS[row.section], row.account.code, row.account.name, ...p.columns.map((c) => r(row.amounts[c.key] ?? 0)), r(row.total)]);
  }
  const line = (label: string, pick: (t: CcTotals) => number) =>
    out.push(['', '', label, ...p.columns.map((c) => r(pick(p.totals[c.key] ?? zero()))), r(pick(p.grand))]);
  line('Total income', (t) => t.income);
  line('Total direct costs', (t) => t.directCosts);
  line('Margin (income − direct costs)', (t) => t.margin);
  line('Total indirect expenses', (t) => t.indirectExpenses);
  line('Net profit / (loss)', (t) => t.netProfit);
  out.push(['', '', 'Margin %', ...p.columns.map((c) => marginPercent(p.totals[c.key] ?? zero()) ?? ''), marginPercent(p.grand) ?? '']);
  return out;
}

export function costCentrePnlCsv(p: CostCentrePnl): string {
  return toCsv(costCentrePnlRows(p));
}
