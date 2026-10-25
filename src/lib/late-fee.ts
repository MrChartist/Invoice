/**
 * Optional automatic late-fee line per client (roadmap 6.15).
 *
 * A client can carry its own late-payment terms (`Client.late_fee`). On an overdue invoice
 * the user can click "Add late fee": that creates a NEW draft invoice to the same client with
 * one line. The overdue invoice itself is never edited (its total, GST returns and audit
 * trail stay as issued).
 *
 *  - `percent_pa`: simple interest at `rate` % a year on the unpaid balance, from the day
 *    after `due date + graceDays`, worked out by the existing interest engine
 *    (`computeInterest` in interest.ts: 365-day year, part-payments and credit notes reduce
 *    the balance from their date, frozen once the invoice is settled).
 *  - `flat`: a fixed ₹ amount (`rate`) once the invoice has been unpaid for at least one day
 *    beyond `due date + graceDays` (the same engine decides that).
 *
 * Under Sec 15(2)(d) CGST Act, interest / late fee for delayed payment is part of the value of
 * the supply, so the line takes the principal supply's GST rate (the rate carrying the largest
 * taxable value on the original; zero-rating / LUT carries over with the copied supply type).
 * It is a draft — verify with your CA and edit the rate before issuing if needed.
 * Whether a fee can be charged at all depends on the agreement with the customer.
 */

import type { Client, InvoiceItem, InvoiceRecord, Payment } from '../types/invoice';
import { calcInputFromRecord, calculateInvoice, num, round2 } from './invoice-calc';
import { computeInterest, interestInputFor, type InterestInput, type InterestResult, type LateFeeConfig } from './interest';
import { readLinks, type DocLink } from './documents';
import { generateId } from './storage';
import { localDb } from './localDb';
import { isoDay, shiftDay } from './dates';
import { inrValue } from './fx';
import { isDateLocked, getLockUntil, lockMessage } from './period-lock';

export { MAX_FLAT_FEE, describeClientLateFee, sanitizeClientLateFee, type ClientLateFee, type ClientLateFeeMode } from './late-fee-rule';
import { sanitizeClientLateFee, type ClientLateFee } from './late-fee-rule';

export interface LateFeeQuote {
  eligible: boolean;
  /** Why no fee: not an invoice, draft/cancelled, no due date, nothing due, not late yet. */
  reason?: string;
  amount: number;
  /** The interest-engine result the figure comes from. */
  interest: InterestResult;
}

const REASONS: Record<string, string> = {
  not_invoice: 'Late fees apply to invoices only.',
  draft_or_cancelled: 'Draft or cancelled invoice.',
  no_due_date: 'The invoice has no due date.',
  nothing_due: 'Nothing is payable on this invoice.',
};

/**
 * Pure: the fee on one invoice as of `asOf` under the client's rule. Reuses `computeInterest`
 * for the dates, grace, part-payments and credit notes.
 */
export function computeClientLateFee(input: InterestInput, fee: ClientLateFee, asOf: string | Date = new Date()): LateFeeQuote {
  const config: LateFeeConfig = {
    enabled: true,
    mode: 'annual',
    // A flat fee only needs to know whether the bill ran late; any positive rate does.
    rate: fee.mode === 'percent_pa' ? fee.rate : 1,
    grace_days: fee.graceDays,
  };
  const interest = computeInterest(input, config, asOf);
  if (!interest.eligible) return { eligible: false, reason: REASONS[interest.reason ?? ''] ?? 'Not eligible.', amount: 0, interest };
  if (interest.chargeable_days <= 0) {
    return { eligible: false, reason: interest.settled ? 'Paid within the grace period.' : 'Not overdue beyond the grace period yet.', amount: 0, interest };
  }
  const amount = fee.mode === 'percent_pa' ? interest.amount : round2(fee.rate);
  if (!(amount > 0)) return { eligible: false, reason: 'The fee works out to zero.', amount: 0, interest };
  return { eligible: true, amount, interest };
}

/** GST rate carrying the largest taxable value on `items` (0 when there are none). */
export function principalTaxRate(items: readonly InvoiceItem[] | undefined): number {
  const byRate = new Map<number, number>();
  for (const it of items ?? []) {
    const rate = num(it.tax_rate);
    const value = Math.abs(num(it.quantity) * num(it.rate));
    byRate.set(rate, (byRate.get(rate) ?? 0) + value);
  }
  let best = 0;
  let bestValue = -1;
  for (const [rate, value] of byRate) if (value > bestValue || (value === bestValue && rate > best)) [best, bestValue] = [rate, value];
  return best;
}

/**
 * The principal supply's line: within the rate `principalTaxRate` picks, the line with the largest
 * value (first one on a tie). Its HSN / SAC and goods-or-service type go on the late-fee line, so
 * the fee reports under the supply it is part of (GSTR-1 HSN summary, e-Invoice HsnCd).
 */
export function principalItem(items: readonly InvoiceItem[] | undefined): InvoiceItem | undefined {
  const rate = principalTaxRate(items);
  let best: InvoiceItem | undefined;
  let bestValue = -1;
  for (const it of items ?? []) {
    if (num(it.tax_rate) !== rate) continue;
    const value = Math.abs(num(it.quantity) * num(it.rate));
    if (value > bestValue) [best, bestValue] = [it, value];
  }
  return best;
}

/**
 * The one line on the late-fee invoice, in RUPEES: a flat fee is a ₹ figure already; interest on a
 * foreign-currency invoice is worked out in that currency and converted at the original's
 * exchange rate (the rate its receivable is booked at). The fee invoice itself is an INR document.
 */
export function buildLateFeeItem(
  quote: LateFeeQuote,
  fee: ClientLateFee,
  original: Pick<InvoiceRecord, 'invoice_number' | 'due_date'> & Partial<Pick<InvoiceRecord, 'items' | 'currency' | 'exchange_rate'>>,
): InvoiceItem | null {
  if (!quote.eligible || !(quote.amount > 0)) return null;
  const amount = fee.mode === 'percent_pa' ? inrValue(quote.amount, original) : round2(quote.amount);
  const principal = principalItem(original.items);
  const i = quote.interest;
  const period = i.accrues_from && i.accrued_to ? ` for ${i.accrues_from} to ${i.accrued_to}` : '';
  const number = original.invoice_number || 'invoice';
  const description =
    fee.mode === 'percent_pa'
      ? `Interest at ${fee.rate}% p.a. on the overdue balance${period} (${i.chargeable_days} day${i.chargeable_days === 1 ? '' : 's'}), as per agreed terms.`
      : `Flat late-payment fee: ${number} was due ${String(original.due_date).slice(0, 10)}${fee.graceDays ? ` (+${fee.graceDays} grace days)` : ''}, as per agreed terms.`;
  return {
    id: generateId(),
    name: `Late fee on ${number}`,
    description,
    type: principal?.type || 'service',
    ...(principal?.hsn?.trim() ? { hsn: principal.hsn.trim() } : {}),
    unit: 'NOS',
    quantity: 1,
    rate: amount,
    tax_rate: principalTaxRate(original.items),
    amount,
  };
}

/** A late fee goes on the same kind of sales bill as the original (a Bill of Supply stays untaxed). */
function lateFeeDocType(t: InvoiceRecord['doc_type']): InvoiceRecord['doc_type'] {
  return t === 'TAX_INVOICE' || t === 'BILL_OF_SUPPLY' ? t : 'INVOICE';
}

/**
 * Pure: a new draft invoice (own id, number and date) to the same client and sender as the
 * original, carrying only the late-fee line. The original is not touched.
 */
export function buildLateFeeInvoice(
  original: InvoiceRecord,
  item: InvoiceItem,
  ctx: { id: string; invoice_number: string; today: string; dueDays: number },
): InvoiceRecord {
  const rec: InvoiceRecord = {
    ...original,
    attachments: undefined, // the original's files stay with it (6.12)
    id: ctx.id,
    invoice_number: ctx.invoice_number,
    doc_type: lateFeeDocType(original.doc_type),
    issue_date: ctx.today,
    due_date: shiftDay(ctx.today, Math.max(0, Math.round(ctx.dueDays))),
    status: 'Draft',
    // The fee line is in rupees (see buildLateFeeItem): the new-dated document is an INR invoice and
    // never inherits the original's exchange rate (which belongs to the original's date).
    currency: 'INR',
    exchange_rate: undefined,
    items: [item],
    client: { ...original.client },
    sender: original.sender ? { ...original.sender } : null,
    discount_type: 'PERCENT',
    discount_rate: 0,
    shipping: 0,
    other_charges: 0,
    charges_taxable: undefined,
    amount_paid: 0,
    price_includes_tax: false,
    tcs_enabled: false,
    tds_enabled: false,
    po_number: original.invoice_number,
    notes: `Late fee on ${original.invoice_number} dated ${String(original.issue_date).slice(0, 10)}.`,
    recurring_id: undefined,
    recurring_date: undefined,
    quote_status: undefined,
    shipping_bill_no: undefined,
    shipping_bill_date: undefined,
    port_code: undefined,
    created_at: undefined,
    updated_at: undefined,
    late_fee_for: original.id,
    amends: undefined,
    pos: undefined,
    transport: undefined,
    approval: undefined, // WP-9: never copied
    loyalty_redeem: undefined,
    // A new document: on reverse charge (copied from the original) its tax stays out of the total.
    rcm_tax_excluded: original.reverse_charge && original.doc_type !== 'BILL_OF_SUPPLY' ? true : undefined,
  };
  const t = calculateInvoice(calcInputFromRecord(rec));
  return {
    ...rec,
    subtotal: t.subtotal,
    discount_amount: t.discount_amount,
    taxable_value: t.taxable_value,
    cgst_amount: t.cgst_amount,
    sgst_amount: t.sgst_amount,
    igst_amount: t.igst_amount,
    tax_amount: t.tax_amount,
    round_off: t.round_off,
    total: t.total,
    balance_due: t.balance_due,
    cess_amount: t.cess_amount,
    tcs_amount: t.tcs_amount,
    tds_amount: t.tds_amount,
  };
}

/* ── Storage-backed helpers for the UI ─────────────────────────── */

/** The client's rule: the client master (current terms) first, else the snapshot on the invoice. */
export function lateFeeRuleFor(invoice: InvoiceRecord, clients: readonly Client[] = localDb.clients.getAll()): ClientLateFee | undefined {
  const c = invoice.client;
  const master =
    (c?.id && clients.find((x) => x.id === c.id)) ||
    clients.find((x) => x.name && c?.name && x.name.trim().toLowerCase() === c.name.trim().toLowerCase() && (x.gstin ?? '') === (c.gstin ?? ''));
  return sanitizeClientLateFee(master ? master.late_fee : c?.late_fee);
}

/** A late-fee invoice already raised for this original (not cancelled), if any. */
export function lateFeeRaisedFor(originalId: string, invoices: readonly InvoiceRecord[]): InvoiceRecord | undefined {
  return invoices.find((i) => i.late_fee_for === originalId && i.status !== 'Cancelled');
}

export function quoteLateFee(
  invoice: InvoiceRecord,
  fee: ClientLateFee,
  data: { payments?: Pick<Payment, 'invoice_id' | 'amount' | 'date'>[]; links?: DocLink[]; invoices?: InvoiceRecord[] } = {},
  asOf: string | Date = new Date(),
): LateFeeQuote {
  const all = data.invoices ?? localDb.invoices.getAll();
  const input = interestInputFor(invoice, data.payments ?? localDb.payments.listFor(invoice.id), data.links ?? readLinks(), all);
  return computeClientLateFee(input, fee, asOf);
}

export class LateFeeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LateFeeError';
  }
}

/**
 * Create and save the late-fee draft for `original` (today's date, next number in its series).
 * Throws `LateFeeError` when the client has no rule, nothing is due, one was already raised,
 * or today falls inside the locked period (the save would also refuse it).
 */
export function createLateFeeInvoice(original: InvoiceRecord, asOf: Date = new Date()): InvoiceRecord {
  const fee = lateFeeRuleFor(original);
  if (!fee) throw new LateFeeError('This client has no late-fee terms. Add them on the client first.');
  const all = localDb.invoices.getAll();
  const already = lateFeeRaisedFor(original.id, all);
  if (already) throw new LateFeeError(`A late fee was already raised on ${already.invoice_number}.`);
  const quote = quoteLateFee(original, fee, { invoices: all }, asOf);
  const item = buildLateFeeItem(quote, fee, original);
  if (!item) throw new LateFeeError(quote.reason ?? 'No late fee is due.');
  const today = isoDay(asOf);
  const lockUntil = getLockUntil();
  if (isDateLocked(today, lockUntil)) throw new LateFeeError(lockMessage(lockUntil, 'create', today));
  const docType = lateFeeDocType(original.doc_type);
  const rec = buildLateFeeInvoice(original, item, {
    id: generateId(),
    invoice_number: localDb.invoices.nextNumber(today, docType, original.sender?.invoicePrefix || undefined),
    today,
    dueDays: num(localDb.settings.get().defaultDueDays, 14),
  });
  return localDb.invoices.save(rec);
}
