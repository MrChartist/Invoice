/**
 * Bill allocation on manual receipt vouchers (WP-1, P0-11 — receivable side; WIP-C covers payables
 * in `billwise.ts`). Tally's "Bill-wise Details" on an RV line against a Sundry Debtor:
 *   Agst Ref    — against an open invoice or opening bill
 *   On Account  — whatever is left (credited to the party, not to a bill)
 *
 * Each allocation becomes a `transactions` row tagged `voucher_id` (plus `client_id` / `client_name`),
 * recorded through `localDb.payments`, so invoice status, receivables, statements, receipts and the
 * Books cash book see the money exactly like a receipt. The ledger posts the voucher itself once:
 * `buildLedger` skips transactions rows whose `voucher_id` names a stored voucher (an orphaned row,
 * whose voucher was deleted elsewhere, posts as a plain receipt so no money disappears).
 */
import type { Client, InvoiceRecord, Payment } from '../types/invoice';
import { requireAccess } from './access';
import { round2 } from './invoice-calc';
import type { Account } from './ledger/accounts';
import {
  VOUCHERS_TABLE,
  assertReceiptRowsRemovable,
  removeVoucherReceiptRows,
  saveVoucher,
  type ManualVoucher,
  type ManualVoucherInput,
} from './ledger/vouchers';
import { localDb } from './localDb';
import { loadReceivableOpeningBills } from './opening-bills';
import { assertUnlocked } from './period-lock';
import { buildReceivables, type ReceiptRow } from './receivables';
import { generateId, getTable, setTable } from './storage';
import { withTablesRollback } from './table-txn';

export type VoucherReceipt = Payment & { voucher_id?: string; client_id?: string; client_name?: string };

export interface ReceiptAllocation {
  /** Invoice id or opening bill id. */
  bill_id: string;
  ref: string;
  /** Rupees, > 0. */
  amount: number;
}

export interface OpenRef {
  id: string;
  ref: string;
  date: string;
  due: string;
  /** Rupees still due (before this voucher's own allocations). */
  outstanding: number;
  opening: boolean;
}

const fold = (s: string | undefined) => (s ?? '').trim().toLowerCase();

/** The client a voucher's party name refers to (company or name, case-insensitive). */
export function clientForParty(party: string, clients: readonly Client[]): Client | undefined {
  const k = fold(party);
  if (!k) return undefined;
  return clients.find((c) => fold(c.company) === k) ?? clients.find((c) => fold(c.name) === k);
}

/** Rows recorded for a voucher. */
export function voucherReceipts(voucherId: string, rows: readonly VoucherReceipt[] = getTable<VoucherReceipt>('transactions')): VoucherReceipt[] {
  return rows.filter((r) => r.voucher_id === voucherId);
}

/** Agst Ref allocations recorded for a voucher (to pre-fill the editor). */
export function allocationsOf(voucherId: string): ReceiptAllocation[] {
  return voucherReceipts(voucherId)
    .filter((r) => r.invoice_id)
    .map((r) => ({ bill_id: r.invoice_id, ref: r.reference ?? '', amount: round2(Number(r.amount) || 0) }));
}

/**
 * Open refs (INR invoices + opening bills) of a party, oldest due first, with this voucher's own
 * earlier allocations added back so an edit can re-allocate them.
 */
export function openRefsFor(party: string, voucherId?: string, now: Date = new Date()): OpenRef[] {
  const clients = localDb.clients.getAll();
  const client = clientForParty(party, clients);
  if (!client?.id) return [];
  const all = localDb.payments.getAll() as ReceiptRow[];
  const payments = voucherId ? all.filter((p) => (p as VoucherReceipt).voucher_id !== voucherId) : all;
  const report = buildReceivables({ invoices: localDb.invoices.getAll(), payments, clients, openingBills: loadReceivableOpeningBills(clients) }, { now });
  const p = report.parties.find((x) => x.key === client.id);
  return (p?.bills ?? [])
    .filter((b) => !b.invoiceId.startsWith('onacc:'))
    .map((b) => ({ id: b.invoiceId, ref: b.number, date: b.issueDate, due: b.dueDate, outstanding: b.outstanding, opening: !!b.opening }));
}

/** Problems with an allocation set (empty = fine). `total` is the party line's credit in rupees. */
export function validateAllocations(allocations: readonly ReceiptAllocation[], total: number, refs: readonly OpenRef[]): string[] {
  const errors: string[] = [];
  const byId = new Map(refs.map((r) => [r.id, r]));
  let sum = 0;
  for (const a of allocations) {
    if (!(a.amount > 0)) continue;
    const ref = byId.get(a.bill_id);
    if (!ref) errors.push(`${a.ref || a.bill_id} is not an open bill of this party.`);
    else if (round2(a.amount) > round2(ref.outstanding) + 0.004) errors.push(`${ref.ref}: only ${ref.outstanding.toFixed(2)} is due.`);
    sum += a.amount;
  }
  if (round2(sum) > round2(total) + 0.004) errors.push('Bill allocations are more than the amount received from the party.');
  return errors;
}


/**
 * Replace the receipt rows of a voucher with `allocations` (+ On Account for the remainder).
 * An empty allocation list removes the rows (the voucher then stays a ledger-only receipt).
 *
 * All or nothing (security review H2): every bill is checked first (role, period lock 'pay' /
 * 'unpay', approval), and if a write still fails half-way the transactions and invoices are put
 * back — an untagged row would otherwise post a second time next to the voucher.
 */
export function syncVoucherReceipts(
  voucher: { id: string; number: string; date: string },
  party: string,
  total: number,
  allocations: readonly ReceiptAllocation[],
  method: string,
): VoucherReceipt[] {
  requireAccess('payment.record');
  const used = allocations.filter((a) => a.amount > 0);
  assertReceiptRowsRemovable(voucher.id);
  for (const a of used) {
    const target = localDb.invoices.getById(a.bill_id);
    if (target) assertCanReceive(target);
  }
  return withTablesRollback(['transactions', 'invoices'], () => {
    removeVoucherReceiptRows(voucher.id);
    if (!used.length) return [];
    const client = clientForParty(party, localDb.clients.getAll());
    const tag = { voucher_id: voucher.id, ...(client?.id ? { client_id: client.id } : {}), client_name: party };
    const ids = new Set<string>();
    for (const a of used) {
      const p = localDb.payments.record({ invoiceId: a.bill_id, amount: round2(a.amount), method, reference: voucher.number, date: voucher.date });
      ids.add(p.id);
    }
    const rows = getTable<VoucherReceipt>('transactions').map((r) => (ids.has(r.id) ? { ...r, ...tag } : r));
    const rest = round2(total - used.reduce((s, a) => s + a.amount, 0));
    if (rest > 0.004) rows.push({ id: generateId(), invoice_id: '', amount: rest, method, reference: voucher.number, note: 'On account', date: voucher.date, ...tag });
    setTable('transactions', rows);
    return voucherReceipts(voucher.id, rows);
  });
}

/** Remove every receipt row of a voucher (voucher deleted, or allocations cleared). */
export function removeVoucherReceipts(voucherId: string): void {
  removeVoucherReceiptRows(voucherId);
}

export interface VoucherReceiptsInput {
  /** The party on the receipt's Sundry Debtors line. */
  party: string;
  /** Rupees credited to that party. */
  total: number;
  allocations: readonly ReceiptAllocation[];
  method: string;
}

/**
 * Save a manual voucher and its bill-wise receipt rows as ONE change (H2): the bills are checked
 * before anything is written, and if the voucher or any receipt is refused the voucher, the
 * transactions and the invoices are put back as they were. `receipts` null / empty allocations on
 * a voucher that had rows removes them.
 */
export function saveReceiptVoucher(input: ManualVoucherInput, chart: readonly Account[] | undefined, receipts: VoucherReceiptsInput | null): ManualVoucher {
  const hadRows = input.id ? voucherReceipts(input.id).length > 0 : false;
  const allocations = receipts?.allocations.filter((a) => a.amount > 0) ?? [];
  if (!hadRows && !allocations.length) return saveVoucher(input, chart);
  requireAccess('payment.record');
  if (input.id) assertReceiptRowsRemovable(input.id);
  for (const a of allocations) {
    const target = localDb.invoices.getById(a.bill_id);
    if (target) assertCanReceive(target);
  }
  return withTablesRollback([VOUCHERS_TABLE, 'transactions', 'invoices'], () => {
    // Old rows go first, so `saveVoucher` sees a voucher free to change date / party / amount.
    if (input.id) removeVoucherReceiptRows(input.id);
    const saved = saveVoucher(input, chart);
    if (allocations.length && receipts) syncVoucherReceipts(saved, receipts.party, receipts.total, allocations, receipts.method);
    return saved;
  });
}

/** A receipt against this document may be recorded now (period lock 'pay'; not held for approval). */
function assertCanReceive(target: InvoiceRecord): void {
  assertUnlocked(target, 'pay');
  if (target.approval?.state === 'pending') throw new Error(`${target.invoice_number || 'This document'} is waiting for approval; record receipts after it is approved.`);
}
