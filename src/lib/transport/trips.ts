/**
 * R5-B3: trip sheets (`TRP/FY…`) — vehicle, driver, km, route, the LRs carried, expenses, driver advances and the
 * lorry hire of a hired vehicle.
 *
 *  - Expenses (diesel litres × rate, toll, loading, police / RTO, food, repairs) are ordinary quick expenses
 *    (`purchases`, kind EXPENSE) tagged with the vehicle's cost centre and `trip_id`, paid in cash.
 *  - A driver advance is a PAYMENT voucher: Dr "Loans & advances to employees" (3615) | Cr cash / bank. On close the
 *    expenses the driver paid from it and the cash he returned settle it: Dr cash | Cr 3615 (one journal); what is
 *    left stays as his advance (carried to the next trip).
 *  - A hired lorry's hire is a supplier bill (category "Lorry hire") with 194C. With the owner's Sec 194C(6)
 *    declaration (≤ 10 goods carriages, PAN) the TDS is nil with reason `T` (`tds-payables.ts`).
 * Reads `purchases` through `readPurchase` (purchase contract). Guards: role, period lock, series counter, audit.
 */
import type { PurchaseRecord, Vendor } from '../../types/purchases';
import type { Trip } from '../../types/transport-works-r5';
import { num, round2 } from '../invoice-calc';
import { requireAccess } from '../access';
import { assertUnlocked } from '../period-lock';
import { generateId, getTable, peekTable, setTable } from '../storage';
import { withTablesRollback } from '../table-txn';
import { nextSeriesNumberFor, recordSeries } from '../series-counters';
import { readPurchase } from '../purchase-normalize';
import { computePurchaseTotals, expenseLine, paymentsDb, purchasesDb, PURCHASES_TABLE } from '../purchases';
import { priorCreditsFor, resolveBillTds } from '../tds-payables';
import { A } from '../ledger/accounts';
import { deleteVoucher, loadVouchers, rupeesToPaise, saveVoucher } from '../ledger/vouchers';
import { LR_TABLE, setLrTrip } from './consignment-notes';
import { loadVehicles, ensureVehicleCostCentre, VEHICLES_TABLE } from './vehicles';

export const TRIPS_TABLE = 'trips';
export const TRIP_PREFIX = 'TRP';
export const TRIP_EXPENSE_KINDS = ['Diesel', 'Toll', 'Loading', 'Police / RTO', 'Food', 'Repairs', 'Other'] as const;
export const HIRE_CATEGORY = 'Lorry hire';
/** Bell: trips open for more than this many days. */
export const OPEN_TRIP_DAYS = 10;

export class TripError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TripError';
  }
}

export function loadTrips(): readonly Trip[] {
  return peekTable<Trip>(TRIPS_TABLE).filter((t) => t && typeof t.id === 'string');
}

export const nextTripNumber = (date: string, rows: readonly Pick<Trip, 'number'>[] = loadTrips()) => nextSeriesNumberFor(TRIP_PREFIX, date, rows.map((t) => t.number));

const lockOf = (t: Pick<Trip, 'id' | 'start_date' | 'number'>) => ({ id: t.id, issue_date: t.start_date, invoice_number: t.number });

function getTrip(id: string): Trip {
  const t = getTable<Trip>(TRIPS_TABLE).find((x) => x.id === id);
  if (!t) throw new TripError('Trip not found.');
  return t;
}

function writeTrip(t: Trip): void {
  const all = getTable<Trip>(TRIPS_TABLE);
  setTable(TRIPS_TABLE, all.some((x) => x.id === t.id) ? all.map((x) => (x.id === t.id ? t : x)) : [...all, t]);
}

export type TripInput = Pick<Trip, 'vehicle_id' | 'start_date'> & Partial<Pick<Trip, 'id' | 'driver' | 'end_date' | 'start_km' | 'end_km' | 'route' | 'lr_ids'>>;

/** Create / edit an open trip; the LRs carried go In transit. */
export function saveTrip(input: TripInput): Trip {
  requireAccess('doc.create');
  if (!input.vehicle_id || !loadVehicles().some((v) => v.id === input.vehicle_id)) throw new TripError('Choose the vehicle.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.start_date ?? '')) throw new TripError('Choose the start date.');
  if (input.end_km !== undefined && input.start_km !== undefined && num(input.end_km) < num(input.start_km)) throw new TripError('End km is below the start km.');
  const all = getTable<Trip>(TRIPS_TABLE);
  const prev = input.id ? all.find((t) => t.id === input.id) : undefined;
  if (prev && prev.status !== 'open') throw new TripError(`Trip ${prev.number} is ${prev.status}.`);
  const id = prev?.id ?? generateId();
  if (prev) assertUnlocked(lockOf(prev), 'edit');
  const number = prev?.number ?? nextTripNumber(input.start_date, all);
  assertUnlocked({ id, issue_date: input.start_date, invoice_number: number }, prev ? 'edit' : 'create');
  const busy = all.filter((t) => t.id !== id && t.status === 'open').flatMap((t) => t.lr_ids);
  const lrIds = [...new Set(input.lr_ids ?? prev?.lr_ids ?? [])];
  const clash = lrIds.find((l) => busy.includes(l));
  if (clash) throw new TripError('An LR is already on another open trip.');
  return withTablesRollback([TRIPS_TABLE, LR_TABLE, 'series_counters'], () => {
    const row: Trip = {
      ...prev,
      id,
      number,
      vehicle_id: input.vehicle_id,
      driver: input.driver?.trim() || undefined,
      start_date: input.start_date,
      end_date: input.end_date || undefined,
      start_km: input.start_km === undefined ? prev?.start_km : num(input.start_km),
      end_km: input.end_km === undefined ? prev?.end_km : num(input.end_km),
      route: input.route?.trim() || undefined,
      lr_ids: lrIds,
      advance_ids: prev?.advance_ids ?? [],
      status: 'open',
      created_at: prev?.created_at ?? new Date().toISOString(),
    };
    if (prev) setLrTrip(prev.lr_ids.filter((l) => !lrIds.includes(l)), undefined);
    setLrTrip(lrIds, id);
    writeTrip(row);
    recordSeries(number);
    return row;
  });
}

/** A trip expense as a quick expense (paid in cash) tagged with the vehicle cost centre and the trip. */
export function addTripExpense(tripId: string, e: { date: string; kind: string; amount: number; litres?: number; taxRate?: number; method?: string; note?: string }): PurchaseRecord {
  requireAccess('books.edit');
  const trip = getTrip(tripId);
  if (trip.status !== 'open') throw new TripError(`Trip ${trip.number} is ${trip.status}.`);
  if (!(num(e.amount) > 0)) throw new TripError('Enter the amount.');
  const vehicle = loadVehicles().find((v) => v.id === trip.vehicle_id);
  return withTablesRollback([PURCHASES_TABLE, 'purchase_payments', TRIPS_TABLE, VEHICLES_TABLE, 'cost_centres'], () => {
    const line = expenseLine(`${e.kind} — ${trip.number}`, num(e.amount), num(e.taxRate), true);
    const totals = computePurchaseTotals([line]);
    const cc = vehicle?.own ? ensureVehicleCostCentre(vehicle) : undefined;
    const bill = purchasesDb.save({
      kind: 'EXPENSE',
      vendor_name: e.kind,
      bill_number: '',
      date: e.date,
      category: `Trip — ${e.kind}`,
      lines: [line],
      taxable: totals.taxable, cgst: totals.cgst, sgst: totals.sgst, igst: totals.igst, total: totals.total,
      itc_eligible: num(e.taxRate) > 0,
      amount_paid: 0,
      notes: [e.note, num(e.litres) > 0 ? `${num(e.litres)} litres` : ''].filter(Boolean).join(' · ') || undefined,
      trip_id: tripId,
      ...(cc ? { cost_centre_id: cc } : {}),
    });
    paymentsDb.record(bill.id, { amount: bill.total, date: e.date, method: e.method || 'Cash' });
    if (num(e.litres) > 0) writeTrip({ ...getTrip(tripId), litres: round2(num(getTrip(tripId).litres) + num(e.litres)) });
    return purchasesDb.get(bill.id) ?? bill;
  });
}

const cashSide = (method: string) => (method.toLowerCase() === 'cash' ? A.cash : A.bank);

/** Driver advance: PAYMENT voucher Dr staff advances (3615) | Cr cash / bank. */
export function giveDriverAdvance(tripId: string, a: { date: string; amount: number; method: string }): Trip {
  requireAccess('books.edit');
  const trip = getTrip(tripId);
  if (trip.status !== 'open') throw new TripError(`Trip ${trip.number} is ${trip.status}.`);
  const paise = rupeesToPaise(a.amount);
  if (!(paise > 0)) throw new TripError('Enter the advance amount.');
  return withTablesRollback([TRIPS_TABLE, 'vouchers'], () => {
    const v = saveVoucher({ type: 'PAYMENT', date: a.date, narration: `Driver advance — trip ${trip.number}${trip.driver ? ` (${trip.driver})` : ''}`, voucher_class: 'Trip advance', lines: [{ account_id: A.staffAdvances, dr: paise, cr: 0, party: trip.driver }, { account_id: cashSide(a.method), dr: 0, cr: paise }] });
    const next = { ...getTrip(tripId), advance_ids: [...trip.advance_ids, v.id] };
    writeTrip(next);
    return next;
  });
}

/** Σ advances given on the trip (₹). */
export function tripAdvances(trip: Pick<Trip, 'advance_ids' | 'settle_id'>, vouchers = loadVouchers()): { given: number; settled: number } {
  const amt = (id: string | undefined) => {
    const v = id ? vouchers.find((x) => x.id === id) : undefined;
    return v ? v.lines.reduce((s, l) => s + (l.account_id === A.staffAdvances ? l.dr - l.cr : 0), 0) / 100 : 0;
  };
  return { given: round2(trip.advance_ids.reduce((s, id) => s + amt(id), 0)), settled: round2(-amt(trip.settle_id)) };
}

/** Trip expenses (`purchases` with this trip id, hire bill excluded) through the purchase contract. */
export function tripExpenses(tripId: string, purchases: readonly unknown[] = peekTable('purchases')): { id: string; date: string; category: string; amount: number; paid: number }[] {
  const out: { id: string; date: string; category: string; amount: number; paid: number }[] = [];
  for (const raw of purchases) {
    const r = raw as { trip_id?: string; category?: string; amount_paid?: number };
    if (r?.trip_id !== tripId || r.category === HIRE_CATEGORY) continue;
    const c = readPurchase(raw);
    if (!c) continue;
    out.push({ id: c.id, date: c.date, category: c.category, amount: c.itcEligible ? c.taxable : c.total, paid: round2(num(r.amount_paid)) });
  }
  return out;
}

/**
 * Close the trip: end day / km; `spent` (expenses the driver paid from the advance) and `returned` (cash back) settle the
 * advance in one journal (Dr cash | Cr 3615). The rest of the advance is carried.
 */
export function closeTrip(tripId: string, c: { date: string; end_km?: number; spent?: number; returned?: number }): Trip {
  requireAccess('books.edit');
  const trip = getTrip(tripId);
  if (trip.status !== 'open') throw new TripError(`Trip ${trip.number} is ${trip.status}.`);
  if (c.date < trip.start_date) throw new TripError('The end date is before the start date.');
  if (c.end_km !== undefined && trip.start_km !== undefined && num(c.end_km) < num(trip.start_km)) throw new TripError('End km is below the start km.');
  const adv = tripAdvances(trip);
  const settle = round2(num(c.spent) + num(c.returned));
  if (settle > adv.given + 0.004) throw new TripError(`Spent + returned (₹${settle}) is more than the advances (₹${adv.given}).`);
  assertUnlocked(lockOf(trip), 'edit');
  return withTablesRollback([TRIPS_TABLE, 'vouchers'], () => {
    let settleId: string | undefined;
    if (settle > 0) {
      const p = rupeesToPaise(settle);
      settleId = saveVoucher({ type: 'JOURNAL', date: c.date, narration: `Driver advance settled — trip ${trip.number}: spent ₹${round2(num(c.spent))}, returned ₹${round2(num(c.returned))}`, voucher_class: 'Trip advance', lines: [{ account_id: A.cash, dr: p, cr: 0 }, { account_id: A.staffAdvances, dr: 0, cr: p, party: trip.driver }] }).id;
    }
    const next: Trip = { ...getTrip(tripId), status: 'closed', closed_on: c.date, end_date: c.date, ...(c.end_km !== undefined ? { end_km: num(c.end_km) } : {}), ...(settleId ? { settle_id: settleId } : {}) };
    writeTrip(next);
    return next;
  });
}

/** Re-open a closed trip (its settlement journal is deleted through the ledger's own call). */
export function reopenTrip(tripId: string): Trip {
  requireAccess('books.edit');
  const trip = getTrip(tripId);
  if (trip.status !== 'closed') return trip;
  return withTablesRollback([TRIPS_TABLE, 'vouchers', 'transactions', 'invoices'], () => {
    if (trip.settle_id) deleteVoucher(trip.settle_id);
    const next: Trip = { ...trip, status: 'open', closed_on: undefined, settle_id: undefined };
    writeTrip(next);
    return next;
  });
}

/* ── Lorry hire (hired vehicle, 194C / 194C(6)) ─────────────────── */

/** The 194C section code for a payee (individual / HUF vs others). */
export const hireSection = (v: Pick<Vendor, 'deductee_type' | 'pan'> | undefined) =>
  v?.deductee_type === 'INDIVIDUAL' || v?.deductee_type === 'HUF' || /^[A-Z]{3}[PH]/.test(String(v?.pan ?? '').toUpperCase()) ? '194C-1' : '194C-2';

/** Lorry hire bill from the owner, TDS 194C (nil with reason T under a valid 194C(6) declaration). */
export function recordLorryHire(tripId: string, h: { date: string; vendorId: string; amount: number; billNumber?: string }): PurchaseRecord {
  requireAccess('books.edit');
  const trip = getTrip(tripId);
  if (trip.hire_bill_id && purchasesDb.get(trip.hire_bill_id)) throw new TripError(`Trip ${trip.number} already has a lorry hire bill.`);
  const vendor = getTable<Vendor>('vendors').find((v) => v.id === h.vendorId);
  if (!vendor) throw new TripError('Choose the lorry owner (a supplier).');
  if (!(num(h.amount) > 0)) throw new TripError('Enter the hire amount.');
  const line = { id: generateId(), name: `Lorry hire — ${trip.number}`, quantity: 1, rate: round2(num(h.amount)), tax_rate: 0 };
  const totals = computePurchaseTotals([line]);
  const decl = vendor.transporter_194c6;
  const { fields } = resolveBillTds(
    { section: vendor.tds_section?.startsWith('194C') ? vendor.tds_section : hireSection(vendor), on: 'BILL', pan: vendor.pan ?? decl?.pan ?? '', ...(decl ? { transporter194c6: decl } : {}) },
    { date: h.date, taxable: totals.taxable, prior: priorCreditsFor(purchasesDb.all(), vendor) },
  );
  return withTablesRollback([PURCHASES_TABLE, TRIPS_TABLE], () => {
    const bill = purchasesDb.save({
      kind: 'PURCHASE', vendor_id: vendor.id, vendor_name: vendor.name, vendor_gstin: vendor.gstin, bill_number: h.billNumber?.trim() || trip.number, date: h.date,
      category: HIRE_CATEGORY, lines: [line], taxable: totals.taxable, cgst: 0, sgst: 0, igst: 0, total: totals.total, itc_eligible: false, amount_paid: 0,
      trip_id: tripId, ...fields,
    });
    writeTrip({ ...getTrip(tripId), hire_bill_id: bill.id });
    return bill;
  });
}
