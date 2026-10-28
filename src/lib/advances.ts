/**
 * Advance receipts (roadmap 5.3): money received from a client before the invoice.
 *
 *  - Each advance is a Receipt Voucher (CGST Rule 50) numbered `ADV/FY25-26/0001` (Indian FY,
 *    own series, derived from the highest number issued — never a row count).
 *  - GST on the advance is worked out once, when saved (`computeAdvanceTax`, tax-inclusive) and
 *    kept on the record as a snapshot, like an invoice's totals.
 *  - Applying an advance to an invoice records an ordinary payment through
 *    `localDb.payments.record` with `advance_id` set, so the period lock, the audit log and the
 *    invoice's paid / balance / status work exactly as for money typed by hand. Removing that
 *    payment (payment dialog) gives the advance back.
 *  - An unadjusted balance can be refunded (Refund Voucher, Rule 51, `RFV/FY25-26/0001`).
 *
 * Every write needs the `payment.record` permission (local roles, 6.21), respects the period lock
 * (the voucher's own date, and the adjustment / refund date) and is audited (entity `advance`). Working papers — verify with your CA.
 */

import type { AdvanceRecord, AdvanceRefund, AdvanceSender, AdvanceSupply } from '../types/advances';
import type { InvoiceRecord, Payment } from '../types/invoice';
import { audit } from './audit';
import { requireAccess } from './access';
import { amountInWords } from './amount-in-words';
import { toCsv } from './csv';
import { isoDay } from './dates';
import { num, round2 } from './invoice-calc';
import { buildInvoiceNumber, getIndianFY, highestSequence } from './invoice-number';
import { formatPlaceOfSupply, stateByCode } from './india-states';
import { checkGstin } from './gstin';
import { localDb } from './localDb';
import { assertUnlocked } from './period-lock';
import { generateId, getTable, setTable } from './storage';
import { todayIso } from './tax-rules';
import { formatCurrency, formatDate } from './utils';
import { ADVANCES_TABLE, advanceBalance, computeAdvanceTax, liveAdjustments, taxTotal, type AdvanceBalance } from './advance-tax';
import { receivableTotal } from './rcm';
import { recordSeries, seriesHigh } from './series-counters';
import { escHtml as esc } from './html-esc';

export { ADVANCES_TABLE, advanceBalance, computeAdvanceTax, isAdvanceAdjustment, liveAdjustments } from './advance-tax';
export type { AdvanceBalance } from './advance-tax';

export const ADVANCE_PREFIX = 'ADV';
export const REFUND_PREFIX = 'RFV';
export const ADJUST_METHOD = 'Advance adjusted';

export class AdvanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdvanceError';
  }
}

/* ── Numbering ──────────────────────────────────────────────── */

/** Next number in `<prefix>/FY<yy-yy>/<0001>` for the FY of `date` (above `floor`, the series high-water mark). */
export function nextSeriesNumber(prefix: string, date: string, existing: readonly string[], floor = 0): string {
  const fy = getIndianFY(isoDay(date) || undefined);
  const taken = new Set(existing.map((n) => String(n ?? '').trim().toUpperCase()));
  let seq = Math.max(highestSequence([...existing], prefix, fy.label), floor) + 1;
  while (taken.has(buildInvoiceNumber(prefix, fy.label, seq))) seq++;
  return buildInvoiceNumber(prefix, fy.label, seq);
}

const highWater = (prefix: string, date: string) => seriesHigh(prefix, getIndianFY(isoDay(date) || undefined).label);

/** A deleted latest voucher's number is never reused (`series-counters.ts`). */
export function nextAdvanceNumber(date: string, advances: readonly AdvanceRecord[] = loadAdvances()): string {
  return nextSeriesNumber(ADVANCE_PREFIX, date, advances.map((a) => a.number), highWater(ADVANCE_PREFIX, date));
}

export function nextRefundNumber(date: string, advances: readonly AdvanceRecord[] = loadAdvances()): string {
  return nextSeriesNumber(REFUND_PREFIX, date, advances.flatMap((a) => (a.refunds ?? []).map((r) => r.number)), highWater(REFUND_PREFIX, date));
}

/* ── Storage ────────────────────────────────────────────────── */

export function loadAdvances(): AdvanceRecord[] {
  return getTable<AdvanceRecord>(ADVANCES_TABLE).filter((a) => a && typeof a === 'object' && typeof a.id === 'string');
}

function writeAll(rows: AdvanceRecord[]): void {
  setTable(ADVANCES_TABLE, rows);
}

const money = (n: number) => `₹${round2(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function log(entityId: string, action: 'create' | 'update' | 'delete', number: string, summary: string): void {
  try {
    audit.record({ entity: 'advance', entity_id: entityId, action, doc_number: number, summary });
  } catch {
    /* logging never breaks a save */
  }
}

/** Lock subject for a dated advance event (voucher, adjustment or refund). */
const lockOf = (id: string, date: string, number: string) => ({ id, issue_date: date, invoice_number: number });

/* ── Input & validation ─────────────────────────────────────── */

export type AdvanceInputClient = { id?: string; name: string; company?: string; gstin?: string; address?: string; state_code?: string; email?: string };

export interface AdvanceInput {
  id?: string;
  date: string;
  client: AdvanceInputClient;
  place_of_supply: string;
  supply: AdvanceSupply;
  tax_rate: number;
  amount: number;
  method: string;
  reference?: string;
  description?: string;
  note?: string;
  /** Multi-account BRS: the bank account it went into (ignored for cash). */
  bankAccountId?: string;
  /** CN-C2: the realty booking (and a pass-through collection) this receipt is for. */
  booking?: Pick<AdvanceRecord, 'booking_id' | 'pass_through'>;
  /** R19-C2: the job of a duty deposit (kept on edit). */
  lg?: AdvanceRecord['lg'];
}

export function validateAdvance(input: AdvanceInput, today: string = todayIso()): string[] {
  const errors: string[] = [];
  const day = isoDay(input.date);
  if (!day) errors.push('Enter the date the money was received.');
  else if (day > today) errors.push('The date cannot be in the future.');
  if (!String(input.client?.name ?? '').trim()) errors.push('Choose who paid the advance.');
  if (!(round2(num(input.amount)) > 0)) errors.push('Enter an amount above zero.');
  const pos = String(input.place_of_supply ?? '').trim();
  if (!stateByCode(pos) && pos !== '96' && pos !== '99') errors.push('Choose the place of supply.');
  const rate = num(input.tax_rate, -1);
  if (!(rate >= 0 && rate <= 100)) errors.push('Enter a GST rate between 0 and 100.');
  if (input.supply !== 'goods' && input.supply !== 'services') errors.push('Say whether the advance is for goods or services.');
  const gstin = String(input.client?.gstin ?? '').trim();
  if (gstin && !checkGstin(gstin).valid) errors.push('The client GSTIN is not valid.');
  return errors;
}

/** Issuer snapshot from the active sender profile (no logo / signature: the voucher is text). */
export function senderSnapshot(): AdvanceSender | null {
  const p = localDb.settings.activeProfile();
  if (!p) return null;
  return {
    companyName: p.companyName || '',
    companyAddress: p.companyAddress || undefined,
    companyGstin: p.companyGstin || undefined,
    companyEmail: p.companyEmail || undefined,
    companyPhone: p.companyPhone || undefined,
    stateCode: p.stateCode || checkGstin(p.companyGstin).stateCode || undefined,
  };
}

const senderState = (s: AdvanceSender | null | undefined) =>
  String(s?.stateCode || checkGstin(s?.companyGstin ?? '').stateCode || '').trim();

function cleanClient(c: AdvanceInputClient): AdvanceRecord['client'] {
  const out: AdvanceRecord['client'] = { name: String(c.name ?? '').trim() };
  if (c.id) out.id = c.id;
  if (c.company?.trim()) out.company = c.company.trim();
  const gstin = String(c.gstin ?? '').trim().toUpperCase();
  if (gstin) out.gstin = gstin;
  if (c.address?.trim()) out.address = c.address.trim();
  if (c.state_code?.trim()) out.state_code = c.state_code.trim();
  if (c.email?.trim()) out.email = c.email.trim();
  return out;
}

/* ── Save / delete ──────────────────────────────────────────── */

interface Ctx {
  payments?: Payment[];
  invoices?: InvoiceRecord[];
  now?: Date;
  today?: string;
}

const ctxPayments = (c: Ctx) => c.payments ?? localDb.payments.getAll();
const ctxInvoices = (c: Ctx) => c.invoices ?? localDb.invoices.getAll();

/** Add or edit an advance. Once anything was adjusted or refunded, the voucher is frozen. */
export function saveAdvance(input: AdvanceInput, ctx: Ctx = {}): AdvanceRecord {
  requireAccess('payment.record');
  const errors = validateAdvance(input, ctx.today);
  if (errors.length) throw new AdvanceError(errors[0]);
  const rows = loadAdvances();
  const prev = input.id ? rows.find((a) => a.id === input.id) : undefined;
  const date = isoDay(input.date);
  const nowIso = (ctx.now ?? new Date()).toISOString();
  if (prev) {
    const bal = advanceBalance(prev, ctxPayments(ctx), ctxInvoices(ctx));
    if (bal.adjusted > 0 || bal.refunded > 0 || num(bal.forfeited) > 0) {
      throw new AdvanceError(`${prev.number} has been adjusted or refunded; remove those entries before editing it.`);
    }
    assertUnlocked(lockOf(prev.id, prev.date, prev.number), 'edit');
  }
  const id = prev?.id ?? generateId();
  const sameFy = prev && getIndianFY(prev.date).label === getIndianFY(date).label;
  const number = prev && sameFy ? prev.number : nextAdvanceNumber(date, rows.filter((a) => a.id !== id));
  assertUnlocked(lockOf(id, date, number), prev ? 'edit' : 'create');
  const sender = prev?.sender !== undefined ? prev.sender : senderSnapshot();
  const amount = round2(num(input.amount));
  const tax_rate = num(input.tax_rate);
  const pos = String(input.place_of_supply).trim();
  const row: AdvanceRecord = {
    id,
    number,
    date,
    client: cleanClient(input.client),
    place_of_supply: pos,
    supply: input.supply,
    tax_rate,
    amount,
    method: String(input.method || 'Bank transfer'),
    ...(input.bankAccountId && !/^cash$/i.test(String(input.method)) ? { bank_account_id: input.bankAccountId } : {}),
    ...(input.reference?.trim() ? { reference: input.reference.trim() } : {}),
    ...(input.description?.trim() ? { description: input.description.trim() } : {}),
    ...(input.note?.trim() ? { note: input.note.trim() } : {}),
    ...(input.booking ?? (prev?.booking_id || prev?.pass_through ? { booking_id: prev.booking_id, pass_through: prev.pass_through } : {})),
    ...(input.lg ?? prev?.lg ? { lg: input.lg ?? prev?.lg } : {}),
    tax: computeAdvanceTax({ amount, rate: tax_rate, supply: input.supply, date, pos, senderState: senderState(sender) }),
    sender,
    refunds: prev?.refunds ?? [],
    created_at: prev?.created_at ?? nowIso,
    ...(prev ? { updated_at: nowIso } : {}),
  };
  writeAll(prev ? rows.map((a) => (a.id === id ? row : a)) : [...rows, row]);
  recordSeries(number);
  const tax = row.tax.applies ? `, GST ${money(taxTotal(row.tax))}` : ', no GST on this advance';
  log(id, prev ? 'update' : 'create', number, `${prev ? 'Edited advance' : 'Advance'} ${number} from ${row.client.name}: ${money(amount)}${tax}`);
  return row;
}

export function deleteAdvance(id: string, ctx: Ctx = {}): void {
  requireAccess('payment.record');
  const rows = loadAdvances();
  const adv = rows.find((a) => a.id === id);
  if (!adv) return;
  const bal = advanceBalance(adv, ctxPayments(ctx), ctxInvoices(ctx));
  if (bal.adjusted > 0 || bal.refunded > 0 || num(bal.forfeited) > 0) {
    throw new AdvanceError(`${adv.number} has been adjusted or refunded; remove those entries first.`);
  }
  assertUnlocked(lockOf(adv.id, adv.date, adv.number), 'delete');
  writeAll(rows.filter((a) => a.id !== id));
  log(id, 'delete', adv.number, `Advance ${adv.number} from ${adv.client.name} (${money(adv.amount)}) deleted`);
}

/* ── Party matching ─────────────────────────────────────────── */

const nameKey = (s: string | undefined) => String(s ?? '').trim().toLowerCase();

/** Same party: by client id when both have one, else by case-folded name. */
export function samePartyAs(a: { id?: string; name?: string } | undefined, b: { id?: string; name?: string } | undefined): boolean {
  if (!a || !b) return false;
  if (a.id && b.id) return a.id === b.id;
  return !!nameKey(a.name) && nameKey(a.name) === nameKey(b.name);
}

export interface OpenAdvance {
  advance: AdvanceRecord;
  balance: AdvanceBalance;
}

/** The client's advances with something left to apply, oldest first. */
export function openAdvancesFor(
  client: { id?: string; name?: string } | undefined,
  advances: readonly AdvanceRecord[],
  payments: readonly Payment[],
  invoices: readonly InvoiceRecord[],
): OpenAdvance[] {
  const invById = new Map(invoices.map((i) => [i.id, i]));
  return advances
    .filter((a) => samePartyAs(a.client, client))
    .map((advance) => ({ advance, balance: advanceBalance(advance, payments, invById) }))
    .filter((x) => x.balance.open > 0.004)
    .sort((x, y) => x.advance.date.localeCompare(y.advance.date) || x.advance.number.localeCompare(y.advance.number));
}

/* ── Apply against an invoice ───────────────────────────────── */

/** What is still owed on the invoice (net of TDS), as the payment dialog computes it. */
export function invoiceOpen(inv: InvoiceRecord): number {
  const total = Math.max(receivableTotal(inv) - num(inv.tds_amount), 0);
  return round2(Math.max(total - num(inv.amount_paid), 0));
}

export function canApplyTo(inv: InvoiceRecord | undefined): string {
  if (!inv) return 'Invoice not found.';
  if (inv.doc_type !== 'INVOICE' && inv.doc_type !== 'TAX_INVOICE') return 'An advance can only be applied to an invoice.';
  if (inv.status === 'Draft' || inv.status === 'Cancelled') return `${inv.invoice_number} is ${inv.status.toLowerCase()}; issue it first.`;
  if ((inv.currency || 'INR').toUpperCase() !== 'INR') return 'Advances are in rupees; this invoice is in another currency.';
  return '';
}

export interface ApplyInput {
  advanceId: string;
  invoiceId: string;
  amount: number;
  /** Adjustment date; default: the later of the invoice date and the advance date. */
  date?: string;
}

/**
 * Adjust (part of) an advance against an invoice: records a payment with `advance_id` through
 * `localDb.payments.record` (invoice lock 'pay' + audit), after checking the lock on the
 * adjustment date (it changes GSTR-1 Table 11B for that period).
 */
export function applyAdvance(input: ApplyInput, ctx: Ctx = {}): Payment {
  requireAccess('payment.record');
  const adv = loadAdvances().find((a) => a.id === input.advanceId);
  if (!adv) throw new AdvanceError('Advance not found.');
  const invoices = ctxInvoices(ctx);
  const inv = invoices.find((i) => i.id === input.invoiceId);
  const problem = canApplyTo(inv);
  if (problem) throw new AdvanceError(problem);
  const invoice = inv as InvoiceRecord;
  if (!samePartyAs(adv.client, invoice.client)) throw new AdvanceError(`${adv.number} was received from ${adv.client.name}, not ${invoice.client?.name ?? 'this client'}.`);
  const amount = round2(num(input.amount));
  if (!(amount > 0)) throw new AdvanceError('Enter an amount above zero.');
  const bal = advanceBalance(adv, ctxPayments(ctx), invoices);
  if (amount > bal.open + 0.004) throw new AdvanceError(`Only ${money(bal.open)} of ${adv.number} is left to apply.`);
  const owed = invoiceOpen(invoice);
  if (amount > owed + 0.004) throw new AdvanceError(`${invoice.invoice_number} has only ${money(owed)} left to pay.`);
  const invDay = isoDay(invoice.issue_date);
  const date = isoDay(input.date) || (invDay > adv.date ? invDay : adv.date);
  if (date < adv.date) throw new AdvanceError(`An advance cannot be adjusted before it was received (${formatDate(adv.date)}).`);
  if (invDay && date < invDay) throw new AdvanceError(`Adjust it on or after the invoice date (${formatDate(invDay)}).`);
  if (date > (ctx.today ?? todayIso())) throw new AdvanceError('The date cannot be in the future.');
  assertUnlocked(lockOf(adv.id, date, adv.number), 'edit');
  const payment = localDb.payments.record({
    invoiceId: invoice.id,
    amount,
    method: ADJUST_METHOD,
    reference: adv.number,
    note: `Advance ${adv.number} of ${formatDate(adv.date)} adjusted`,
    date,
    advanceId: adv.id,
  });
  log(adv.id, 'update', adv.number, `Advance ${adv.number}: ${money(amount)} adjusted against ${invoice.invoice_number}`);
  return payment;
}

/* ── Refund (Rule 51) ───────────────────────────────────────── */

export interface RefundInput {
  amount: number;
  date: string;
  method: string;
  reference?: string;
  note?: string;
  /** Multi-account BRS: the bank account it was paid from (ignored for cash). */
  bankAccountId?: string;
}

export function refundAdvance(advanceId: string, input: RefundInput, ctx: Ctx = {}): AdvanceRefund {
  requireAccess('payment.record');
  const rows = loadAdvances();
  const idx = rows.findIndex((a) => a.id === advanceId);
  if (idx < 0) throw new AdvanceError('Advance not found.');
  const adv = rows[idx];
  const amount = round2(num(input.amount));
  if (!(amount > 0)) throw new AdvanceError('Enter an amount above zero.');
  const bal = advanceBalance(adv, ctxPayments(ctx), ctxInvoices(ctx));
  if (amount > bal.open + 0.004) throw new AdvanceError(`Only ${money(bal.open)} of ${adv.number} is unadjusted.`);
  const date = isoDay(input.date);
  if (!date) throw new AdvanceError('Enter the refund date.');
  if (date < adv.date) throw new AdvanceError(`A refund cannot be dated before the advance (${formatDate(adv.date)}).`);
  if (date > (ctx.today ?? todayIso())) throw new AdvanceError('The date cannot be in the future.');
  assertUnlocked(lockOf(adv.id, date, adv.number), 'edit');
  const refund: AdvanceRefund = {
    id: generateId(),
    number: nextRefundNumber(date, rows),
    date,
    amount,
    method: String(input.method || 'Bank transfer'),
    ...(input.bankAccountId && !/^cash$/i.test(String(input.method)) ? { bank_account_id: input.bankAccountId } : {}),
    ...(input.reference?.trim() ? { reference: input.reference.trim() } : {}),
    ...(input.note?.trim() ? { note: input.note.trim() } : {}),
    created_at: (ctx.now ?? new Date()).toISOString(),
  };
  rows[idx] = { ...adv, refunds: [...(adv.refunds ?? []), refund], updated_at: refund.created_at };
  writeAll(rows);
  recordSeries(refund.number);
  log(adv.id, 'update', adv.number, `Advance ${adv.number}: ${money(amount)} refunded (${refund.number})`);
  return refund;
}

export function deleteRefund(advanceId: string, refundId: string): void {
  requireAccess('payment.record');
  const rows = loadAdvances();
  const idx = rows.findIndex((a) => a.id === advanceId);
  if (idx < 0) return;
  const adv = rows[idx];
  const refund = (adv.refunds ?? []).find((r) => r.id === refundId);
  if (!refund) return;
  assertUnlocked(lockOf(adv.id, refund.date, adv.number), 'delete');
  rows[idx] = { ...adv, refunds: (adv.refunds ?? []).filter((r) => r.id !== refundId), updated_at: new Date().toISOString() };
  writeAll(rows);
  log(adv.id, 'update', adv.number, `Advance ${adv.number}: refund ${refund.number} (${money(refund.amount)}) removed`);
}

/* ── Register rows & CSV ────────────────────────────────────── */

export interface AdvanceRow {
  advance: AdvanceRecord;
  balance: AdvanceBalance;
  adjustments: { payment: Payment; invoiceNumber: string }[];
}

export function advanceRows(advances: readonly AdvanceRecord[], payments: readonly Payment[], invoices: readonly InvoiceRecord[]): AdvanceRow[] {
  const invById = new Map(invoices.map((i) => [i.id, i]));
  return [...advances]
    .sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number))
    .map((advance) => ({
      advance,
      balance: advanceBalance(advance, payments, invById),
      adjustments: liveAdjustments(advance.id, payments, invById).map((payment) => ({
        payment,
        invoiceNumber: invById.get(payment.invoice_id)?.invoice_number ?? '',
      })),
    }));
}

export function advancesCsv(rows: readonly AdvanceRow[]): string {
  const out: (string | number)[][] = [[
    'Voucher', 'Date', 'Client', 'Client GSTIN', 'Place of supply', 'Goods / services', 'Rate %', 'Amount received',
    'Taxable value', 'IGST', 'CGST', 'SGST', 'Adjusted', 'Refunded', 'Unadjusted', 'Method', 'Reference',
  ]];
  for (const { advance: a, balance: b } of rows) {
    out.push([
      a.number, a.date, a.client.name, a.client.gstin ?? '', a.place_of_supply, a.supply, a.tax_rate, a.amount,
      a.tax.taxable, a.tax.igst, a.tax.cgst, a.tax.sgst, b.adjusted, b.refunded, b.open, a.method, a.reference ?? '',
    ]);
  }
  out.push(['Working paper: GST on advances follows the rules in force on each date. Verify with your CA.']);
  return toCsv(out);
}

/* ── Printable vouchers (script-free HTML) ──────────────────── */


const VOUCHER_STYLE = `
  body { font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; color: #111; margin: 0; padding: 32px; }
  .sheet { max-width: 680px; margin: 0 auto; border: 1px solid #ccc; padding: 28px 32px; }
  h1 { font-size: 20px; letter-spacing: 0.08em; text-transform: uppercase; margin: 0 0 4px; }
  .muted { color: #555; font-size: 13px; }
  .head { display: flex; justify-content: space-between; gap: 16px; border-bottom: 2px solid #111; padding-bottom: 12px; margin-bottom: 16px; }
  .amount { font-size: 28px; font-weight: 700; margin: 12px 0 2px; font-variant-numeric: tabular-nums; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 14px; }
  th { text-align: left; color: #555; font-weight: 500; width: 42%; padding: 6px 0; vertical-align: top; }
  td { padding: 6px 0; font-variant-numeric: tabular-nums; }
  .sign { margin-top: 48px; text-align: right; font-size: 13px; }
  .note { margin-top: 24px; font-size: 11px; color: #777; }
  @media print { body { padding: 0; } .sheet { border: 0; } }`;

function voucherShell(title: string, number: string, date: string, adv: AdvanceRecord, body: string, note: string): string {
  const s = adv.sender;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} ${esc(number)}</title>
<style>${VOUCHER_STYLE}</style></head>
<body><div class="sheet">
  <div class="head">
    <div><h1>${esc(title)}</h1><div class="muted">${esc(number)} · ${esc(formatDate(date))}</div></div>
    <div style="text-align:right"><strong>${esc(s?.companyName ?? '')}</strong>
      ${s?.companyGstin ? `<div class="muted">GSTIN ${esc(s.companyGstin)}</div>` : ''}
      ${s?.companyAddress ? `<div class="muted">${esc(s.companyAddress).replace(/\n/g, '<br>')}</div>` : ''}</div>
  </div>
  ${body}
  <div class="sign">For ${esc(s?.companyName ?? '')}<br><br><br>Authorised signatory</div>
  <div class="note">${esc(note)} Produced on the issuer's device; verify GST treatment with your CA.</div>
</div></body></html>`;
}

function taxRows(a: AdvanceRecord, heads: { igst: number; cgst: number; sgst: number }, row: (k: string, v: string) => string, m: (n: number) => string): string {
  if (!a.tax.applies) {
    return row('GST on this advance', esc(a.supply === 'goods' ? 'Not payable: advance for goods (Notification 66/2017-CT)' : 'Not payable (zero-rated / nil rate)'));
  }
  return [
    row('Rate of tax', esc(`${a.tax_rate}%`)),
    heads.igst ? row('IGST', m(heads.igst)) : '',
    heads.cgst ? row(`CGST @ ${a.tax_rate / 2}%`, m(heads.cgst)) : '',
    heads.sgst ? row(`SGST / UTGST @ ${a.tax_rate / 2}%`, m(heads.sgst)) : '',
  ].join('');
}

/** Receipt Voucher (CGST Rule 50) for an advance. */
export function advanceVoucherHtml(a: AdvanceRecord): string {
  const m = (n: number) => esc(formatCurrency(n, 'INR'));
  const row = (k: string, v: string) => (v ? `<tr><th>${esc(k)}</th><td>${v}</td></tr>` : '');
  const body = `
  <div class="muted">Received from</div>
  <div style="font-size:16px;font-weight:600">${esc(a.client.name)}</div>
  ${a.client.gstin ? `<div class="muted">GSTIN ${esc(a.client.gstin)}</div>` : ''}
  ${a.client.address ? `<div class="muted">${esc(a.client.address).replace(/\n/g, '<br>')}</div>` : ''}
  <div class="amount">${m(a.amount)}</div>
  <div class="muted">${esc(amountInWords(a.amount, 'INR'))}</div>
  <table>
    ${row('Description of supply', esc(a.description || (a.supply === 'goods' ? 'Advance against supply of goods' : 'Advance against supply of services')))}
    ${row('Place of supply', esc(formatPlaceOfSupply(a.place_of_supply) || (a.place_of_supply === '96' || a.place_of_supply === '99' ? '96 — Other Countries' : a.place_of_supply)))}
    ${a.tax.applies ? row('Taxable value', m(a.tax.taxable)) : ''}
    ${taxRows(a, a.tax, row, m)}
    ${row('Tax payable on reverse charge', 'No')}
    ${row('Payment method', esc(a.method))}
    ${row('Reference / UTR', esc(a.reference ?? ''))}
  </table>`;
  return voucherShell('Receipt voucher', a.number, a.date, a, body,
    'Receipt voucher for an advance under Rule 50 of the CGST Rules. The tax invoice will show this advance as adjusted.');
}

/** Refund Voucher (CGST Rule 51) against an advance. */
export function refundVoucherHtml(a: AdvanceRecord, r: AdvanceRefund, heads: { igst: number; cgst: number; sgst: number } = { igst: 0, cgst: 0, sgst: 0 }): string {
  const m = (n: number) => esc(formatCurrency(n, 'INR'));
  const row = (k: string, v: string) => (v ? `<tr><th>${esc(k)}</th><td>${v}</td></tr>` : '');
  const body = `
  <div class="muted">Refunded to</div>
  <div style="font-size:16px;font-weight:600">${esc(a.client.name)}</div>
  ${a.client.gstin ? `<div class="muted">GSTIN ${esc(a.client.gstin)}</div>` : ''}
  <div class="amount">${m(r.amount)}</div>
  <div class="muted">${esc(amountInWords(r.amount, 'INR'))}</div>
  <table>
    ${row('Against receipt voucher', esc(`${a.number} dated ${formatDate(a.date)}`))}
    ${row('Description of supply', esc(a.description || (a.supply === 'goods' ? 'Advance against supply of goods' : 'Advance against supply of services')))}
    ${row('Place of supply', esc(formatPlaceOfSupply(a.place_of_supply) || a.place_of_supply))}
    ${taxRows(a, heads, row, m)}
    ${row('Tax payable on reverse charge', 'No')}
    ${row('Payment method', esc(r.method))}
    ${row('Reference / UTR', esc(r.reference ?? ''))}
  </table>`;
  return voucherShell('Refund voucher', r.number, r.date, a, body,
    'Refund voucher under Rule 51 of the CGST Rules for an advance against which no supply was made.');
}
