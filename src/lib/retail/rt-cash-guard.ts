/**
 * Cash guard (generic, not pack-gated; `retail_settings.cash_guard`: off / warn / block — the electronics profile sets
 * *warn*, jewellery *block*). Built by RT-D for the electronics counter and the buy-back cash payment; RT-E adds the PAN
 * prompt and the PMLA note on top of it.
 *  - Receipts: cash tenders on one bill ≥ ₹2 lakh, or cash from the same customer (client id, else name + phone) on the
 *    same day ≥ ₹2 lakh → "Sec 269ST" (refunds and cash we PAY for a used device / old gold are not receipts).
 *  - Payments: cash paid to one person in a day above ₹10,000 for a buy-back / old gold → "Sec 40A(3)" warning.
 * Thresholds from `retail-rules.ts` (dated). Working paper — verify with your CA (RT14, RT18).
 */
import type { InvoiceRecord, Payment } from '../../types/invoice';
import type { GuardMode } from '../../types/retail-r9';
import { CASH_PAYMENT_LIMIT_RULES, CASH_RECEIPT_LIMIT_RULES } from '../retail-rules';
import { ruleAt } from '../tax-rules';
import { num, round2 } from '../invoice-calc';
import { movedNoCash } from '../advance-tax'; // no-cash.ts (QA6-1 F4)

export const cashReceiptLimit = (date?: string): number => ruleAt(CASH_RECEIPT_LIMIT_RULES, date);
export const cashPaymentLimit = (date?: string): number => ruleAt(CASH_PAYMENT_LIMIT_RULES, date);

const isCash = (m: unknown) => String(m ?? '').trim().toLowerCase() === 'cash';
const who = (c: InvoiceRecord['client'] | undefined) => (c?.id ? `id:${c.id}` : `n:${String(c?.name ?? '').trim().toLowerCase()}|${String(c?.phone ?? '').replace(/\D/g, '')}`);

/** Cash already received on `day` from the bill's customer (other bills; walk-ins without a name never aggregate). */
export function sameDayCash(client: InvoiceRecord['client'] | undefined, day: string, invoices: readonly InvoiceRecord[], payments: readonly Payment[], excludeInvoiceId?: string): number {
  if (!client?.id && !String(client?.name ?? '').trim()) return 0;
  const key = who(client);
  const mine = new Set(invoices.filter((i) => i.id !== excludeInvoiceId && i.status !== 'Cancelled' && who(i.client) === key).map((i) => i.id));
  return round2(payments.filter((p) => mine.has(p.invoice_id) && p.date === day && isCash(p.method) && !movedNoCash(p)).reduce((s, p) => s + num(p.amount), 0));
}

/** Sec 269ST check on a bill's cash (`cash`) plus the customer's other cash that day; null when fine or the guard is off. */
export function cashReceiptIssue(mode: GuardMode | undefined, cash: number, earlierToday: number, date?: string): { block: boolean; message: string } | null {
  if (!mode || mode === 'off' || !(num(cash) > 0)) return null;
  const limit = cashReceiptLimit(date);
  const total = round2(num(cash) + num(earlierToday));
  if (total < limit) return null;
  return { block: mode === 'block', message: `Cash of ₹${limit.toLocaleString('en-IN')} or more cannot be accepted from one person in a day (Sec 269ST): ₹${total.toLocaleString('en-IN')} in cash. Take the rest by UPI / card / bank — verify with your CA.` };
}

/** Sec 40A(3) warning for cash paid to one person in a day (buy-back / old gold). '' when fine. */
export function cashPaymentIssue(paidToday: number, date?: string): string {
  const limit = cashPaymentLimit(date);
  return num(paidToday) > limit ? `Sec 40A(3): cash above ₹${limit.toLocaleString('en-IN')} paid to one person in a day may be disallowed — pay by bank. Verify with your CA.` : '';
}
