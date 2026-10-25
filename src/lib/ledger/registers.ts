/**
 * Voucher registers (WP-2, P1-4): Sales / Purchase / Journal / Payment / Receipt / Contra / Debit
 * Note / Credit Note registers, month-wise → vouchers → voucher, with a columnar view (one column per
 * ledger the vouchers touch: party, sales, each tax head, round off …) and voucher statistics (P2).
 * Pure. Working papers — verify with your CA.
 */

import type { Period } from '../books';
import type { Ledger, LedgerVoucher, LedgerVoucherKind } from './postings';
import { monthPeriods } from './group-summary';

export type RegisterId = 'sales' | 'purchase' | 'journal' | 'payment' | 'receipt' | 'contra' | 'debit_note' | 'credit_note';

export const REGISTER_KINDS: Record<RegisterId, LedgerVoucherKind[]> = {
  sales: ['Sales'],
  purchase: ['Purchase', 'Expense'],
  journal: ['Journal', 'Depreciation', 'Fixed Asset', 'Opening'],
  payment: ['Payment'],
  receipt: ['Receipt'],
  contra: ['Contra'],
  debit_note: ['Debit Note'],
  credit_note: ['Credit Note'],
};

export const REGISTER_LABELS: Record<RegisterId, string> = {
  sales: 'Sales Register',
  purchase: 'Purchase Register',
  journal: 'Journal Register',
  payment: 'Payment Register',
  receipt: 'Receipt Register',
  contra: 'Contra Register',
  debit_note: 'Debit Note Register',
  credit_note: 'Credit Note Register',
};

const value = (v: LedgerVoucher) => v.lines.reduce((s, l) => s + l.dr, 0);

export interface RegisterMonth {
  key: string;
  label: string;
  period: Period;
  count: number;
  /** Σ voucher values (total debits). */
  amount: number;
  vouchers: LedgerVoucher[];
}

export interface VoucherRegister {
  id: RegisterId;
  period: Period;
  months: RegisterMonth[];
  count: number;
  amount: number;
}

/** Month-wise register for one voucher class. Every month of the period is listed (Tally style). */
export function voucherRegister(ledger: Ledger, id: RegisterId, period: Period): VoucherRegister {
  const kinds = new Set(REGISTER_KINDS[id]);
  const months: RegisterMonth[] = monthPeriods(period).map((m) => ({ ...m, count: 0, amount: 0, vouchers: [] }));
  const idx = new Map(months.map((m, i) => [m.key, i]));
  for (const v of ledger.vouchers) {
    if (!kinds.has(v.kind) || v.date < period.start || v.date > period.end) continue;
    const m = months[idx.get(v.date.slice(0, 7)) ?? -1];
    if (!m) continue;
    m.count += 1;
    m.amount += value(v);
    m.vouchers.push(v);
  }
  return { id, period, months, count: months.reduce((s, m) => s + m.count, 0), amount: months.reduce((s, m) => s + m.amount, 0) };
}

export interface ColumnarRegister {
  /** Ledger ids in column order (most used first). */
  columns: Array<{ accountId: string; label: string }>;
  rows: Array<{ voucher: LedgerVoucher; amount: number; values: number[] }>;
  totals: number[];
  amount: number;
}

/** Columnar register: signed (debit-positive) amount per ledger for each voucher. */
export function columnarRegister(ledger: Ledger, vouchers: readonly LedgerVoucher[]): ColumnarRegister {
  const use = new Map<string, number>();
  for (const v of vouchers) for (const l of v.lines) use.set(l.account, (use.get(l.account) ?? 0) + 1);
  const columns = [...use.entries()]
    .sort((a, b) => b[1] - a[1] || (ledger.byId.get(a[0])?.code ?? '').localeCompare(ledger.byId.get(b[0])?.code ?? ''))
    .map(([accountId]) => ({ accountId, label: ledger.byId.get(accountId)?.name ?? accountId }));
  const col = new Map(columns.map((c, i) => [c.accountId, i]));
  const totals = columns.map(() => 0);
  const rows = vouchers.map((v) => {
    const values = columns.map(() => 0);
    for (const l of v.lines) values[col.get(l.account)!] += l.dr - l.cr;
    values.forEach((x, i) => (totals[i] += x));
    return { voucher: v, amount: value(v), values };
  });
  return { columns, rows, totals, amount: rows.reduce((s, r) => s + r.amount, 0) };
}

export interface VoucherStatistics {
  period: Period;
  rows: Array<{ kind: LedgerVoucherKind; auto: number; manual: number; total: number }>;
  total: number;
  accountsUsed: number;
  accountsInChart: number;
}

/** Tally "Statistics": voucher counts by type (automatic vs manual) and ledgers in use. */
export function voucherStatistics(ledger: Ledger, period: Period): VoucherStatistics {
  const m = new Map<LedgerVoucherKind, { auto: number; manual: number }>();
  const used = new Set<string>();
  for (const v of ledger.vouchers) {
    if (v.date < period.start || v.date > period.end) continue;
    const c = m.get(v.kind) ?? { auto: 0, manual: 0 };
    c[v.source] += 1;
    m.set(v.kind, c);
    for (const l of v.lines) used.add(l.account);
  }
  const rows = [...m.entries()].map(([kind, c]) => ({ kind, ...c, total: c.auto + c.manual })).sort((a, b) => b.total - a.total || a.kind.localeCompare(b.kind));
  return { period, rows, total: rows.reduce((s, r) => s + r.total, 0), accountsUsed: used.size, accountsInChart: ledger.accounts.length };
}
