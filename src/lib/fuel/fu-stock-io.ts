/**
 * R21-C bridge to shared lazy code (≤ 4 bridges in Round 21): tanks (godowns with `fu`), the OMC bills of a product
 * read through `readPurchase` / `readPurchaseLines` (purchases contract), the stock engine's book in a tank and the
 * monthly stock-register loss / gain posting — a Physical Stock voucher for the tank, class "Normal loss — evaporation /
 * handling", ONE per tank per month (`PhysicalStockVoucher.fu`; a second post edits it). Working papers (FU18).
 */
import './fu-registry';
import { godownsDb } from '../godowns';
import { liveInputs, stockDb } from '../inventory';
import { physicalLines, physicalStockDb } from '../manufacturing';
import { isVoidStatus, readPurchase, readPurchaseLines } from '../purchase-normalize';
import { getTable } from '../storage';
import type { PhysicalStockVoucher } from '../../types/manufacturing';
import type { InvoiceRecord } from '../../types/invoice';
import type { FuelNozzle, FuelShift, FuelSlip } from '../../types/fuel-r21';
import { billLitres } from './fu-receipt';
import { FU_LOSS_CLASS, FU_TABLES } from './fu-shared';
import { tankOf } from './fu-line';
import type { FuTankRow } from './fu-dips';

export const fuTanks = (): FuTankRow[] => godownsDb.stored().filter((g) => g.fu);
export const fuItems = () => stockDb.items();

export interface OmcBill { id: string; number: string; date: string; party: string; litres: number; rate: number }

/** Live purchase bills carrying `item` (newest first): their litres and rate per litre. */
export function omcBills(item: { id: string; name: string }, rows: readonly unknown[] = getTable('purchases')): OmcBill[] {
  return rows.flatMap((raw) => {
    const p = readPurchase(raw);
    if (!p || p.isExpense || isVoidStatus(p.status)) return [];
    const b = billLitres(readPurchaseLines(raw), item);
    return b.litres > 0 ? [{ id: p.id, number: p.number, date: p.date, party: p.partyName, ...b }] : [];
  }).sort((a, b) => b.date.localeCompare(a.date));
}

/** The stock engine's closing quantity of the tank's product in the tank on `day`. */
export function stockBook(tank: FuTankRow, day: string): number {
  return physicalLines([{ id: 'fu', item_id: tank.fu!.product_item_id, godown_id: tank.id, counted: 0 }], day, liveInputs())[0]?.book_qty ?? 0;
}

/** The month's loss / gain voucher of a tank, if posted. */
export const postedFor = (tankId: string, month: string): PhysicalStockVoucher | undefined => physicalStockDb.all().find((v) => v.fu?.tank_id === tankId && v.fu.month === month);

export interface FuBooksLag { slipsL: number; shifts: string[] }

/**
 * QA25 W6 (pure): what the dip has seen leave the tank by `day` that the books have not — litres on credit slips not yet
 * billed (FU7: the slip bill takes them out of stock later) and this month's shifts holding the tank's nozzles that are
 * not day-closed (their counter bill is not written yet).
 */
export function booksLag(tank: Pick<FuTankRow, 'id'>, month: string, day: string, d: { slips: readonly FuelSlip[]; docs: readonly InvoiceRecord[]; nozzles: readonly FuelNozzle[]; shifts: readonly FuelShift[]; tanks: readonly FuTankRow[] }): FuBooksLag {
  const billed = new Set(d.docs.flatMap((x) => (x.status === 'Cancelled' ? [] : x.fu?.slip_ids ?? []))); // `billedSlipIds` (kept out of this chunk)
  const slipsL = d.slips.filter((s) => !billed.has(s.id) && s.date <= day && tankOf(s.item_id, s.nozzle_id, d.nozzles, d.tanks) === tank.id).reduce((t, s) => t + s.litres, 0);
  const mine = new Set(d.nozzles.filter((n) => n.tank_id === tank.id).map((n) => n.id));
  const shifts = d.shifts.filter((s) => s.status !== 'posted' && s.date.startsWith(month) && s.date <= day && s.readings.some((r) => mine.has(r.nozzle_id))).map((s) => `${s.date} #${s.shift_no}`);
  return { slipsL: Math.round(slipsL * 1000) / 1000, shifts };
}

/**
 * Post (or re-post) the month's register count as the tank's physical stock on `day`. The count is the dip plus the
 * unbilled slip litres (they leave the books when billed — without them the slips would be lost twice); refused while a
 * shift of the month is not day-closed (QA25 W6).
 */
export function postVariation(tank: FuTankRow, month: string, day: string, physical: number): PhysicalStockVoucher {
  const lag = booksLag(tank, month, day, { slips: getTable<FuelSlip>(FU_TABLES.slips), docs: getTable<InvoiceRecord>('invoices'), nozzles: getTable<FuelNozzle>(FU_TABLES.nozzles), shifts: getTable<FuelShift>(FU_TABLES.shifts), tanks: fuTanks() });
  if (lag.shifts.length) throw new Error(`Day-close these shifts first, or their litres count as a loss: ${lag.shifts.join(', ')}.`);
  const counted = Math.round((physical + lag.slipsL) * 1000) / 1000;
  const old = postedFor(tank.id, month);
  const input = { id: old?.id, number: old?.number, date: day, lines: [{ id: 'fu', item_id: tank.fu!.product_item_id, godown_id: tank.id, counted }], narration: `${FU_LOSS_CLASS}: ${tank.name}, ${month}`, fu: { tank_id: tank.id, month } };
  return physicalStockDb.save(input, stockDb.items(), liveInputs());
}
