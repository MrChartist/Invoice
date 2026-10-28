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
import { receivableTotal } from './rcm';
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
import { buildReceivables, posRefunds, type ReceiptRow } from './receivables';
import type { PosReturn } from './pos-returns';
import type { CreditLinkRow } from './amount-due';
import { generateId, getTable, setTable } from './storage';
import { withTablesRollback } from './table-txn';
import { audit } from './audit';
import { nextReceiptNumber, recordSeries, SERIES_TABLE } from './series-counters';

/**
 * `tds_amount` (R6-C2): the customer's TDS on the bill, stamped on the allocation row that clears the bill's cash part
 * (as an invoice receipt books it). Informational on the row: the ledger books Dr TDS receivable from the invoice's
 * own `tds_amount` (`postings.ts` `voucherTdsJournal`) and the TDS register reads the invoice.
 */
export type VoucherReceipt = Payment & { voucher_id?: string; client_id?: string; client_name?: string; tds_amount?: number };

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
  /** R6-C2: TDS the customer withholds on this bill (the invoice's `tds_amount`); `outstanding` is already net of it. */
  tds?: number;
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
  const report = buildReceivables({ invoices: localDb.invoices.getAll(), payments, clients, openingBills: loadReceivableOpeningBills(clients), links: getTable<CreditLinkRow>('doc_links'), refunds: posRefunds(getTable<PosReturn>('pos_returns')) }, { now });
  const p = report.parties.find((x) => x.key === client.id);
  const tdsOf = (id: string) => round2(Math.max(Number(localDb.invoices.getById(id)?.tds_amount) || 0, 0));
  return (p?.bills ?? [])
    .filter((b) => !b.invoiceId.startsWith('onacc:'))
    .map((b) => {
      const tds = b.opening ? 0 : tdsOf(b.invoiceId);
      return { id: b.invoiceId, ref: b.number, date: b.issueDate, due: b.dueDate, outstanding: b.outstanding, opening: !!b.opening, ...(tds > 0 ? { tds } : {}) };
    });
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
  /** Label of the non-bill remainder row (7.19: "New ref …" / "Advance"); default "On account". */
  remainderNote = 'On account',
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
    const rows = stampVoucherTds(getTable<VoucherReceipt>('transactions').map((r) => (ids.has(r.id) ? { ...r, ...tag } : r)), ids);
    const rest = round2(total - used.reduce((s, a) => s + a.amount, 0));
    if (rest > 0.004) rows.push({ id: generateId(), invoice_id: '', amount: rest, method, reference: voucher.number, note: remainderNote, date: voucher.date, ...tag });
    setTable('transactions', rows);
    return voucherReceipts(voucher.id, rows);
  });
}

/**
 * R6-C2: stamp the bill's TDS on the voucher row (of `ids`) whose amount takes the bill's receipts past total − TDS —
 * the same receipt `postings.ts` `tdsSettlements` books TDS receivable on. Pure over `rows`.
 */
export function stampVoucherTds(rows: VoucherReceipt[], ids: ReadonlySet<string>, invoiceOf: (id: string) => InvoiceRecord | undefined = (id) => localDb.invoices.getById(id)): VoucherReceipt[] {
  const targets = new Set(rows.filter((r) => ids.has(r.id) && r.invoice_id).map((r) => r.invoice_id));
  const stamp = new Map<string, number>();
  for (const invoiceId of targets) {
    const inv = invoiceOf(invoiceId);
    const tds = round2(Math.max(Number(inv?.tds_amount) || 0, 0));
    if (!inv || !(tds > 0)) continue;
    const cashDue = round2(Math.abs(receivableTotal(inv)) - tds);
    let paid = 0;
    const mine = rows.filter((r) => r.invoice_id === invoiceId).sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.id).localeCompare(String(b.id)));
    for (const r of mine) {
      const before = paid;
      paid = round2(paid + Math.abs(Number(r.amount) || 0));
      if (before < cashDue - 0.004 && paid >= cashDue - 0.004) {
        if (ids.has(r.id)) stamp.set(r.id, tds);
        break;
      }
    }
  }
  return stamp.size ? rows.map((r) => (stamp.has(r.id) ? { ...r, tds_amount: stamp.get(r.id) } : r)) : rows;
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
  /** Additive (7.19): label of the remainder row (New Ref / Advance); default "On account". */
  remainder_note?: string;
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
    if (allocations.length && receipts) syncVoucherReceipts(saved, receipts.party, receipts.total, allocations, receipts.method, receipts.remainder_note);
    return saved;
  });
}

export interface PartyReceiptInput {
  /** The party (client master id when known; the name is always written on the rows). */
  client: { id?: string; name: string };
  /** Rupees received, > 0. */
  amount: number;
  method: string;
  /** UTR / UPI ref / cheque number. */
  reference?: string;
  note?: string;
  /** Local day (YYYY-MM-DD). */
  date: string;
  /** Agst Ref allocations (invoice or opening bill ids); the rest goes On Account. */
  allocations: readonly ReceiptAllocation[];
}

/**
 * Quick "₹ Received" from the khata (8.2): one receipt from a party, split over its open bills
 * (usually oldest first, `fifoAllocate` in `khata.ts`) and the remainder on account. The same rows
 * a receipt voucher writes (minus the voucher): each allocation is a `localDb.payments.record` row
 * (receipt number, invoice status, audit), tagged `client_id` / `client_name`; the remainder is one
 * invoice-less row with the party, which receivables treat as an advance and Books post as a receipt
 * from the party. All or nothing (H2): role, period lock and approval are checked for every bill
 * before anything is written, and a failure half-way restores `transactions`, `invoices` and the
 * receipt-number high-water mark.
 */
export function savePartyReceipt(input: PartyReceiptInput): VoucherReceipt[] {
  requireAccess('payment.record');
  const total = round2(Number(input.amount) || 0);
  if (!(total > 0)) throw new Error('Enter an amount above zero.');
  const name = input.client.name.trim();
  if (!name) throw new Error('Pick the party who paid.');
  const date = input.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Enter the date the money came in.');
  const used = input.allocations.filter((a) => a.amount > 0).map((a) => ({ ...a, amount: round2(a.amount) }));
  const allocated = round2(used.reduce((s, a) => s + a.amount, 0));
  if (allocated > total + 0.004) throw new Error('The bills add up to more than the amount received.');
  const rest = round2(total - allocated);
  // Every target first: nothing is written when one of them is refused.
  for (const a of used) {
    const target = localDb.invoices.getById(a.bill_id);
    if (target) assertCanReceive(target);
    else assertUnlocked({ issue_date: date, invoice_number: a.ref }, 'pay');
  }
  const overridden = rest > 0.004 ? assertUnlocked({ issue_date: date, invoice_number: 'On-account receipt' }, 'pay') === 'overridden' : false;
  const tag = { ...(input.client.id ? { client_id: input.client.id } : {}), client_name: name };
  return withTablesRollback(['transactions', 'invoices', SERIES_TABLE], () => {
    const ids = new Set<string>();
    for (const a of used) {
      const p = localDb.payments.record({ invoiceId: a.bill_id, amount: a.amount, method: input.method, reference: input.reference, note: input.note, date });
      ids.add(p.id);
    }
    const rows = getTable<VoucherReceipt>('transactions').map((r) => (ids.has(r.id) ? { ...r, ...tag } : r));
    let onAccount: VoucherReceipt | null = null;
    if (rest > 0.004) {
      onAccount = {
        id: generateId(), invoice_id: '', amount: rest, method: input.method || 'Cash', reference: input.reference,
        note: input.note?.trim() || 'On account', date, receipt_number: nextReceiptNumber(date, rows), ...tag,
      };
      rows.push(onAccount);
      ids.add(onAccount.id);
    }
    setTable('transactions', rows);
    if (onAccount) {
      recordSeries(onAccount.receipt_number);
      const row = onAccount;
      try {
        audit.record({
          entity: 'payment', entity_id: row.id, action: 'payment_add',
          summary: `On-account receipt ₹${row.amount.toFixed(2)} from ${name} via ${row.method}${overridden ? ' (period-lock override)' : ''}`,
          changes: [{ field: 'Amount', from: null, to: row.amount.toFixed(2) }, { field: 'Method', from: null, to: row.method }, { field: 'Date', from: null, to: row.date }],
        });
      } catch {
        /* logging must never break a save */
      }
    }
    return rows.filter((r) => ids.has(r.id));
  });
}

/** A receipt against this document may be recorded now (period lock 'pay'; not held for approval). */
function assertCanReceive(target: InvoiceRecord): void {
  assertUnlocked(target, 'pay');
  if (target.approval?.state === 'pending') throw new Error(`${target.invoice_number || 'This document'} is waiting for approval; record receipts after it is approved.`);
}
