/**
 * Payment advice to a supplier (WP-5, gap P1-14): which bills one payment settled, the TDS deducted
 * (on booking the bill and on this payment) and any amount kept as an advance / on account — the
 * letter a Tally user prints from a payment voucher.
 *
 * One "payment" is the `purchase_payments` rows sharing a `group_id` (bill-wise multi-bill payment)
 * plus the `vendor_payments` remainder with the same group, or a single row without a group.
 * Reads `purchases` through `readPurchase` (Critical Rule 9: covered by tests/purchase-contract.test.ts).
 * Pure: the caller passes the tables. The supplier's account number is masked.
 */

import type { PurchaseRecord, Vendor, VendorPayment } from '../types/purchases';
import type { PurchasePayment } from './purchases';
import { amountInWords } from './amount-in-words';
import { maskAccountNo, type BankAccount } from './bank-accounts';
import { num, round2 } from './invoice-calc';
import { readPurchase, supplierPayable } from './purchase-normalize';

export interface PaymentRef {
  /** `g:<group id>`, `pp:<purchase payment id>` or `vp:<vendor payment id>`. */
  key: string;
  date: string;
  vendor: string;
  vendorId?: string;
  /** Cash paid (₹), TDS excluded. */
  amount: number;
  bills: number;
  method: string;
  reference: string;
}

export interface AdviceLine {
  billNo: string;
  billDate: string;
  /** Bill total (₹). */
  billAmount: number;
  /** TDS deducted when the bill was booked. */
  tdsOnBill: number;
  /** TDS deducted on this payment. */
  tdsNow: number;
  /** Cash paid against the bill now. */
  paid: number;
  /** Still due on the bill after this payment (as of today's records). */
  balance: number;
}

export interface PaymentAdvice {
  key: string;
  date: string;
  vendor: string;
  vendorGstin: string;
  /** e.g. `HDFC Bank · ••••4321 · HDFC0001234`; '' without bank details. */
  vendorBank: string;
  method: string;
  reference: string;
  /** Our account it was paid from. */
  paidFrom: string;
  lines: AdviceLine[];
  /** Advance / on account part, if any. */
  onAccount: number;
  onAccountLabel: string;
  totalPaid: number;
  totalTds: number;
  words: string;
}

export interface AdviceInput {
  purchases: readonly PurchaseRecord[];
  payments: readonly PurchasePayment[];
  vendorPayments: readonly VendorPayment[];
  vendors?: readonly Vendor[];
  bankAccounts?: readonly BankAccount[];
}

const keyOf = (p: { id: string; group_id?: string }, kind: 'pp' | 'vp') => (p.group_id ? `g:${p.group_id}` : `${kind}:${p.id}`);

/** Every supplier payment as one row per payment (newest first). */
export function supplierPaymentRefs(input: AdviceInput): PaymentRef[] {
  const bills = new Map(input.purchases.map((b) => [b.id, b]));
  const refs = new Map<string, PaymentRef>();
  const add = (key: string, date: string, vendor: string, vendorId: string | undefined, amount: number, isBill: boolean, method: string, reference: string) => {
    const r = refs.get(key) ?? { key, date, vendor, vendorId, amount: 0, bills: 0, method, reference };
    r.amount = round2(r.amount + amount);
    if (isBill) r.bills += 1;
    refs.set(key, r);
  };
  for (const p of input.payments) {
    const b = bills.get(p.purchase_id);
    if (!b) continue;
    add(keyOf(p, 'pp'), p.date, b.vendor_name, b.vendor_id, num(p.amount), true, p.method, p.reference ?? '');
  }
  for (const v of input.vendorPayments) add(keyOf(v, 'vp'), v.date, v.vendor_name, v.vendor_id, num(v.amount), false, v.method, v.reference ?? '');
  return [...refs.values()].sort((a, b) => b.date.localeCompare(a.date) || a.vendor.localeCompare(b.vendor));
}

const ON_ACCOUNT: Record<VendorPayment['kind'], string> = { ADVANCE: 'Advance', ON_ACCOUNT: 'On account', NEW_REF: 'New reference' };

/** The advice for one payment key, or null when nothing matches. */
export function buildPaymentAdvice(key: string, input: AdviceInput): PaymentAdvice | null {
  const match = (p: { id: string; group_id?: string }, kind: 'pp' | 'vp') => keyOf(p, kind) === key;
  const pps = input.payments.filter((p) => match(p, 'pp'));
  const vps = input.vendorPayments.filter((v) => match(v, 'vp'));
  if (!pps.length && !vps.length) return null;
  const bills = new Map(input.purchases.map((b) => [b.id, b]));
  const allPays = input.payments;
  const lines: AdviceLine[] = [];
  let vendorId: string | undefined;
  let vendorName = '';
  let gstin = '';
  for (const p of pps) {
    const raw = bills.get(p.purchase_id);
    const c = raw ? readPurchase(raw, input.vendors ?? []) : null;
    if (!raw || !c) continue;
    vendorId ??= raw.vendor_id;
    vendorName ||= c.partyName;
    gstin ||= c.partyGstin;
    const settled = allPays.filter((x) => x.purchase_id === raw.id).reduce((s, x) => s + num(x.amount) + Math.max(num(x.tds_amount), 0), 0);
    const legacy = Math.max(num(raw.amount_paid) - settled, 0);
    lines.push({
      billNo: c.number || '-',
      billDate: c.date,
      billAmount: round2(c.total),
      tdsOnBill: round2(c.tdsOnBill),
      tdsNow: round2(Math.max(num(p.tds_amount), 0)),
      paid: round2(num(p.amount)),
      balance: round2(Math.max(supplierPayable(raw) - settled - legacy, 0)),
    });
  }
  const first = pps[0] ?? vps[0];
  const v0 = vps[0];
  vendorId ??= v0?.vendor_id;
  vendorName ||= v0?.vendor_name ?? '';
  const vendor = (input.vendors ?? []).find((v) => (vendorId && v.id === vendorId) || v.name.trim().toLowerCase() === vendorName.trim().toLowerCase());
  gstin ||= vendor?.gstin ?? '';
  const onAccount = round2(vps.reduce((s, v) => s + num(v.amount), 0));
  const totalPaid = round2(lines.reduce((s, l) => s + l.paid, 0) + onAccount);
  const totalTds = round2(lines.reduce((s, l) => s + l.tdsOnBill + l.tdsNow, 0));
  const bankId = first.bank_account_id;
  const paidFrom = /^\s*cash\s*$/i.test(first.method) ? 'Cash' : (input.bankAccounts ?? []).find((a) => a.id === (bankId || 'default'))?.name ?? '';
  return {
    key,
    date: first.date,
    vendor: vendorName || 'Supplier',
    vendorGstin: gstin,
    vendorBank: vendor ? [vendor.bank_name, maskAccountNo(vendor.bank_account_no), vendor.bank_ifsc].filter(Boolean).join(' · ') : '',
    method: first.method,
    reference: first.reference ?? '',
    paidFrom,
    lines: lines.sort((a, b) => a.billDate.localeCompare(b.billDate) || a.billNo.localeCompare(b.billNo)),
    onAccount,
    onAccountLabel: v0 ? ON_ACCOUNT[v0.kind] : '',
    totalPaid,
    totalTds,
    words: totalPaid > 0 ? amountInWords(totalPaid, 'INR') : '',
  };
}
