/**
 * R21-B1 / B3 the shift store and the day-close plan. Writes `fuel_shifts` (`doc.create`, audited; deletes go to the
 * recycle bin): open a shift (a reading per held nozzle, opening carried), save readings / collections, close it once
 * every reading is valid. `planShift` is what the day close of a closed shift issues: ONE non-GST Bill of Supply of its
 * counter litres (lines per tank × product, so stock leaves the right tank), receipts by mode and the excess (a note). The
 * documents are written by `fu-issue-io.ts` in one `saveMany` for the day. Working papers — verify with your CA (FU6).
 */
import './fu-registry';
import { generateId, getTable, setTable } from '../storage';
import { requireAccess } from '../access';
import { audit } from '../audit';
import type { InvoiceRecord } from '../../types/invoice';
import type { FuelNozzle, FuelPrice, FuelShift, FuelSlip, FuReading } from '../../types/fuel-r21';
import { FU_TABLES } from './fu-shared';
import { nozzleLabel } from './fu-line';
import { carriedOpening, readingIssue, shiftSales } from './fu-shift';
import { billedInShift, counterLines, postPlan, settleShift } from './fu-settle';
import { fbT } from '../../i18n/areas/fuel-r21b';

export const readShifts = (): FuelShift[] => getTable<FuelShift>(FU_TABLES.shifts);

function put(row: FuelShift): FuelShift {
  setTable(FU_TABLES.shifts, [...readShifts().filter((x) => x.id !== row.id), row]);
  return row;
}

/** Open shift `no` of `date` from `start` (HH:MM): a reading per held nozzle, opening carried, the daily test litres. */
export function openShift(i: { date: string; shift_no: number; start: string; attendants: FuelShift['attendants']; test_l: number }, nozzles: readonly FuelNozzle[]): FuelShift {
  requireAccess('doc.create');
  const all = readShifts();
  if (all.some((s) => s.date === i.date && s.shift_no === i.shift_no)) throw new Error(fbT('eDup', { n: i.shift_no, d: i.date }));
  const att = i.attendants.filter((a) => (a.name ?? a.employee_id ?? '').trim() && a.nozzle_ids.length);
  const held = att.flatMap((a) => a.nozzle_ids);
  if (!held.length) throw new Error(fbT('eAtt'));
  if (new Set(held).size < held.length) throw new Error(fbT('eTwice'));
  const readings: FuReading[] = held.map((id) => ({ nozzle_id: id, opening: carriedOpening(nozzles.find((n) => n.id === id) ?? { id, totaliser_start: 0 }, all, i.date, i.shift_no), test_l: i.test_l, test_returned: true }));
  return put({ id: generateId(), date: i.date, shift_no: i.shift_no, opened_at: `${i.date} ${i.start}`, attendants: att, readings, collections: [], status: 'open' });
}

/** Save readings / collections; `closeAt` (a moment) closes the shift once every reading is valid. A posted shift is refused. */
export function saveShift(id: string, patch: Pick<FuelShift, 'readings'> & Partial<Pick<FuelShift, 'collections'>>, nozzles: readonly FuelNozzle[], closeAt?: string): FuelShift {
  requireAccess('doc.create');
  const all = readShifts();
  const s = all.find((x) => x.id === id);
  if (!s) throw new Error(fbT('eNoShift'));
  if (s.status === 'posted') throw new Error(fbT('ePosted'));
  const lab = (r: FuReading) => ((n) => (n ? nozzleLabel(n) : r.nozzle_id))(nozzles.find((x) => x.id === r.nozzle_id));
  for (const r of patch.readings) {
    const n = nozzles.find((x) => x.id === r.nozzle_id);
    const carried = n ? carriedOpening(n, all, s.date, s.shift_no) : r.opening;
    if (Math.abs(r.opening - carried) < 0.0005) continue;
    if (!r.reason?.trim()) throw new Error(fbT('eReason', { n: lab(r) }));
    if (s.readings.find((x) => x.nozzle_id === r.nozzle_id)?.opening !== r.opening) {
      audit.record({ entity: 'invoice', entity_id: s.id, action: 'update', summary: `Pump shift ${s.date} #${s.shift_no}: nozzle ${lab(r)} opening ${carried} → ${r.opening} (${r.reason.trim()})` });
    }
  }
  const next: FuelShift = { ...s, readings: patch.readings, ...(patch.collections ? { collections: patch.collections.filter((c) => c.amount > 0) } : {}) };
  if (closeAt) {
    for (const r of next.readings) { const bad = readingIssue(r, lab(r)); if (bad) throw new Error(bad); }
    if (closeAt <= s.opened_at) throw new Error(fbT('eCloseAt'));
    Object.assign(next, { status: 'closed', closed_at: closeAt });
  }
  return put(next);
}

/** Delete an open shift (to the recycle bin). */
export function removeShift(id: string): void {
  requireAccess('doc.create');
  if (readShifts().find((x) => x.id === id)?.status !== 'open') throw new Error(fbT('eNotOpen'));
  setTable(FU_TABLES.shifts, readShifts().filter((x) => x.id !== id));
}

/** Set a shift's status / settlement fields (the day-close bridge). */
export function markShift(id: string, patch: Partial<Pick<FuelShift, 'status' | 'settled'>>): FuelShift {
  const s = readShifts().find((x) => x.id === id);
  if (!s) throw new Error(fbT('eNoShift'));
  const next = { ...s, ...patch };
  if ('settled' in patch && !patch.settled) delete next.settled;
  return put(next);
}

export interface FuData { nozzles: readonly FuelNozzle[]; prices: readonly FuelPrice[]; invoices: readonly InvoiceRecord[]; slips?: readonly FuelSlip[] }

/** Everything a shift's settlement and day close need (refused with the reason when a reading or a price is missing). */
export function planShift(s: FuelShift, d: FuData) {
  const sales = shiftSales(s, d.nozzles, d.prices);
  const billed = billedInShift(s, d.invoices, d.slips);
  const people = settleShift(s, sales, billed);
  return { sales, billed, people, lines: counterLines(sales, billed), ...postPlan(people) };
}
export type ShiftPlan = ReturnType<typeof planShift>;
