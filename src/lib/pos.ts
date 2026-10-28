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
import { currentActor, requireAccess } from './access';
import { audit } from './audit';
import { generateId, getTable, setTable } from './storage';
import {
  batchOptions, editorStockContext, liveDocTrackingIssues, liveMrpIssues, recordMrpOverrides, withBatch, withMrpIssues,
  type EditorStockContext,
} from './stock-tracking';
import { rxRequiredErrors } from './pharma-gate';
import { toCsv } from './csv';
import { formatCurrency, formatDate } from './utils';
import { nextPartyBalanceSnapshot } from './party-balance';
import { partyBalanceSnapshotFor } from './khata-actions';
import { EXCHANGE_NOTE, applyExchange, openExchange, zReturns, type PosReturn, type ZReturns } from './pos-returns';
import { escHtml as esc } from './html-esc';
import { liveRedeemIssue, recordPromoUse, stampVoucherPayment } from './retail/gift-voucher-core'; // R4-B1
import { movedNoCash } from './advance-tax'; // no-cash.ts (QA6-1 F4)

export const POS_DAY_CLOSE_TABLE = 'pos_day_close';
export const WALK_IN_NAME = 'Walk-in customer';

/* ── Tender maths ────────────────────────────────────────────── */

/** 8E (8.144): Cheque and Wallet (Paytm / PhonePe wallet, gift card) join the counter tenders; non-cash like UPI. */
export type TenderMethod = 'Cash' | 'UPI' | 'Card' | 'Cheque' | 'Wallet' | 'Gift voucher';
export const TENDER_METHODS: TenderMethod[] = ['Cash', 'UPI', 'Card', 'Cheque', 'Wallet', 'Gift voucher'];
/** R4-B1: the counter's money tenders (a gift voucher is entered by code, one row per voucher). */
export type MoneyTender = Exclude<TenderMethod, 'Gift voucher'>;

export interface Tender {
  method: TenderMethod;
  amount: number;
  reference?: string;
  /** UPI / card: the bank account the money lands in (multi-account BRS). */
  bank_account_id?: string;
  /** R4-B1: the `gift_vouchers` row a 'Gift voucher' tender takes its amount from. */
  gift_voucher_id?: string;
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
  /** What is recorded as payments: one row per method with an amount, cash net of change (one row per gift voucher). */
  payments: { method: TenderMethod; amount: number; reference?: string; bank_account_id?: string; gift_voucher_id?: string }[];
  /** Blocking problems ("UPI and card are more than the bill"). */
  errors: string[];
}

/** Split-tender maths for a bill of `total`. Amounts below zero count as zero. */
export function tenderSummary(total: number, tenders: readonly Tender[]): TenderSummary {
  const t = round2(Math.max(num(total), 0));
  const by = (m: TenderMethod) => round2(tenders.filter((x) => x.method === m).reduce((s, x) => s + Math.max(num(x.amount), 0), 0));
  const cash = by('Cash');
  const nonCash = round2(by('UPI') + by('Card') + by('Cheque') + by('Wallet') + by('Gift voucher'));
  const tendered = round2(cash + nonCash);
  const errors: string[] = [];
  if (nonCash > t + 0.004) errors.push('UPI, card, cheque, wallet and gift vouchers together are more than the bill — only cash can be given back as change.');
  const change = nonCash > t ? 0 : round2(Math.max(tendered - t, 0));
  const due = round2(Math.max(t - tendered, 0));
  const payments: TenderSummary['payments'] = [];
  for (const m of TENDER_METHODS) {
    const rows = tenders.filter((x) => x.method === m && num(x.amount) > 0);
    if (!rows.length) continue;
    if (m === 'Gift voucher') {
      // R4-B1: one receipt per voucher (each carries its gift_voucher_id); never change from a voucher.
      for (const r of rows) payments.push({ method: m, amount: round2(num(r.amount)), ...(r.reference ? { reference: r.reference } : {}), ...(r.gift_voucher_id ? { gift_voucher_id: r.gift_voucher_id } : {}) });
      continue;
    }
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
  /** R4-B1: a promotional gift voucher already applied to `record` as an amount discount (noted on the voucher on save). */
  promoVoucher?: { id: string; amount: number };
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
  const errors = [...posIssues(rec, summary, !!input.allowCredit), ...rxRequiredErrors(rec)]; // R9 (RT-B1) "Require prescription"
  // R4-B1: every gift-voucher tender is checked (balance, expiry, cancelled) before anything is written.
  for (const p of summary.payments) if (p.method === 'Gift voucher') {
    const issue = p.gift_voucher_id ? liveRedeemIssue(p.gift_voucher_id, p.amount, rec.issue_date) : 'Scan or type the gift voucher code.';
    if (issue) errors.push(issue);
  }
  if (errors.length) return { ok: false, errors, summary };

  // R9 (RT-A2): the MRP guard runs even without batch / serial / godown tracking (no stock context).
  const check = { doc_type: rec.doc_type, status: 'Sent' as const, issue_date: rec.issue_date, items: rec.items, discount_type: rec.discount_type, discount_rate: rec.discount_rate, price_includes_tax: rec.price_includes_tax };
  const issues = ctx ? liveDocTrackingIssues(check) : withMrpIssues({ errors: [], expired: [], warnings: [] }, liveMrpIssues(check));
  if (issues.errors.length) return { ok: false, errors: issues.errors, summary };
  if (issues.expired.length && !input.expiredOk) return { ok: false, errors: [], expired: issues.expired, summary };

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

  // Party balance on the bill (8.5): a saved customer's previous balance, frozen with what was paid now.
  const paidNow = round2(credit + summary.payments.reduce((sum, p) => sum + p.amount, 0));
  const balanceSnap = nextPartyBalanceSnapshot(rec, undefined, () => partyBalanceSnapshotFor(rec, { paid: paidNow }));
  if (balanceSnap) rec = { ...rec, party_balance_snapshot: balanceSnap };

  let saved: InvoiceRecord;
  try {
    saved = localDb.invoices.save(rec);
  } catch (err) {
    return { ok: false, errors: [(err as Error).message], locked: isPeriodLockedError(err), summary };
  }
  if (input.expiredOk) recordMrpOverrides(saved, issues.expired, currentActor()?.name ?? 'the owner', (r) => audit.record(r)); // R9 (RT-A2): the owner's "Sell anyway" over MRP
  const payments: Payment[] = [];
  try {
    if (exchange) {
      const x = applyExchange(exchange.id, saved);
      if (x.payment) payments.push(x.payment);
    }
    for (const p of summary.payments) {
      const row = localDb.payments.record({
        invoiceId: saved.id,
        amount: p.amount,
        method: p.method,
        reference: p.reference,
        date: saved.issue_date,
        note: 'POS',
        bankAccountId: p.bank_account_id,
      });
      // R4-B1: the receipt paid with a gift voucher carries its id (ledger: Dr Gift vouchers outstanding).
      if (p.gift_voucher_id) stampVoucherPayment(row.id, p.gift_voucher_id);
      payments.push(p.gift_voucher_id ? { ...row, gift_voucher_id: p.gift_voucher_id } : row);
    }
    if (input.promoVoucher) recordPromoUse(input.promoVoucher.id, { invoice_id: saved.id, number: saved.invoice_number, date: saved.issue_date, amount: round2(input.promoVoucher.amount) });
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

/** R9 (RT-A3) Cash with riders at the end of `day`: COD cash collected up to that day less what was settled up to it. */
export function cashWithRiders(payments: readonly Payment[], settlements: readonly { date: string; payment_ids: readonly string[] }[], day: string): number {
  const settledBy = new Map<string, string>();
  for (const s of settlements) for (const id of s.payment_ids) settledBy.set(id, s.date);
  return round2(
    payments
      .filter((p) => p.rider_id && p.date <= day && String(p.method).toLowerCase() === 'cash')
      .filter((p) => !(settledBy.has(p.id) && settledBy.get(p.id)! <= day))
      .reduce((s, p) => s + num(p.amount), 0),
  );
}


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
  /** R4-B1: gift vouchers redeemed on the day's bills (not new money: left out of the tenders and the drawer). */
  giftVouchers: number;
  /** R9 (RT-A3): COD cash collected on the day's bills by delivery riders (with the riders, not in the drawer). */
  riderCash: number;
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
    giftVouchers: 0,
    riderCash: 0,
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
    // QA6-1 F4: rows that moved no money are not tenders; a gift voucher is shown on its own line.
    if (movedNoCash(p)) {
      if (p.gift_voucher_id) r.giftVouchers += num(p.amount);
      continue;
    }
    if (p.rider_id && methodKey(p.method) === 'cash') { // R9 (RT-A3): cash still with the rider, not in the drawer
      r.riderCash += num(p.amount);
      continue;
    }
    r.tenders[methodKey(p.method)] += num(p.amount);
  }
  for (const k of Object.keys(r.tenders) as (keyof ZReport['tenders'])[]) r.tenders[k] = round2(r.tenders[k]);
  for (const k of ['gross', 'discounts', 'taxable', 'tax', 'cess', 'roundOff', 'net'] as const) r[k] = round2(r[k]);
  r.received = round2(r.tenders.cash + r.tenders.upi + r.tenders.card + r.tenders.other);
  r.exchangeIn = round2(r.exchangeIn);
  r.giftVouchers = round2(r.giftVouchers);
  r.riderCash = round2(r.riderCash);
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

/**
 * R3-A: live restaurant orders (open, or bill printed but not settled) opened on or before `day`.
 * Read straight from `table_orders` so the POS never loads the restaurant module.
 */
export function openTableOrders(day?: string): { id: string; label: string }[] {
  const names = new Map(getTable<{ id: string; name?: string }>('dining_tables').map((t) => [t.id, t.name ?? '']));
  return getTable<{ id: string; status?: string; day?: string; table_id?: string; token?: number; channel?: string }>('table_orders')
    .filter((o) => (o.status === 'open' || o.status === 'printed') && (!day || !o.day || o.day <= day))
    .map((o) => ({ id: o.id, label: o.table_id ? `table ${names.get(o.table_id) || o.table_id.replace(/^tbl_/, '')}` : `token ${o.token ?? '?'}` }));
}

/** Why the day / shift cannot be closed because of restaurant orders ('' = it can). */
export function openOrdersBlocker(day?: string): string {
  const open = openTableOrders(day);
  if (!open.length) return '';
  return `${open.length} restaurant order${open.length === 1 ? ' is' : 's are'} still open (${open.slice(0, 6).map((o) => o.label).join(', ')}${open.length > 6 ? ', …' : ''}) — settle or void ${open.length === 1 ? 'it' : 'them'} on the Tables screen (/tables) first.`;
}

export const dayCloseDb = {
  all: (): PosDayClose[] => getTable<PosDayClose>(POS_DAY_CLOSE_TABLE),
  forDay: (day: string): PosDayClose | undefined => dayCloseDb.all().find((d) => d.day === day),
  /** Close (or re-close) a day: one record per day, the latest count wins. */
  close: (z: ZReport, openingFloat: number, counted: number, note?: string): PosDayClose => {
    requireAccess('payment.record');
    const blocker = openOrdersBlocker(z.day); // R3-A
    if (blocker) throw new Error(blocker);
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
    ...(z.giftVouchers ? [['Gift vouchers redeemed', z.giftVouchers]] : []),
    ...(z.riderCash ? [['Cash collected by riders', z.riderCash]] : []),
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


/** Script-free 80 mm HTML of the Z report, for a print window (or saving as a file). */
export function zReportHtml(z: ZReport, opts: { business?: string; close?: PosDayClose; printedAt?: string; /** 8E: "X REPORT" / "SHIFT 2 Z REPORT" */ title?: string } = {}): string {
  const m = (n: number) => esc(formatCurrency(n));
  const row = (k: string, v: string, strong = false) => `<tr${strong ? ' class="b"' : ''}><td>${esc(k)}</td><td class="r">${v}</td></tr>`;
  const c = opts.close;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(opts.title ?? 'Z report')} ${esc(z.day)}</title>
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
<h1>${esc((opts.title ?? 'Z report').toUpperCase())}</h1>
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
${z.giftVouchers ? row('Gift vouchers redeemed', m(z.giftVouchers)) : ''}
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

export type PosAction =
  | 'search' | 'cash' | 'upi' | 'card' | 'customer' | 'save' | 'new' | 'zreport' | 'hold' | 'held'
  // 8E retail speed pack (8.141 / 8.144 / 8.146)
  | 'help' | 'daySummary' | 'prevBill' | 'nextBill' | 'lastQty' | 'weigh' | 'account' | 'cheque' | 'wallet' | 'display';

/** Counter shortcuts (shown on screen and in docs/features/pos-barcode-pricing.md). Keys can be changed per device (pos-keys.ts). */
export const POS_SHORTCUTS: { keys: string; action: PosAction; label: string }[] = [
  { keys: 'F2', action: 'search', label: 'Scan / search items' },
  { keys: 'F3', action: 'customer', label: 'Customer' },
  { keys: 'F4', action: 'cash', label: 'Cash (fills the rest)' },
  { keys: 'F6', action: 'upi', label: 'UPI (fills the rest)' },
  { keys: 'F7', action: 'card', label: 'Card (fills the rest)' },
  { keys: 'F8', action: 'new', label: 'New bill' },
  { keys: 'F9', action: 'save', label: 'Save & print' },
  { keys: 'F10', action: 'zreport', label: 'Day-end Z report' },
  // 8.21: park the bill and start a new one; the list of bills on hold (recall).
  { keys: 'Shift+F8', action: 'hold', label: 'Hold & new bill' },
  { keys: 'F1', action: 'held', label: 'Bills on hold (recall)' },
  // 8E: help, day summary, bill browsing, last line quantity, live weight, more tenders, customer display.
  { keys: 'Shift+F1', action: 'help', label: 'All POS keys (help)' },
  { keys: 'Ctrl+F5', action: 'daySummary', label: 'Today so far (sales, returns, tenders)' },
  { keys: 'PageUp', action: 'prevBill', label: 'Previous bill' },
  { keys: 'PageDown', action: 'nextBill', label: 'Next bill' },
  { keys: 'Alt+Q', action: 'lastQty', label: 'Quantity of the last scanned line' },
  { keys: 'Alt+W', action: 'weigh', label: 'Read the weighing scale' },
  { keys: 'Shift+F4', action: 'account', label: 'On account (fills the rest)' },
  { keys: 'Shift+F6', action: 'cheque', label: 'Cheque (fills the rest)' },
  { keys: 'Shift+F7', action: 'wallet', label: 'Wallet (fills the rest)' },
  { keys: 'Alt+M', action: 'display', label: 'Customer display' },
];

export interface KeyEventLike { key: string; code?: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean }

/**
 * A key press as a combo string ("F2", "Shift+F8", "Ctrl+F5", "Alt+Q", "PageUp"); null for a bare
 * modifier. With Alt, letters / digits come from `code` (macOS types "œ" for Option+Q).
 */
export function keyCombo(e: KeyEventLike): string | null {
  if (['Shift', 'Control', 'Alt', 'Meta', 'AltGraph'].includes(e.key)) return null;
  let key = e.key;
  if (e.altKey && e.code && /^(Key[A-Z]|Digit\d)$/.test(e.code)) key = e.code.slice(e.code.startsWith('Key') ? 3 : 5);
  else if (key.length === 1) key = key.toUpperCase();
  else if (key === ' ') key = 'Space';
  const mods = [(e.ctrlKey || e.metaKey) && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift'].filter(Boolean);
  return [...mods, key].join('+');
}

/**
 * The POS action for a key press, or null. Ctrl/⌘+Enter also saves. `keymap` (pos-keys.ts) replaces
 * the default key of an action on this device.
 */
export function posShortcut(e: KeyEventLike, keymap?: Partial<Record<PosAction, string>>): PosAction | null {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') return 'save';
  const combo = keyCombo(e);
  if (!combo) return null;
  for (const s of POS_SHORTCUTS) if ((keymap?.[s.action] || s.keys) === combo) return s.action;
  return null;
}

/** Amount for a tender field that "fills the rest": what is still due once the other tenders count. */
export function fillRest(total: number, tenders: readonly Tender[], method: TenderMethod): number {
  const others = tenders.filter((t) => t.method !== method).reduce((s, t) => s + Math.max(num(t.amount), 0), 0);
  return round2(Math.max(num(total) - others, 0));
}
