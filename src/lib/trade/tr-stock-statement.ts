/**
 * TR-C4 bank stock & book-debts statement (drawing power for a cash-credit limit) — a bank working paper, not a
 * financial statement (TR19):
 *
 *   net stock      = stock at cost (the books' valuation, `loadStockValuer`, so it agrees with Books) − creditors for goods
 *   DP on stock    = net stock × (1 − stock margin)
 *   DP on debtors  = debtors up to `age_days` old (by bill date) × (1 − debtors margin)
 *   drawing power  = DP on stock + DP on debtors;  available = min(DP, limit) − cash-credit outstanding
 *
 * Principals' goods held by an agent (consignment lots, TR-C1) are never in our stock valuation: they are shown as an
 * excluded memo. Margins default to 25% / 40% and debtors over 90 days are excluded (§8 Q15); the sanction letter
 * decides, so all are editable per bank account (object `bank_statement_settings`, `settings.manage`).
 * Reads `purchases` through `billwisePayables` (Rule 9: listed in tests/purchase-contract.test.ts).
 */
import './tr-registry';
import type { BankStatementSettings, BankStatementTerms } from '../../types/trade-r8';
import { num, round2 } from '../invoice-calc';
import { requireAccess } from '../access';
import { DB_PREFIX, getJson, setJson } from '../storage';
import { TR_OBJECTS } from './tr-shared';

export const BANK_STATEMENT_KEY = `${DB_PREFIX}${TR_OBJECTS.bankStatementSettings}`;
export const DEFAULT_TERMS: BankStatementTerms = { stock_margin: 25, debtor_margin: 40, age_days: 90 };

export interface StockStatementInput {
  asOf: string;
  /** Stock at cost by group (stock engine). */
  groups: readonly { name: string; value: number }[];
  /** The books' closing stock on `asOf` (equals Σ groups when the books value from the inventory). */
  stockTotal: number;
  /** Memo: principals' goods held (excluded). */
  consignment: number;
  /** Sundry creditors for goods (purchase bills still unpaid on `asOf`). */
  creditors: number;
  /** Open sales bills: age in days by bill date, amount outstanding. */
  debtors: readonly { age: number; amount: number }[];
  terms: BankStatementTerms;
  /** Cash-credit ledger balance owed to the bank on `asOf` (₹, positive = drawn). */
  outstanding: number;
}

export interface StockStatement {
  stockTotal: number;
  creditors: number;
  netStock: number;
  dpStock: number;
  debtorsIn: number;
  debtorsOut: number;
  dpDebtors: number;
  dp: number;
  limit?: number;
  outstanding: number;
  available: number;
}

const pct = (n: unknown, fallback: number) => {
  const v = Number(n);
  return Number.isFinite(v) && v >= 0 && v <= 100 ? v : fallback;
};

/** The terms with defaults filled in (bad values fall back). */
export function termsOf(t: Partial<BankStatementTerms> | undefined): BankStatementTerms {
  const age = Math.round(Number(t?.age_days));
  return {
    stock_margin: pct(t?.stock_margin, DEFAULT_TERMS.stock_margin),
    debtor_margin: pct(t?.debtor_margin, DEFAULT_TERMS.debtor_margin),
    age_days: Number.isFinite(age) && age > 0 ? age : DEFAULT_TERMS.age_days,
    ...(num(t?.limit) > 0 ? { limit: round2(num(t?.limit)) } : {}),
  };
}

/** Pure: the drawing-power working. */
export function drawingPower(i: StockStatementInput): StockStatement {
  const terms = termsOf(i.terms);
  const stockTotal = round2(i.stockTotal);
  const creditors = round2(Math.max(i.creditors, 0));
  const netStock = round2(Math.max(stockTotal - creditors, 0));
  const dpStock = round2(netStock * (1 - terms.stock_margin / 100));
  let debtorsIn = 0;
  let debtorsOut = 0;
  for (const d of i.debtors) {
    if (!(d.amount > 0)) continue;
    if (d.age <= terms.age_days) debtorsIn += d.amount;
    else debtorsOut += d.amount;
  }
  debtorsIn = round2(debtorsIn);
  debtorsOut = round2(debtorsOut);
  const dpDebtors = round2(debtorsIn * (1 - terms.debtor_margin / 100));
  const dp = round2(dpStock + dpDebtors);
  const drawable = terms.limit ? Math.min(dp, terms.limit) : dp;
  const outstanding = round2(Math.max(i.outstanding, 0));
  return { stockTotal, creditors, netStock, dpStock, debtorsIn, debtorsOut, dpDebtors, dp, ...(terms.limit ? { limit: terms.limit } : {}), outstanding, available: round2(drawable - outstanding) };
}

/** Rows for print / XLSX (label, amount). */
export function statementRows(i: StockStatementInput, s: StockStatement, words: (k: string, n?: number) => string): (string | number)[][] {
  const t = termsOf(i.terms);
  return [
    [words('asOf'), i.asOf],
    ...i.groups.map((g) => [g.name, round2(g.value)]),
    [words('stockTotal'), s.stockTotal],
    ...(i.consignment > 0 ? [[words('consignment'), round2(i.consignment)]] : []),
    [words('creditors'), -s.creditors],
    [words('netStock'), s.netStock],
    [`${words('dpStock')} (${100 - t.stock_margin}%)`, s.dpStock],
    [words('debtorsIn', t.age_days), s.debtorsIn],
    [words('debtorsOut', t.age_days), s.debtorsOut],
    [`${words('dpDebtors')} (${100 - t.debtor_margin}%)`, s.dpDebtors],
    [words('dp'), s.dp],
    ...(s.limit ? [[words('limit'), s.limit]] : []),
    [words('outstanding'), s.outstanding],
    [words('available'), s.available],
  ];
}

/* ── Storage ──────────────────────────────────────────────────── */

export const loadBankStatementSettings = (): BankStatementSettings => getJson<BankStatementSettings>(BANK_STATEMENT_KEY, {}) ?? {};

export function saveBankTerms(accountId: string, terms: Partial<BankStatementTerms>): BankStatementSettings {
  requireAccess('settings.manage');
  const s = loadBankStatementSettings();
  const next: BankStatementSettings = { ...s, by_account: { ...(s.by_account ?? {}), [accountId]: termsOf(terms) } };
  setJson(BANK_STATEMENT_KEY, next);
  return next;
}
