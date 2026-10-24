/**
 * Budgets vs actual (roadmap 6.17).
 *
 * A budget row is one income or expense account for one Indian financial year (April–March),
 * optionally for one cost centre, with twelve monthly amounts in integer PAISE (index 0 = April,
 * 11 = March). Stored in table `budgets`.
 *
 * Actuals come from the ledger's posting lines: income accounts count credit − debit, expense
 * accounts debit − credit. A row WITHOUT a cost centre is an account-level budget and is compared
 * with every posting on the account; a row WITH one is compared only with lines tagged to it. The
 * report shows one scope at a time (account-level, or one cost centre) so totals never double count.
 *
 * Variance = actual − budget. Income above budget is favourable, expense above budget adverse.
 * Pure except `loadBudgets` / `saveBudget` / `saveBudgets` / `deleteBudget`.
 * Working papers — verify with your CA.
 */

import { audit } from '../audit';
import { fyPeriod } from '../books';
import { toCsv } from '../csv';
import { generateId, getTable, setTable } from '../storage';
import { groupOf, type Account } from './accounts';
import type { Ledger } from './postings';
import { fyLabelOf } from './assets';

export const BUDGETS_TABLE = 'budgets';

export interface Budget {
  id: string;
  /** Calendar year in which the FY starts (2026 = FY 2026-27). */
  fy_start_year: number;
  account_id: string;
  /** Optional `cost_centres` row id; absent = account-level budget. */
  cost_centre_id?: string;
  /** Twelve integer-paise amounts, April → March. */
  months: number[];
  notes?: string;
  created_at: string;
  updated_at?: string;
}

export type BudgetInput = Omit<Budget, 'id' | 'created_at' | 'updated_at'> & { id?: string };

export const MONTH_LABELS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'] as const;

export class BudgetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BudgetError';
  }
}

/* ── Pure helpers ──────────────────────────────────────────────── */

/**
 * Spread an annual amount (paise) evenly over 12 months, exact to the paisa: each month gets the
 * integer share and the remaining paise go one each to the first months (April first).
 */
export function spreadEvenly(annualPaise: number): number[] {
  const total = Math.round(annualPaise);
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const base = Math.floor(abs / 12);
  const rest = abs - base * 12;
  return Array.from({ length: 12 }, (_, i) => sign * (base + (i < rest ? 1 : 0)));
}

export const sumMonths = (months: readonly number[], from = 0, to = 11) =>
  months.slice(from, to + 1).reduce((s, m) => s + (Number.isFinite(m) ? m : 0), 0);

/** Month index (0 = April) of a YYYY-MM-DD day inside FY `fy`, or -1 outside it. */
export function fyMonthIndex(date: string, fy: number): number {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(date);
  if (!m) return -1;
  const y = +m[1];
  const mo = +m[2];
  const idx = y === fy && mo >= 4 ? mo - 4 : y === fy + 1 && mo <= 3 ? mo + 8 : -1;
  return idx;
}

/** Inclusive month-index range inside the FY. */
export interface MonthRange {
  from: number;
  to: number;
}
export type RangeMode = 'month' | 'quarter' | 'ytd' | 'year';

/** Range for a view mode, anchored on month index `month` (0 = April). */
export function rangeFor(mode: RangeMode, month: number): MonthRange {
  const m = Math.min(Math.max(Math.trunc(month), 0), 11);
  if (mode === 'month') return { from: m, to: m };
  if (mode === 'quarter') {
    const q = Math.floor(m / 3);
    return { from: q * 3, to: q * 3 + 2 };
  }
  if (mode === 'ytd') return { from: 0, to: m };
  return { from: 0, to: 11 };
}

export function rangeLabel(fy: number, r: MonthRange): string {
  const fyL = fyLabelOf(fy);
  if (r.from === 0 && r.to === 11) return `${fyL} (full year)`;
  if (r.from === r.to) return `${MONTH_LABELS[r.from]} ${r.from <= 8 ? fy : fy + 1}`;
  if (r.from === 0) return `${fyL} YTD to ${MONTH_LABELS[r.to]}`;
  if (r.from % 3 === 0 && r.to === r.from + 2) return `Q${r.from / 3 + 1} ${fyL}`;
  return `${MONTH_LABELS[r.from]}–${MONTH_LABELS[r.to]} ${fyL}`;
}

const isPnlAccount = (a: Account | undefined) => {
  const n = a ? groupOf(a.group).nature : undefined;
  return n === 'income' || n === 'expense';
};

/** Accounts a budget can be set on: income and expense heads of the chart. */
export function budgetableAccounts(accounts: readonly Account[]): Account[] {
  return accounts.filter(isPnlAccount);
}

/** Composite key of a budget row's scope. */
export const budgetKey = (b: Pick<Budget, 'fy_start_year' | 'account_id' | 'cost_centre_id'>) =>
  `${b.fy_start_year}|${b.account_id}|${b.cost_centre_id ?? ''}`;

/**
 * Monthly actuals for FY `fy` from the ledger. Keys: `account|cc` for lines tagged to a cost centre,
 * and `account|*` for the whole account (all lines, tagged or not). Sign: income credit-positive,
 * expense debit-positive.
 */
export function monthlyActuals(ledger: Ledger, fy: number): Map<string, number[]> {
  const out = new Map<string, number[]>();
  const bump = (key: string, idx: number, amt: number) => {
    const arr = out.get(key) ?? Array<number>(12).fill(0);
    arr[idx] += amt;
    out.set(key, arr);
  };
  const { start, end } = fyPeriod(fy);
  for (const v of ledger.vouchers) {
    if (v.date < start || v.date > end) continue;
    const idx = fyMonthIndex(v.date, fy);
    if (idx < 0) continue;
    for (const l of v.lines) {
      const acc = ledger.byId.get(l.account);
      if (!acc || !isPnlAccount(acc)) continue;
      const amt = groupOf(acc.group).nature === 'income' ? l.cr - l.dr : l.dr - l.cr;
      if (!amt) continue;
      bump(`${l.account}|*`, idx, amt);
      if (l.cost_centre) bump(`${l.account}|${l.cost_centre}`, idx, amt);
    }
  }
  return out;
}

export const actualKey = (accountId: string, costCentreId?: string) => `${accountId}|${costCentreId || '*'}`;

/** Variance of actual against budget. `favourable` is null only when the account is unknown. */
export interface Variance {
  variance: number;
  /** Percent of the budget (one decimal), null when the budget is 0. */
  percent: number | null;
  favourable: boolean;
}

/** Income: actual ≥ budget is favourable. Expense: actual ≤ budget is favourable. */
export function variance(isIncome: boolean, budget: number, actual: number): Variance {
  const v = actual - budget;
  return {
    variance: v,
    percent: budget ? Math.round((v / Math.abs(budget)) * 1000) / 10 : null,
    favourable: isIncome ? v >= 0 : v <= 0,
  };
}

export interface BudgetReportRow extends Variance {
  budgetRow: Budget;
  account: Account;
  isIncome: boolean;
  budget: number;
  actual: number;
}

export interface BudgetReport {
  fy: number;
  range: MonthRange;
  /** '' = account-level budgets, else the cost centre id shown. */
  costCentreId: string;
  rows: BudgetReportRow[];
  income: { budget: number; actual: number } & Variance;
  expense: { budget: number; actual: number } & Variance;
  /** Income − expenses. Favourable when actual net ≥ budgeted net. */
  net: { budget: number; actual: number } & Variance;
}

export function budgetVsActual(
  ledger: Ledger,
  budgets: readonly Budget[],
  fy: number,
  range: MonthRange,
  costCentreId = '',
  actuals: Map<string, number[]> = monthlyActuals(ledger, fy),
): BudgetReport {
  const rows: BudgetReportRow[] = [];
  for (const b of budgets) {
    if (b.fy_start_year !== fy || (b.cost_centre_id ?? '') !== costCentreId) continue;
    const account = ledger.byId.get(b.account_id);
    if (!account || !isPnlAccount(account)) continue;
    const isIncome = groupOf(account.group).nature === 'income';
    const budget = sumMonths(b.months, range.from, range.to);
    const actual = sumMonths(actuals.get(actualKey(b.account_id, b.cost_centre_id)) ?? [], range.from, range.to);
    rows.push({ budgetRow: b, account, isIncome, budget, actual, ...variance(isIncome, budget, actual) });
  }
  rows.sort((a, b) => Number(b.isIncome) - Number(a.isIncome) || a.account.code.localeCompare(b.account.code));
  const tot = (inc: boolean) => {
    const rs = rows.filter((r) => r.isIncome === inc);
    const budget = rs.reduce((s, r) => s + r.budget, 0);
    const actual = rs.reduce((s, r) => s + r.actual, 0);
    return { budget, actual, ...variance(inc, budget, actual) };
  };
  const income = tot(true);
  const expense = tot(false);
  const nb = income.budget - expense.budget;
  const na = income.actual - expense.actual;
  return { fy, range, costCentreId, rows, income, expense, net: { budget: nb, actual: na, ...variance(true, nb, na) } };
}

/**
 * Next year's budget from a year's actuals: one row per income/expense account with postings
 * (per account × cost centre when `byCostCentre`; lines with no centre are then left out), each
 * month scaled by (1 + uplift%) and rounded to the rupee. Rows whose 12 months are all zero are skipped.
 */
export function budgetsFromActuals(
  ledger: Ledger,
  sourceFy: number,
  upliftPercent = 0,
  opts: { byCostCentre?: boolean; targetFy?: number } = {},
): BudgetInput[] {
  const factor = 1 + (Number.isFinite(upliftPercent) ? upliftPercent : 0) / 100;
  const target = opts.targetFy ?? sourceFy + 1;
  const out: BudgetInput[] = [];
  for (const [key, months] of monthlyActuals(ledger, sourceFy)) {
    const [account_id, cc] = key.split('|');
    if (opts.byCostCentre ? cc === '*' : cc !== '*') continue;
    const scaled = months.map((m) => Math.round((m * factor) / 100) * 100);
    if (scaled.every((m) => m === 0)) continue;
    out.push({ fy_start_year: target, account_id, ...(opts.byCostCentre ? { cost_centre_id: cc } : {}), months: scaled });
  }
  return out.sort((a, b) => a.account_id.localeCompare(b.account_id) || (a.cost_centre_id ?? '').localeCompare(b.cost_centre_id ?? ''));
}

/* ── Export ────────────────────────────────────────────────────── */

/** Rows (rupees) for CSV / xlsx: one per budget line, then income, expense and net totals. */
export function budgetReportRows(r: BudgetReport, centreName = ''): (string | number | null)[][] {
  const rs = (p: number) => Math.round(p) / 100;
  const tone = (v: Variance) => (v.variance === 0 ? 'On budget' : v.favourable ? 'Favourable' : 'Adverse');
  const out: (string | number | null)[][] = [
    ['Period', rangeLabel(r.fy, r.range), '', '', '', '', '', ''],
    ['Scope', centreName || 'Account-level budgets', '', '', '', '', '', ''],
    ['Type', 'Code', 'Account', 'Budget', 'Actual', 'Variance', 'Variance %', 'Result'],
  ];
  for (const x of r.rows) {
    out.push([x.isIncome ? 'Income' : 'Expense', x.account.code, x.account.name, rs(x.budget), rs(x.actual), rs(x.variance), x.percent, tone(x)]);
  }
  const t = (label: string, v: BudgetReport['income']) => out.push(['', '', label, rs(v.budget), rs(v.actual), rs(v.variance), v.percent, tone(v)]);
  t('Total income', r.income);
  t('Total expenses', r.expense);
  t('Net (income − expenses)', r.net);
  return out;
}

export function budgetReportCsv(r: BudgetReport, centreName = ''): string {
  return toCsv(budgetReportRows(r, centreName).map((row) => row.map((c) => c ?? '')));
}

/* ── Storage ───────────────────────────────────────────────────── */

const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n);

export function normalizeBudgets(rows: unknown[]): Budget[] {
  const out: Budget[] = [];
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    if (typeof o.id !== 'string' || !o.id || typeof o.account_id !== 'string' || !o.account_id || !isInt(o.fy_start_year)) continue;
    const months = Array.from({ length: 12 }, (_, i) => {
      const m = Array.isArray(o.months) ? o.months[i] : 0;
      return isInt(m) ? m : 0;
    });
    out.push({
      id: o.id,
      fy_start_year: o.fy_start_year,
      account_id: o.account_id,
      ...(typeof o.cost_centre_id === 'string' && o.cost_centre_id ? { cost_centre_id: o.cost_centre_id } : {}),
      months,
      ...(typeof o.notes === 'string' && o.notes.trim() ? { notes: o.notes.trim() } : {}),
      created_at: typeof o.created_at === 'string' ? o.created_at : '',
      ...(typeof o.updated_at === 'string' ? { updated_at: o.updated_at } : {}),
    });
  }
  return out;
}

export function loadBudgets(): Budget[] {
  return normalizeBudgets(getTable<unknown>(BUDGETS_TABLE));
}

export function validateBudget(input: BudgetInput, accounts: readonly Account[], existing: readonly Budget[]): string[] {
  const errors: string[] = [];
  const acc = accounts.find((a) => a.id === input.account_id);
  if (!acc) errors.push('Choose an account.');
  else if (!isPnlAccount(acc)) errors.push('Budgets are set on income and expense accounts only.');
  if (!isInt(input.fy_start_year) || input.fy_start_year < 2000 || input.fy_start_year > 2100) errors.push('Choose the financial year.');
  if (!Array.isArray(input.months) || input.months.length !== 12 || !input.months.every(isInt)) errors.push('Enter twelve monthly amounts.');
  else if (input.months.some((m) => m < 0)) errors.push('Budget amounts cannot be negative.');
  if (existing.some((b) => b.id !== input.id && budgetKey(b) === budgetKey(input))) {
    errors.push(`${acc?.name ?? 'This account'} already has a budget for ${fyLabelOf(input.fy_start_year)}${input.cost_centre_id ? ' for this cost centre' : ''}.`);
  }
  return errors;
}

function toRow(input: BudgetInput, prev: Budget | undefined, now: string): Budget {
  return {
    id: prev?.id ?? input.id ?? generateId(),
    fy_start_year: input.fy_start_year,
    account_id: input.account_id,
    ...(input.cost_centre_id ? { cost_centre_id: input.cost_centre_id } : {}),
    months: input.months.map((m) => Math.round(m)),
    ...(input.notes && input.notes.trim() ? { notes: input.notes.trim() } : {}),
    created_at: prev?.created_at ?? now,
    ...(prev ? { updated_at: now } : {}),
  };
}

export function saveBudget(input: BudgetInput, accounts: readonly Account[]): Budget {
  const all = loadBudgets();
  const errors = validateBudget(input, accounts, all);
  if (errors.length) throw new BudgetError(errors[0]);
  const prev = input.id ? all.find((b) => b.id === input.id) : undefined;
  const row = toRow(input, prev, new Date().toISOString());
  setTable(BUDGETS_TABLE, prev ? all.map((b) => (b.id === row.id ? row : b)) : [...all, row]);
  const acc = accounts.find((a) => a.id === row.account_id);
  audit.record({
    entity: 'budget',
    entity_id: row.id,
    action: prev ? 'update' : 'create',
    summary: `${prev ? 'Edited' : 'Set'} ${fyLabelOf(row.fy_start_year)} budget for ${acc?.name ?? row.account_id}: ₹${(sumMonths(row.months) / 100).toFixed(2)}`,
  });
  return row;
}

/**
 * Write many budget rows at once (copy from actuals). A row whose scope (FY × account × cost
 * centre) already has a budget replaces it when `replace`, else is skipped. Returns the counts.
 */
export function saveBudgets(inputs: readonly BudgetInput[], opts: { replace: boolean }): { added: number; replaced: number; skipped: number } {
  const all = loadBudgets();
  const byKey = new Map(all.map((b) => [budgetKey(b), b]));
  const now = new Date().toISOString();
  let added = 0;
  let replaced = 0;
  let skipped = 0;
  const next = [...all];
  for (const input of inputs) {
    const prev = byKey.get(budgetKey(input));
    if (prev && !opts.replace) {
      skipped++;
      continue;
    }
    const row = toRow({ ...input, id: undefined }, prev, now);
    if (prev) {
      next[next.findIndex((b) => b.id === prev.id)] = row;
      replaced++;
    } else {
      next.push(row);
      added++;
    }
    byKey.set(budgetKey(row), row);
  }
  if (added || replaced) {
    setTable(BUDGETS_TABLE, next);
    const fy = inputs[0]?.fy_start_year;
    audit.record({
      entity: 'budget',
      entity_id: `fy-${fy}`,
      action: 'import',
      summary: `Budgets for ${fy ? fyLabelOf(fy) : 'the year'} copied from actuals: ${added} added, ${replaced} replaced${skipped ? `, ${skipped} kept` : ''}`,
    });
  }
  return { added, replaced, skipped };
}

export function deleteBudget(id: string): void {
  const all = loadBudgets();
  const row = all.find((b) => b.id === id);
  if (!row) return;
  setTable(BUDGETS_TABLE, all.filter((b) => b.id !== id));
  audit.record({ entity: 'budget', entity_id: id, action: 'delete', summary: `Deleted ${fyLabelOf(row.fy_start_year)} budget (${row.account_id})` });
}
