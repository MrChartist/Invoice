/**
 * R15-C3 cancellations and refunds — one action for a booking or a whole trip:
 *  - client side: a credit note on each issued invoice that billed the bookings (their lines in full, GST reversed,
 *    through `documents.createCreditNote`), and a draft invoice of our cancellation fee at the rate of the principal
 *    supply (Circular 178/10/2022, `CANCEL_FEE_RATE_RULES` by the trip's regime; TV15);
 *  - supplier side: a value-only debit note (`purchase-returns`) for the refund due on the booking's bill, else the
 *    statement's RFND row (C2) is the record;
 *  - the booking keeps `cancel` (supplier charge, fee, refunds, credit note): the trip shows the charge not recovered
 *    by our fee as a loss (B2). A cancelled booking is never billed again; a booking inside a shared package line is
 *    cancelled with its whole trip. Re-issue: cut 3 (PRD §3). All or nothing. Working papers — verify with your CA.
 */
import './tv-registry';
import type { InvoiceItem, InvoiceRecord } from '../../types/invoice';
import type { TravelBooking, TvRegime } from '../../types/travel-r15';
import { generateId, setTable } from '../storage';
import { requireAccess } from '../access';
import { assertUnlocked } from '../period-lock';
import { round2 } from '../invoice-calc';
import { ruleAt } from '../tax-rules';
import { localDb } from '../localDb';
import { withTablesRollback } from '../table-txn';
import { buildCreditNote, createCreditNote, readLinks } from '../documents';
import { purchaseReturnsDb } from '../purchase-returns';
import { purchasesDb } from '../purchases';
import { blankClient, makeDraft } from '../../store/invoice-defaults';
import { buildBillDraft } from '../timesheets';
import { CANCEL_FEE_RATE_RULES, AIR_SAC_RULES } from '../travel-rules';
import { costInr, isBilled, liveLines, loadBookings } from './tv-bookings';
import { regimeRule, tvSnapshot } from './tv-regime';
import { loadTrips, saveTrip } from './tv-trips';
import { TV_TABLES } from './tv-shared';

export interface CancelInput { date: string; supplier_charge: number; fee: number; refund_in: number }
export interface CancelPlan { credits: { invoice: InvoiceRecord; lines: { itemId: string; quantity: number }[] }[]; billed: number; cost: number; rate: number; refundOut: number }

const n = (x: unknown) => round2(Number(x) || 0);
const gross = (l: InvoiceItem) => round2(n(l.quantity) * n(l.rate) * (1 - n(l.discount_percent) / 100) * (1 + n(l.tax_rate) / 100));
export const feeRate = (regime: TvRegime, date?: string): number => ruleAt(CANCEL_FEE_RATE_RULES, date)[regime];

const CANCEL_REASON = 'Booking cancelled';

/**
 * Pure (reads the document links unless given): what cancelling `targets` credits and refunds. Throws when a guard
 * fails: a line shared with a booking that stays, a draft invoice, charges above the cost.
 */
export function cancelPlan(targets: readonly TravelBooking[], all: readonly TravelBooking[], invoices: readonly InvoiceRecord[], regime: TvRegime, i: CancelInput, links = readLinks()): CancelPlan {
  const live = liveLines(invoices);
  const ids = new Set(targets.map((b) => b.id));
  const cost = round2(targets.reduce((s, b) => s + costInr(b), 0));
  if ([i.supplier_charge, i.fee, i.refund_in].some((x) => n(x) < 0)) throw new Error('Amounts cannot be negative.');
  if (n(i.supplier_charge) + n(i.refund_in) > cost + 0.005) throw new Error(`The supplier's charge and refund are more than the cost (₹${cost.toFixed(2)}).`);
  const by = new Map<string, Set<string>>();
  for (const b of targets) {
    if (!isBilled(b, live)) continue;
    const { invoice_id, line_id } = b.line_ref!;
    if (all.some((o) => !ids.has(o.id) && o.status !== 'cancelled' && o.line_ref?.line_id === line_id && o.line_ref.invoice_id === invoice_id)) throw new Error('This booking is billed inside the package line: cancel the whole trip.');
    by.set(invoice_id, (by.get(invoice_id) ?? new Set()).add(line_id));
  }
  let billed = 0;
  const credits = [...by].map(([id, lines]) => {
    const invoice = invoices.find((x) => x.id === id)!;
    if (invoice.status === 'Draft') throw new Error('Issue the invoice first, or remove the booking\'s line from the draft.');
    // A ticket invoice of these bookings only: all its tickets and the agent's service line go with them.
    const tk = [...lines].some((x) => invoice.tv?.lines?.[x]) && !all.some((o) => !ids.has(o.id) && o.status !== 'cancelled' && o.line_ref?.invoice_id === id);
    const items = invoice.items.filter((l) => lines.has(l.id) || (tk && (!!invoice.tv?.lines?.[l.id] || l.id === invoice.tv?.air?.line_id)));
    const req = items.map((l) => ({ itemId: l.id, quantity: n(l.quantity) }));
    // QA18 T4: what the client is refunded is what the credit note credits — its own maths (invoice discount share,
    // cess, the TCS the invoice charged on those lines, round-off), not a per-line sum that left the TCS out.
    const note = buildCreditNote(invoice, { lines: req, reason: CANCEL_REASON, goodsReturned: false, date: i.date }, links, [...invoices], { id: 'plan', invoice_number: '', today: i.date }).record;
    billed += note ? n(note.total) : items.reduce((s, l) => s + gross(l), 0);
    return { invoice, lines: req };
  });
  const rate = feeRate(regime, i.date);
  return { credits, billed: round2(billed), cost, rate, refundOut: round2(Math.max(billed - n(i.fee) * (1 + rate / 100), 0)) };
}

/** Split `x` over the targets by cost (the last takes the rounding). */
const split = (x: number, ts: readonly TravelBooking[], cost: number) => {
  let left = n(x);
  return ts.map((b, k) => { const v = k === ts.length - 1 ? left : round2(cost > 0 ? (x * costInr(b)) / cost : x / ts.length); left = round2(left - v); return v; });
};

/** Cancel bookings (`doc.create`; period lock on the date). Returns the credit notes and the fee draft made. */
export function cancelBookings(bookingIds: readonly string[], i: CancelInput): { notes: InvoiceRecord[]; fee?: InvoiceRecord; plan: CancelPlan } {
  requireAccess('doc.create');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.date)) throw new Error('Enter the date.');
  assertUnlocked({ issue_date: i.date }, 'create');
  const all = loadBookings();
  const targets = all.filter((b) => bookingIds.includes(b.id) && b.status !== 'cancelled');
  if (!targets.length) throw new Error('Nothing to cancel.');
  const trip = loadTrips().find((t) => t.id === targets[0].trip_id);
  const regime = trip?.tv.regime ?? 'agent';
  const invoices = localDb.invoices.getAll();
  const plan = cancelPlan(targets, all, invoices, regime, i);
  return withTablesRollback(['invoices', 'doc_links', 'purchases', 'purchase_returns', 'series_counters', 'cost_centres', TV_TABLES.bookings], () => {
    const notes = plan.credits.map((c) => createCreditNote(c.invoice, { lines: c.lines, reason: CANCEL_REASON, goodsReturned: false, date: i.date }));
    let fee: InvoiceRecord | undefined;
    if (n(i.fee) > 0) {
      const sender = localDb.settings.activeProfile() ?? null;
      const base = makeDraft({ settings: localDb.settings.get(), sender, docType: 'INVOICE', templateId: localDb.template.get() });
      const hsn = regime === 'agent' ? ruleAt(AIR_SAC_RULES, i.date)[targets.every((b) => b.component === 'air') ? 'air' : 'other'] : regimeRule(regime, i.date).sac;
      const item: InvoiceItem = { id: generateId(), name: `Cancellation fee: ${[...new Set(targets.map((b) => b.ref || b.component))].join(', ')}`, type: 'Service', hsn, unit: 'NOS', quantity: 1, rate: n(i.fee), amount: n(i.fee), tax_rate: plan.rate, discount_percent: 0, ...(regime === 'exempt_outside' ? { sv: { exempt: 'EXEMPT' as const } } : {}) };
      const client = plan.credits[0]?.invoice.client ?? ((trip?.client_id && localDb.clients.getById(trip.client_id)) || { ...blankClient(), name: trip?.name ?? '' });
      const snap = trip ? tvSnapshot(trip, regime, i.date) : { regime };
      delete snap.decl;
      fee = localDb.invoices.save(buildBillDraft({ ...base, id: generateId(), issue_date: i.date, ...(trip ? { cost_centre_id: trip.id } : {}), tv: snap }, client, [item], sender));
    }
    const [sc, fe, ri, ro] = [i.supplier_charge, i.fee, i.refund_in, plan.refundOut].map((x) => split(x, targets, plan.cost));
    const due = new Map<string, number>();
    targets.forEach((b, k) => { if (b.bill_id && ri[k] > 0) due.set(b.bill_id, round2((due.get(b.bill_id) ?? 0) + ri[k])); });
    for (const [billId, amt] of due) {
      if (!purchasesDb.get(billId)) continue;
      purchaseReturnsDb.create({ kind: 'DEBIT_NOTE', date: i.date, purchaseId: billId, reason: '07', goodsReturned: false, lines: [{ id: generateId(), name: 'Cancellation: refund due', quantity: 1, rate: amt, tax_rate: 0 }], notes: 'Booking cancelled. Verify with your CA.' });
    }
    const now = new Date().toISOString();
    const at = new Map(targets.map((b, k) => [b.id, k]));
    setTable(TV_TABLES.bookings, loadBookings().map((b) => {
      const k = at.get(b.id);
      return k === undefined ? b : { ...b, status: 'cancelled' as const, cancel: { date: i.date, supplier_charge: sc[k], fee: fe[k], refund_in: ri[k], refund_out: ro[k], ...(notes[0] ? { credit_note_id: notes[0].id } : {}) }, updated_at: now };
    }));
    if (trip && all.every((b) => b.trip_id !== trip.id || b.status === 'cancelled' || at.has(b.id))) saveTrip({ id: trip.id, name: trip.name, client_id: trip.client_id, tv: { ...trip.tv, status: 'cancelled' } });
    return { notes, fee, plan };
  });
}
