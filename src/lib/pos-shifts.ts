/**
 * Cashier shifts (8E, roadmap 8.142): each counter user opens a shift with an opening float, takes an
 * X report at any time (totals so far, nothing changes) and closes the shift with a cash count — the
 * Z report of that shift. Optional: with no shift open the POS bills as before, and the day close
 * (`pos_day_close`, Z report per day) keeps working unchanged across all shifts.
 *
 * Storage: table `pos_shifts` (company data: backed up, synced, dated by `day`; written with the
 * `doc.create` right like POS returns, so a clerk runs their own shift). A shift row lists the POS bills
 * saved while it was open (`bill_ids`), so totals never depend on clocks or on which device billed:
 * bills → `zReport` maths (tax, tenders from those bills' payments, returns made during the shift).
 * Closing is refused while bills are on hold on this counter (they would fall outside every shift).
 *
 * Pure above "Storage".
 */
import type { InvoiceRecord, Payment } from '../types/invoice';
import { num, round2 } from './invoice-calc';
import { zReport, type ZReport } from './pos';
import type { PosReturn } from './pos-returns';
import { currentActor, requireAccess } from './access';
import { audit } from './audit';
import { generateId, getTable, setTable } from './storage';

export const POS_SHIFTS_TABLE = 'pos_shifts';

export interface PosShift {
  id: string;
  /** Local day the shift opened (YYYY-MM-DD). */
  day: string;
  /** Shift number of that day (1, 2, …), across users. */
  number: number;
  user_id: string;
  user_name: string;
  opened_at: string;
  opening_float: number;
  /** POS bills saved while the shift was open. */
  bill_ids: string[];
  closed_at?: string;
  /** opening float + cash taken − cash refunded (at close). */
  expected_cash?: number;
  counted_cash?: number;
  /** counted − expected (negative = short). */
  difference?: number;
  /** Totals frozen at close (the shift's Z report summary). */
  totals?: ShiftTotals;
  note?: string;
}

export interface ShiftTotals {
  bills: number;
  net: number;
  cash: number;
  upi: number;
  card: number;
  other: number;
  credit: number;
  returns: number;
  cash_refunds: number;
}

/** The person at the counter (signed-in local user, or the owner on a single-user install). */
export function counterUser(): { id: string; name: string } {
  const a = currentActor();
  return a ? { id: a.id, name: a.name || a.role } : { id: 'owner', name: 'Owner' };
}

/** The open shift of `userId`, if any. */
export const openShiftOf = (shifts: readonly PosShift[], userId: string): PosShift | undefined => shifts.find((s) => s.user_id === userId && !s.closed_at);

/**
 * The shift's report in Z-report shape: its bills (dated as the shift day, so a shift past midnight
 * stays one report), their payments up to the close, and returns made while it was open.
 */
export function shiftReport(shift: PosShift, invoices: readonly InvoiceRecord[], payments: readonly Payment[], returns: readonly PosReturn[] = [], now = new Date().toISOString()): ZReport {
  const ids = new Set(shift.bill_ids);
  const closeDay = (shift.closed_at ?? now).slice(0, 10);
  const bills = invoices.filter((i) => ids.has(i.id)).map((i) => ({ ...i, issue_date: shift.day }));
  const pays = payments.filter((p) => ids.has(p.invoice_id) && p.date <= closeDay && p.date >= shift.day).map((p) => ({ ...p, date: shift.day }));
  const until = shift.closed_at ?? now;
  const rets = returns.filter((r) => r.created_at >= shift.opened_at && r.created_at <= until).map((r) => ({ ...r, day: shift.day }));
  // QA-3 F1: `zReturns` values each return from its credit note, so the shift's return CNs go in with
  // its bills (a CN carries no `pos` flag, so it is never counted as a bill).
  const cnIds = new Set(rets.map((r) => r.credit_note_id));
  const cns = invoices.filter((i) => cnIds.has(i.id) && !ids.has(i.id));
  return zReport(shift.day, [...bills, ...cns], pays, rets);
}

export function shiftTotals(z: ZReport): ShiftTotals {
  return {
    bills: z.bills,
    net: z.net,
    cash: z.tenders.cash,
    upi: z.tenders.upi,
    card: z.tenders.card,
    other: z.tenders.other,
    credit: z.credit,
    returns: round2(z.returns?.value ?? 0),
    cash_refunds: round2(z.returns?.refunds.cash ?? 0),
  };
}

/** Cash that should be in the drawer: float + cash taken − cash refunded. */
export function shiftExpected(z: ZReport, openingFloat: number): number {
  return round2(Math.max(num(openingFloat), 0) + z.tenders.cash - num(z.returns?.refunds.cash));
}

/** Why a shift cannot be closed now ('' = it can). */
export function closeBlocker(heldBills: number): string {
  return heldBills > 0 ? `${heldBills} bill${heldBills === 1 ? ' is' : 's are'} on hold — recall and save or drop ${heldBills === 1 ? 'it' : 'them'} before closing the shift.` : '';
}

/**
 * QA-3 F16: the drawer's opening float for the day Z report: the float of the day's first shift (one
 * drawer: later shifts take over the cash already in it). 0 when no shift was opened that day.
 */
export function dayOpeningFloat(shifts: readonly PosShift[], day: string): number {
  const first = shifts.filter((s) => s.day === day).sort((a, b) => (a.number || 0) - (b.number || 0))[0];
  return first ? round2(Math.max(num(first.opening_float), 0)) : 0;
}

/** Next shift number for `day`. */
export const nextShiftNumber = (shifts: readonly PosShift[], day: string): number => shifts.filter((s) => s.day === day).reduce((m, s) => Math.max(m, s.number || 0), 0) + 1;

/* ── Storage ─────────────────────────────────────────────────── */

const write = (rows: PosShift[]) => setTable(POS_SHIFTS_TABLE, rows);
const log = (s: PosShift, action: 'create' | 'update', summary: string) => {
  try {
    audit.record({ entity: 'pos_day_close', entity_id: s.id, action, summary });
  } catch {
    /* logging never breaks a save */
  }
};

export const shiftsDb = {
  all: (): PosShift[] => getTable<PosShift>(POS_SHIFTS_TABLE),
  current: (): PosShift | undefined => openShiftOf(shiftsDb.all(), counterUser().id),
  /** Open a shift for the signed-in user (refused when they already have one open). */
  open: (openingFloat: number, day: string): PosShift => {
    requireAccess('doc.create');
    const all = shiftsDb.all();
    const user = counterUser();
    if (openShiftOf(all, user.id)) throw new Error('You already have a shift open — close it first.');
    const row: PosShift = {
      id: generateId(),
      day,
      number: nextShiftNumber(all, day),
      user_id: user.id,
      user_name: user.name,
      opened_at: new Date().toISOString(),
      opening_float: round2(Math.max(num(openingFloat), 0)),
      bill_ids: [],
    };
    write([...all, row]);
    log(row, 'create', `Opened POS shift ${row.number} (${day}) for ${row.user_name}, float ₹${row.opening_float}`);
    return row;
  },
  /** Note a saved POS bill on the open shift (no-op without one). */
  addBill: (shiftId: string, billId: string): void => {
    const all = shiftsDb.all();
    const idx = all.findIndex((s) => s.id === shiftId && !s.closed_at);
    if (idx < 0 || all[idx].bill_ids.includes(billId)) return;
    all[idx] = { ...all[idx], bill_ids: [...all[idx].bill_ids, billId] };
    write(all);
  },
  /** Close with the counted cash; refused while bills are on hold. Returns the closed row. */
  close: (shiftId: string, z: ZReport, counted: number, heldBills: number, note?: string): PosShift => {
    requireAccess('doc.create');
    const blocker = closeBlocker(heldBills);
    if (blocker) throw new Error(blocker);
    const all = shiftsDb.all();
    const idx = all.findIndex((s) => s.id === shiftId);
    if (idx < 0) throw new Error('This shift no longer exists.');
    if (all[idx].closed_at) throw new Error('This shift is already closed.');
    const expected = shiftExpected(z, all[idx].opening_float);
    const row: PosShift = {
      ...all[idx],
      closed_at: new Date().toISOString(),
      expected_cash: expected,
      counted_cash: round2(num(counted)),
      difference: round2(num(counted) - expected),
      totals: shiftTotals(z),
      ...(note?.trim() ? { note: note.trim() } : {}),
    };
    all[idx] = row;
    write(all);
    log(row, 'update', `Closed POS shift ${row.number} (${row.day}) of ${row.user_name}: counted ₹${row.counted_cash}, expected ₹${expected}, difference ₹${row.difference}`);
    return row;
  },
};
