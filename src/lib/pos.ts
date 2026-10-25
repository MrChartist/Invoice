/**
 * POS quick bill (roadmap 6.8 / 5.5): counter billing that ends in a normal invoice.
 *
 *  - `buildPosRecord` turns a cart into an `InvoiceRecord` from the same draft factory as the
 *    editor (`makeDraft`: doc type per profile — a composition profile issues a Bill of Supply —
 *    round-off, terms) and the same calculator (`calculateInvoice`). A walk-in customer's place of
 *    supply is the business's own state.
 *  - `tenderSummary` is the split-tender / change maths (cash, UPI, card; change only from cash).
 *  - `savePosBill` checks batches / serials (FEFO auto-pick and split, serial count), numbers the
 *    bill in the FY series of its doc type and saves it through `localDb.invoices.save` (period
 *    lock, duplicate-number guard, audit, catalogue learning — the store's `saveInvoice` ends in the
 *    same call), then records one payment per tender with `localDb.payments.record`. Stock is
 *    derived from invoice lines, so the saved bill is the stock-out.
 *  - `zReport` / `pos_day_close`: the day-end Z report and the cash-drawer count.
 */

import type { Client, DocumentType, InvoiceItem, InvoiceRecord, Payment, SenderProfile } from '../types/invoice';
import { calcInputFromRecord, calculateInvoice, buildSlabs, num, round2, type CalcLine, type TaxSlabRow } from './invoice-calc';
import { localDb, type AppSettings } from './localDb';
import { makeDraft, senderStateCode } from '../store/invoice-defaults';
import { resolveStateCode } from './india-states';
import { customFieldsDb, finalizeValues } from './custom-fields';
import { isPeriodLockedError } from './period-lock';
import { requireAccess } from './access';
import { audit } from './audit';
import { generateId, getTable, setTable } from './storage';
import {
  batchOptions, editorStockContext, liveDocTrackingIssues, withBatch,
  type EditorStockContext,
} from './stock-tracking';
import { toCsv } from './csv';
import { formatCurrency, formatDate } from './utils';
import { EXCHANGE_NOTE, applyExchange, openExchange, zReturns, type PosReturn, type ZReturns } from './pos-returns';

export const POS_DAY_CLOSE_TABLE = 'pos_day_close';
export const WALK_IN_NAME = 'Walk-in customer';

/* ── Tender maths ────────────────────────────────────────────── */

export type TenderMethod = 'Cash' | 'UPI' | 'Card';
export const TENDER_METHODS: TenderMethod[] = ['Cash', 'UPI', 'Card'];

export interface Tender {
  method: TenderMethod;
  amount: number;
  reference?: string;
  /** UPI / card: the bank account the money lands in (multi-account BRS). */
  bank_account_id?: string;
}

export interface TenderSummary {
  total: number;
  tendered: number;
  cash: number;
  nonCash: number;
  /** Cash handed back: tendered − total, never more than the cash given. */
  change: number;
  /** Still unpaid after every tender (0 when fully paid). */
  due: number;
  /** What is recorded as payments: one row per method with an amount, cash net of change. */
  payments: { method: TenderMethod; amount: number; reference?: string; bank_account_id?: string }[];
  /** Blocking problems ("UPI and card are more than the bill"). */
  errors: string[];
}

/** Split-tender maths for a bill of `total`. Amounts below zero count as zero. */
export function tenderSummary(total: number, tenders: readonly Tender[]): TenderSummary {
  const t = round2(Math.max(num(total), 0));
  const by = (m: TenderMethod) => round2(tenders.filter((x) => x.method === m).reduce((s, x) => s + Math.max(num(x.amount), 0), 0));
  const cash = by('Cash');
  const nonCash = round2(by('UPI') + by('Card'));
  const tendered = round2(cash + nonCash);
  const errors: string[] = [];
  if (nonCash > t + 0.004) errors.push('UPI and card together are more than the bill — only cash can be given back as change.');
  const change = nonCash > t ? 0 : round2(Math.max(tendered - t, 0));
  const due = round2(Math.max(t - tendered, 0));
  const payments: TenderSummary['payments'] = [];
  for (const m of TENDER_METHODS) {
    const rows = tenders.filter((x) => x.method === m && num(x.amount) > 0);
    if (!rows.length) continue;
    let amount = by(m);
    if (m === 'Cash') amount = round2(amount - change);
    if (amount <= 0) continue;
    const ref = rows.map((r) => r.reference?.trim()).filter(Boolean).join(', ');
    const bank = rows.find((r) => r.bank_account_id)?.bank_account_id;
    payments.push({ method: m, amount, ...(ref ? { reference: ref } : {}), ...(bank && m !== 'Cash' ? { bank_account_id: bank } : {}) });
  }
  return { total: t, tendered, cash, nonCash, change, due, payments, errors };
}

/* ── Building the bill ───────────────────────────────────────── */

export interface PosParty {
  /** A saved client; null / undefined = walk-in. */
  client?: Client | null;
  /** Walk-in details (optional): printed on the bill. */
  name?: string;
  phone?: string;
}

export interface PosBuildInput {
  items: InvoiceItem[];
  party: PosParty;
  settings: AppSettings;
  sender: SenderProfile | null;
  templateId?: string;
  /** Bill date (YYYY-MM-DD local day). */
  day: string;
  docType?: DocumentType;
  /**
   * The goods are dispatched to the saved client's state instead of being handed over at the counter.
   * Only then is the client's state the place of supply (IGST when it differs from the business's).
   */
  deliverToClientState?: boolean;
}

/** Copy the calculator's totals onto the record (as the editor store does after every edit). */
export function withTotals(rec: InvoiceRecord): InvoiceRecord {
  const totals = calculateInvoice(calcInputFromRecord(rec));
  return {
    ...rec,
    subtotal: totals.subtotal,
    discount_amount: totals.discount_amount,
    taxable_value: totals.taxable_value,
    cgst_amount: totals.cgst_amount,
    sgst_amount: totals.sgst_amount,
    igst_amount: totals.igst_amount,
    tax_amount: totals.tax_amount,
    round_off: totals.round_off,
    total: totals.total,
    balance_due: totals.balance_due,
    cess_amount: totals.cess_amount,
    tcs_amount: totals.tcs_amount,
    tds_amount: totals.tds_amount,
  };
}

/** The cart as an unsaved invoice (no number yet), totals filled in. */
export function buildPosRecord(input: PosBuildInput): InvoiceRecord {
  const draft = makeDraft({ settings: input.settings, sender: input.sender, docType: input.docType, templateId: input.templateId });
  const home = senderStateCode(input.sender);
  const c = input.party.client;
  const client: Client = c
    ? { ...draft.client, ...c }
    : {
        ...draft.client,
        name: input.party.name?.trim() || WALK_IN_NAME,
        phone: input.party.phone?.trim() ?? '',
        state_code: home,
      };
  delete client.custom_fields;
  delete client.credit_limit;
  delete client.credit_days;
  delete client.price_level;
  // Goods handed over at the counter: the place of supply is where delivery happens — the shop's state
  // (Sec 10(1)(a)/(c) IGST Act), even for a saved out-of-state client. Only an explicit dispatch to the
  // client's state makes that state the place of supply. Verify with your CA.
  const clientState = c ? resolveStateCode({ code: c.state_code, gstin: c.gstin, name: c.state }) : '';
  const place = c && input.deliverToClientState ? clientState || home : home;
  let gst_mode = draft.gst_mode;
  if (gst_mode === 'CGST_SGST' || gst_mode === 'IGST') gst_mode = place && home && place !== home ? 'IGST' : 'CGST_SGST';
  const items = input.items.filter((i) => i.name.trim() && num(i.quantity) > 0).map((i) => ({ ...i, amount: round2(num(i.quantity) * num(i.rate)) }));
  return withTotals({
    ...draft,
    issue_date: input.day,
    due_date: input.day,
    client,
    place_of_supply: place,
    gst_mode,
    items,
    notes: '',
    pos: true,
  });
}

/**
 * Batch lines (FEFO) and godowns for a bill about to be issued: a batch-tracked line without a
 * batch takes the unexpired batches in FEFO order (split over several lines when one batch does
 * not cover it; what the bill's earlier lines took is not offered again); a line whose batch was
 * picked by hand is left alone. With several godowns, tracked lines leave from the default godown.
 */
export function applyStockRules(items: InvoiceItem[], ctx: EditorStockContext | null, newId: () => string = generateId): InvoiceItem[] {
  if (!ctx) return items;
  const used = new Map<string, number>();
  const out: InvoiceItem[] = [];
  for (const raw of items) {
    const stock = raw.name.trim() ? ctx.find(raw.name, raw.hsn) : undefined;
    let line = raw;
    if (stock && ctx.multi && !line.godown_id) line = { ...line, godown_id: ctx.defaultGodown };
    const where = ctx.multi ? line.godown_id || ctx.defaultGodown : undefined;
    const key = (b: string) => `${stock?.id}|${where ?? ''}|${b.toUpperCase()}`;
    if (!stock?.track_batches || line.batch_no) {
      if (stock?.track_batches && line.batch_no) used.set(key(line.batch_no), (used.get(key(line.batch_no)) ?? 0) + num(line.quantity));
      out.push(line);
      continue;
    }
    const options = batchOptions(ctx.tracking.get(stock.id), ctx.day, where)
      .filter((o) => !o.expired)
      .map((o) => ({ ...o, qty: round2(o.qty - (used.get(key(o.batch)) ?? 0)) }))
      .filter((o) => o.qty > 1e-9);
    let rest = num(line.quantity);
    const parts: InvoiceItem[] = [];
    for (const o of options) {
      if (rest <= 1e-9) break;
      const take = Math.min(rest, o.qty);
      parts.push(withBatch({ ...line, id: parts.length ? newId() : line.id, quantity: round2(take) }, o));
      used.set(key(o.batch), (used.get(key(o.batch)) ?? 0) + take);
      rest = round2(rest - take);
    }
    if (parts.length === 0) {
      out.push(line); // nothing batched in stock: the issue check decides
      continue;
    }
    // Not enough in batches: the last part carries the shortfall (the issue check warns about it).
    if (rest > 1e-9) parts[parts.length - 1] = { ...parts[parts.length - 1], quantity: round2(parts[parts.length - 1].quantity + rest) };
    out.push(...parts.map((l) => ({ ...l, amount: round2(num(l.quantity) * num(l.rate)) })));
  }
  return out;
}

export interface PosSaveInput {
  record: InvoiceRecord;
  tenders: Tender[];
  /** The user confirmed selling an expired batch. */
  expiredOk?: boolean;
  /** A walk-in must pay in full; a saved client may leave a balance on account. */
  allowCredit?: boolean;
  /** Exchange (WP-9): an open `pos_returns` exchange whose credit pays part of this bill. */
  exchangeReturnId?: string;
}

export interface PosSaveResult {
  ok: boolean;
  errors: string[];
  /** Expired batches waiting for confirmation (call again with expiredOk). */
  expired?: string[];
  locked?: boolean;
  record?: InvoiceRecord;
  payments?: Payment[];
  summary?: TenderSummary;
}

/** Issue checks before anything is written. */
export function posIssues(rec: InvoiceRecord, summary: TenderSummary, allowCredit: boolean): string[] {
  const errors: string[] = [];
  if (!rec.sender?.companyName?.trim()) errors.push('Add your business profile in Settings first.');
  if (rec.items.length === 0) errors.push('Add at least one item.');
  if (!(rec.total > 0)) errors.push('The bill total is zero — check the rates.');
  errors.push(...summary.errors);
  if (!allowCredit && summary.due > 0.004) errors.push(`${formatCurrency(summary.due, rec.currency)} is still unpaid — take the rest, or pick a saved customer to leave it on account.`);
  return errors;
}

/** Save the bill as an invoice and record every tender as a payment. */
export function savePosBill(input: PosSaveInput): PosSaveResult {
  const ctx = editorStockContext({ doc_type: input.record.doc_type, issue_date: input.record.issue_date });
  let rec: InvoiceRecord = withTotals({ ...input.record, items: applyStockRules(input.record.items, ctx), status: 'Sent' });
  const exchange = input.exchangeReturnId ? openExchange(input.exchangeReturnId) : undefined;
  if (input.exchangeReturnId && !exchange) return { ok: false, errors: ['This exchange credit was already used.'] };
  const credit = exchange ? Math.min(exchange.amount, rec.total) : 0;
  const summary = tenderSummary(round2(rec.total - credit), input.tenders);
  const errors = posIssues(rec, summary, !!input.allowCredit);
  if (errors.length) return { ok: false, errors, summary };

  if (ctx) {
    const issues = liveDocTrackingIssues({ doc_type: rec.doc_type, status: 'Sent', issue_date: rec.issue_date, items: rec.items });
    if (issues.errors.length) return { ok: false, errors: issues.errors, summary };
    if (issues.expired.length && !input.expiredOk) return { ok: false, errors: [], expired: issues.expired, summary };
  }

  // Same finishing steps as the editor's save: custom-field snapshot, number from the profile's series.
  const defs = customFieldsDb.all();
  rec = {
    ...rec,
    items: rec.items.map((i) => {
      const values = finalizeValues(i.custom_values, defs, true);
      const next = { ...i };
      if (values) next.custom_values = values;
      else delete next.custom_values;
      return next;
    }),
  };
  if (!rec.invoice_number) {
    rec.invoice_number = localDb.invoices.nextNumber(rec.issue_date, rec.doc_type, rec.sender?.invoicePrefix || undefined);
  }

  let saved: InvoiceRecord;
  try {
    saved = localDb.invoices.save(rec);
  } catch (err) {
    return { ok: false, errors: [(err as Error).message], locked: isPeriodLockedError(err), summary };
  }
  const payments: Payment[] = [];
  try {
    if (exchange) {
      const x = applyExchange(exchange.id, saved);
      if (x.payment) payments.push(x.payment);
    }
    for (const p of summary.payments) {
      payments.push(
        localDb.payments.record({
          invoiceId: saved.id,
          amount: p.amount,
          method: p.method,
          reference: p.reference,
          date: saved.issue_date,
          note: 'POS',
          bankAccountId: p.bank_account_id,
        }),
      );
    }
  } catch (err) {
    return {
      ok: false,
      errors: [`${saved.invoice_number} was saved, but a payment could not be recorded: ${(err as Error).message}. Record it from Invoices.`],
      record: localDb.invoices.getById(saved.id) ?? saved,
      payments,
      summary,
    };
  }
  return { ok: true, errors: [], record: localDb.invoices.getById(saved.id) ?? saved, payments, summary };
}

/* ── Z report ────────────────────────────────────────────────── */

export interface ZReport {
  day: string;
  bills: number;
  cancelled: number;
  firstNumber: string;
  lastNumber: string;
  /** Σ quantity × rate before discounts. */
  gross: number;
  discounts: number;
  taxable: number;
  tax: number;
  cess: number;
  roundOff: number;
  /** Σ bill totals. */
  net: number;
  taxByRate: TaxSlabRow[];
  tenders: { cash: number; upi: number; card: number; other: number };
  /** Received against the day's bills on that day. */
  received: number;
  /** Left on account (saved customers). */
  credit: number;
  /** Returns of the day (credit notes raised from the POS return screen) and their refunds (WP-9). */
  returns: ZReturns;
  /** Exchange credit used to pay the day's bills (not new money: left out of the tenders). */
  exchangeIn: number;
  /** Net sales less the day's returns. */
  netAfterReturns: number;
}

const methodKey = (m: string): keyof ZReport['tenders'] => {
  const k = (m || '').trim().toLowerCase();
  return k === 'cash' ? 'cash' : k === 'upi' ? 'upi' : k === 'card' ? 'card' : 'other';
};

/**
 * Day-end totals of the POS bills dated `day`, the money taken for them that day, and the day's
 * returns (`pos_returns` rows) with their refunds by tender.
 */
export function zReport(day: string, invoices: readonly InvoiceRecord[], payments: readonly Payment[], returns: readonly PosReturn[] = []): ZReport {
  const mine = invoices.filter((i) => i.pos && i.issue_date === day);
  const live = mine.filter((i) => i.status !== 'Cancelled').sort((a, b) => a.invoice_number.localeCompare(b.invoice_number, undefined, { numeric: true }));
  const ids = new Set(live.map((i) => i.id));
  const r: ZReport = {
    day,
    bills: live.length,
    cancelled: mine.length - live.length,
    firstNumber: live[0]?.invoice_number ?? '',
    lastNumber: live[live.length - 1]?.invoice_number ?? '',
    gross: 0, discounts: 0, taxable: 0, tax: 0, cess: 0, roundOff: 0, net: 0,
    taxByRate: [],
    tenders: { cash: 0, upi: 0, card: 0, other: 0 },
    received: 0,
    credit: 0,
    returns: zReturns(day, returns, invoices),
    exchangeIn: 0,
    netAfterReturns: 0,
  };
  const lines: CalcLine[] = [];
  for (const inv of live) {
    const t = calculateInvoice(calcInputFromRecord(inv, { amount_paid: 0 }));
    r.gross += t.subtotal;
    r.discounts += t.discount_amount;
    r.taxable += t.taxable_value;
    r.tax += t.tax_amount;
    r.cess += t.cess_amount;
    r.roundOff += t.round_off;
    r.net += t.total;
    lines.push(...t.lines);
    if (t.charges_line) lines.push(t.charges_line);
  }
  r.taxByRate = buildSlabs(lines);
  for (const p of payments) {
    if (!ids.has(p.invoice_id) || p.date !== day) continue;
    if ((p.note || '').startsWith(EXCHANGE_NOTE)) {
      r.exchangeIn += num(p.amount);
      continue;
    }
    r.tenders[methodKey(p.method)] += num(p.amount);
  }
  for (const k of Object.keys(r.tenders) as (keyof ZReport['tenders'])[]) r.tenders[k] = round2(r.tenders[k]);
  for (const k of ['gross', 'discounts', 'taxable', 'tax', 'cess', 'roundOff', 'net'] as const) r[k] = round2(r[k]);
  r.received = round2(r.tenders.cash + r.tenders.upi + r.tenders.card + r.tenders.other);
  r.exchangeIn = round2(r.exchangeIn);
  r.netAfterReturns = round2(r.net - r.returns.value);
  r.credit = round2(live.reduce((s, i) => s + Math.max(num(i.balance_due), 0), 0));
  return r;
}

/* ── Day close (cash drawer) ─────────────────────────────────── */

export interface PosDayClose {
  id: string;
  /** YYYY-MM-DD */
  day: string;
  opening_float: number;
  /** opening float + cash taken (net of change) − cash refunded. */
  expected_cash: number;
  counted_cash: number;
  /** counted − expected (negative = short). */
  difference: number;
  bills: number;
  net: number;
  cash: number;
  upi: number;
  card: number;
  /** Additive (WP-9): cash handed back on returns that day. */
  cash_refunds?: number;
  note?: string;
  closed_at: string;
}

/** Drawer maths for a Z report. */
export function drawerCount(z: Pick<ZReport, 'tenders'> & { returns?: Pick<ZReturns, 'refunds'> }, openingFloat: number, counted: number): { expected: number; difference: number } {
  const expected = round2(Math.max(num(openingFloat), 0) + z.tenders.cash - num(z.returns?.refunds.cash));
  return { expected, difference: round2(num(counted) - expected) };
}

export const dayCloseDb = {
  all: (): PosDayClose[] => getTable<PosDayClose>(POS_DAY_CLOSE_TABLE),
  forDay: (day: string): PosDayClose | undefined => dayCloseDb.all().find((d) => d.day === day),
  /** Close (or re-close) a day: one record per day, the latest count wins. */
  close: (z: ZReport, openingFloat: number, counted: number, note?: string): PosDayClose => {
    requireAccess('payment.record');
    const { expected, difference } = drawerCount(z, openingFloat, counted);
    const all = dayCloseDb.all();
    const prev = all.find((d) => d.day === z.day);
    const row: PosDayClose = {
      id: prev?.id ?? generateId(),
      day: z.day,
      opening_float: round2(Math.max(num(openingFloat), 0)),
      expected_cash: expected,
      counted_cash: round2(num(counted)),
      difference,
      bills: z.bills,
      net: z.net,
      cash: z.tenders.cash,
      upi: z.tenders.upi,
      card: z.tenders.card,
      ...(z.returns?.refunds.cash ? { cash_refunds: z.returns.refunds.cash } : {}),
      ...(note?.trim() ? { note: note.trim() } : {}),
      closed_at: new Date().toISOString(),
    };
    setTable(POS_DAY_CLOSE_TABLE, [...all.filter((d) => d.day !== z.day), row].sort((a, b) => a.day.localeCompare(b.day)));
    try {
      audit.record({
        entity: 'pos_day_close', entity_id: row.id, action: prev ? 'update' : 'create',
        summary: `${prev ? 'Re-counted' : 'Closed'} POS day ${z.day}: counted ₹${row.counted_cash}, expected ₹${row.expected_cash}, difference ₹${row.difference}${prev ? ` (was counted ₹${prev.counted_cash})` : ''}`,
      });
    } catch {
      /* logging never breaks a save */
    }
    return row;
  },
};

/* ── Output ──────────────────────────────────────────────────── */

export function zReportCsv(z: ZReport, close?: PosDayClose): string {
  const rows: unknown[][] = [
    ['Z report', z.day],
    ['Bills', z.bills],
    ['Cancelled', z.cancelled],
    ['Bill numbers', z.firstNumber && `${z.firstNumber} – ${z.lastNumber}`],
    ['Gross sales', z.gross],
    ['Discounts', z.discounts],
    ['Taxable value', z.taxable],
    ['GST', z.tax],
    ['Cess', z.cess],
    ['Round-off', z.roundOff],
    ['Net sales', z.net],
    [],
    ['GST rate %', 'Taxable', 'CGST', 'SGST', 'IGST', 'Total tax'],
    ...z.taxByRate.map((s) => [s.rate, s.taxable, s.cgst, s.sgst, s.igst, s.tax]),
    [],
    ['Tender', 'Amount'],
    ['Cash', z.tenders.cash],
    ['UPI', z.tenders.upi],
    ['Card', z.tenders.card],
    ['Other', z.tenders.other],
    ['Received', z.received],
    ['On account', z.credit],
  ];
  if (z.returns?.count) {
    rows.push(
      [],
      ['Returns', z.returns.count],
      ['Credit notes', z.returns.numbers.join(' ')],
      ['Returns value', z.returns.value],
      ['Refund cash', z.returns.refunds.cash],
      ['Refund UPI', z.returns.refunds.upi],
      ['Refund card', z.returns.refunds.card],
      ['Exchanged on new bills', z.returns.exchanged],
      ['Kept on account', z.returns.onAccount],
      ['Net sales after returns', z.netAfterReturns],
    );
  }
  if (close) {
    rows.push([], ['Opening float', close.opening_float], ['Expected cash', close.expected_cash], ['Counted cash', close.counted_cash], ['Difference', close.difference]);
    if (close.note) rows.push(['Note', close.note]);
  }
  return toCsv(rows);
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

/** Script-free 80 mm HTML of the Z report, for a print window (or saving as a file). */
export function zReportHtml(z: ZReport, opts: { business?: string; close?: PosDayClose; printedAt?: string } = {}): string {
  const m = (n: number) => esc(formatCurrency(n));
  const row = (k: string, v: string, strong = false) => `<tr${strong ? ' class="b"' : ''}><td>${esc(k)}</td><td class="r">${v}</td></tr>`;
  const c = opts.close;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Z report ${esc(z.day)}</title>
<style>
@page { size: 80mm auto; margin: 0; }
body { width: 72mm; margin: 4mm; font: 12px/1.35 ui-monospace, Menlo, Consolas, monospace; color: black; background: white; }
h1 { font-size: 15px; text-align: center; margin: 0 0 2px; }
p { margin: 0; text-align: center; }
table { width: 100%; border-collapse: collapse; margin-top: 6px; }
td { padding: 1px 0; vertical-align: top; }
.r { text-align: right; white-space: nowrap; }
.b td { font-weight: 700; }
.sep td { border-top: 1px dashed black; padding-top: 3px; }
h2 { font-size: 12px; margin: 8px 0 0; border-bottom: 1px dashed black; }
.foot { margin-top: 8px; font-size: 10px; }
</style></head><body>
<h1>Z REPORT</h1>
${opts.business ? `<p>${esc(opts.business)}</p>` : ''}
<p>${esc(formatDate(z.day))}</p>
<table>
${row('Bills', String(z.bills))}
${z.cancelled ? row('Cancelled', String(z.cancelled)) : ''}
${z.firstNumber ? row('From', esc(z.firstNumber)) + row('To', esc(z.lastNumber)) : ''}
${row('Gross sales', m(z.gross))}
${row('Discounts', m(-z.discounts))}
${row('Taxable value', m(z.taxable))}
${row('GST', m(z.tax))}
${z.cess ? row('Cess', m(z.cess)) : ''}
${z.roundOff ? row('Round-off', m(z.roundOff)) : ''}
${row('Net sales', m(z.net), true)}
</table>
<h2>Tax by rate</h2>
<table>
${z.taxByRate.length ? z.taxByRate.map((s) => row(`${s.rate}% on ${formatCurrency(s.taxable)}`, m(s.tax))).join('\n') : row('No GST charged', m(0))}
</table>
<h2>Tenders</h2>
<table>
${row('Cash', m(z.tenders.cash))}
${row('UPI', m(z.tenders.upi))}
${row('Card', m(z.tenders.card))}
${z.tenders.other ? row('Other', m(z.tenders.other)) : ''}
${row('Received', m(z.received), true)}
${z.credit ? row('On account', m(z.credit)) : ''}
${z.exchangeIn ? row('Exchange credit used', m(z.exchangeIn)) : ''}
</table>
${z.returns?.count ? `<h2>Returns</h2>
<table>
${row('Returns', String(z.returns.count))}
${row('Credit notes', m(z.returns.value))}
${z.returns.refunds.cash ? row('Refund cash', m(-z.returns.refunds.cash)) : ''}
${z.returns.refunds.upi ? row('Refund UPI', m(-z.returns.refunds.upi)) : ''}
${z.returns.refunds.card ? row('Refund card', m(-z.returns.refunds.card)) : ''}
${z.returns.exchanged ? row('Exchanged', m(z.returns.exchanged)) : ''}
${z.returns.onAccount ? row('On account', m(z.returns.onAccount)) : ''}
${row('Net after returns', m(z.netAfterReturns), true)}
</table>` : ''}
${c ? `<h2>Cash drawer</h2>
<table>
${row('Opening float', m(c.opening_float))}
${row('Expected', m(c.expected_cash))}
${row('Counted', m(c.counted_cash))}
${row(c.difference < 0 ? 'Short' : c.difference > 0 ? 'Over' : 'Difference', m(c.difference), true)}
${c.note ? `<tr><td colspan="2">${esc(c.note)}</td></tr>` : ''}
</table>` : ''}
<p class="foot">Printed ${esc(opts.printedAt ?? new Date().toLocaleString('en-IN'))}</p>
</body></html>`;
}

/* ── Keyboard ────────────────────────────────────────────────── */

export type PosAction = 'search' | 'cash' | 'upi' | 'card' | 'customer' | 'save' | 'new' | 'zreport';

/** Counter shortcuts (shown on screen and in docs/features/pos-barcode-pricing.md). */
export const POS_SHORTCUTS: { keys: string; action: PosAction; label: string }[] = [
  { keys: 'F2', action: 'search', label: 'Scan / search items' },
  { keys: 'F3', action: 'customer', label: 'Customer' },
  { keys: 'F4', action: 'cash', label: 'Cash (fills the rest)' },
  { keys: 'F6', action: 'upi', label: 'UPI (fills the rest)' },
  { keys: 'F7', action: 'card', label: 'Card (fills the rest)' },
  { keys: 'F8', action: 'new', label: 'New bill' },
  { keys: 'F9', action: 'save', label: 'Save & print' },
  { keys: 'F10', action: 'zreport', label: 'Day-end Z report' },
];

/** The POS action for a key press, or null. Ctrl/⌘+Enter also saves. */
export function posShortcut(e: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }): PosAction | null {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') return 'save';
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  return POS_SHORTCUTS.find((s) => s.keys === e.key)?.action ?? null;
}

/** Amount for a tender field that "fills the rest": what is still due once the other tenders count. */
export function fillRest(total: number, tenders: readonly Tender[], method: TenderMethod): number {
  const others = tenders.filter((t) => t.method !== method).reduce((s, t) => s + Math.max(num(t.amount), 0), 0);
  return round2(Math.max(num(total) - others, 0));
}
