/**
 * Payment receipts (receipt vouchers for money received against an invoice).
 *
 * Numbers are STAMPED on the payment when it is recorded (`receipt_number`, highest + 1 per Indian FY
 * with a high-water mark — `series-counters.ts`), so deleting a payment or bouncing a cheque never
 * renumbers another receipt. Older payments recorded before stamping keep their derived number: their
 * position, in date order (ties by id), among the UNSTAMPED payments of that FY; new stamps start above
 * that count, so the two never collide (advance adjustments take no RCPT number). The HTML is self-contained (inline styles, no scripts) so it prints from
 * a plain window under the app's CSP and can be saved as a file.
 */

import type { InvoiceRecord, Payment } from '../types/invoice';
import { getIndianFY } from './invoice-number';
import { amountInWords } from './amount-in-words';
import { formatCurrency, formatDate } from './utils';
import { round2 } from './invoice-calc';
import { receivableTotal } from './rcm';
import { escHtml as esc } from './html-esc';
import { PRINT_FONT, PRINT_FONT_FACE } from './print-fonts';

export function receiptNumber(
  payment: Pick<Payment, 'id' | 'date'> & Partial<Pick<Payment, 'receipt_number'>>,
  all: readonly (Pick<Payment, 'id' | 'date' | 'advance_id'> & Partial<Pick<Payment, 'receipt_number'>>)[],
): string {
  const stamped = payment.receipt_number || all.find((p) => p.id === payment.id)?.receipt_number;
  if (stamped) return stamped;
  const fy = getIndianFY(payment.date);
  // An advance adjusted against an invoice (5.3) is not new money: it already has its own
  // receipt voucher (ADV/…), so it takes no RCPT number. Stamped rows are numbered already.
  const sameYear = all
    .filter((p) => !p.advance_id && !p.receipt_number && getIndianFY(p.date).label === fy.label)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.id).localeCompare(String(b.id)));
  const seq = Math.max(1, sameYear.findIndex((p) => p.id === payment.id) + 1);
  return `RCPT/FY${fy.label}/${String(seq).padStart(4, '0')}`;
}

export interface ReceiptData {
  number: string;
  date: string;
  from: string;
  fromGstin: string;
  business: string;
  businessGstin: string;
  businessAddress: string;
  amount: number;
  currency: string;
  amountWords: string;
  method: string;
  reference: string;
  against: string;
  invoiceTotal: number;
  /** Balance still owed on the invoice once this payment (and every earlier one) is counted. */
  balanceAfter: number;
  /** Additive (R5-C1): "for" line — the student's / patient's roll no. and class on a fee receipt. */
  forLine?: string;  /** Additive (R5-C3 / C6): another receipt kind (donation, deposit refund) — its title, rows and notes replace the invoice rows. */
  title?: string;
  rows?: [string, string][];
  notes?: string[];
}

export function buildReceipt(invoice: InvoiceRecord, payment: Payment, allPayments: readonly Payment[]): ReceiptData {
  const mine = allPayments
    .filter((p) => p.invoice_id === invoice.id)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.id).localeCompare(String(b.id)));
  const upTo = mine.slice(0, mine.findIndex((p) => p.id === payment.id) + 1);
  const paidSoFar = upTo.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const tds = Math.max(Number(invoice.tds_amount) || 0, 0);
  const currency = invoice.currency || 'INR';
  return {
    number: receiptNumber(payment, allPayments),
    date: payment.date,
    from: invoice.client?.company || invoice.client?.name || '',
    fromGstin: invoice.client?.gstin ?? '',
    business: invoice.sender?.companyName ?? '',
    businessGstin: invoice.sender?.companyGstin ?? '',
    businessAddress: invoice.sender?.companyAddress ?? '',
    amount: round2(Number(payment.amount) || 0),
    currency,
    amountWords: amountInWords(Number(payment.amount) || 0, currency),
    method: payment.method,
    reference: payment.reference ?? '',
    against: invoice.invoice_number,
    // Reverse charge: the recipient's GST is never part of what the receipt settles (src/lib/rcm.ts).
    invoiceTotal: receivableTotal(invoice) || 0,
    balanceAfter: Math.max(round2((receivableTotal(invoice) || 0) - tds - paidSoFar), 0),
    ...forLineOf(invoice),
  };
}

/** R5-C1: "Roll no. 12 · Class 6-A" from the document's party snapshot (fee documents only). */
function forLineOf(inv: InvoiceRecord): { forLine?: string } {
  const c = inv.client;
  const line = inv.fee_plan_id ? [c?.roll_no ? `Roll no. ${c.roll_no}` : '', c?.class_label ? `Class ${c.class_label}` : ''].filter(Boolean).join(' · ') : '';
  return line ? { forLine: line } : {};
}


/** A complete, script-free HTML document for printing or saving. */
export function receiptHtml(r: ReceiptData): string {
  const money = (n: number) => esc(formatCurrency(n, r.currency));
  const row = (k: string, v: string) => (v ? `<tr><th>${esc(k)}</th><td>${v}</td></tr>` : '');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Receipt ${esc(r.number)}</title>
<style>${PRINT_FONT_FACE}
  body { font-family: ${PRINT_FONT}; color: #111; margin: 0; padding: 32px; }
  .sheet { max-width: 640px; margin: 0 auto; border: 1px solid #ccc; padding: 28px 32px; }
  h1 { font-size: 20px; letter-spacing: 0.08em; text-transform: uppercase; margin: 0 0 4px; }
  .muted { color: #555; font-size: 13px; }
  .head { display: flex; justify-content: space-between; gap: 16px; border-bottom: 2px solid #111; padding-bottom: 12px; margin-bottom: 16px; }
  .amount { font-size: 28px; font-weight: 600; margin: 12px 0 2px; font-variant-numeric: tabular-nums; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 14px; }
  th { text-align: left; color: #555; font-weight: 500; width: 40%; padding: 6px 0; vertical-align: top; }
  td { padding: 6px 0; }
  .sign { margin-top: 48px; text-align: right; font-size: 13px; }
  .note { margin-top: 24px; font-size: 12px; color: #777; }
  @media print { body { padding: 0; } .sheet { border: 0; } }
</style></head>
<body><div class="sheet">
  <div class="head">
    <div><h1>${esc(r.title ?? 'Payment receipt')}</h1><div class="muted">${esc(r.number)} · ${esc(formatDate(r.date))}</div></div>
    <div style="text-align:right"><strong>${esc(r.business)}</strong>
      ${r.businessGstin ? `<div class="muted">GSTIN ${esc(r.businessGstin)}</div>` : ''}
      ${r.businessAddress ? `<div class="muted">${esc(r.businessAddress).replace(/\n/g, '<br>')}</div>` : ''}</div>
  </div>
  <div class="muted">Received with thanks from</div>
  <div style="font-size:16px;font-weight:600">${esc(r.from)}</div>
  ${r.fromGstin ? `<div class="muted">GSTIN ${esc(r.fromGstin)}</div>` : ''}
  ${r.forLine ? `<div class="muted">For ${esc(r.forLine)}</div>` : ''}
  <div class="amount">${money(r.amount)}</div>
  <div class="muted">${esc(r.amountWords)}</div>
  <table>
    ${r.rows ? r.rows.map(([k, v]) => row(k, esc(v))).join('') : `${row('Against', esc(r.against))}
    ${row('Invoice total', money(r.invoiceTotal))}
    ${row('Payment method', esc(r.method))}
    ${row('Reference', esc(r.reference))}
    ${row('Balance after this payment', money(r.balanceAfter))}`}
  </table>
  ${(r.notes ?? []).map((n) => `<div class="note">${esc(n)}</div>`).join('')}
  <div class="sign">For ${esc(r.business)}<br><br><br>Authorised signatory</div>
  <div class="note">This receipt was produced on the issuer's device.</div>
</div></body></html>`;
}

/** Label for the reference field, by payment method. */
export function referenceLabel(method: string): string {
  const m = method.toLowerCase();
  if (m.includes('upi')) return 'UPI ref / UTR';
  if (m.includes('bank') || m.includes('neft') || m.includes('rtgs') || m.includes('imps')) return 'UTR number';
  if (m.includes('cheque')) return 'Cheque number';
  if (m.includes('card')) return 'Approval code';
  return 'Reference';
}
