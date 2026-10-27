/**
 * Cash and PAN guards (generic, not pack-gated; `retail_settings.cash_guard`: off / warn / block — the electronics profile
 * sets *warn*, jewellery *block*; `require_pan`). Built by RT-D for the electronics counter and the buy-back cash payment;
 * RT-E adds the PAN prompt, the PMLA note, the live counter / editor guards and the jewellery e-Way note on top of it.
 *  - Receipts: cash tenders on one bill ≥ ₹2 lakh, or cash from the same customer on the same day ≥ ₹2 lakh →
 *    "Sec 269ST" (refunds and cash we PAY for a used device / old gold are not receipts).
 *  - Payments: cash paid to one person in a day above ₹10,000 for a buy-back / old gold → "Sec 40A(3)" warning.
 *  - Rule 114B (RT-E): a sale above ₹2 lakh (any mode) needs the customer's PAN or a Form 60 / 97 declaration.
 *  - PMLA (RT-E): cash of ₹10 lakh or more from one customer in a day (reachable only with the guard off) — a note.
 * The Income-tax Act 2025 section numbers are not confirmed (no `ita2025.ts` row): labels name the 1961 sections.
 * Thresholds from `retail-rules.ts` (dated). Working paper — verify with your CA (RT14, RT18).
 */
import type { InvoiceRecord, Payment } from '../../types/invoice';
import type { GuardMode, SaleKyc } from '../../types/retail-r9';
import { CASH_PAYMENT_LIMIT_RULES, CASH_RECEIPT_LIMIT_RULES, EWAY_EXEMPT_CHAPTER_RULES, PAN_SALE_LIMIT_RULES, PMLA_CASH_RULES } from '../retail-rules';
import { ruleAt } from '../tax-rules';
import { num, round2 } from '../invoice-calc';
import { movedNoCash } from '../advance-tax'; // no-cash.ts (QA6-1 F4)
import { getTable } from '../storage';
import { readRetailSettings } from './rt-settings';

/* ── RT-D: 269ST / 40A(3) ── */

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

/* ── RT-E: PAN, PMLA, live guards (counter, editor, receipts), e-Way chapter 71 ── */

export interface Guard { level: 'error' | 'warn'; message: string }

export const validPan = (s: string | undefined): boolean => /^[A-Z]{5}\d{4}[A-Z]$/.test(String(s ?? '').trim().toUpperCase());
/** "ABCDE****F" for lists. */
export const maskPan = (s: string): string => s.replace(/^(.{5}).{4}/, '$1****');

const digits = (s: unknown) => String(s ?? '').replace(/\D/g, '').slice(-10);

/** Cash already received on `date` from the customer of `rec` (this bill too, or the same client id / phone) — receipts only. */
export function cashFromCustomer(payments: readonly Payment[], invoices: readonly InvoiceRecord[], rec: Pick<InvoiceRecord, 'id' | 'client'>, date: string): number {
  const id = rec.client?.id;
  const phone = digits(rec.client?.phone);
  const mine = new Set(invoices.filter((i) => i && ((rec.id && i.id === rec.id) || (id && i.client?.id === id) || (phone.length === 10 && digits(i.client?.phone) === phone))).map((i) => i.id));
  return round2(payments.filter((p) => mine.has(p.invoice_id) && p.date === date && isCash(p.method) && num(p.amount) > 0 && !movedNoCash(p)).reduce((s, p) => s + num(p.amount), 0));
}

/** Sec 269ST (RT-D's check) and the PMLA note on a sale: `cashNow` on this bill + `earlier` cash from the customer that day. */
export function cashGuards(mode: GuardMode | undefined, date: string, cashNow: number, earlier = 0): Guard[] {
  if (!(num(cashNow) > 0)) return [];
  const r = cashReceiptIssue(mode, cashNow, earlier, date);
  const out: Guard[] = r ? [{ level: r.block ? 'error' : 'warn', message: r.message }] : [];
  if (round2(num(cashNow) + num(earlier)) >= ruleAt(PMLA_CASH_RULES, date)) out.push({ level: 'warn', message: 'KYC and record-keeping under PMLA may apply to this cash — verify with your CA.' });
  return out;
}

/** Rule 114B on a sale above the limit: PAN or Form 60 / 97 (an error with *Require PAN*, else a warning). */
export function panGuard(total: number, date: string, kyc: SaleKyc | undefined, require: boolean): Guard | null {
  const limit = ruleAt(PAN_SALE_LIMIT_RULES, date);
  if (!(num(total) > limit) || validPan(kyc?.pan) || kyc?.form === '60' || kyc?.form === '97') return null;
  return { level: require ? 'error' : 'warn', message: `A sale above ₹${limit.toLocaleString('en-IN')} needs the customer's PAN or a Form 60 / 97 declaration (Rule 114B) — verify with your CA.` };
}

/** RT-E2 / RT22: e-Way note when every goods line is chapter 71, else '' (the usual threshold applies). */
export function ewayChapterNote(hsns: readonly string[], date?: string): string {
  const ch = ruleAt(EWAY_EXEMPT_CHAPTER_RULES, date);
  const goods = hsns.map((h) => String(h ?? '').replace(/\D/g, '')).filter((h) => h && !h.startsWith('99'));
  return goods.length && goods.every((h) => ch.some((c) => h.startsWith(c))) ? 'e-Way bill not required for Chapter 71 goods (Rule 138(14) annexure) — verify with your CA.' : '';
}

const SALE_DOCS = new Set(['INVOICE', 'TAX_INVOICE', 'BILL_OF_SUPPLY']);

/** Editor save gate: a sale above the PAN limit without PAN / Form 60 / 97 while *Require PAN* is on (errors only). */
export function kycGate(rec: Pick<InvoiceRecord, 'doc_type' | 'total' | 'issue_date' | 'kyc'>): string[] {
  if (!SALE_DOCS.has(rec.doc_type)) return [];
  const g = panGuard(rec.total, rec.issue_date, rec.kyc, !!readRetailSettings().require_pan);
  return g?.level === 'error' ? [g.message] : [];
}

/** The live guards of a sale (POS / editor / receipt): settings, earlier cash of the customer that day. */
export function liveSaleGuards(rec: Pick<InvoiceRecord, 'id' | 'client' | 'total' | 'issue_date' | 'kyc'>, cashNow: number, date = rec.issue_date, withPan = true): Guard[] {
  const s = readRetailSettings();
  const earlier = s.cash_guard && s.cash_guard !== 'off' && cashNow > 0 ? cashFromCustomer(getTable<Payment>('transactions'), getTable<InvoiceRecord>('invoices'), rec, date) : 0;
  const pan = withPan ? panGuard(rec.total, rec.issue_date, rec.kyc, !!s.require_pan) : null;
  return [...cashGuards(s.cash_guard, date, cashNow, earlier), ...(pan ? [pan] : [])];
}
