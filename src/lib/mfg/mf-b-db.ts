/**
 * MF-B shared data-layer helpers (engineering, plastics, printing writers): rows of a table, insert-or-replace by id,
 * delete through `setTable` (the recycle bin keeps the row; audited by the edit observer), rounding and the bare-day
 * check. Every importer is a writer of a Round 13 table, so this file carries the registry side effect.
 */
import './mf-registry';
import { getTable, setTable } from '../storage';
import { num } from '../invoice-calc';
import { requireAccess } from '../access';
import { stockDb, type StockItem } from '../inventory';

export const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const r2 = (x: number) => Math.round((num(x) + Number.EPSILON) * 100) / 100 || 0;
export const r3 = (x: number) => Math.round((num(x) + Number.EPSILON) * 1000) / 1000 || 0;
export const nowIso = () => new Date().toISOString();

export const rowsOf = <T>(t: string): T[] => getTable<T>(t).filter((r) => !!r && typeof (r as { id?: unknown }).id === 'string');

/** Insert or replace a row by id (one table write). */
export function put<T extends { id: string }>(t: string, row: T): T {
  const all = rowsOf<T>(t);
  setTable(t, all.some((r) => r.id === row.id) ? all.map((r) => (r.id === row.id ? row : r)) : [...all, row]);
  return row;
}

/** Data-layer delete (the row goes to the recycle bin). */
export const drop = (t: string, id: string) => setTable(t, rowsOf<{ id: string }>(t).filter((r) => r.id !== id));

/** The row or an error. */
export function mustGet<T extends { id: string }>(t: string, id: string, what: string): T {
  const r = rowsOf<T>(t).find((x) => x.id === id);
  if (!r) throw new Error(`This ${what} no longer exists.`);
  return r;
}

/** Master edit of a stock item's MF-B fields (scrap class, EPR category, regrind limit …). */
export function patchItem(id: string, patch: Partial<StockItem>): void {
  requireAccess('master.edit');
  const it = stockDb.items().find((i) => i.id === id);
  if (!it) throw new Error('Item not found.');
  stockDb.saveItem({ ...it, ...patch });
}

/** Scrap / regrind rate of an item (its sale rate, else its opening rate). */
export const scrapRate = (it: { sale_rate?: number; opening_rate?: number } | undefined): number => num(it?.sale_rate) || num(it?.opening_rate);
