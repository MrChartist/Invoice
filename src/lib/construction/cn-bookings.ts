/**
 * CN-C2 bookings (table `realty_bookings`, `BKG/FY…`, `doc.create`, dated `date`, audited): unit, buyer, cost sheet
 * (taxable heads make the agreement value; pass-through heads — stamp duty, registration, society / maintenance
 * deposit, corpus — are collected as pure agent, Rule 33, never in the taxable value), payment plan, class at booking.
 * Receipts are ordinary advance receipt vouchers (`advances.ts`, GST at receipt; none after the completion certificate
 * or on a pass-through collection) tagged `booking_id`; demand invoices adjust them. Guards: RERA Sec 13 (> 10% before
 * a registered agreement — warn, never block) and the 194-IA hint (≥ ₹50 lakh). Working paper — verify with your CA.
 */
import './cn-registry';
import type { CostHead, RealtyBooking, RealtyProject, RealtyUnit } from '../../types/construction-r11';
import type { AdvanceRecord } from '../../types/advances';
import type { InvoiceRecord, Payment } from '../../types/invoice';
import { generateId, getTable, setTable } from '../storage';
import { requireAccess } from '../access';
import { num, round2 } from '../invoice-calc';
import { nextSeriesNumberFor, recordSeries } from '../series-counters';
import { assertUnlocked } from '../period-lock';
import { withTablesRollback } from '../table-txn';
import { localDb } from '../localDb';
import { loadAdvances, saveAdvance } from '../advances';
import { movedNoCash } from '../advance-tax';
import { RT, loadProjects, rows, upsert } from './cn-realty-projects';
import { loadUnits, unitPrice } from './cn-units';
import { loadPlans } from './cn-plans';
import { afterCc, landSplit, preAgreementWarning, tds194ia, unitClass } from './cn-realty-tax';

export const BKG = 'BKG';
export const loadBookings = () => rows<RealtyBooking>(RT.bookings);
export const live = (b: RealtyBooking) => b.status !== 'cancelled';

/** Default cost sheet of a unit: basic + PLC + parking / club / development (taxable) and the pass-through heads. */
export function defaultCostSheet(u: RealtyUnit): CostHead[] {
  const plc = (u.plc ?? []).map((p) => ({ head: p.label, amount: num(p.amount), taxable: true, pass_through: false }));
  const base = round2(unitPrice(u) - plc.reduce((s, p) => s + p.amount, 0));
  const tx = (head: string) => ({ head, amount: 0, taxable: true, pass_through: false });
  const pt = (head: string) => ({ head, amount: 0, taxable: false, pass_through: true });
  return [{ head: 'Basic', amount: base, taxable: true, pass_through: false }, ...plc, tx('Car parking'), tx('Club'), tx('Development charges'), pt('Stamp duty'), pt('Registration'), pt('Maintenance deposit'), pt('Corpus')];
}

/** Agreement value = every head that is not pass-through; taxable value = the taxable ones of those. */
export const agreementValue = (sheet: readonly CostHead[]) => round2(sheet.filter((h) => !h.pass_through).reduce((s, h) => s + num(h.amount), 0));
export const passThroughTotal = (sheet: readonly CostHead[]) => round2(sheet.filter((h) => h.pass_through).reduce((s, h) => s + num(h.amount), 0));

export interface BookingInput {
  date: string;
  unit_id: string;
  client_id?: string;
  client_name: string;
  co_applicants?: string;
  cost_sheet: CostHead[];
  stamp_value?: number;
  plan_id: string;
  broker?: RealtyBooking['broker'];
  loan?: RealtyBooking['loan'];
}

export function createBooking(i: BookingInput): RealtyBooking {
  requireAccess('doc.create');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.date)) throw new Error('Enter the booking date.');
  if (!i.client_name.trim()) throw new Error('Choose the buyer.');
  const unit = loadUnits().find((u) => u.id === i.unit_id);
  if (!unit || (unit.status !== 'available' && unit.status !== 'hold')) throw new Error('Choose an available unit.');
  const project = loadProjects().find((p) => p.id === unit.project_id);
  if (!project) throw new Error('The unit\'s project is missing.');
  if (!loadPlans().some((p) => p.id === i.plan_id)) throw new Error('Choose a payment plan.');
  const value = agreementValue(i.cost_sheet);
  if (!(value > 0)) throw new Error('The cost sheet has no consideration.');
  const all = loadBookings();
  const number = nextSeriesNumberFor(BKG, i.date, all.map((b) => b.number));
  assertUnlocked({ issue_date: i.date, invoice_number: number }, 'create');
  const row: RealtyBooking = {
    ...i, id: generateId(), number, project_id: project.id, client_name: i.client_name.trim(), agreement_value: value,
    cls: unitClass(unit, project, value, i.date), status: 'booked', created_at: new Date().toISOString(),
  };
  return withTablesRollback([RT.bookings, RT.units, 'series_counters'], () => {
    setTable(RT.bookings, [...all, row]);
    upsert(RT.units, { ...unit, status: 'booked', booking_id: row.id });
    recordSeries(number);
    return row;
  });
}

/** Agreement signed / registered / possession (dates kept); registration marks the unit registered. */
export function setBookingStatus(id: string, status: 'agreement' | 'registered' | 'possession', date: string): RealtyBooking {
  requireAccess('doc.create');
  const b = loadBookings().find((x) => x.id === id);
  if (!b || !live(b)) throw new Error('Booking not found.');
  const next: RealtyBooking = { ...b, status, ...(status === 'agreement' ? { agreement_date: date } : status === 'registered' ? { registered_on: date, agreement_date: b.agreement_date ?? date } : {}), updated_at: new Date().toISOString() };
  return withTablesRollback([RT.bookings, RT.units], () => {
    upsert(RT.bookings, next);
    const u = loadUnits().find((x) => x.id === b.unit_id);
    if (u && status === 'registered') upsert(RT.units, { ...u, status: 'registered' });
    return next;
  });
}

/** Interest on delay waived / charged again for a booking (audited through the table). */
export function setInterestWaived(id: string, waived: boolean): void {
  requireAccess('doc.create');
  const b = loadBookings().find((x) => x.id === id);
  if (b) upsert(RT.bookings, { ...b, interest_waived: waived || undefined, updated_at: new Date().toISOString() });
}

/** A booking with no receipt and no demand can be deleted (recycle bin); the unit is free again. */
export function deleteBooking(id: string): void {
  requireAccess('doc.create');
  const b = loadBookings().find((x) => x.id === id);
  if (!b) return;
  if (loadAdvances().some((a) => a.booking_id === id) || localDb.invoices.getAll().some((i) => i.boq_terms?.cn?.demand?.booking_id === id)) throw new Error(`${b.number} has receipts or demands: cancel it instead.`);
  assertUnlocked({ id, issue_date: b.date, invoice_number: b.number }, 'delete');
  withTablesRollback([RT.bookings, RT.units], () => {
    setTable(RT.bookings, loadBookings().filter((x) => x.id !== id));
    const u = loadUnits().find((x) => x.id === b.unit_id);
    if (u?.booking_id === id) upsert(RT.units, { ...u, status: 'available', booking_id: undefined });
  });
}

/* ── Receipts ── */

/** Demand invoices of a booking (live = not cancelled). */
export const demandsOf = (bookingId: string, invoices: readonly InvoiceRecord[]) => invoices.filter((i) => i.boq_terms?.cn?.demand?.booking_id === bookingId && i.status !== 'Cancelled' && i.doc_type !== 'CREDIT_NOTE');

export interface Received {
  /** Consideration received (advances net of refunds + money paid straight against demands). */
  consideration: number;
  passThrough: number;
}

/** Money received for a booking (no-cash rows — advance adjustments, write-offs — are not money). */
export function receivedFor(bookingId: string, advances: readonly AdvanceRecord[], payments: readonly Payment[], invoices: readonly InvoiceRecord[], upTo?: string): Received {
  const by = (a: AdvanceRecord) => a.booking_id === bookingId && (!upTo || a.date <= upTo);
  const net = (a: AdvanceRecord) => num(a.amount) - (a.refunds ?? []).reduce((s, r) => s + num(r.amount), 0);
  const ids = new Set(demandsOf(bookingId, invoices).map((i) => i.id));
  const direct = payments.filter((p) => ids.has(p.invoice_id) && !movedNoCash(p) && (!upTo || String(p.date ?? '') <= upTo)).reduce((s, p) => s + num(p.amount), 0);
  return {
    consideration: round2(advances.filter((a) => by(a) && !a.pass_through).reduce((s, a) => s + net(a), 0) + direct),
    passThrough: round2(advances.filter((a) => by(a) && a.pass_through).reduce((s, a) => s + net(a), 0)),
  };
}

/** GST rate on a booking receipt: none after CC; class effective rate (old option: the project's rate). */
export function receiptRate(b: Pick<RealtyBooking, 'cls'>, project: RealtyProject | undefined, date: string): number {
  if (afterCc(project, date)) return 0;
  return landSplit(0, b.cls, date, project?.old_rate).effective;
}

export interface ReceiptInput {
  date: string;
  amount: number;
  method: string;
  reference?: string;
  bankAccountId?: string;
  passThrough?: boolean;
  /** Bank paying a loan disbursement (printed as the payer). */
  payer?: string;
}

/** Record a booking receipt (an advance receipt voucher tagged with the booking). Returns it with the guards. */
export function recordReceipt(bookingId: string, r: ReceiptInput): { advance: AdvanceRecord; warn10: boolean } {
  const b = loadBookings().find((x) => x.id === bookingId);
  if (!b || !live(b)) throw new Error('Booking not found.');
  const project = loadProjects().find((p) => p.id === b.project_id);
  const client = b.client_id ? localDb.clients.getById(b.client_id) : undefined;
  const unit = loadUnits().find((u) => u.id === b.unit_id);
  const advance = saveAdvance({
    date: r.date, client: client ? { ...client, name: client.name } : { name: b.client_name }, place_of_supply: project?.state_code || '', supply: 'services',
    tax_rate: r.passThrough ? 0 : receiptRate(b, project, r.date), amount: r.amount, method: r.method, reference: r.reference, bankAccountId: r.bankAccountId,
    description: `${r.passThrough ? 'Pass-through collection (pure agent)' : 'Advance towards'} ${unit?.unit_no ?? ''} — booking ${b.number}`.trim(),
    ...(r.payer?.trim() ? { note: `Paid by ${r.payer.trim()}` } : {}),
    booking: { booking_id: b.id, ...(r.passThrough ? { pass_through: true } : {}) },
  });
  const rec = receivedFor(b.id, loadAdvances(), getTable<Payment>('transactions'), localDb.invoices.getAll());
  return { advance, warn10: !r.passThrough && preAgreementWarning(rec.consideration, b.agreement_value, b.registered_on, r.date) };
}

/** The 194-IA hint for a booking ("Buyer deducts 1% TDS (…); record it as TDS on the receipt"). */
export const bookingTds = (b: Pick<RealtyBooking, 'agreement_value' | 'stamp_value'>, date: string) => tds194ia(b.agreement_value, b.stamp_value, date);

