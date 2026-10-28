/**
 * Reverse-charge documents the RECIPIENT issues (7O, 7.92) — table `rcm_documents`:
 *
 *  - Self-invoice (Sec 31(3)(f), Rule 46 — "46(f)" in the roadmap) for supplies received from an UNREGISTERED
 *    supplier on which we pay the tax under reverse charge (Sec 9(3) / 9(4)). Series `RCM/FY<yy-yy>/<seq>`
 *    (16 characters, unique per Indian FY — Rule 46(b)). One per bill, or one consolidated invoice for a month's
 *    bills (`consolidated_month`: verify with your CA that the consolidated route is open to you).
 *    Time limit: `rcmSelfInvoiceDays` (gst-penalties.ts — Rule 47A, 30 days from receipt from 1 Nov 2024).
 *  - Payment voucher (Sec 31(3)(g), Rule 52) when paying the supplier of a reverse-charge supply. Series
 *    `RPV/FY<yy-yy>/<seq>`.
 *
 * Numbers come from `nextSeriesNumberFor` + `recordSeries` (series-counters.ts) so a deleted number is never
 * re-issued. These documents are records only: the tax itself is already in the books through the bill
 * (Cr GST payable — reverse charge) and in GSTR-3B 3.1(d) / 4A(3); nothing here posts to the ledger.
 *
 * Pure above the "Storage" divider. Printable (script-free HTML). Working paper — verify with your CA.
 */

import { requireAccess } from './access';
import { audit } from './audit';
import { isoDay } from './dates';
import { rcmSelfInvoiceDays } from './gst-penalties';
import { checkGstin } from './gstin';
import { stateByCode } from './india-states';
import { num, round2 } from './invoice-calc';
import { assertUnlocked } from './period-lock';
import { isVoidStatus, readPurchase, readPurchaseLines, splitLumpTax, supplierPayableOf } from './purchase-normalize';
import { nextSeriesNumberFor, recordSeries } from './series-counters';
import { generateId, getTable, setTable } from './storage';
import { amountInWords } from './amount-in-words';
import { esc } from './voucher-print';

export const RCM_DOCS_TABLE = 'rcm_documents';
export const SELF_INVOICE_PREFIX = 'RCM';
export const PAYMENT_VOUCHER_PREFIX = 'RPV';
/** Rule 46(b): a consecutive serial number "not exceeding sixteen characters". */
export const RCM_NUMBER_MAX = 16;

export const RCM_DISCLAIMER = 'Working paper — self-invoice / payment voucher prepared offline for reverse-charge supplies. Not validated against the GST portal; verify the contents, series and time limits with your CA.';

export type RcmDocKind = 'SELF_INVOICE' | 'PAYMENT_VOUCHER';

export interface RcmParty {
  name: string;
  address?: string;
  gstin?: string;
  state_code?: string;
}

export interface RcmLine {
  /** The bill this line comes from. */
  purchase_id: string;
  bill_number?: string;
  bill_date?: string;
  description: string;
  hsn?: string;
  quantity?: number;
  unit?: string;
  taxable: number;
  /** GST rate % (0 when the bill carries none). */
  rate: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
}

export interface RcmDocument {
  id: string;
  kind: RcmDocKind;
  /** `RCM/FY<yy-yy>/<seq>` or `RPV/FY<yy-yy>/<seq>` (Indian FY of `date`). */
  number: string;
  /** Local day YYYY-MM-DD. */
  date: string;
  purchase_ids: string[];
  /** Set on a consolidated monthly self-invoice: the month (`YYYY-MM`) it covers. */
  consolidated_month?: string;
  /** Supplier (unregistered, so normally no GSTIN); "Various suppliers" on a consolidated invoice with several. */
  supplier: RcmParty;
  /** Us — snapshot of the sender profile when the document was made. */
  recipient: RcmParty;
  /** Two-digit place-of-supply state code. */
  place_of_supply: string;
  lines: RcmLine[];
  taxable: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
  /** taxable + all tax. */
  total: number;
  /** Payment voucher: amount paid to the supplier, and the payment row it records (optional). */
  amount_paid?: number;
  payment_id?: string;
  notes?: string;
  created_at?: string;
  updated_at?: string;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/* ── Pure ─────────────────────────────────────────────────────── */

export interface RcmBill {
  id: string;
  number: string;
  date: string;
  supplierName: string;
  supplierGstin: string;
  /** Unregistered supplier (no valid GSTIN): a self-invoice is required. */
  unregistered: boolean;
  taxable: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
  /** What the supplier is owed (total less the self-assessed tax and TDS). */
  supplierPayable: number;
  /** Self-invoice already issued for it (number), else ''. */
  selfInvoice: string;
  /** Payment vouchers issued for it. */
  vouchers: string[];
  /** Last day for the self-invoice (Rule 47A), '' when no limit applies. */
  selfInvoiceDue: string;
}

const addDays = (day: string, n: number): string => {
  const [y, m, d] = day.split('-').map(Number);
  const t = new Date(y, m - 1, d + n);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
};

/** Last day to issue the self-invoice for a supply received on `receivedOn` ('' = no limit in the rules). */
export function selfInvoiceDueDate(receivedOn: string): string {
  const days = rcmSelfInvoiceDays(receivedOn);
  return days === null || !isoDay(receivedOn) ? '' : addDays(receivedOn, days);
}

/**
 * Reverse-charge bills (domestic — imports have the Bill of Entry / their own route) with the documents already
 * issued for them, newest first. `unregisteredOnly` (default) keeps only suppliers without a valid GSTIN.
 */
export function rcmBills(purchases: readonly unknown[], docs: readonly RcmDocument[], unregisteredOnly = true): RcmBill[] {
  const out: RcmBill[] = [];
  for (const raw of purchases) {
    const c = readPurchase(raw);
    if (!c || isVoidStatus(c.status) || !c.reverseCharge || c.importType) continue;
    const unregistered = !checkGstin(c.partyGstin).valid;
    if (unregisteredOnly && !unregistered) continue;
    const heads = splitLumpTax(c, raw, c.placeOfSupply);
    const mine = docs.filter((d) => d.purchase_ids.includes(c.id));
    out.push({
      id: c.id,
      number: c.number,
      date: c.date,
      supplierName: c.partyName,
      supplierGstin: c.partyGstin,
      unregistered,
      taxable: heads.taxable,
      igst: heads.igst,
      cgst: heads.cgst,
      sgst: heads.sgst,
      cess: c.cess,
      supplierPayable: supplierPayableOf(c),
      selfInvoice: mine.find((d) => d.kind === 'SELF_INVOICE')?.number ?? '',
      vouchers: mine.filter((d) => d.kind === 'PAYMENT_VOUCHER').map((d) => d.number),
      selfInvoiceDue: selfInvoiceDueDate(c.date),
    });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number));
}

/** One line per bill line (tax spread by value), or one line for the whole bill when it has no lines. */
export function linesOfBill(raw: unknown): RcmLine[] {
  const c = readPurchase(raw);
  if (!c) return [];
  const heads = splitLumpTax(c, raw, c.placeOfSupply);
  const base = { purchase_id: c.id, ...(c.number ? { bill_number: c.number } : {}), bill_date: c.date };
  const lines = readPurchaseLines(raw).filter((l) => l.quantity * l.unitCost > 0);
  const total = lines.reduce((t, l) => t + l.quantity * l.unitCost, 0);
  const rateOf = (taxable: number) => (taxable > 0 ? round2(((heads.igst + heads.cgst + heads.sgst) * 100) / taxable) : 0);
  if (!lines.length || !(total > 0)) {
    return [{ ...base, description: c.category || 'Supply received', taxable: heads.taxable, rate: rateOf(heads.taxable), igst: heads.igst, cgst: heads.cgst, sgst: heads.sgst, cess: c.cess }];
  }
  // Spread the bill's actual heads over the lines by value; the last line takes the rounding so totals match.
  const out: RcmLine[] = [];
  const acc = { taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 };
  lines.forEach((l, i) => {
    const last = i === lines.length - 1;
    const share = (l.quantity * l.unitCost) / total;
    const part = (k: keyof typeof acc, whole: number) => (last ? round2(whole - acc[k]) : round2(whole * share));
    const row = { taxable: part('taxable', heads.taxable), igst: part('igst', heads.igst), cgst: part('cgst', heads.cgst), sgst: part('sgst', heads.sgst), cess: part('cess', c.cess) };
    for (const k of Object.keys(acc) as (keyof typeof acc)[]) acc[k] = round2(acc[k] + row[k]);
    out.push({
      ...base,
      description: l.name || c.category || 'Supply received',
      ...(l.hsn ? { hsn: l.hsn } : {}),
      quantity: round2(l.quantity),
      ...(l.unit ? { unit: l.unit } : {}),
      ...row,
      rate: l.taxRate || rateOf(row.taxable),
    });
  });
  return out;
}

const sumLines = (lines: readonly RcmLine[]) => {
  const t = { taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 };
  for (const l of lines) for (const k of Object.keys(t) as (keyof typeof t)[]) t[k] = round2(t[k] + num(l[k]));
  return { ...t, total: round2(t.taxable + t.igst + t.cgst + t.sgst + t.cess) };
};

export interface SelfInvoiceInput {
  date: string;
  number: string;
  recipient: RcmParty;
  /** Bills (raw `purchases` rows). Several = a consolidated invoice; give `consolidatedMonth` then. */
  bills: readonly unknown[];
  consolidatedMonth?: string;
  notes?: string;
}

/** Problems with a self-invoice draft ('' = fine). */
export function validateSelfInvoice(i: SelfInvoiceInput, docs: readonly RcmDocument[]): string {
  if (!isoDay(i.date)) return 'Choose the self-invoice date.';
  if (!i.number.trim()) return 'The self-invoice needs a number.';
  if (i.number.trim().length > RCM_NUMBER_MAX) return `The number may have at most ${RCM_NUMBER_MAX} characters (Rule 46).`;
  if (docs.some((d) => d.number.toUpperCase() === i.number.trim().toUpperCase())) return `Number ${i.number.trim()} is already used.`;
  if (!i.bills.length) return 'Choose at least one reverse-charge bill.';
  const ids = new Set<string>();
  for (const raw of i.bills) {
    const c = readPurchase(raw);
    if (!c || isVoidStatus(c.status)) return 'A chosen bill is not a live bill.';
    if (!c.reverseCharge || c.importType) return `Bill ${c.number || c.id} is not a domestic reverse-charge bill.`;
    if (c.date > isoDay(i.date)) return `Bill ${c.number || c.id} is dated after the self-invoice.`;
    if (docs.some((d) => d.kind === 'SELF_INVOICE' && d.purchase_ids.includes(c.id))) return `Bill ${c.number || c.id} already has a self-invoice.`;
    ids.add(c.id);
  }
  if (i.bills.length > 1) {
    const month = i.consolidatedMonth ?? '';
    if (!/^\d{4}-\d{2}$/.test(month)) return 'A consolidated self-invoice covers one month: choose it.';
    for (const raw of i.bills) if (readPurchase(raw)!.date.slice(0, 7) !== month) return 'Every bill of a consolidated self-invoice must be of the chosen month.';
  }
  return '';
}

/** The self-invoice a draft stands for (pure; id / timestamps filled in by the caller). */
export function buildSelfInvoice(i: SelfInvoiceInput): Omit<RcmDocument, 'id'> {
  const cores = i.bills.map((raw) => readPurchase(raw)!).filter(Boolean);
  const lines = i.bills.flatMap((raw) => linesOfBill(raw));
  const t = sumLines(lines);
  const names = [...new Set(cores.map((c) => c.partyName).filter(Boolean))];
  const first = cores[0];
  const supplierState = first ? checkGstin(first.partyGstin).stateCode ?? first.vendorStateCode : '';
  const pos = (first?.placeOfSupply || i.recipient.state_code || supplierState || '').slice(0, 2);
  return {
    kind: 'SELF_INVOICE',
    number: i.number.trim(),
    date: isoDay(i.date),
    purchase_ids: cores.map((c) => c.id),
    ...(i.bills.length > 1 && i.consolidatedMonth ? { consolidated_month: i.consolidatedMonth } : {}),
    supplier: names.length === 1
      ? { name: names[0], ...(first?.partyGstin ? { gstin: first.partyGstin } : {}), ...(supplierState ? { state_code: supplierState } : {}) }
      : { name: `Various unregistered suppliers (${names.length})` },
    recipient: i.recipient,
    place_of_supply: pos,
    lines,
    ...t,
    ...(i.notes?.trim() ? { notes: i.notes.trim() } : {}),
  };
}

export interface PaymentVoucherInput {
  date: string;
  number: string;
  recipient: RcmParty;
  bill: unknown;
  /** Amount paid to the supplier (₹). */
  amount: number;
  paymentId?: string;
  notes?: string;
}

/** Amount already covered by payment vouchers for the bill (₹). */
export function voucheredFor(docs: readonly RcmDocument[], billId: string, excludeId?: string): number {
  return round2(docs.filter((d) => d.kind === 'PAYMENT_VOUCHER' && d.id !== excludeId && d.purchase_ids.includes(billId)).reduce((t, d) => t + num(d.amount_paid), 0));
}

export function validatePaymentVoucher(i: PaymentVoucherInput, docs: readonly RcmDocument[]): string {
  if (!isoDay(i.date)) return 'Choose the payment date.';
  if (!i.number.trim()) return 'The payment voucher needs a number.';
  if (i.number.trim().length > RCM_NUMBER_MAX) return `The number may have at most ${RCM_NUMBER_MAX} characters.`;
  if (docs.some((d) => d.number.toUpperCase() === i.number.trim().toUpperCase())) return `Number ${i.number.trim()} is already used.`;
  const c = readPurchase(i.bill);
  if (!c || isVoidStatus(c.status)) return 'Choose a live bill.';
  if (!c.reverseCharge || c.importType) return `Bill ${c.number || c.id} is not a domestic reverse-charge bill.`;
  if (!(num(i.amount) > 0)) return 'Enter the amount paid.';
  const left = round2(supplierPayableOf(c) - voucheredFor(docs, c.id));
  if (num(i.amount) > left + 0.004) return `The amount is more than what is left to pay on the bill (₹${Math.max(left, 0).toFixed(2)}).`;
  return '';
}

/**
 * Rule 52 payment voucher for a payment of `amount` against a reverse-charge bill: the bill's lines scaled by
 * amount ÷ what the supplier is owed (so the tax shown is the tax on the part paid).
 */
export function buildPaymentVoucher(i: PaymentVoucherInput): Omit<RcmDocument, 'id'> {
  const c = readPurchase(i.bill)!;
  const payable = supplierPayableOf(c);
  const share = payable > 0 ? Math.min(num(i.amount) / payable, 1) : 0;
  const lines = linesOfBill(i.bill).map((l) => ({
    ...l,
    taxable: round2(l.taxable * share),
    igst: round2(l.igst * share),
    cgst: round2(l.cgst * share),
    sgst: round2(l.sgst * share),
    cess: round2(l.cess * share),
    ...(l.quantity !== undefined ? { quantity: round2(l.quantity * share) } : {}),
  }));
  const supplierState = checkGstin(c.partyGstin).stateCode ?? c.vendorStateCode;
  return {
    kind: 'PAYMENT_VOUCHER',
    number: i.number.trim(),
    date: isoDay(i.date),
    purchase_ids: [c.id],
    supplier: { name: c.partyName, ...(c.partyGstin ? { gstin: c.partyGstin } : {}), ...(supplierState ? { state_code: supplierState } : {}) },
    recipient: i.recipient,
    place_of_supply: (c.placeOfSupply || i.recipient.state_code || supplierState || '').slice(0, 2),
    lines,
    ...sumLines(lines),
    amount_paid: round2(num(i.amount)),
    ...(i.paymentId ? { payment_id: i.paymentId } : {}),
    ...(i.notes?.trim() ? { notes: i.notes.trim() } : {}),
  };
}

/** Next number of a series for `date` (above every stored number and the high-water mark). */
export function nextRcmNumber(kind: RcmDocKind, date: string, docs: readonly RcmDocument[]): string {
  const prefix = kind === 'SELF_INVOICE' ? SELF_INVOICE_PREFIX : PAYMENT_VOUCHER_PREFIX;
  return nextSeriesNumberFor(prefix, date, docs.filter((d) => d.kind === kind).map((d) => d.number));
}

/* ── Print ────────────────────────────────────────────────────── */

const money = (n: number) => esc(round2(n).toFixed(2));
const stateLabel = (code?: string) => (code ? `${code}${stateByCode(code)?.name ? ` — ${stateByCode(code)!.name}` : ''}` : '—');

const PRINT_CSS = `
  body { font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; color: #111; margin: 0; padding: 24px; }
  .doc { max-width: 820px; margin: 0 auto 28px; border: 1px solid #222; break-after: page; page-break-after: always; }
  .doc:last-child { break-after: auto; page-break-after: auto; }
  h1 { margin: 0; font-size: 17px; text-align: center; padding: 10px; border-bottom: 1px solid #222; letter-spacing: 0.06em; text-transform: uppercase; }
  .rc { text-align: center; font-size: 12px; padding: 4px; border-bottom: 1px solid #222; }
  .parties { display: grid; grid-template-columns: 1fr 1fr; border-bottom: 1px solid #222; font-size: 12px; }
  .parties div { padding: 8px 12px; white-space: pre-line; }
  .parties div + div { border-left: 1px solid #222; }
  .meta { display: flex; flex-wrap: wrap; gap: 4px 24px; padding: 8px 12px; font-size: 12px; border-bottom: 1px solid #222; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th, td { padding: 5px 6px; border-bottom: 1px solid #ccc; text-align: left; vertical-align: top; }
  th { font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; border-bottom: 1px solid #222; }
  td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  tr.total td { font-weight: 700; border-top: 1px solid #222; }
  .words, .notes { padding: 8px 12px; font-size: 12px; border-top: 1px solid #222; }
  .sign { display: flex; justify-content: flex-end; padding: 40px 12px 10px; font-size: 12px; border-top: 1px solid #222; }
  .wp { max-width: 820px; margin: 0 auto; font-size: 10px; color: #666; }
`;

function docSection(d: RcmDocument): string {
  const title = d.kind === 'SELF_INVOICE' ? 'Tax invoice (self-invoice) — reverse charge' : 'Payment voucher — reverse charge';
  const rule = d.kind === 'SELF_INVOICE' ? 'Issued by the recipient under Sec 31(3)(f) read with Rule 46 of the CGST Rules' : 'Issued by the recipient under Sec 31(3)(g) read with Rule 52 of the CGST Rules';
  const party = (label: string, p: RcmParty) => `<div><strong>${esc(label)}</strong>\n${esc(p.name)}${p.address ? `\n${esc(p.address)}` : ''}\nGSTIN: ${esc(p.gstin || 'Unregistered')}\nState: ${esc(stateLabel(p.state_code))}</div>`;
  const rows = d.lines.map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.description)}${l.bill_number ? `<br><small>Bill ${esc(l.bill_number)}${l.bill_date ? ` dt ${esc(l.bill_date)}` : ''}</small>` : ''}</td><td>${esc(l.hsn ?? '')}</td><td class="n">${l.quantity !== undefined ? esc(String(l.quantity)) : ''} ${esc(l.unit ?? '')}</td><td class="n">${money(l.taxable)}</td><td class="n">${esc(String(l.rate))}%</td><td class="n">${money(l.igst)}</td><td class="n">${money(l.cgst)}</td><td class="n">${money(l.sgst)}</td><td class="n">${money(l.cess)}</td></tr>`).join('');
  const tax = round2(d.igst + d.cgst + d.sgst + d.cess);
  return `<section class="doc">
  <h1>${esc(title)}</h1>
  <div class="rc">Tax payable on reverse charge: <strong>Yes</strong> · ${esc(rule)}</div>
  <div class="parties">${party(d.kind === 'SELF_INVOICE' ? 'Supplier' : 'Paid to (supplier)', d.supplier)}${party('Recipient (issuer)', d.recipient)}</div>
  <div class="meta"><span>No.: <strong>${esc(d.number)}</strong></span><span>Date: <strong>${esc(d.date)}</strong></span><span>Place of supply: <strong>${esc(stateLabel(d.place_of_supply))}</strong></span>${d.consolidated_month ? `<span>Consolidated for: <strong>${esc(d.consolidated_month)}</strong></span>` : ''}${d.amount_paid !== undefined ? `<span>Amount paid: <strong>₹${money(d.amount_paid)}</strong></span>` : ''}</div>
  <table><thead><tr><th>#</th><th>Description</th><th>HSN / SAC</th><th class="n">Qty</th><th class="n">Taxable (₹)</th><th class="n">Rate</th><th class="n">IGST</th><th class="n">CGST</th><th class="n">SGST / UTGST</th><th class="n">Cess</th></tr></thead>
  <tbody>${rows}<tr class="total"><td></td><td colspan="3">Total</td><td class="n">${money(d.taxable)}</td><td></td><td class="n">${money(d.igst)}</td><td class="n">${money(d.cgst)}</td><td class="n">${money(d.sgst)}</td><td class="n">${money(d.cess)}</td></tr></tbody></table>
  <div class="words"><strong>Tax payable by the recipient (in words):</strong> ${esc(amountInWords(tax))}</div>
  ${d.notes ? `<div class="notes">${esc(d.notes)}</div>` : ''}
  <div class="sign">For ${esc(d.recipient.name || 'the recipient')} — Authorised signatory</div>
</section>`;
}

/** A complete print document (one document per page). */
export function rcmDocsHtml(docs: readonly RcmDocument[], title = 'Reverse-charge documents'): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><style>${PRINT_CSS}</style></head>
<body>
${docs.map(docSection).join('\n')}
<p class="wp">${esc(RCM_DISCLAIMER)}</p>
</body></html>`;
}

/* ── Storage ──────────────────────────────────────────────────── */

export class RcmDocError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RcmDocError';
  }
}

export function normalizeRcmDocs(rows: readonly unknown[]): RcmDocument[] {
  const out: RcmDocument[] = [];
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Partial<RcmDocument>;
    if (typeof o.id !== 'string' || (o.kind !== 'SELF_INVOICE' && o.kind !== 'PAYMENT_VOUCHER') || !isoDay(o.date) || !str(o.number)) continue;
    out.push({ ...(o as RcmDocument), purchase_ids: Array.isArray(o.purchase_ids) ? o.purchase_ids.filter((x): x is string => typeof x === 'string') : [], lines: Array.isArray(o.lines) ? o.lines : [] });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number));
}

export const rcmDocsDb = {
  all: (): RcmDocument[] => normalizeRcmDocs(getTable<unknown>(RCM_DOCS_TABLE)),

  /** Save a new self-invoice or payment voucher (access, period lock, number series, audit). */
  create(kind: RcmDocKind, input: SelfInvoiceInput | PaymentVoucherInput): RcmDocument {
    requireAccess('books.edit');
    const docs = rcmDocsDb.all();
    const problem = kind === 'SELF_INVOICE' ? validateSelfInvoice(input as SelfInvoiceInput, docs) : validatePaymentVoucher(input as PaymentVoucherInput, docs);
    if (problem) throw new RcmDocError(problem);
    const built = kind === 'SELF_INVOICE' ? buildSelfInvoice(input as SelfInvoiceInput) : buildPaymentVoucher(input as PaymentVoucherInput);
    assertUnlocked({ issue_date: built.date, invoice_number: built.number }, 'create');
    const row: RcmDocument = { ...built, id: generateId(), created_at: new Date().toISOString() };
    setTable(RCM_DOCS_TABLE, [...getTable<unknown>(RCM_DOCS_TABLE), row]);
    recordSeries(row.number);
    audit.record({
      entity: 'gst',
      entity_id: row.id,
      action: 'create',
      doc_number: row.number,
      summary: `${kind === 'SELF_INVOICE' ? 'RCM self-invoice' : 'RCM payment voucher'} ${row.number} dated ${row.date} for ${row.supplier.name}: taxable ₹${row.taxable.toFixed(2)}, tax ₹${round2(row.igst + row.cgst + row.sgst + row.cess).toFixed(2)}${row.consolidated_month ? ` (consolidated ${row.consolidated_month})` : ''}`,
    });
    return row;
  },

  /** Delete a document (the number is never re-issued: series-counters keeps the high-water mark). */
  remove(id: string): void {
    const docs = rcmDocsDb.all();
    const d = docs.find((x) => x.id === id);
    if (!d) return;
    requireAccess('books.edit');
    assertUnlocked({ issue_date: d.date, invoice_number: d.number }, 'delete');
    setTable(RCM_DOCS_TABLE, getTable<{ id?: string }>(RCM_DOCS_TABLE).filter((x) => x?.id !== id));
    audit.record({ entity: 'gst', entity_id: id, action: 'delete', doc_number: d.number, summary: `Deleted ${d.kind === 'SELF_INVOICE' ? 'RCM self-invoice' : 'RCM payment voucher'} ${d.number} (${d.supplier.name})` });
  },
};
