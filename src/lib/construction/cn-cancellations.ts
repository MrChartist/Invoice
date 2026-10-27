/**
 * CN-C5 cancellations: proposal = consideration received − forfeiture (settings: % of agreement value, or an amount)
 * − GST the app cannot reverse. A demand still inside the Sec 34(2) window (credit note by 30 November after the FY of
 * the invoice, `nextFyCutoff`, gst-penalties.ts) gets a full credit note; GST on a demand past it stays paid and the
 * refund is net of that tax — the buyer may claim it (Circular 188/20/2022-GST, printed note). Open booking advances
 * are refunded with refund vouchers (Rule 51); what was already adjusted against demands is left "to pay". Forfeiture
 * is a journal draft (optional voucher) to "Forfeiture income", no GST by default. The unit is free again.
 * Working paper — verify with your CA (CN22).
 */
import './cn-registry';
import type { BookingCancellation, RealtyBooking } from '../../types/construction-r11';
import type { AdvanceRecord } from '../../types/advances';
import type { InvoiceRecord, Payment } from '../../types/invoice';
import { getTable } from '../storage';
import { requireAccess } from '../access';
import { num, round2 } from '../invoice-calc';
import { getIndianFY } from '../invoice-number';
import { nextFyCutoff } from '../gst-penalties';
import { withTablesRollback } from '../table-txn';
import { localDb } from '../localDb';
import { advanceBalance, loadAdvances, refundAdvance } from '../advances';
import { createCreditNote } from '../documents';
import { A, chartOf, loadUserAccounts, saveUserAccount, type PrimaryGroupId } from '../ledger/accounts';
import { saveVoucher } from '../ledger/vouchers';
import { RT, upsert } from './cn-realty-projects';
import { loadUnits } from './cn-units';
import { demandsOf, live, loadBookings, receivedFor } from './cn-bookings';
import { readConstructionSettings } from './cn-settings';

/** Last day a GST credit note may be issued for a document of `date` (Sec 34(2)). */
export const sec34Limit = (date: string) => nextFyCutoff(getIndianFY(date).startYear);

/** A user ledger found (or created) by name. */
export function ledger(name: string, group: PrimaryGroupId, code: number): string {
  const chart = chartOf(loadUserAccounts());
  const hit = chart.find((a) => a.name.toLowerCase() === name.toLowerCase());
  if (hit) return hit.id;
  const codes = new Set(chart.map((a) => a.code));
  while (codes.has(String(code))) code++;
  return saveUserAccount({ code: String(code), name, group }).id;
}

export interface Proposal {
  received: number;
  forfeiture: number;
  /** Demands inside the window (credit notes) and past it (GST stays). */
  within: InvoiceRecord[];
  past: InvoiceRecord[];
  taxRetained: number;
  refund: number;
  path: BookingCancellation['path'];
}

/** Pure: the cancellation proposal on `date`. */
export function proposal(b: RealtyBooking, date: string, ctx: { advances: readonly AdvanceRecord[]; payments: readonly Payment[]; invoices: readonly InvoiceRecord[]; forfeitPct?: number; forfeitAmount?: number }): Proposal {
  const received = receivedFor(b.id, ctx.advances, ctx.payments, ctx.invoices).consideration;
  const forfeiture = round2(Math.min(num(ctx.forfeitAmount) > 0 ? num(ctx.forfeitAmount) : (b.agreement_value * num(ctx.forfeitPct)) / 100, received));
  const docs = demandsOf(b.id, ctx.invoices).filter((i) => i.doc_type !== 'BILL_OF_SUPPLY');
  const within = docs.filter((i) => date <= sec34Limit(i.issue_date));
  const past = docs.filter((i) => date > sec34Limit(i.issue_date));
  const taxRetained = round2(past.reduce((s, i) => s + num(i.tax_amount), 0));
  return { received, forfeiture, within, past, taxRetained, refund: round2(Math.max(received - forfeiture - taxRetained, 0)), path: past.length ? 'refund_net' : 'credit_note' };
}

/** Cancel a booking: credit notes / refund vouchers / forfeiture draft; unit back to available. */
export function cancelBooking(id: string, date: string, reason: string, method = 'Bank transfer'): RealtyBooking {
  requireAccess('doc.create');
  requireAccess('payment.record');
  const b = loadBookings().find((x) => x.id === id);
  if (!b || !live(b)) throw new Error('Booking not found.');
  if (!reason.trim()) throw new Error('Enter the reason for the cancellation.');
  const s = readConstructionSettings().realty ?? {};
  const p = proposal(b, date, { advances: loadAdvances(), payments: getTable<Payment>('transactions'), invoices: localDb.invoices.getAll(), forfeitPct: s.forfeit_pct, forfeitAmount: s.forfeit_amount });
  return withTablesRollback([RT.bookings, RT.units, 'invoices', 'transactions', 'doc_links', 'advances', 'series_counters', 'vouchers', 'accounts', 'stock_moves'], () => {
    const notes = p.within.map((inv) => createCreditNote(inv, { lines: inv.items.map((l) => ({ itemId: l.id, quantity: num(l.quantity) })), reason: `Booking ${b.number} cancelled: ${reason.trim()}` }).id);
    let left = p.refund;
    const numbers: string[] = [];
    for (const a of loadAdvances().filter((x) => x.booking_id === id && !x.pass_through)) {
      const open = advanceBalance(a, getTable<Payment>('transactions'), localDb.invoices.getAll()).open;
      const amt = round2(Math.min(open, left));
      if (amt <= 0.004) continue;
      numbers.push(refundAdvance(a.id, { amount: amt, date: date < a.date ? a.date : date, method, note: `Booking ${b.number} cancelled` }).number);
      left = round2(left - amt);
    }
    const journal = p.forfeiture > 0
      ? saveVoucher({ type: 'JOURNAL', date, variant: 'OPTIONAL', voucher_class: 'Booking forfeiture', narration: `Forfeiture on cancellation of booking ${b.number} (${b.client_name}) — no GST by default; verify with your CA (CN22).`, lines: [{ account_id: A.debtors, dr: Math.round(p.forfeiture * 100), cr: 0, party: b.client_name }, { account_id: ledger('Forfeiture income', 'OTHER_INCOME', 4810), dr: 0, cr: Math.round(p.forfeiture * 100) }] }).id
      : undefined;
    const c: BookingCancellation = {
      date, reason: reason.trim(), received: p.received, forfeiture: p.forfeiture, tax_retained: p.taxRetained, refund: p.refund, path: p.path,
      ...(notes.length ? { credit_note_ids: notes } : {}), ...(numbers.length ? { refund_numbers: numbers } : {}), ...(left > 0.004 ? { refund_pending: left } : {}), ...(journal ? { journal_id: journal } : {}),
    };
    const next: RealtyBooking = { ...b, status: 'cancelled', cancellation: c, updated_at: new Date().toISOString() };
    upsert(RT.bookings, next);
    const u = loadUnits().find((x) => x.id === b.unit_id);
    if (u?.booking_id === id) upsert(RT.units, { ...u, status: 'available', booking_id: undefined });
    return next;
  });
}
