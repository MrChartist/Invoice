/**
 * Manual vouchers (Phase 6.1): journal, contra, payment and receipt entries the user types,
 * stored in table `vouchers`. Every amount is an integer number of PAISE so a voucher can
 * only ever balance exactly.
 *
 * Numbering: one series per type per Indian FY — `JV/FY25-26/0001`, `CV/…`, `PV/…`, `RV/…`
 * (same shape as invoice numbers). Writes respect the period lock (src/lib/period-lock.ts)
 * and are written to the audit log.
 */

import { requireAccess } from '../access';
import { audit } from '../audit';
import { isoDay } from '../dates';
import { round2 } from '../invoice-calc';
import { buildInvoiceNumber, getIndianFY, highestSequence } from '../invoice-number';
import { assertUnlocked } from '../period-lock';
import { generateId, getTable, setTable } from '../storage';
import { localDb } from '../localDb';
import { withTablesRollback } from '../table-txn';
import { recordSeries, seriesHigh } from '../series-counters';
import type { Payment } from '../../types/invoice';
import { formatMoney } from '../utils';
import { chartOf, loadUserAccounts, type Account } from './accounts';
import { isCashOrBankLedger } from '../bank-ledgers';

export const VOUCHERS_TABLE = 'vouchers';

export type ManualVoucherType = 'JOURNAL' | 'CONTRA' | 'PAYMENT' | 'RECEIPT';

export const MANUAL_VOUCHER_TYPES: readonly ManualVoucherType[] = ['JOURNAL', 'CONTRA', 'PAYMENT', 'RECEIPT'];

export const VOUCHER_TYPE_LABELS: Record<ManualVoucherType, string> = {
  JOURNAL: 'Journal',
  CONTRA: 'Contra',
  PAYMENT: 'Payment',
  RECEIPT: 'Receipt',
};

export const VOUCHER_PREFIX: Record<ManualVoucherType, string> = {
  JOURNAL: 'JV',
  CONTRA: 'CV',
  PAYMENT: 'PV',
  RECEIPT: 'RV',
};

export interface ManualVoucherLine {
  account_id: string;
  /** Integer paise; exactly one of dr / cr is > 0. */
  dr: number;
  cr: number;
  /** Party name for the debtors / creditors control accounts (sub-ledger). */
  party?: string;
  /** Additive (6.16): `cost_centres` row id — meaningful on income / expense lines. */
  cost_centre_id?: string;
}

export interface ManualVoucher {
  id: string;
  type: ManualVoucherType;
  number: string;
  /** Local day, YYYY-MM-DD. */
  date: string;
  narration: string;
  lines: ManualVoucherLine[];
  created_at: string;
  updated_at?: string;
  /* ── Voucher variants (Tally parity) — additive, all optional; absent = a regular voucher ── */
  /**
   * `OPTIONAL`: kept in the Optional vouchers register, never in the books until "Make regular".
   * `MEMO`: a memorandum voucher — memo register only, never in the books.
   */
  variant?: ManualVoucherVariant;
  /** Post-dated: left out of the books until its date arrives (then it counts automatically). */
  post_dated?: boolean;
  /** Reversing journal: an automatic mirror-image journal is posted on this day (YYYY-MM-DD, after `date`). */
  reverse_on?: string;
  /** Free-text voucher class (Tally's optional voucher classes) — a register filter only. */
  voucher_class?: string;
  /** ISO timestamp an optional voucher was made regular. */
  regularised_at?: string;
  /** Additive (WP-9): `branches` row id of the branch / location. */
  branch_id?: string;
}

export type ManualVoucherVariant = 'OPTIONAL' | 'MEMO';

export type ManualVoucherInput = Omit<ManualVoucher, 'id' | 'created_at' | 'updated_at' | 'number'> & {
  id?: string;
  number?: string;
};

const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;

/** Rupees (as typed) → integer paise. */
export function rupeesToPaise(value: unknown): number {
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? '').replace(/,/g, ''));
  if (!Number.isFinite(n)) return 0;
  const r = round2(Math.abs(n));
  const text = String(r);
  return text.includes('e') ? Math.round(r * 100) : Math.round(Number(`${text}e2`));
}

export function paiseToRupees(p: number): number {
  return Math.round(p) / 100;
}

export function voucherTotals(lines: readonly ManualVoucherLine[]): { dr: number; cr: number; diff: number } {
  let dr = 0;
  let cr = 0;
  for (const l of lines) {
    dr += isInt(l.dr) ? l.dr : 0;
    cr += isInt(l.cr) ? l.cr : 0;
  }
  return { dr, cr, diff: dr - cr };
}

/** Problems with a voucher (empty list = it may be saved). */
export function validateVoucher(v: ManualVoucherInput, chart: readonly Account[]): string[] {
  const errors: string[] = [];
  const byId = new Map(chart.map((a) => [a.id, a]));
  if (!MANUAL_VOUCHER_TYPES.includes(v.type)) errors.push('Choose a voucher type.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date ?? '') || isoDay(v.date) !== v.date) errors.push('Choose the voucher date.');
  const lines = Array.isArray(v.lines) ? v.lines : [];
  if (lines.length < 2) errors.push('A voucher needs at least two lines (one debit, one credit).');
  lines.forEach((l, i) => {
    const n = i + 1;
    if (!byId.has(l.account_id)) errors.push(`Line ${n}: choose an account.`);
    if (!isInt(l.dr) || !isInt(l.cr)) errors.push(`Line ${n}: amounts must be positive.`);
    else if ((l.dr > 0) === (l.cr > 0)) errors.push(`Line ${n}: enter either a debit or a credit amount.`);
  });
  const t = voucherTotals(lines);
  if (t.dr === 0) errors.push('The voucher has no amount.');
  else if (t.diff !== 0) errors.push(`Debits and credits differ by ${formatMoney(Math.abs(t.diff) / 100)}.`);
  if (v.variant !== undefined && v.variant !== 'OPTIONAL' && v.variant !== 'MEMO') errors.push('Unknown voucher variant.');
  if (v.reverse_on) {
    if (v.type !== 'JOURNAL') errors.push('Only a journal voucher can reverse itself.');
    else if (isoDay(v.reverse_on) !== v.reverse_on || !(v.reverse_on > (v.date ?? ''))) errors.push('Choose a reversal date after the voucher date.');
  }
  const isCashBank = (l: ManualVoucherLine) => isCashOrBankLedger(byId.get(l.account_id)); // bank OD ledgers too (WP-5)
  if (!errors.length) {
    if (v.type === 'CONTRA' && !lines.every(isCashBank)) errors.push('A contra voucher moves money between cash and bank accounts only.');
    if (v.type === 'PAYMENT' && !lines.some((l) => l.cr > 0 && isCashBank(l))) errors.push('A payment voucher must credit a cash or bank account.');
    if (v.type === 'RECEIPT' && !lines.some((l) => l.dr > 0 && isCashBank(l))) errors.push('A receipt voucher must debit a cash or bank account.');
  }
  return errors;
}

/** Next number in the type's series for the FY of `date`. */
export function nextVoucherNumber(existing: readonly Pick<ManualVoucher, 'number'>[], type: ManualVoucherType, date: string): string {
  const prefix = VOUCHER_PREFIX[type];
  const fy = getIndianFY(date).label;
  // R4-C4: the number of a deleted voucher stays used (series high-water mark, set when it went to the bin).
  return buildInvoiceNumber(prefix, fy, Math.max(highestSequence(existing.map((v) => v.number), prefix, fy), seriesHigh(prefix, fy)) + 1);
}

/** Tolerant read of stored rows; malformed ones are skipped (the ledger warns about unbalanced ones). */
export function normalizeVouchers(rows: unknown[]): ManualVoucher[] {
  const out: ManualVoucher[] = [];
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const type = o.type as ManualVoucherType;
    const date = isoDay(o.date);
    if (typeof o.id !== 'string' || !MANUAL_VOUCHER_TYPES.includes(type) || !date || !Array.isArray(o.lines)) continue;
    const lines: ManualVoucherLine[] = [];
    for (const l of o.lines as unknown[]) {
      if (!l || typeof l !== 'object') continue;
      const x = l as Record<string, unknown>;
      lines.push({
        account_id: typeof x.account_id === 'string' ? x.account_id : '',
        dr: isInt(x.dr) ? x.dr : 0,
        cr: isInt(x.cr) ? x.cr : 0,
        ...(typeof x.party === 'string' && x.party.trim() ? { party: x.party.trim() } : {}),
        ...(typeof x.cost_centre_id === 'string' && x.cost_centre_id ? { cost_centre_id: x.cost_centre_id } : {}),
      });
    }
    out.push({
      id: o.id,
      type,
      number: typeof o.number === 'string' ? o.number : '',
      date,
      narration: typeof o.narration === 'string' ? o.narration : '',
      lines,
      created_at: typeof o.created_at === 'string' ? o.created_at : '',
      ...(typeof o.updated_at === 'string' ? { updated_at: o.updated_at } : {}),
      ...variantFields(o),
      ...(typeof o.branch_id === 'string' && o.branch_id ? { branch_id: o.branch_id } : {}),
    });
  }
  return out;
}

/** The additive variant fields of a stored / typed voucher, cleaned (absent when not set). */
export function variantFields(o: Partial<Record<keyof ManualVoucher, unknown>>): Pick<ManualVoucher, 'variant' | 'post_dated' | 'reverse_on' | 'voucher_class' | 'regularised_at'> {
  const out: Pick<ManualVoucher, 'variant' | 'post_dated' | 'reverse_on' | 'voucher_class' | 'regularised_at'> = {};
  if (o.variant === 'OPTIONAL' || o.variant === 'MEMO') out.variant = o.variant;
  if (o.post_dated === true) out.post_dated = true;
  const rev = isoDay(o.reverse_on);
  if (rev && o.type === 'JOURNAL') out.reverse_on = rev;
  if (typeof o.voucher_class === 'string' && o.voucher_class.trim()) out.voucher_class = o.voucher_class.trim();
  if (typeof o.regularised_at === 'string' && o.regularised_at) out.regularised_at = o.regularised_at;
  return out;
}

export function loadVouchers(): ManualVoucher[] {
  return normalizeVouchers(getTable<unknown>(VOUCHERS_TABLE));
}

export class VoucherError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VoucherError';
  }
}

function cleanLines(lines: readonly ManualVoucherLine[]): ManualVoucherLine[] {
  return lines.map((l) => ({
    account_id: l.account_id,
    dr: l.dr,
    cr: l.cr,
    ...(l.party && l.party.trim() ? { party: l.party.trim() } : {}),
    ...(l.cost_centre_id ? { cost_centre_id: l.cost_centre_id } : {}),
  }));
}

/**
 * Create or update a manual voucher. Throws VoucherError on invalid input or a duplicate
 * number, and PeriodLockedError when the (old or new) date is inside the period lock.
 */
export function saveVoucher(input: ManualVoucherInput, chart: readonly Account[] = chartOf(loadUserAccounts())): ManualVoucher {
  const errors = validateVoucher(input, chart);
  if (errors.length) throw new VoucherError(errors[0]);
  const all = loadVouchers();
  const prev = input.id ? all.find((v) => v.id === input.id) : undefined;
  const others = all.filter((v) => v.id !== prev?.id);

  const number = (input.number ?? '').trim() || (prev && prev.type === input.type ? prev.number : nextVoucherNumber(others, input.type, input.date));
  if (others.some((v) => v.number.toLowerCase() === number.toLowerCase())) throw new VoucherError(`Voucher number ${number} is already used.`);

  requireAccess('books.edit');
  const id = prev?.id ?? generateId();
  if (prev) assertUnlocked({ id, issue_date: prev.date, invoice_number: prev.number }, 'edit');
  const lock = assertUnlocked({ id, issue_date: input.date, invoice_number: number }, prev ? 'edit' : 'create');
  // A reversing journal also writes into the day it reverses on.
  if (input.reverse_on && input.type === 'JOURNAL') assertUnlocked({ id, issue_date: input.reverse_on, invoice_number: number }, prev ? 'edit' : 'create');
  if (prev?.reverse_on) assertUnlocked({ id, issue_date: prev.reverse_on, invoice_number: prev.number }, 'edit');

  // Bill-wise receipt rows (P0-11) must stay in step with the voucher they settle bills for.
  const receipts = prev ? voucherReceiptRows(prev.id) : [];
  if (prev && receipts.length) assertReceiptsInStep(prev, input, chart, receipts);

  const now = new Date().toISOString();
  const row: ManualVoucher = {
    id,
    type: input.type,
    number,
    date: input.date,
    narration: (input.narration ?? '').trim(),
    lines: cleanLines(input.lines),
    created_at: prev?.created_at ?? now,
    ...(prev ? { updated_at: now } : {}),
    ...variantFields({ ...input, regularised_at: prev?.regularised_at }),
    ...(input.branch_id ? { branch_id: input.branch_id } : {}),
  };
  setTable(VOUCHERS_TABLE, prev ? all.map((v) => (v.id === id ? row : v)) : [...all, row]);
  if (receipts.length && prev && prev.number !== number) {
    setTable('transactions', getTable<VoucherReceiptRow>('transactions').map((r) => (r.voucher_id === id ? { ...r, reference: number } : r)));
  }
  const amount = formatMoney(voucherTotals(row.lines).dr / 100);
  const tag = row.variant === 'OPTIONAL' ? ' (optional)' : row.variant === 'MEMO' ? ' (memorandum)' : row.post_dated ? ' (post-dated)' : row.reverse_on ? ` (reverses on ${row.reverse_on})` : '';
  audit.record({
    entity: 'voucher',
    entity_id: id,
    action: prev ? 'update' : 'create',
    doc_number: number,
    summary: `${prev ? 'Edited' : 'Recorded'} ${VOUCHER_TYPE_LABELS[row.type].toLowerCase()} voucher ${number}${tag} dated ${row.date} for ₹${amount}${lock === 'overridden' ? ' (period lock overridden)' : ''}`,
    ...(prev && prev.date !== row.date ? { changes: [{ field: 'Date', from: prev.date, to: row.date }] } : {}),
  });
  return row;
}

/** Delete a manual voucher (period lock applies). */
export function deleteVoucher(id: string): void {
  const all = loadVouchers();
  const row = all.find((v) => v.id === id);
  if (!row) return;
  requireAccess('books.edit');
  const lock = assertUnlocked({ id, issue_date: row.date, invoice_number: row.number }, 'delete');
  if (row.reverse_on) assertUnlocked({ id, issue_date: row.reverse_on, invoice_number: row.number }, 'delete');
  // Its bill-wise receipt rows go with it, whichever screen deletes it (M3): all or nothing.
  const receipts = voucherReceiptRows(id);
  withTablesRollback(receipts.length ? [VOUCHERS_TABLE, 'transactions', 'invoices'] : [VOUCHERS_TABLE], () => {
    removeVoucherReceiptRows(id);
    setTable(VOUCHERS_TABLE, all.filter((v) => v.id !== id));
  });
  recordSeries(row.number); // R4-C4: the deleted voucher (now in the recycle bin) keeps its number
  audit.record({
    entity: 'voucher',
    entity_id: id,
    action: 'delete',
    doc_number: row.number,
    summary: `Deleted ${VOUCHER_TYPE_LABELS[row.type].toLowerCase()} voucher ${row.number} dated ${row.date} (₹${formatMoney(voucherTotals(row.lines).dr / 100)})${lock === 'overridden' ? ' (period lock overridden)' : ''}`,
  });
}

/* ── Bill-wise receipt rows of a voucher (P0-11; `bill-allocation.ts` writes them) ────────────── */

/** A `transactions` row recorded for a receipt voucher's bill allocation. */
export type VoucherReceiptRow = Payment & { voucher_id?: string; client_id?: string; client_name?: string };

export function voucherReceiptRows(voucherId: string, rows: readonly VoucherReceiptRow[] = getTable<VoucherReceiptRow>('transactions')): VoucherReceiptRow[] {
  return rows.filter((r) => r.voucher_id === voucherId);
}

/**
 * Throws (nothing written) unless every receipt row of the voucher may be removed: role
 * `payment.record` and the period lock of each settled bill ('unpay').
 */
export function assertReceiptRowsRemovable(voucherId: string): void {
  const mine = voucherReceiptRows(voucherId);
  if (!mine.length) return;
  requireAccess('payment.record');
  for (const r of mine) {
    const target = r.invoice_id ? localDb.invoices.getById(r.invoice_id) : undefined;
    if (target) assertUnlocked(target, 'unpay');
  }
}

/** Remove every receipt row of a voucher (pre-checked first, so a refusal removes nothing). */
export function removeVoucherReceiptRows(voucherId: string): void {
  if (!voucherReceiptRows(voucherId).length) return;
  assertReceiptRowsRemovable(voucherId);
  withTablesRollback(['transactions', 'invoices'], () => {
    for (const r of voucherReceiptRows(voucherId)) if (r.invoice_id) localDb.payments.remove(r.id);
    const left = getTable<VoucherReceiptRow>('transactions');
    if (left.some((r) => r.voucher_id === voucherId)) setTable('transactions', left.filter((r) => r.voucher_id !== voucherId));
  });
}

/**
 * An edit of a receipt voucher that carries bill-wise rows may change its number, narration or the
 * other side of the entry, but not what the rows record (type, date, in-books state, the party and
 * the amount credited to it). Those edits go through `saveReceiptVoucher` (`bill-allocation.ts`),
 * which re-does the rows in the same step.
 */
function assertReceiptsInStep(prev: ManualVoucher, input: ManualVoucherInput, chart: readonly Account[], rows: readonly VoucherReceiptRow[]): void {
  const party = (rows[0].client_name ?? '').trim().toLowerCase();
  const debtors = new Set(chart.filter((a) => a.group === 'TRADE_RECEIVABLES').map((a) => a.id));
  const credited = input.lines.reduce((s, l) => s + (debtors.has(l.account_id) && (l.party ?? '').trim().toLowerCase() === party ? l.cr - l.dr : 0), 0);
  const recorded = Math.round(rows.reduce((s, r) => s + (Number(r.amount) || 0), 0) * 100);
  const inStep = input.type === 'RECEIPT' && input.date === prev.date && !input.variant && !input.post_dated && credited === recorded;
  if (!inStep) {
    throw new VoucherError(`Voucher ${prev.number} has bill-wise receipts: change its date, party or amount in Books → Vouchers, where the bill allocations are done again.`);
  }
}
