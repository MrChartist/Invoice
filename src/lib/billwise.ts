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
import type { OpeningBillInput } from './receivables';
import { loadPayableOpeningBills } from './opening-bills';
import { NETTING_METHOD } from './netting';
import { exchangeVoucherOf } from './no-cash';
import type { Payment } from '../types/invoice';

export const VENDOR_PAYMENTS_TABLE = 'vendor_payments';

/* ── Pure ─────────────────────────────────────────────────────── */

/** R6-C2: bill-wise key of a payable opening bill (`BillRef.purchaseId`, allocation plans). */
export const OPENING_REF = 'opening:';
export const openingRefKey = (openingBillId: string) => `${OPENING_REF}${openingBillId}`;
export const isOpeningRef = (key: string) => key.startsWith(OPENING_REF);
/** The bill-wise key an allocation settles: a purchase id, or `opening:<opening bill id>`. */
export const allocationKey = (a: { purchase_id: string; opening_bill_id?: string }) => (a.opening_bill_id ? openingRefKey(a.opening_bill_id) : a.purchase_id);

/** What is still unadjusted on an advance / on-account payment (allocations to deleted bills ignored). */
export function unallocatedOf(vp: VendorPayment, billIds?: ReadonlySet<string>): number {
  const used = (vp.allocations ?? []).filter((a) => !billIds || billIds.has(allocationKey(a))).reduce((s, a) => s + num(a.amount), 0);
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
  /** R6-C2: a supplier opening bill (`purchaseId` = `opening:<id>`); settled only by `vendor_payments` allocations. */
  opening?: boolean;
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
  /** R6-C2: a debit opening bill of the supplier (money with them when the books began); managed on the party's openings. */
  openingId?: string;
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
  /** R6-C2: payable opening bills (`loadPayableOpeningBills`); they age from their own date and settle Agst Ref. */
  openingBills?: readonly OpeningBillInput[];
  /** R15-A3: customer receipts (`transactions`); netting rows settle the bill they name, as dated adjustments. */
  receipts?: readonly Payment[];
}

const emptyBuckets = (): Record<AgeBucket, number> => ({ notDue: 0, d0_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 });
const partyKey = (vendorId: string | undefined, name: string) => (vendorId ? `id:${vendorId}` : `name:${name.trim().toLowerCase()}`);

/** Outstanding payables bill-wise, party by party, as of `asOf`. */
export function billwisePayables(input: PayablesInput): PartyPayables[] {
  const asOf = input.asOf;
  const openings = input.openingBills ?? [];
  const billIds = new Set([...input.purchases.map((p) => p.id), ...openings.map((b) => openingRefKey(b.id))]);
  const payByBill = new Map<string, PurchasePayment[]>();
  for (const p of input.payments) payByBill.set(p.purchase_id, [...(payByBill.get(p.purchase_id) ?? []), p]);
  const adjByBill = new Map<string, { date: string; amount: number; ref: string }[]>();
  for (const vp of input.vendorPayments) {
    for (const a of vp.allocations ?? []) {
      const key = allocationKey(a);
      adjByBill.set(key, [...(adjByBill.get(key) ?? []), { date: a.date, amount: num(a.amount), ref: vp.kind === 'NEW_REF' ? vp.ref_name || 'New ref' : vp.kind === 'ADVANCE' ? 'Advance' : 'On account' }]);
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
    // R15-A3: set off against the party's own invoices (live netting receipts; `exchange_paid` is their part of amount_paid).
    const nets = (input.receipts ?? []).filter((r) => exchangeVoucherOf(r) === bill.id && r.method === NETTING_METHOD);
    for (const r of nets) if (isoDay(r.date) && r.date <= asOf) allocations.push({ date: r.date, amount: round2(num(r.amount)), kind: 'adjustment', ref: `Netting ${r.receipt_number ?? ''}`.trim() });
    // The stored part leaves the "recorded on the bill" remainder, so a netting receipt deleted elsewhere frees the bill here.
    if (input.receipts && !bill.used_goods && !bill.old_metal) rowsTotal += num(bill.exchange_paid);
    // amount_paid not backed by rows (legacy / imported): settled on the bill date.
    const legacy = round2(num(bill.amount_paid) - rowsTotal);
    // R11 (CN-D1): on a sub-contractor bill this part is its deductions journal (retention / recoveries), not cash — the
    // net due is what ages.
    if (legacy > 0.004) allocations.push({ date: bill.date, amount: legacy, kind: bill.cn_sub?.jv_id ? 'adjustment' : 'payment', ref: bill.cn_sub?.jv_id ? 'Sub-contract deductions (journal)' : 'Paid (recorded on the bill)' });
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
  // R6-C2: supplier opening bills (Cr = owed, aged from their own date); a Dr opening is money with the supplier.
  for (const ob of openings) {
    if (ob.date > asOf) continue;
    const key = openingRefKey(ob.id);
    const p = party(ob.party_id, ob.party_name);
    if (ob.dr_cr === 'Dr') {
      p.advances.push({ id: key, kind: 'ON_ACCOUNT', date: ob.date, ref: ob.ref_no, amount: round2(ob.amount), unallocated: round2(ob.amount), openingId: ob.id });
      p.advancesTotal = round2(p.advancesTotal + ob.amount);
      continue;
    }
    const allocations: BillRef['allocations'] = (adjByBill.get(key) ?? []).filter((a) => a.date <= asOf).map((a) => ({ date: a.date, amount: round2(a.amount), kind: 'adjustment' as const, ref: a.ref })).sort((a, b) => a.date.localeCompare(b.date));
    const settled = round2(allocations.reduce((s, a) => s + a.amount, 0));
    const balance = round2(Math.max(ob.amount - settled, 0));
    if (balance <= 0.004 && !input.includeSettled) continue;
    const due = (input.ageBy ?? 'due') === 'bill' ? ob.date : ob.due_date || ob.date;
    const overdueDays = Math.max(daysBetween(due, asOf), 0);
    const ref: BillRef = { purchaseId: key, number: ob.ref_no, date: ob.date, due, payable: round2(ob.amount), settled, balance, overdueDays, bucket: bucketOf(due < asOf ? overdueDays : 0), allocations, msmeInterest: 0, opening: true };
    p.bills.push(ref);
    p.billsTotal = round2(p.billsTotal + balance);
    p.buckets[ref.bucket] = round2(p.buckets[ref.bucket] + balance);
  }
  for (const vp of input.vendorPayments) {
    if (!isoDay(vp.date) || vp.date > asOf) continue;
    const used = (vp.allocations ?? []).filter((a) => billIds.has(allocationKey(a)) && a.date <= asOf).reduce((s, a) => s + num(a.amount), 0);
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

/** R6-C2: open balance of each payable (Cr) opening bill, keyed `opening:<id>`, net of `vendor_payments` allocations. */
export function openingBillBalances(vendorPayments: readonly VendorPayment[] = vendorPaymentsDb.all(), openings: readonly OpeningBillInput[] = loadPayableOpeningBills(getTable<Vendor>('vendors'))): Map<string, number> {
  const used = new Map<string, number>();
  for (const vp of vendorPayments) for (const a of vp.allocations ?? []) if (a.opening_bill_id) used.set(a.opening_bill_id, (used.get(a.opening_bill_id) ?? 0) + num(a.amount));
  return new Map(openings.filter((b) => b.dr_cr === 'Cr').map((b) => [openingRefKey(b.id), round2(Math.max(b.amount - (used.get(b.id) ?? 0), 0))]));
}

/**
 * Record one supplier payment allocated bill-wise: an Agst Ref `purchase_payments` row per bill
 * (same `group_id`) and, for any remainder, a `vendor_payments` row (New Ref / Advance / On Account).
 * R6-C2: allocations to supplier opening bills (`opening:<id>`) ride on that `vendor_payments` row as
 * `allocations[].opening_bill_id` (the opening bill is not a document, so it has no payment rows).
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
  const toOpenings = input.allocations.filter((a) => isOpeningRef(a.purchaseId) && num(a.amount) > 0);
  const toBills = input.allocations.filter((a) => !isOpeningRef(a.purchaseId));
  for (const a of toBills) {
    const bill = purchasesDb.get(a.purchaseId);
    if (!bill) throw new BillwiseError('A bill in the allocation no longer exists.');
    if (round2(num(a.amount)) > balanceOf(bill) + 0.004) throw new BillwiseError(`Bill ${bill.bill_number || bill.id}: the allocation exceeds its balance of ${balanceOf(bill).toFixed(2)}.`);
  }
  const openBal = toOpenings.length ? openingBillBalances() : new Map<string, number>();
  for (const a of toOpenings) {
    const bal = openBal.get(a.purchaseId);
    if (bal === undefined) throw new BillwiseError('An opening bill in the allocation no longer exists.');
    if (round2(num(a.amount)) > bal + 0.004) throw new BillwiseError(`Opening bill: the allocation exceeds its balance of ${bal.toFixed(2)}.`);
  }
  assertUnlocked({ issue_date: input.date }, 'pay');
  const groupId = generateId();
  const payments: PurchasePayment[] = [];
  for (const a of toBills) {
    if (!(num(a.amount) > 0)) continue;
    payments.push(paymentsDb.record(a.purchaseId, { amount: round2(num(a.amount)), date: input.date, method: input.method, reference: input.reference, bankAccountId: input.bankAccountId, groupId }));
  }
  const billAllocated = round2(toBills.reduce((s, a) => s + Math.max(num(a.amount), 0), 0));
  const left = round2(amount - billAllocated);
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
      allocations: toOpenings.map((a) => ({ purchase_id: '', opening_bill_id: a.purchaseId.slice(OPENING_REF.length), amount: round2(num(a.amount)), date: input.date })),
      group_id: groupId,
      created_at: new Date().toISOString(),
    };
    setTable(VENDOR_PAYMENTS_TABLE, [...vendorPaymentsDb.all(), remainder]);
    const opened = round2(toOpenings.reduce((s, a) => s + num(a.amount), 0));
    audit.record({
      entity: 'vendor_payment',
      entity_id: remainder.id,
      action: 'create',
      doc_number: remainder.reference ?? remainder.ref_name ?? '',
      summary: `${opened > 0 ? `₹${opened.toFixed(2)} against opening bills${left - opened > 0.004 ? ' and ' : ''}` : ''}${left - opened > 0.004 || !(opened > 0) ? `${remainder.kind === 'ADVANCE' ? 'Advance' : remainder.kind === 'NEW_REF' ? 'New ref' : 'On-account payment'} of ₹${round2(left - opened).toFixed(2)}` : ''} to ${remainder.vendor_name} on ${remainder.date}`,
    });
  }
  return { groupId, payments, remainder };
}

/** Adjust an unallocated advance / on-account payment against a bill (Agst Ref). Moves no money. */
export function adjustAgainstBill(vendorPaymentId: string, purchaseId: string, amount: number, date: string): VendorPayment {
  requireAccess('books.edit');
  const all = vendorPaymentsDb.all();
  const vp = all.find((v) => v.id === vendorPaymentId);
  if (isOpeningRef(purchaseId)) return adjustAgainstOpening(all, vp, purchaseId, amount, date);
  const bill = purchasesDb.get(purchaseId);
  if (!vp || !bill) throw new BillwiseError('Payment or bill not found.');
  const day = isoDay(date);
  if (!day) throw new BillwiseError('Choose the adjustment date.');
  if (day < vp.date) throw new BillwiseError('An advance cannot be adjusted before it was paid.');
  const a = round2(num(amount));
  const billIds = new Set([...purchasesDb.all().map((p) => p.id), ...openingBillBalances(all).keys()]);
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

/** R6-C2: adjust an advance / on-account payment against a supplier opening bill (no money moves; no bill row changes). */
function adjustAgainstOpening(all: VendorPayment[], vp: VendorPayment | undefined, key: string, amount: number, date: string): VendorPayment {
  const balances = openingBillBalances(all);
  const bal = balances.get(key);
  if (!vp || bal === undefined) throw new BillwiseError('Payment or opening bill not found.');
  const day = isoDay(date);
  if (!day) throw new BillwiseError('Choose the adjustment date.');
  if (day < vp.date) throw new BillwiseError('An advance cannot be adjusted before it was paid.');
  const a = round2(num(amount));
  const ids = new Set([...purchasesDb.all().map((p) => p.id), ...balances.keys()]);
  if (!(a > 0)) throw new BillwiseError('Enter the amount to adjust.');
  if (a > unallocatedOf(vp, ids) + 0.004) throw new BillwiseError(`Only ₹${unallocatedOf(vp, ids).toFixed(2)} of this payment is unadjusted.`);
  if (a > bal + 0.004) throw new BillwiseError(`The opening bill balance is ₹${bal.toFixed(2)}.`);
  assertUnlocked({ issue_date: day }, 'pay');
  const next: VendorPayment = { ...vp, allocations: [...(vp.allocations ?? []), { purchase_id: '', opening_bill_id: key.slice(OPENING_REF.length), amount: a, date: day }] };
  setTable(VENDOR_PAYMENTS_TABLE, all.map((v) => (v.id === vp.id ? next : v)));
  audit.record({ entity: 'vendor_payment', entity_id: vp.id, action: 'update', doc_number: vp.reference ?? '', summary: `₹${a.toFixed(2)} of the payment to ${vp.vendor_name} adjusted against an opening bill on ${day}` });
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
  for (const a of vp.allocations ?? []) if (!a.opening_bill_id) undo.set(a.purchase_id, (undo.get(a.purchase_id) ?? 0) + num(a.amount));
  if (undo.size) setTable('purchases', purchasesDb.all().map((p) => (undo.has(p.id) ? { ...p, amount_paid: Math.max(round2(num(p.amount_paid) - (undo.get(p.id) ?? 0)), 0) } : p)));
  setTable(VENDOR_PAYMENTS_TABLE, all.filter((v) => v.id !== id));
  audit.record({ entity: 'vendor_payment', entity_id: id, action: 'delete', doc_number: vp.reference ?? '', summary: `Deleted ₹${num(vp.amount).toFixed(2)} ${vp.kind === 'ADVANCE' ? 'advance' : 'on-account payment'} to ${vp.vendor_name} dated ${vp.date}` });
}
