/**
 * Dashboard "Today" card (8G, 8.105): sales, cash / UPI / bank collected, udhaar (credit) given,
 * expenses and cash in hand for one local day — plus a WhatsApp-ready summary for the owner. Pure.
 */

import type { InvoiceRecord, Payment } from '../types/invoice';
import { isoDay } from './dates';
import { num, round2 } from './invoice-calc';
import { isRevenueDoc } from './stats';
import { receivableBalance } from './rcm';
import { isVoidStatus, readPurchase } from './purchase-normalize';
import { formatCurrency } from './utils';

export interface TodaySummary {
  day: string;
  sales: number;
  bills: number;
  cash: number;
  upi: number;
  bank: number;
  /** Credit given today: the unpaid part of today's sales. */
  udhaar: number;
  expenses: number;
  cashInHand: number | null;
}

const inr = (inv: Pick<InvoiceRecord, 'currency'> | undefined) => !inv || (inv.currency || 'INR').toUpperCase() === 'INR';

export function modeOf(method: string | undefined): 'cash' | 'upi' | 'bank' {
  const m = String(method ?? '').toLowerCase();
  if (m === 'cash') return 'cash';
  if (/upi|gpay|phonepe|paytm|bhim/.test(m)) return 'upi';
  return 'bank';
}

export function todaySummary(input: { invoices: readonly InvoiceRecord[]; payments: readonly Payment[]; purchases: readonly unknown[]; vendors?: readonly unknown[]; cashInHand?: number | null }, day: string): TodaySummary {
  const out: TodaySummary = { day, sales: 0, bills: 0, cash: 0, upi: 0, bank: 0, udhaar: 0, expenses: 0, cashInHand: input.cashInHand ?? null };
  const byId = new Map(input.invoices.map((i) => [i.id, i]));
  for (const inv of input.invoices) {
    if (!inv || !isRevenueDoc(inv) || !inr(inv) || isoDay(inv.issue_date) !== day) continue;
    out.sales = round2(out.sales + num(inv.total));
    out.bills++;
    out.udhaar = round2(out.udhaar + Math.max(receivableBalance(inv), 0));
  }
  for (const p of input.payments) {
    if (!p || p.advance_id || p.write_off || isoDay(p.date) !== day || !inr(byId.get(p.invoice_id))) continue;
    const k = modeOf(p.method);
    out[k] = round2(out[k] + num(p.amount));
  }
  for (const raw of input.purchases) {
    const b = readPurchase(raw, input.vendors ?? []);
    if (!b || !b.isExpense || isVoidStatus(b.status) || b.date !== day) continue;
    out.expenses = round2(out.expenses + b.total);
  }
  return out;
}

export function todayText(s: TodaySummary, business: string): string {
  const m = (n: number) => formatCurrency(n, 'INR');
  return [
    `*${business || 'Business'} — today (${s.day})*`,
    `Sales: ${m(s.sales)} (${s.bills} bill${s.bills === 1 ? '' : 's'})`,
    `Collected: cash ${m(s.cash)} · UPI ${m(s.upi)} · bank ${m(s.bank)}`,
    `Udhaar given: ${m(s.udhaar)}`,
    `Expenses: ${m(s.expenses)}`,
    ...(s.cashInHand !== null ? [`Cash in hand: ${m(s.cashInHand)}`] : []),
  ].join('\n');
}
