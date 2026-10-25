/**
 * POS returns and exchanges (WP-9, gap P1-25).
 *
 * A return is never a new kind of document: it is the existing credit note
 * (`documents.createCreditNote`, `goods_returned: true`, so the goods come back into stock through
 * `credit-restock.ts`), plus how the customer is settled:
 *
 *  - **refund**   money handed back by tender (cash / UPI / card). Booked as one manual PAYMENT
 *                 voucher (`saveVoucher`): Dr Sundry debtors (the bill's party) / Cr Cash or Bank.
 *  - **exchange** the credit is used on the next POS bill. When that bill is saved,
 *                 `applyExchange` records a payment row on it (method Cash, note `POS exchange …`)
 *                 and the matching voucher (Dr debtors / Cr Cash), so cash nets to zero and the new
 *                 bill shows as paid. Credit larger than the new bill is refunded in cash.
 *  - **account**  nothing is paid back (a saved customer's bill left on account): the credit
 *                 note simply reduces what they owe.
 *
 * Each return writes one `pos_returns` row (what the Z report reads). Refund limits: never more
 * than was actually received on the bill, less what earlier returns already refunded.
 */

import type { InvoiceRecord, Payment } from '../types/invoice';
import { num, round2 } from './invoice-calc';
import { localDb } from './localDb';
import { generateId, getTable, setTable } from './storage';
import { requireAccess } from './access';
import { buildCreditNote, createCreditNote, creditableLines, isInvoiceType, readLinks, type CreditLineStatus, type DocLink } from './documents';
import { saveVoucher, rupeesToPaise, type ManualVoucherLine } from './ledger/vouchers';
import { A } from './ledger/accounts';
import { receivableTotal } from './rcm';
import { localDayOf } from './dates';

export const POS_RETURNS_TABLE = 'pos_returns';
export const EXCHANGE_NOTE = 'POS exchange';

export type RefundMethod = 'Cash' | 'UPI' | 'Card';
export const REFUND_METHODS: RefundMethod[] = ['Cash', 'UPI', 'Card'];
export type ReturnSettlement = 'refund' | 'exchange' | 'account';

export interface RefundTender {
  method: RefundMethod;
  amount: number;
  reference?: string;
}

export interface PosReturn {
  id: string;
  /** Local day of the return (YYYY-MM-DD). */
  day: string;
  bill_id: string;
  bill_number: string;
  credit_note_id: string;
  credit_note_number: string;
  /** Credit note total (what the customer is owed back). */
  amount: number;
  settlement: ReturnSettlement;
  /** Money paid back, by tender. For an exchange: the part of the credit larger than the new bill. */
  refunds: RefundTender[];
  /** The PAYMENT voucher that books the refund / exchange. */
  voucher_id?: string;
  /** Exchange: the new bill the credit was used on, and how much of it. */
  exchange_bill_id?: string;
  exchange_used?: number;
  reason: string;
  created_at: string;
}

export const posReturnsDb = {
  all: (): PosReturn[] => getTable<PosReturn>(POS_RETURNS_TABLE),
  forDay: (day: string): PosReturn[] => posReturnsDb.all().filter((r) => r.day === day),
  forBill: (billId: string): PosReturn[] => posReturnsDb.all().filter((r) => r.bill_id === billId),
};

function writeReturn(row: PosReturn): void {
  const all = posReturnsDb.all();
  setTable(POS_RETURNS_TABLE, all.some((r) => r.id === row.id) ? all.map((r) => (r.id === row.id ? row : r)) : [...all, row]);
}

/* ── Finding the bill ─────────────────────────────────────────── */

const norm = (s: string) => (s || '').replace(/[\s\u0000-\u001f]/g, '').toUpperCase();

/**
 * The sales bill for a scanned / typed bill number: an exact match (ignoring case and spaces)
 * first, then a unique match on the trailing sequence ("17" or "0017" finds INV/FY26-27/0017
 * when only one bill ends that way). Only issued, live sales bills are returnable.
 */
export function findBillByNumber(code: string, invoices: readonly InvoiceRecord[]): InvoiceRecord | null {
  const q = norm(code);
  if (!q) return null;
  const live = invoices.filter((i) => isInvoiceType(i.doc_type) && i.status !== 'Draft' && i.status !== 'Cancelled');
  const exact = live.find((i) => norm(i.invoice_number) === q);
  if (exact) return exact;
  if (!/^\d+$/.test(q)) return null;
  const n = Number(q);
  const tail = live.filter((i) => {
    const m = /(\d+)$/.exec(i.invoice_number || '');
    return !!m && Number(m[1]) === n;
  });
  if (tail.length === 1) return tail[0];
  // Several FYs end in the same sequence: the newest POS bill wins.
  const pos = tail.filter((i) => i.pos).sort((a, b) => b.issue_date.localeCompare(a.issue_date));
  return pos[0] ?? null;
}

/** Recent POS bills, newest first (the "pick the original bill" list). */
export function recentPosBills(invoices: readonly InvoiceRecord[], limit = 30): InvoiceRecord[] {
  return invoices
    .filter((i) => i.pos && isInvoiceType(i.doc_type) && i.status !== 'Draft' && i.status !== 'Cancelled')
    .sort((a, b) => b.issue_date.localeCompare(a.issue_date) || b.invoice_number.localeCompare(a.invoice_number, undefined, { numeric: true }))
    .slice(0, limit);
}

/* ── Planning a return ────────────────────────────────────────── */

export interface ReturnLineRequest {
  itemId: string;
  quantity: number;
}

export interface ReturnPlan {
  lines: CreditLineStatus[];
  /** Credit note preview (null with errors). */
  credit: InvoiceRecord | null;
  amount: number;
  /** Most that may be paid back: received on the bill − refunded by earlier returns. */
  refundable: number;
  errors: string[];
}

/** Received on the bill (payments in the ledger). */
function receivedOn(bill: InvoiceRecord, payments: readonly Payment[]): number {
  return round2(payments.filter((p) => p.invoice_id === bill.id).reduce((s, p) => s + num(p.amount), 0));
}

/** Refunded (and exchanged) by earlier returns of the bill. */
export function alreadyRefunded(billId: string, returns: readonly PosReturn[]): number {
  return round2(
    returns
      .filter((r) => r.bill_id === billId)
      .reduce((s, r) => s + r.refunds.reduce((t, x) => t + num(x.amount), 0) + num(r.exchange_used), 0),
  );
}

/**
 * Pure: validate the lines picked for return and preview the credit note. `refundable` caps the
 * money that may go back (a bill left on account was never paid, so nothing is refunded).
 */
export function planReturn(
  bill: InvoiceRecord,
  picks: readonly ReturnLineRequest[],
  ctx: { links: DocLink[]; invoices: InvoiceRecord[]; payments: readonly Payment[]; returns: readonly PosReturn[]; day: string },
): ReturnPlan {
  const lines = creditableLines(bill, ctx.links, ctx.invoices);
  const { record, errors } = buildCreditNote(bill, { lines: picks.map((p) => ({ itemId: p.itemId, quantity: p.quantity })), reason: 'Sales return', goodsReturned: true }, ctx.links, ctx.invoices, {
    id: 'preview',
    invoice_number: '',
    today: ctx.day,
  });
  const amount = record ? round2(receivableTotal(record)) : 0;
  const refundable = round2(Math.max(receivedOn(bill, ctx.payments) - alreadyRefunded(bill.id, ctx.returns), 0));
  return { lines, credit: record, amount, refundable, errors };
}

/** Default refund split: back the way it was paid (the bill's tenders in order), capped at `amount`. */
export function suggestRefund(bill: InvoiceRecord, payments: readonly Payment[], amount: number): RefundTender[] {
  let rest = round2(amount);
  const out: RefundTender[] = [];
  const by = new Map<RefundMethod, number>();
  for (const p of payments.filter((x) => x.invoice_id === bill.id && !(x.note || '').startsWith(EXCHANGE_NOTE))) {
    const m = (REFUND_METHODS.find((r) => r.toLowerCase() === (p.method || '').toLowerCase()) ?? 'Cash') as RefundMethod;
    by.set(m, round2((by.get(m) ?? 0) + num(p.amount)));
  }
  if (by.size === 0) by.set('Cash', rest);
  for (const m of REFUND_METHODS) {
    const have = by.get(m);
    if (!have || rest <= 0) continue;
    const take = round2(Math.min(have, rest));
    out.push({ method: m, amount: take });
    rest = round2(rest - take);
  }
  if (rest > 0.004) {
    const cash = out.find((r) => r.method === 'Cash');
    if (cash) cash.amount = round2(cash.amount + rest);
    else out.push({ method: 'Cash', amount: rest });
  }
  return out;
}

/* ── Saving ───────────────────────────────────────────────────── */

export interface PosReturnInput {
  bill: InvoiceRecord;
  lines: ReturnLineRequest[];
  settlement: ReturnSettlement;
  /** settlement 'refund': the tenders paid back; must add up to the credit note total. */
  refunds?: RefundTender[];
  reason?: string;
}

export interface PosReturnResult {
  ok: boolean;
  errors: string[];
  creditNote?: InvoiceRecord;
  row?: PosReturn;
}

const partyOf = (inv: InvoiceRecord) => (inv.client?.company || inv.client?.name || 'Cash sale').trim();
const cashAccount = (m: string) => (m.toLowerCase() === 'cash' ? A.cash : A.bank);

/** Refund voucher lines: Dr debtors (party) for the total, Cr cash / bank per tender. */
export function refundVoucherLines(party: string, tenders: readonly RefundTender[]): ManualVoucherLine[] {
  const credits = new Map<string, number>();
  for (const t of tenders) {
    const p = rupeesToPaise(t.amount);
    if (p > 0) credits.set(cashAccount(t.method), (credits.get(cashAccount(t.method)) ?? 0) + p);
  }
  const total = [...credits.values()].reduce((s, n) => s + n, 0);
  if (total === 0) return [];
  return [
    { account_id: A.debtors, dr: total, cr: 0, party },
    ...[...credits.entries()].map(([account_id, cr]) => ({ account_id, dr: 0, cr })),
  ];
}

/** Validate a refund split against the credit and the money received. */
export function refundIssues(amount: number, refundable: number, refunds: readonly RefundTender[]): string[] {
  const errors: string[] = [];
  const sum = round2(refunds.reduce((s, r) => s + Math.max(num(r.amount), 0), 0));
  if (Math.abs(sum - round2(amount)) > 0.009) errors.push(`The refund (₹${sum.toFixed(2)}) must equal the credit note (₹${round2(amount).toFixed(2)}).`);
  if (sum > refundable + 0.009) errors.push(`Only ₹${refundable.toFixed(2)} was received on this bill — refund at most that, or keep the rest on account.`);
  return errors;
}

/**
 * Raise the credit note (goods back to stock) and settle it. A refund voucher that fails after
 * the credit note was saved leaves the note in place (it is still correct) and says so.
 */
export function savePosReturn(input: PosReturnInput): PosReturnResult {
  requireAccess('doc.create');
  const day = localDayOf(new Date());
  const ctx = {
    links: readLinks(),
    invoices: localDb.invoices.getAll(),
    payments: localDb.payments.getAll(),
    returns: posReturnsDb.all(),
    day,
  };
  const bill = ctx.invoices.find((i) => i.id === input.bill.id) ?? input.bill;
  const plan = planReturn(bill, input.lines, ctx);
  if (plan.errors.length || !plan.credit) return { ok: false, errors: plan.errors };
  const refunds = (input.refunds ?? []).filter((r) => num(r.amount) > 0).map((r) => ({ ...r, amount: round2(num(r.amount)) }));
  if (input.settlement === 'refund') {
    const issues = refundIssues(plan.amount, plan.refundable, refunds);
    if (issues.length) return { ok: false, errors: issues };
  }
  if (input.settlement === 'exchange' && plan.amount > plan.refundable + 0.009) {
    return { ok: false, errors: [`Only ₹${plan.refundable.toFixed(2)} was received on this bill, so at most that can be used on a new bill. Keep it on account instead.`] };
  }

  let note: InvoiceRecord;
  try {
    note = createCreditNote(bill, { lines: input.lines, reason: input.reason?.trim() || 'Sales return', goodsReturned: true });
  } catch (err) {
    return { ok: false, errors: [(err as Error).message] };
  }
  const row: PosReturn = {
    id: generateId(),
    day: note.issue_date,
    bill_id: bill.id,
    bill_number: bill.invoice_number,
    credit_note_id: note.id,
    credit_note_number: note.invoice_number,
    amount: round2(receivableTotal(note)),
    settlement: input.settlement,
    refunds: input.settlement === 'refund' ? refunds : [],
    reason: input.reason?.trim() || 'Sales return',
    created_at: new Date().toISOString(),
  };
  if (input.settlement === 'refund') {
    try {
      const v = saveVoucher({
        type: 'PAYMENT',
        date: row.day,
        narration: `Refund against ${note.invoice_number} (return of ${bill.invoice_number}) · ${refunds.map((r) => `${r.method} ${r.amount.toFixed(2)}`).join(', ')}`,
        lines: refundVoucherLines(partyOf(bill), refunds),
      });
      row.voucher_id = v.id;
    } catch (err) {
      writeReturn(row);
      return { ok: false, errors: [`${note.invoice_number} was saved (stock is back), but the refund could not be booked: ${(err as Error).message}. Book it as a payment voucher in Books.`], creditNote: note, row };
    }
  }
  writeReturn(row);
  return { ok: true, errors: [], creditNote: note, row };
}

/** Exchange credit still to be used on a new bill (an exchange return without `exchange_bill_id`). */
export function openExchange(returnId: string): PosReturn | undefined {
  const r = posReturnsDb.all().find((x) => x.id === returnId);
  return r && r.settlement === 'exchange' && !r.exchange_bill_id ? r : undefined;
}

/**
 * Use an exchange credit on the new bill just saved: a Cash payment row (note `POS exchange …`) for
 * the part the bill absorbs, one voucher Dr debtors / Cr Cash for the whole credit (the part above
 * the bill is cash handed back). Returns the payment (if any).
 */
export function applyExchange(returnId: string, newBill: InvoiceRecord): { used: number; refunded: number; payment?: Payment } {
  const r = openExchange(returnId);
  if (!r) throw new Error('This exchange credit was already used.');
  const due = round2(Math.max(num(newBill.balance_due), 0));
  const used = round2(Math.min(r.amount, due));
  const refunded = round2(r.amount - used);
  let payment: Payment | undefined;
  if (used > 0) {
    payment = localDb.payments.record({
      invoiceId: newBill.id,
      amount: used,
      method: 'Cash',
      note: `${EXCHANGE_NOTE} ${r.credit_note_number}`,
      date: newBill.issue_date,
    });
  }
  const v = saveVoucher({
    type: 'PAYMENT',
    date: newBill.issue_date,
    narration: `Exchange: ${r.credit_note_number} (return of ${r.bill_number}) used on ${newBill.invoice_number}${refunded > 0 ? ` · Cash ${refunded.toFixed(2)} refunded` : ''}`,
    lines: refundVoucherLines(partyOf(newBill), [{ method: 'Cash', amount: r.amount }]),
  });
  writeReturn({
    ...r,
    voucher_id: v.id,
    exchange_bill_id: newBill.id,
    exchange_used: used,
    refunds: refunded > 0 ? [{ method: 'Cash', amount: refunded }] : [],
  });
  return { used, refunded, payment };
}

/* ── Z report ─────────────────────────────────────────────────── */

export interface ZReturns {
  count: number;
  /** Σ credit note totals of the day's returns (cancelled notes left out). */
  value: number;
  taxable: number;
  tax: number;
  refunds: { cash: number; upi: number; card: number };
  /** Credit used on new bills that day (exchange). */
  exchanged: number;
  /** Left as credit on account. */
  onAccount: number;
  numbers: string[];
}

export function zReturns(day: string, returns: readonly PosReturn[], invoices: readonly InvoiceRecord[]): ZReturns {
  const byId = new Map(invoices.map((i) => [i.id, i]));
  const out: ZReturns = { count: 0, value: 0, taxable: 0, tax: 0, refunds: { cash: 0, upi: 0, card: 0 }, exchanged: 0, onAccount: 0, numbers: [] };
  for (const r of returns) {
    if (r.day !== day) continue;
    const cn = byId.get(r.credit_note_id);
    if (!cn || cn.status === 'Cancelled') continue;
    out.count++;
    out.value += receivableTotal(cn);
    out.taxable += num(cn.taxable_value);
    out.tax += num(cn.tax_amount);
    out.numbers.push(cn.invoice_number);
    for (const t of r.refunds) {
      const k = t.method.toLowerCase() as 'cash' | 'upi' | 'card';
      if (k in out.refunds) out.refunds[k] += num(t.amount);
    }
    out.exchanged += num(r.exchange_used);
    if (r.settlement === 'account' || (r.settlement === 'exchange' && !r.exchange_bill_id)) out.onAccount += num(r.amount);
  }
  for (const k of ['value', 'taxable', 'tax', 'exchanged', 'onAccount'] as const) out[k] = round2(out[k]);
  for (const k of ['cash', 'upi', 'card'] as const) out.refunds[k] = round2(out.refunds[k]);
  return out;
}
