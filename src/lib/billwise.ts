/**
 * Bill-wise payables (Tally parity): Tally's bill allocations on supplier payments —
 *   Agst Ref  — against a bill (a `purchase_payments` row; several rows of one multi-bill payment
 *               share a `group_id`, partial amounts allowed);
 *   New Ref / Advance / On Account — money paid that is not against a bill yet (`vendor_payments`);
 *               adjust it against a bill later (an `allocations` row; no money moves).
 * Outstanding payables bill-wise with ageing by due date (or bill date), the party ledger bill-wise
 * view, and the MSMED Act Sec 16 interest on overdue bills of micro / small suppliers (`msme.ts`).
 *
 * Pure above the "Storage" divider. Working papers — verify with your CA.
 */

import type { PurchaseRecord, PurchaseReturn, Vendor, VendorPayment } from '../types/purchases';
import { isLiveNote, noteSupplierAmount } from './purchase-returns-gst';
import { requireAccess } from './access';
import { audit } from './audit';
import { daysBetween } from './compliance';
import { isoDay } from './dates';
import { num, round2 } from './invoice-calc';
import { msmeBills } from './msme';
import { assertUnlocked } from './period-lock';
import { isVoidStatus, readPurchase, supplierPayable } from './purchase-normalize';
import { balanceOf, paymentsDb, purchasesDb, type PurchasePayment } from './purchases';
import { generateId, getTable, setTable } from './storage';

export const VENDOR_PAYMENTS_TABLE = 'vendor_payments';

/* ── Pure ─────────────────────────────────────────────────────── */

/** What is still unadjusted on an advance / on-account payment (allocations to deleted bills ignored). */
export function unallocatedOf(vp: VendorPayment, billIds?: ReadonlySet<string>): number {
  const used = (vp.allocations ?? []).filter((a) => !billIds || billIds.has(a.purchase_id)).reduce((s, a) => s + num(a.amount), 0);
  return round2(Math.max(num(vp.amount) - used, 0));
}

export type AgeBucket = 'notDue' | 'd0_30' | 'd31_60' | 'd61_90' | 'd90plus';
export const AGE_BUCKETS: readonly AgeBucket[] = ['notDue', 'd0_30', 'd31_60', 'd61_90', 'd90plus'];

export function bucketOf(overdueDays: number): AgeBucket {
  if (overdueDays <= 0) return 'notDue';
  if (overdueDays <= 30) return 'd0_30';
  if (overdueDays <= 60) return 'd31_60';
  if (overdueDays <= 90) return 'd61_90';
  return 'd90plus';
}

export interface BillRef {
  purchaseId: string;
  number: string;
  date: string;
  due: string;
  /** What the supplier is owed (`supplierPayable`: total − self-assessed GST − TDS on booking). */
  payable: number;
  /** Settled up to `asOf`: payments (cash + TDS on payment) and advance adjustments. */
  settled: number;
  balance: number;
  overdueDays: number;
  bucket: AgeBucket;
  /** Agst Ref allocations, oldest first. */
  allocations: { date: string; amount: number; kind: 'payment' | 'adjustment'; ref: string }[];
  /** MSMED Act Sec 16 interest (micro / small suppliers only), ₹. */
  msmeInterest: number;
}

export interface OpenAdvance {
  id: string;
  kind: VendorPayment['kind'];
  date: string;
  ref: string;
  amount: number;
  unallocated: number;
  /** WP-3: set when this open item is the on-account part of a purchase return / supplier note (not adjustable here). */
  noteId?: string;
}

export interface PartyPayables {
  vendorId?: string;
  vendor: string;
  bills: BillRef[];
  advances: OpenAdvance[];
  billsTotal: number;
  advancesTotal: number;
  /** billsTotal − advancesTotal: what is owed net of unadjusted advances. */
  net: number;
  buckets: Record<AgeBucket, number>;
}

export interface PayablesInput {
  purchases: readonly PurchaseRecord[];
  payments: readonly PurchasePayment[];
  vendorPayments: readonly VendorPayment[];
  vendors?: readonly Vendor[];
  asOf: string;
  /** Age by due date (default) or by bill date. */
  ageBy?: 'due' | 'bill';
  /** Include fully settled bills (party ledger view). */
  includeSettled?: boolean;
  /** WP-3: purchase returns / supplier notes — an Agst Ref adjustment on their bill, any excess on account. */
  returns?: readonly PurchaseReturn[];
}

const emptyBuckets = (): Record<AgeBucket, number> => ({ notDue: 0, d0_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 });
const partyKey = (vendorId: string | undefined, name: string) => (vendorId ? `id:${vendorId}` : `name:${name.trim().toLowerCase()}`);

/** Outstanding payables bill-wise, party by party, as of `asOf`. */
export function billwisePayables(input: PayablesInput): PartyPayables[] {
  const asOf = input.asOf;
  const billIds = new Set(input.purchases.map((p) => p.id));
  const payByBill = new Map<string, PurchasePayment[]>();
  for (const p of input.payments) payByBill.set(p.purchase_id, [...(payByBill.get(p.purchase_id) ?? []), p]);
  const adjByBill = new Map<string, { date: string; amount: number; ref: string }[]>();
  for (const vp of input.vendorPayments) {
    for (const a of vp.allocations ?? []) {
      adjByBill.set(a.purchase_id, [...(adjByBill.get(a.purchase_id) ?? []), { date: a.date, amount: num(a.amount), ref: vp.kind === 'NEW_REF' ? vp.ref_name || 'New ref' : vp.kind === 'ADVANCE' ? 'Advance' : 'On account' }]);
    }
  }
  for (const n of input.returns ?? []) {
    if (!isLiveNote(n) || !n.purchase_id || !(num(n.adjusted_amount) > 0)) continue;
    adjByBill.set(n.purchase_id, [...(adjByBill.get(n.purchase_id) ?? []), { date: n.date, amount: num(n.adjusted_amount), ref: n.note_number }]);
  }
  const msme = new Map<string, number>();
  try {
    for (const b of msmeBills(input.purchases as PurchaseRecord[], (input.vendors ?? []) as Vendor[], input.payments as PurchasePayment[], asOf)) msme.set(b.id, b.interest);
  } catch {
    /* MSME data unreadable: no interest column */
  }
  const parties = new Map<string, PartyPayables>();
  const party = (vendorId: string | undefined, name: string) => {
    const k = partyKey(vendorId, name);
    let p = parties.get(k);
    if (!p) {
      p = { vendorId, vendor: name || 'Unknown vendor', bills: [], advances: [], billsTotal: 0, advancesTotal: 0, net: 0, buckets: emptyBuckets() };
      parties.set(k, p);
    }
    return p;
  };

  for (const bill of input.purchases) {
    const c = readPurchase(bill);
    if (!c || isVoidStatus(c.status) || c.date > asOf) continue;
    const payable = supplierPayable(bill);
    const allocations: BillRef['allocations'] = [];
    let rowsTotal = 0;
    for (const p of payByBill.get(bill.id) ?? []) {
      const amount = round2(num(p.amount) + Math.max(num(p.tds_amount), 0));
      rowsTotal += amount;
      if (isoDay(p.date) && p.date <= asOf) allocations.push({ date: p.date, amount, kind: 'payment', ref: p.reference || p.method });
    }
    for (const a of adjByBill.get(bill.id) ?? []) {
      rowsTotal += a.amount;
      if (a.date <= asOf) allocations.push({ date: a.date, amount: round2(a.amount), kind: 'adjustment', ref: a.ref });
    }
    // amount_paid not backed by rows (legacy / imported): settled on the bill date.
    const legacy = round2(num(bill.amount_paid) - rowsTotal);
    if (legacy > 0.004) allocations.push({ date: bill.date, amount: legacy, kind: 'payment', ref: 'Paid (recorded on the bill)' });
    allocations.sort((a, b) => a.date.localeCompare(b.date));
    const settled = round2(allocations.reduce((s, a) => s + a.amount, 0));
    const balance = round2(Math.max(payable - settled, 0));
    if (balance <= 0.004 && !input.includeSettled) continue;
    const due = (input.ageBy ?? 'due') === 'bill' ? bill.date : bill.due_date || bill.date;
    const overdueDays = Math.max(daysBetween(due, asOf), 0);
    const ref: BillRef = { purchaseId: bill.id, number: bill.bill_number, date: bill.date, due, payable, settled, balance, overdueDays, bucket: bucketOf(due < asOf ? overdueDays : 0), allocations, msmeInterest: round2(msme.get(bill.id) ?? 0) };
    const p = party(bill.vendor_id, bill.vendor_name);
    p.bills.push(ref);
    p.billsTotal = round2(p.billsTotal + balance);
    p.buckets[ref.bucket] = round2(p.buckets[ref.bucket] + balance);
  }
  for (const vp of input.vendorPayments) {
    if (!isoDay(vp.date) || vp.date > asOf) continue;
    const used = (vp.allocations ?? []).filter((a) => billIds.has(a.purchase_id) && a.date <= asOf).reduce((s, a) => s + num(a.amount), 0);
    const unallocated = round2(Math.max(num(vp.amount) - used, 0));
    if (unallocated <= 0.004 && !input.includeSettled) continue;
    const p = party(vp.vendor_id, vp.vendor_name);
    p.advances.push({ id: vp.id, kind: vp.kind, date: vp.date, ref: vp.ref_name || vp.reference || '', amount: round2(num(vp.amount)), unallocated });
    p.advancesTotal = round2(p.advancesTotal + unallocated);
  }
  // WP-3: the part of a note not adjusted against a bill is a debit on the supplier's account.
  for (const n of input.returns ?? []) {
    if (!isLiveNote(n) || n.date > asOf) continue;
    const open = round2(noteSupplierAmount(n) - (n.purchase_id && billIds.has(n.purchase_id) ? num(n.adjusted_amount) : 0));
    if (open <= 0.004 && !input.includeSettled) continue;
    const p = party(n.vendor_id, n.vendor_name);
    p.advances.push({ id: n.id, kind: 'ON_ACCOUNT', date: n.date, ref: n.note_number, amount: round2(noteSupplierAmount(n)), unallocated: Math.max(open, 0), noteId: n.id });
    p.advancesTotal = round2(p.advancesTotal + Math.max(open, 0));
  }
  for (const p of parties.values()) {
    p.bills.sort((a, b) => a.due.localeCompare(b.due) || a.date.localeCompare(b.date));
    p.advances.sort((a, b) => a.date.localeCompare(b.date));
    p.net = round2(p.billsTotal - p.advancesTotal);
  }
  return [...parties.values()].filter((p) => p.bills.length || p.advances.length).sort((a, b) => b.net - a.net || a.vendor.localeCompare(b.vendor));
}

export function payablesTotals(parties: readonly PartyPayables[]): { bills: number; advances: number; net: number; buckets: Record<AgeBucket, number>; msmeInterest: number } {
  const buckets = emptyBuckets();
  let bills = 0;
  let advances = 0;
  let msmeInterest = 0;
  for (const p of parties) {
    bills += p.billsTotal;
    advances += p.advancesTotal;
    for (const k of AGE_BUCKETS) buckets[k] = round2(buckets[k] + p.buckets[k]);
    for (const b of p.bills) msmeInterest += b.msmeInterest;
  }
  return { bills: round2(bills), advances: round2(advances), net: round2(bills - advances), buckets, msmeInterest: round2(msmeInterest) };
}

export interface AllocationPlanLine {
  purchaseId: string;
  amount: number;
}

/**
 * Split one payment over bills: explicit Agst Ref amounts first, else oldest due first ("FIFO"),
 * the remainder going to New Ref / Advance / On Account. Never allocates more than a bill's balance.
 */
export function planAllocation(amount: number, bills: readonly { purchaseId: string; balance: number; due: string }[], explicit?: readonly AllocationPlanLine[]): { lines: AllocationPlanLine[]; remainder: number } {
  let left = round2(Math.max(num(amount), 0));
  const lines: AllocationPlanLine[] = [];
  const byId = new Map(bills.map((b) => [b.purchaseId, b]));
  if (explicit) {
    for (const e of explicit) {
      const b = byId.get(e.purchaseId);
      const a = round2(Math.min(Math.max(num(e.amount), 0), b ? b.balance : 0, left));
      if (a > 0) {
        lines.push({ purchaseId: e.purchaseId, amount: a });
        left = round2(left - a);
      }
    }
  } else {
    for (const b of [...bills].sort((x, y) => x.due.localeCompare(y.due))) {
      const a = round2(Math.min(b.balance, left));
      if (a > 0) {
        lines.push({ purchaseId: b.purchaseId, amount: a });
        left = round2(left - a);
      }
    }
  }
  return { lines, remainder: left };
}

/* ── Storage ──────────────────────────────────────────────────── */

export class BillwiseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BillwiseError';
  }
}

export const vendorPaymentsDb = {
  all: (): VendorPayment[] => getTable<VendorPayment>(VENDOR_PAYMENTS_TABLE).filter((v) => v && typeof v.id === 'string'),
  get: (id: string): VendorPayment | undefined => vendorPaymentsDb.all().find((v) => v.id === id),
};

export interface SupplierPaymentInput {
  vendorId?: string;
  vendorName: string;
  date: string;
  amount: number;
  method: string;
  reference?: string;
  bankAccountId?: string;
  /** Agst Ref allocations; anything left over becomes `remainderKind`. */
  allocations: AllocationPlanLine[];
  remainderKind?: VendorPayment['kind'];
  refName?: string;
}

/**
 * Record one supplier payment allocated bill-wise: an Agst Ref `purchase_payments` row per bill
 * (same `group_id`) and, for any remainder, a `vendor_payments` row (New Ref / Advance / On Account).
 * Each part goes through the usual access check and period lock.
 */
export function recordSupplierPayment(input: SupplierPaymentInput): { groupId: string; payments: PurchasePayment[]; remainder?: VendorPayment } {
  requireAccess('books.edit');
  const amount = round2(num(input.amount));
  if (!(amount > 0)) throw new BillwiseError('Enter the amount paid.');
  if (!isoDay(input.date)) throw new BillwiseError('Choose the payment date.');
  if (!input.vendorName.trim()) throw new BillwiseError('Choose the supplier.');
  const allocated = round2(input.allocations.reduce((s, a) => s + num(a.amount), 0));
  if (allocated > amount + 0.004) throw new BillwiseError('The bill allocations exceed the amount paid.');
  for (const a of input.allocations) {
    const bill = purchasesDb.get(a.purchaseId);
    if (!bill) throw new BillwiseError('A bill in the allocation no longer exists.');
    if (round2(num(a.amount)) > balanceOf(bill) + 0.004) throw new BillwiseError(`Bill ${bill.bill_number || bill.id}: the allocation exceeds its balance of ${balanceOf(bill).toFixed(2)}.`);
  }
  assertUnlocked({ issue_date: input.date }, 'pay');
  const groupId = generateId();
  const payments: PurchasePayment[] = [];
  for (const a of input.allocations) {
    if (!(num(a.amount) > 0)) continue;
    payments.push(paymentsDb.record(a.purchaseId, { amount: round2(num(a.amount)), date: input.date, method: input.method, reference: input.reference, bankAccountId: input.bankAccountId, groupId }));
  }
  const left = round2(amount - allocated);
  let remainder: VendorPayment | undefined;
  if (left > 0.004) {
    remainder = {
      id: generateId(),
      ...(input.vendorId ? { vendor_id: input.vendorId } : {}),
      vendor_name: input.vendorName.trim(),
      date: input.date,
      amount: left,
      method: input.method,
      ...(input.reference?.trim() ? { reference: input.reference.trim() } : {}),
      ...(input.bankAccountId && input.method.toLowerCase() !== 'cash' ? { bank_account_id: input.bankAccountId } : {}),
      kind: input.remainderKind ?? 'ON_ACCOUNT',
      ...(input.refName?.trim() ? { ref_name: input.refName.trim() } : {}),
      allocations: [],
      group_id: groupId,
      created_at: new Date().toISOString(),
    };
    setTable(VENDOR_PAYMENTS_TABLE, [...vendorPaymentsDb.all(), remainder]);
    audit.record({
      entity: 'vendor_payment',
      entity_id: remainder.id,
      action: 'create',
      doc_number: remainder.reference ?? remainder.ref_name ?? '',
      summary: `${remainder.kind === 'ADVANCE' ? 'Advance' : remainder.kind === 'NEW_REF' ? 'New ref' : 'On-account payment'} of ₹${left.toFixed(2)} to ${remainder.vendor_name} on ${remainder.date}`,
    });
  }
  return { groupId, payments, remainder };
}

/** Adjust an unallocated advance / on-account payment against a bill (Agst Ref). Moves no money. */
export function adjustAgainstBill(vendorPaymentId: string, purchaseId: string, amount: number, date: string): VendorPayment {
  requireAccess('books.edit');
  const all = vendorPaymentsDb.all();
  const vp = all.find((v) => v.id === vendorPaymentId);
  const bill = purchasesDb.get(purchaseId);
  if (!vp || !bill) throw new BillwiseError('Payment or bill not found.');
  const day = isoDay(date);
  if (!day) throw new BillwiseError('Choose the adjustment date.');
  if (day < vp.date) throw new BillwiseError('An advance cannot be adjusted before it was paid.');
  const a = round2(num(amount));
  const billIds = new Set(purchasesDb.all().map((p) => p.id));
  if (!(a > 0)) throw new BillwiseError('Enter the amount to adjust.');
  if (a > unallocatedOf(vp, billIds) + 0.004) throw new BillwiseError(`Only ₹${unallocatedOf(vp, billIds).toFixed(2)} of this payment is unadjusted.`);
  if (a > balanceOf(bill) + 0.004) throw new BillwiseError(`The bill balance is ₹${balanceOf(bill).toFixed(2)}.`);
  assertUnlocked({ issue_date: day }, 'pay');
  const next: VendorPayment = { ...vp, allocations: [...(vp.allocations ?? []), { purchase_id: purchaseId, amount: a, date: day }] };
  setTable(VENDOR_PAYMENTS_TABLE, all.map((v) => (v.id === vp.id ? next : v)));
  // Roll into the bill like a payment (only `amount_paid` changes, allowed inside a locked bill period).
  setTable('purchases', purchasesDb.all().map((p) => (p.id === purchaseId ? { ...p, amount_paid: round2(num(p.amount_paid) + a), updated_at: new Date().toISOString() } : p)));
  audit.record({ entity: 'vendor_payment', entity_id: vp.id, action: 'update', doc_number: bill.bill_number, summary: `₹${a.toFixed(2)} of ${vp.kind === 'ADVANCE' ? 'the advance' : 'the on-account payment'} to ${vp.vendor_name} adjusted against bill ${bill.bill_number || bill.id} on ${day}` });
  return next;
}

/** Remove an advance / on-account payment and undo its adjustments on the bills. */
export function deleteVendorPayment(id: string): void {
  const all = vendorPaymentsDb.all();
  const vp = all.find((v) => v.id === id);
  if (!vp) return;
  requireAccess('books.edit');
  assertUnlocked({ issue_date: vp.date }, 'unpay');
  for (const a of vp.allocations ?? []) assertUnlocked({ issue_date: a.date }, 'unpay');
  const undo = new Map<string, number>();
  for (const a of vp.allocations ?? []) undo.set(a.purchase_id, (undo.get(a.purchase_id) ?? 0) + num(a.amount));
  if (undo.size) setTable('purchases', purchasesDb.all().map((p) => (undo.has(p.id) ? { ...p, amount_paid: Math.max(round2(num(p.amount_paid) - (undo.get(p.id) ?? 0)), 0) } : p)));
  setTable(VENDOR_PAYMENTS_TABLE, all.filter((v) => v.id !== id));
  audit.record({ entity: 'vendor_payment', entity_id: id, action: 'delete', doc_number: vp.reference ?? '', summary: `Deleted ₹${num(vp.amount).toFixed(2)} ${vp.kind === 'ADVANCE' ? 'advance' : 'on-account payment'} to ${vp.vendor_name} dated ${vp.date}` });
}
