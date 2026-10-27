/**
 * MSME payables: MSMED Act Sec 15/16 and Income-tax Sec 43B(h).
 *
 *  - A bill from a micro or small supplier must be paid by the agreed date, capped at
 *    45 days. With no agreed date (no `due_date` on the bill) the limit is 15 days.
 *    The bill date stands in for the day of acceptance.
 *  - Sec 43B(h): what is still unpaid once the limit has passed is deductible only in
 *    the year it is actually paid. A bill of FY X is safe if it is paid by the limit or
 *    within FY X itself; the rest is disallowed for FY X.
 *  - Sec 16 interest: compound with monthly rests at three times the RBI bank rate,
 *    from the day after the limit until payment. Sec 23 makes it non-deductible.
 *
 * Pure: no storage. Dates are local `YYYY-MM-DD` strings compared as strings.
 * Working-paper figures — verify with your CA.
 */

import type { PurchaseRecord, Vendor } from '../types/purchases';
import type { PurchasePayment } from './purchases';
import { num, round2 } from './invoice-calc';
import { shiftDay } from './dates';
import { MSME_43BH_FROM, MSME_PAYMENT_DAYS, rbiBankRate } from './tax-rules';
import { supplierPayable } from './purchase-normalize';

export const UDYAM_RE = /^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/;

export const normalizeUdyam = (s: string | undefined): string => (s ?? '').trim().toUpperCase();

/** '' when empty or well-formed, else an error message. */
export function validateUdyam(s: string | undefined): string {
  const v = normalizeUdyam(s);
  return !v || UDYAM_RE.test(v) ? '' : 'Udyam number should look like UDYAM-MH-01-0000001.';
}

/** Micro and small enterprises are covered by Sec 15 and 43B(h); medium ones are not. */
export const isMse = (v: Pick<Vendor, 'msme_category'> | undefined): boolean =>
  v?.msme_category === 'MICRO' || v?.msme_category === 'SMALL';

/**
 * MF-D3 (MF21): a supplier the buyer flagged as a trader (`Vendor.mf.msme_trader`; Udyam for traders is for
 * priority-sector lending only, OM of 2 Jul 2021 as reported) is left out of the Sec 43B(h) totals. Off by default.
 */
export const traderExcluded = (v: unknown): boolean => !!(v as { mf?: { msme_trader?: boolean } } | undefined)?.mf?.msme_trader;

/** Last day the bill may be paid: agreed due date capped at 45 days, or 15 days without one. */
export function paymentLimit(billDate: string, dueDate?: string): string {
  if (!dueDate || dueDate < billDate) return shiftDay(billDate, MSME_PAYMENT_DAYS.noAgreement);
  const cap = shiftDay(billDate, MSME_PAYMENT_DAYS.agreed);
  return dueDate < cap ? dueDate : cap;
}

/** Whole days from `a` to `b` (positive when b is later). */
export function daysBetween(a: string, b: string): number {
  const t = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
  return Math.round((t(b) - t(a)) / 86400000);
}

/** Indian financial year of a day: start year (2025 for 2025-04-01 .. 2026-03-31). */
export const fyStartYear = (day: string): number => (+day.slice(5, 7) >= 4 ? +day.slice(0, 4) : +day.slice(0, 4) - 1);
export const fyEnd = (startYear: number): string => `${startYear + 1}-03-31`;
export const fyLabel = (startYear: number): string => `FY ${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;

/**
 * Sec 16 interest on `amount` from the day after `limit` to `paidOn`:
 * compounded monthly at 3 × the bank rate in force when interest starts.
 */
export function msmedInterest(amount: number, limit: string, paidOn: string): number {
  const days = daysBetween(limit, paidOn);
  if (days <= 0 || amount <= 0) return 0;
  const monthly = (3 * rbiBankRate(shiftDay(limit, 1))) / 100 / 12;
  return round2(amount * ((1 + monthly) ** ((days * 12) / 365) - 1));
}

interface Paid {
  amount: number;
  date: string;
}

/**
 * Dated payments for a bill. Any `amount_paid` not backed by a payment row
 * (imported / legacy data) is treated as paid on the bill date.
 */
function paymentsOf(bill: PurchaseRecord, byBill: Map<string, PurchasePayment[]>): Paid[] {
  const rows = (byBill.get(bill.id) ?? []).map((p) => ({ amount: num(p.amount), date: p.date }));
  const recorded = rows.reduce((s, p) => s + p.amount, 0);
  const extra = round2(num(bill.amount_paid) - recorded);
  if (extra > 0) rows.push({ amount: extra, date: bill.date });
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

const paidBy = (paid: Paid[], day: string) => round2(paid.filter((p) => p.date <= day).reduce((s, p) => s + p.amount, 0));

export interface MsmeBill {
  id: string;
  vendorName: string;
  category: 'MICRO' | 'SMALL';
  billNumber: string;
  date: string;
  limit: string;
  total: number;
  /** Balance on `asOf`. */
  unpaid: number;
  /** Days past the limit on `asOf` (0 when not yet due). */
  daysOverdue: number;
  /** Sec 16 interest to `asOf`: on late payments already made plus the open balance. */
  interest: number;
  /** Share of the bill that is a deductible expense: taxable value when ITC is claimed, else the total. */
  expenseShare: number;
}

/** Every bill from a micro / small vendor, with its limit, balance and interest on `asOf`. */
export function msmeBills(
  purchases: readonly PurchaseRecord[],
  vendors: readonly Vendor[],
  payments: readonly PurchasePayment[],
  asOf: string,
): MsmeBill[] {
  const vendorById = new Map(vendors.map((v) => [v.id, v]));
  const byBill = new Map<string, PurchasePayment[]>();
  for (const p of payments) byBill.set(p.purchase_id, [...(byBill.get(p.purchase_id) ?? []), p]);
  const out: MsmeBill[] = [];
  for (const bill of purchases) {
    const vendor = bill.vendor_id ? vendorById.get(bill.vendor_id) : undefined;
    if (!vendor || !isMse(vendor) || !bill.date || bill.date > asOf) continue;
    // What the MSE supplier is owed: reverse-charge / import GST is ours to pay, not theirs.
    const total = round2(supplierPayable(bill));
    const limit = paymentLimit(bill.date, bill.due_date);
    const paid = paymentsOf(bill, byBill).filter((p) => p.date <= asOf);
    let open = total;
    let interest = 0;
    for (const p of paid) {
      const amt = Math.min(p.amount, open);
      if (p.date > limit) interest += msmedInterest(amt, limit, p.date);
      open = round2(open - amt);
    }
    if (open > 0 && asOf > limit) interest += msmedInterest(open, limit, asOf);
    const expense = bill.itc_eligible ? num(bill.taxable) : total;
    out.push({
      id: bill.id,
      vendorName: bill.vendor_name || vendor.name,
      category: vendor.msme_category as 'MICRO' | 'SMALL',
      billNumber: bill.bill_number,
      date: bill.date,
      limit,
      total,
      unpaid: Math.max(open, 0),
      daysOverdue: Math.max(daysBetween(limit, asOf), 0),
      interest: round2(interest),
      expenseShare: total > 0 ? Math.min(expense / total, 1) : 1,
    });
  }
  return out.sort((a, b) => a.limit.localeCompare(b.limit) || a.date.localeCompare(b.date));
}

export interface DisallowanceRow {
  id: string;
  vendorName: string;
  billNumber: string;
  date: string;
  limit: string;
  /** Amount not paid by the later of the limit and 31 March. */
  unpaid: number;
  /** `unpaid` × expense share: the deduction that moves to the year of payment. */
  disallowed: number;
  /** False while it can still be paid in time (before the limit / before 31 March). */
  final: boolean;
}

export interface Disallowance43Bh {
  fy: string;
  /** Final disallowance: the deadline has passed. */
  total: number;
  /** Still avoidable if paid by the limit (or by 31 March). */
  atRisk: number;
  rows: DisallowanceRow[];
  /** MF21: micro / small suppliers flagged as traders with bills this year, left out of the totals (absent = none). */
  excludedTraders?: string[];
}

/** Sec 43B(h) disallowance for the financial year starting `fyStart`, as known on `asOf`. */
export function disallowance43Bh(
  purchases: readonly PurchaseRecord[],
  vendors: readonly Vendor[],
  payments: readonly PurchasePayment[],
  fyStart: number,
  asOf: string,
): Disallowance43Bh {
  const from = `${fyStart}-04-01`;
  const end = fyEnd(fyStart);
  const res: Disallowance43Bh = { fy: fyLabel(fyStart), total: 0, atRisk: 0, rows: [] };
  if (end < MSME_43BH_FROM) return res;
  const inYear = purchases.filter((p) => p.date >= from && p.date <= end);
  const byBill = new Map<string, PurchasePayment[]>();
  for (const p of payments) byBill.set(p.purchase_id, [...(byBill.get(p.purchase_id) ?? []), p]);
  // Reuse msmeBills for vendor matching; payments are re-read against the cut-off below.
  for (const b of msmeBills(inYear, vendors.filter((v) => !traderExcluded(v)), payments, end)) {
    const bill = inYear.find((p) => p.id === b.id)!;
    const cutoff = b.limit > end ? b.limit : end;
    const known = cutoff < asOf ? cutoff : asOf;
    const unpaid = round2(b.total - paidBy(paymentsOf(bill, byBill), known));
    if (unpaid <= 0) continue;
    const final = asOf > cutoff;
    const disallowed = round2(unpaid * b.expenseShare);
    res.rows.push({ id: b.id, vendorName: b.vendorName, billNumber: b.billNumber, date: b.date, limit: b.limit, unpaid, disallowed, final });
    if (final) res.total = round2(res.total + disallowed);
    else res.atRisk = round2(res.atRisk + disallowed);
  }
  const traders = vendors.filter((v) => traderExcluded(v) && isMse(v) && inYear.some((p) => p.vendor_id === v.id)).map((v) => v.name);
  if (traders.length) res.excludedTraders = traders;
  return res;
}
