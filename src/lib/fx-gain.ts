/**
 * Exchange gain / loss on foreign-currency invoices (roadmap 6.19).
 *
 * A foreign invoice is booked in rupees at its `exchange_rate` (the invoice-date rate that GST
 * also uses — Rule 34 CGST Rules — and that never changes here). When the customer pays, the bank
 * converts at the rate of the day. The receipt can carry that `realised_rate`; then:
 *
 *   realised gain/loss = (realised rate − invoice rate) × foreign amount settled
 *
 * which is AS 11 / Ind AS 21 "exchange difference on settlement of a monetary item", recognised in
 * P&L in the period it arises. The ledger posts it automatically (account 4930 "Foreign exchange
 * gain / loss"): Dr Bank at the realised rupees, Cr Debtors at the invoice-rate rupees, the
 * difference to the FX account — so the voucher (and the trial balance) still balances.
 *
 * Period-end revaluation of OPEN foreign receivables at a closing rate (AS 11 para 11/13) is a
 * report only: the unrealised difference is shown with the reversing journal it implies, nothing
 * is posted. GST is unaffected by either: returns, e-Invoice and tax figures keep the invoice
 * rate. Working papers — verify with your CA.
 *
 * Pure: no storage.
 */

import type { InvoiceRecord, Payment } from '../types/invoice';
import { docCurrency, fxRate, inrValue, isForeignCurrency } from './fx';
import { mulRound2, num, round2 } from './invoice-calc';
import { isoDay } from './dates';
import { toCsv } from './csv';
import { receivableTotal } from './rcm';

export interface RealisedFx {
  currency: string;
  /** Foreign amount settled by the receipt. */
  foreign: number;
  /** Invoice (book) rate and the rate realised on the receipt, ₹ per unit. */
  bookRate: number;
  realisedRate: number;
  /** Rupees at the invoice rate (what the debtor is reduced by). */
  bookInr: number;
  /** Rupees actually received. */
  realisedInr: number;
  /** realisedInr − bookInr: positive = gain, negative = loss. */
  gain: number;
}

type FxInvoice = Pick<InvoiceRecord, 'currency' | 'exchange_rate'> | null | undefined;
type FxPayment = Pick<Payment, 'amount'> & Partial<Pick<Payment, 'realised_rate'>>;

/** A usable realised rate: positive and finite, else undefined. */
export function cleanRate(v: unknown): number | undefined {
  const n = num(v);
  return n > 0 && Number.isFinite(n) ? n : undefined;
}

/**
 * The realised exchange difference on one receipt, or null when there is none to compute
 * (INR invoice, foreign invoice without a rate, or no realised rate on the receipt).
 */
export function realisedFx(payment: FxPayment, inv: FxInvoice): RealisedFx | null {
  if (!inv || !isForeignCurrency(inv)) return null;
  const bookRate = fxRate(inv);
  const realisedRate = cleanRate(payment.realised_rate);
  if (bookRate === null || realisedRate === undefined) return null;
  const foreign = Math.abs(num(payment.amount));
  if (foreign === 0) return null;
  const bookInr = inrValue(foreign, inv);
  const realisedInr = mulRound2(foreign, realisedRate);
  return { currency: docCurrency(inv), foreign, bookRate, realisedRate, bookInr, realisedInr, gain: round2(realisedInr - bookInr) };
}

/** Rupees a receipt really brought in: at the realised rate when there is one, else the invoice rate. */
export function receiptInr(payment: FxPayment, inv: FxInvoice): number {
  const fx = realisedFx(payment, inv);
  return fx ? fx.realisedInr : inrValue(Math.abs(num(payment.amount)), inv);
}

/* ── Realised register ──────────────────────────────────────── */

export interface RealisedRow extends RealisedFx {
  paymentId: string;
  invoiceId: string;
  invoiceNumber: string;
  party: string;
  date: string;
}

export interface ForeignReceiptRow {
  paymentId: string;
  invoiceId: string;
  invoiceNumber: string;
  party: string;
  date: string;
  currency: string;
  foreign: number;
  bookRate: number | null;
  realisedRate?: number;
  fx: RealisedFx | null;
  /** QA22 W7: a netting row (R19-D agent set-off): its rate is the bill's, set by the netting — not edited here. */
  netted?: boolean;
}

const partyOf = (inv: InvoiceRecord) => String(inv.client?.company || inv.client?.name || '').trim() || 'Customer';

/** Every receipt against a foreign-currency invoice in the period, with its realised difference (if a rate was entered). */
export function foreignReceipts(invoices: readonly InvoiceRecord[], payments: readonly Payment[], period: { start: string; end: string }): ForeignReceiptRow[] {
  const byId = new Map(invoices.map((i) => [i.id, i]));
  const out: ForeignReceiptRow[] = [];
  for (const p of payments) {
    const inv = byId.get(p.invoice_id);
    if (!inv || !isForeignCurrency(inv)) continue;
    const date = isoDay(p.date);
    if (!date || date < period.start || date > period.end) continue;
    out.push({
      paymentId: p.id,
      invoiceId: inv.id,
      invoiceNumber: inv.invoice_number || '',
      party: partyOf(inv),
      date,
      currency: docCurrency(inv),
      foreign: round2(Math.abs(num(p.amount))),
      bookRate: fxRate(inv),
      realisedRate: cleanRate(p.realised_rate),
      fx: realisedFx(p, inv),
      ...(p.exchange_purchase_id ? { netted: true } : {}),
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.invoiceNumber.localeCompare(b.invoiceNumber));
}

export function realisedTotals(rows: readonly ForeignReceiptRow[]): { gain: number; loss: number; net: number; missingRate: number } {
  let gain = 0;
  let loss = 0;
  let missingRate = 0;
  for (const r of rows) {
    if (!r.fx) {
      missingRate++;
      continue;
    }
    if (r.fx.gain >= 0) gain += r.fx.gain;
    else loss -= r.fx.gain;
  }
  return { gain: round2(gain), loss: round2(loss), net: round2(gain - loss), missingRate };
}

/* ── Period-end revaluation (unrealised, report only) ───────── */

export interface RevaluationRow {
  invoiceId: string;
  invoiceNumber: string;
  party: string;
  issueDate: string;
  currency: string;
  /** Foreign balance still open on `asOf` (total − TDS − receipts dated on or before `asOf`). */
  openForeign: number;
  bookRate: number;
  closingRate: number | null;
  bookInr: number;
  closingInr: number | null;
  /** closingInr − bookInr (null without a closing rate). */
  unrealised: number | null;
}

export interface Revaluation {
  asOf: string;
  rows: RevaluationRow[];
  /** Currencies with open balances, for the closing-rate inputs. */
  currencies: string[];
  totals: { bookInr: number; closingInr: number; unrealised: number; missingRate: number };
}

const SALE_TYPES = new Set(['INVOICE', 'TAX_INVOICE', 'DEBIT_NOTE', 'BILL_OF_SUPPLY']);

/**
 * Restate open foreign-currency receivables at `closingRates` (₹ per unit, by currency code) as on
 * `asOf`. Only documents with an invoice rate are revalued (others have no book value to compare).
 */
export function revalueReceivables(
  invoices: readonly InvoiceRecord[],
  payments: readonly Payment[],
  closingRates: Readonly<Record<string, number | undefined>>,
  asOf: string,
): Revaluation {
  const paidBy = new Map<string, number>();
  for (const p of payments) {
    const d = isoDay(p.date);
    if (!d || d > asOf) continue;
    paidBy.set(p.invoice_id, (paidBy.get(p.invoice_id) ?? 0) + Math.abs(num(p.amount)));
  }
  const rows: RevaluationRow[] = [];
  const currencies = new Set<string>();
  for (const inv of invoices) {
    if (!isForeignCurrency(inv) || !SALE_TYPES.has(inv.doc_type ?? 'INVOICE')) continue;
    if (inv.status === 'Draft' || inv.status === 'Cancelled') continue;
    const issued = isoDay(inv.issue_date);
    const bookRate = fxRate(inv);
    if (!issued || issued > asOf || bookRate === null) continue;
    const open = round2(Math.abs(receivableTotal(inv)) - Math.abs(num(inv.tds_amount)) - (paidBy.get(inv.id) ?? 0));
    if (open <= 0.004) continue;
    const currency = docCurrency(inv);
    currencies.add(currency);
    const closingRate = cleanRate(closingRates[currency]) ?? null;
    const bookInr = mulRound2(open, bookRate);
    const closingInr = closingRate === null ? null : mulRound2(open, closingRate);
    rows.push({
      invoiceId: inv.id,
      invoiceNumber: inv.invoice_number || '',
      party: partyOf(inv),
      issueDate: issued,
      currency,
      openForeign: open,
      bookRate,
      closingRate,
      bookInr,
      closingInr,
      unrealised: closingInr === null ? null : round2(closingInr - bookInr),
    });
  }
  rows.sort((a, b) => a.currency.localeCompare(b.currency) || a.issueDate.localeCompare(b.issueDate));
  const totals = { bookInr: 0, closingInr: 0, unrealised: 0, missingRate: 0 };
  for (const r of rows) {
    if (r.closingInr === null) {
      totals.missingRate++;
      continue;
    }
    totals.bookInr += r.bookInr;
    totals.closingInr += r.closingInr;
    totals.unrealised += r.unrealised ?? 0;
  }
  return {
    asOf,
    rows,
    currencies: [...currencies].sort(),
    totals: { bookInr: round2(totals.bookInr), closingInr: round2(totals.closingInr), unrealised: round2(totals.unrealised), missingRate: totals.missingRate },
  };
}

/* ── CSV ────────────────────────────────────────────────────── */

const NOTE = 'Working paper — verify with your CA. GST figures keep the invoice-date rate.';

export function realisedCsv(rows: readonly ForeignReceiptRow[], period: { start: string; end: string }): string {
  const t = realisedTotals(rows);
  return toCsv([
    [`Realised exchange gain / loss ${period.start} to ${period.end}`, NOTE],
    ['Date', 'Invoice', 'Party', 'Currency', 'Amount (foreign)', 'Invoice rate', 'Realised rate', 'At invoice rate (₹)', 'Realised (₹)', 'Gain / (loss) (₹)'],
    ...rows.map((r) => [r.date, r.invoiceNumber, r.party, r.currency, r.foreign, r.bookRate ?? '', r.realisedRate ?? '', r.fx?.bookInr ?? '', r.fx?.realisedInr ?? '', r.fx?.gain ?? 'rate not entered']),
    ['', '', '', '', '', '', '', '', 'Net', t.net],
  ]);
}

export function revaluationCsv(rev: Revaluation): string {
  return toCsv([
    [`Revaluation of foreign-currency receivables as on ${rev.asOf} (unrealised — not posted)`, NOTE],
    ['Invoice', 'Date', 'Party', 'Currency', 'Open (foreign)', 'Invoice rate', 'Closing rate', 'At invoice rate (₹)', 'At closing rate (₹)', 'Unrealised gain / (loss) (₹)'],
    ...rev.rows.map((r) => [r.invoiceNumber, r.issueDate, r.party, r.currency, r.openForeign, r.bookRate, r.closingRate ?? '', r.bookInr, r.closingInr ?? '', r.unrealised ?? 'closing rate not entered']),
    ['', '', '', '', '', '', 'Total', rev.totals.bookInr, rev.totals.closingInr, rev.totals.unrealised],
  ]);
}
