/**
 * R21-A3 dated fuel prices (`fuel_prices`, `master.edit`, dated by `date`, audited): a retail selling price per litre /
 * kg from a date and a time (oil-company prices change at 06:00, sometimes mid-day). The price of a sale is the latest
 * row at or before its moment; a second row for the same item and moment replaces the first (to the recycle bin).
 */
import './fu-registry';
import { generateId, getTable, setTable } from '../storage';
import type { FuelPrice } from '../../types/fuel-r21';
import { FU_TABLES } from './fu-shared';
import { priceAt } from './fu-line';

export const readPrices = (): FuelPrice[] => getTable<FuelPrice>(FU_TABLES.prices);
const at = (p: Pick<FuelPrice, 'date' | 'time'>) => `${p.date} ${p.time}`;

/** Add a price row (refused with the reason). */
export function savePrice(input: Omit<FuelPrice, 'id' | 'created_at'>): FuelPrice {
  if (!input.item_id) throw new Error('Pick the product.');
  if (!(input.rsp > 0)) throw new Error('Type the retail selling price.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time)) throw new Error('Type the date and the time (HH:MM) the price applies from.');
  const row: FuelPrice = { ...input, id: generateId(), created_at: new Date().toISOString() };
  setTable(FU_TABLES.prices, [...readPrices().filter((r) => !(r.item_id === row.item_id && at(r) === at(row))), row]);
  return row;
}

/** "Copy yesterday": a row at `day` `time` for each item, at its price in force at the end of the day before (items priced at that moment already are left alone). */
export function copyYesterday(itemIds: readonly string[], day: string, prevDay: string, time: string): number {
  const all = readPrices();
  const add = itemIds.flatMap((id) => {
    const p = priceAt(all, id, prevDay, '23:59');
    return p && !all.some((r) => r.item_id === id && at(r) === `${day} ${time}`) ? [{ ...p, id: generateId(), date: day, time, created_at: new Date().toISOString() }] : [];
  });
  if (add.length) setTable(FU_TABLES.prices, [...all, ...add]);
  return add.length;
}
