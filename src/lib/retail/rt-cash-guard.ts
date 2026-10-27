/**
 * RT-E3 cash and PAN guards (generic retail settings, not pack-gated; `retail_settings.cash_guard` off / warn / block,
 * `require_pan`). Thresholds are dated rows in `retail-rules.ts`:
 *  - Sec 269ST: cash RECEIVED of ₹2 lakh or more on one bill, or from one customer (client id or phone) in a day, is
 *    refused (block) or warned. Refunds and cash PAID for old gold / buy-backs are not receipts and never count;
 *  - Sec 40A(3): cash PAID to one person in a day above ₹10,000 (old gold, buy-backs) — a warning;
 *  - Rule 114B: a sale above ₹2 lakh (any mode) needs the customer's PAN or a Form 60 / 97 declaration;
 *  - PMLA: cash of ₹10 lakh or more from one customer in a day (reachable only with the guard off) — a note.
 * The Income-tax Act 2025 section numbers are not confirmed (no `ita2025.ts` row): labels name the 1961 sections.
 * Working paper — verify with your CA (RT14, RT18).
 */
import type { InvoiceRecord, Payment } from '../../types/invoice';
import type { GuardMode, SaleKyc } from '../../types/retail-r9';
import { CASH_PAYMENT_LIMIT_RULES, CASH_RECEIPT_LIMIT_RULES, PAN_SALE_LIMIT_RULES, PMLA_CASH_RULES } from '../retail-rules';
import { ruleAt } from '../tax-rules';
import { num, round2 } from '../invoice-calc';
import { movedNoCash } from '../no-cash';
import { formatCurrency } from '../utils';
import { getTable } from '../storage';
import { readRetailSettings } from './rt-settings';

export interface Guard { level: 'error' | 'warn'; message: string }

export const validPan = (s: string | undefined): boolean => /^[A-Z]{5}\d{4}[A-Z]$/.test(String(s ?? '').trim().toUpperCase());
/** "ABCDE****F" for lists. */
export const maskPan = (s: string): string => s.replace(/^(.{5}).{4}/, '$1****');

const digits = (s: unknown) => String(s ?? '').replace(/\D/g, '').slice(-10);

/** Cash received on `date` from the customer of `rec` (same client id or phone) on OTHER bills — receipts only. */
export function cashFromCustomer(payments: readonly Payment[], invoices: readonly InvoiceRecord[], rec: Pick<InvoiceRecord, 'id' | 'client'>, date: string): number {
  const id = rec.client?.id;
  const phone = digits(rec.client?.phone);
  if (!id && phone.length < 10) return 0;
  const mine = new Set(invoices.filter((i) => i && i.id !== rec.id && ((id && i.client?.id === id) || (phone.length === 10 && digits(i.client?.phone) === phone))).map((i) => i.id));
  return round2(payments.filter((p) => mine.has(p.invoice_id) && p.date === date && String(p.method).toLowerCase() === 'cash' && num(p.amount) > 0 && !movedNoCash(p)).reduce((s, p) => s + num(p.amount), 0));
}

/** Sec 269ST / PMLA on a sale: `cashNow` on this bill + `earlier` cash from the customer that day. */
export function cashGuards(mode: GuardMode | undefined, date: string, cashNow: number, earlier = 0): Guard[] {
  const total = round2(num(cashNow) + num(earlier));
  const out: Guard[] = [];
  if (!(num(cashNow) > 0)) return out;
  const limit = ruleAt(CASH_RECEIPT_LIMIT_RULES, date);
  if (mode && mode !== 'off' && total >= limit) {
    out.push({ level: mode === 'block' ? 'error' : 'warn', message: `Cash of ${formatCurrency(limit)} or more cannot be accepted from one person in a day (Sec 269ST, IT Act 1961) — ${formatCurrency(total)} in cash${num(earlier) > 0 ? ` incl. ${formatCurrency(num(earlier))} earlier today` : ''}. Take the rest by UPI / card / bank. Verify with your CA.` });
  }
  if (total >= ruleAt(PMLA_CASH_RULES, date)) out.push({ level: 'warn', message: 'KYC and record-keeping under PMLA may apply to this cash — verify with your CA.' });
  return out;
}

/** Rule 114B on a sale above the limit: PAN or Form 60 / 97 (an error with *Require PAN*, else a warning). */
export function panGuard(total: number, date: string, kyc: SaleKyc | undefined, require: boolean): Guard | null {
  const limit = ruleAt(PAN_SALE_LIMIT_RULES, date);
  if (!(num(total) > limit) || validPan(kyc?.pan) || kyc?.form === '60' || kyc?.form === '97') return null;
  return { level: require ? 'error' : 'warn', message: `A sale above ${formatCurrency(limit)} needs the customer's PAN or a Form 60 / 97 declaration (Rule 114B) — verify with your CA.` };
}

/** Sec 40A(3): cash paid to one person in a day (old gold, buy-back) above the limit — a warning ('' otherwise). */
export function cashPaidWarning(paidToday: number, date: string): string {
  const limit = ruleAt(CASH_PAYMENT_LIMIT_RULES, date);
  return num(paidToday) > limit ? `Cash paid of ${formatCurrency(round2(num(paidToday)))} to one person today is above ${formatCurrency(limit)}: the purchase may be disallowed under Sec 40A(3) — pay by bank. Verify with your CA.` : '';
}

/** The live guards of a sale (POS / editor / receipt): settings, earlier cash of the customer that day. */
export function liveSaleGuards(rec: Pick<InvoiceRecord, 'id' | 'client' | 'total' | 'issue_date' | 'kyc'>, cashNow: number, date = rec.issue_date, withPan = true): Guard[] {
  const s = readRetailSettings();
  const earlier = s.cash_guard && s.cash_guard !== 'off' && cashNow > 0 ? cashFromCustomer(getTable<Payment>('transactions'), getTable<InvoiceRecord>('invoices'), rec, date) : 0;
  const pan = withPan ? panGuard(rec.total, rec.issue_date, rec.kyc, !!s.require_pan) : null;
  return [...cashGuards(s.cash_guard, date, cashNow, earlier), ...(pan ? [pan] : [])];
}
