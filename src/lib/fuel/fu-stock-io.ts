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
import { billLitres } from './fu-receipt';
import { FU_LOSS_CLASS } from './fu-shared';
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

/** Post (or re-post) the month's register count as the tank's physical stock on `day`. */
export function postVariation(tank: FuTankRow, month: string, day: string, counted: number): PhysicalStockVoucher {
  const old = postedFor(tank.id, month);
  const input = { id: old?.id, number: old?.number, date: day, lines: [{ id: 'fu', item_id: tank.fu!.product_item_id, godown_id: tank.id, counted }], narration: `${FU_LOSS_CLASS}: ${tank.name}, ${month}`, fu: { tank_id: tank.id, month } };
  return physicalStockDb.save(input, stockDb.items(), liveInputs());
}
