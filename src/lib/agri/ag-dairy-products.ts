/**
 * AG-B5 dairy products: BOM starters (existing `boms`) for paneer, khoa, curd, ghee and buttermilk, with by-products
 * (whey, ghee residue) and TYPICAL yields as editable values ("practice — adjust"), each item carrying its A3 agri class
 * so the rate is suggested by date (paneer nil and ghee 5% from 22 Sep 2025, AG4). Making uses the existing
 * manufacturing journal / production order. Fat memo: kg fat in (milk) vs kg fat in the products.
 */
import type { AgClass } from '../../types/agri-r12';
import type { Bom } from '../../types/manufacturing';
import { num, round2 } from '../invoice-calc';
import { blankStockItem, stockDb } from '../inventory';
import { bomsDb } from '../manufacturing';
import { agClassAt } from '../agri-rules';
import { generateId } from '../storage';
import { milkItemId } from './ag-shifts';
import { q3 } from './ag-rate-chart';

export interface DairyStarter { key: string; name: string; cls: AgClass; unit: string; hsn: string; milkL: number; fatPct: number; by?: { name: string; qty: number; unit: string; rate: number } }
/** Per 1 unit of product: litres of milk and the product's typical fat % (practice — adjust). */
export const DAIRY_STARTERS: readonly DairyStarter[] = [
  { key: 'paneer', name: 'Paneer', cls: 'paneer', unit: 'KGS', hsn: '0406', milkL: 5, fatPct: 22, by: { name: 'Whey', qty: 4, unit: 'LTR', rate: 0 } },
  { key: 'khoa', name: 'Khoa', cls: 'paneer', unit: 'KGS', hsn: '0402', milkL: 4.5, fatPct: 25 },
  { key: 'curd', name: 'Curd', cls: 'curd_loose', unit: 'KGS', hsn: '0403', milkL: 1, fatPct: 4 },
  { key: 'ghee', name: 'Ghee', cls: 'ghee_butter', unit: 'KGS', hsn: '0405', milkL: 22, fatPct: 99.5, by: { name: 'Ghee residue', qty: 0.05, unit: 'KGS', rate: 0 } },
  { key: 'buttermilk', name: 'Buttermilk', cls: 'curd_loose', unit: 'LTR', hsn: '0403', milkL: 0.5, fatPct: 1 },
];

/** Suggested rate / HSN of a starter on a date (a typed rate always wins). */
export const starterRate = (s: Pick<DairyStarter, 'cls'>, date?: string) => agClassAt(s.cls, date);

const itemFor = (name: string, unit: string, hsn: string, cls?: AgClass, rate?: number): string => {
  const hit = stockDb.items().find((i) => i.name.toLowerCase() === name.toLowerCase());
  if (hit) return hit.id;
  const it = blankStockItem({ name, unit, hsn, ...(cls ? { ag_class: cls } : {}), ...(rate !== undefined ? { tax_rate: rate } : {}) });
  stockDb.saveItem(it);
  return it.id;
};

/** Create the product item (with its class) and its starter BOM from cow / buffalo milk; returns the BOM. */
export function addStarter(key: string, milk: 'cow' | 'buffalo' = 'buffalo', date?: string): Bom {
  const s = DAIRY_STARTERS.find((x) => x.key === key);
  if (!s) throw new Error('Unknown product.');
  const product = itemFor(s.name, s.unit, s.hsn, s.cls, starterRate(s, date)?.rate);
  const outputs = s.by ? [{ id: generateId(), item_id: itemFor(s.by.name, s.by.unit, '0404'), qty: s.by.qty, kind: 'by_product' as const, rate: s.by.rate }] : [];
  return bomsDb.save({ item_id: product, name: 'Starter (practice — adjust)', batch_qty: 1, components: [{ id: generateId(), item_id: milkItemId(milk), qty: s.milkL }], outputs, notes: 'Typical yield — adjust to your own (AG-B5).' }, stockDb.items());
}

/** Fat memo: kg fat in the milk used vs kg fat in the products made (and the loss). */
export function fatMemo(milkL: number, milkFatPct: number, products: readonly { qty: number; fatPct: number }[], clr = 28): { fatIn: number; fatOut: number; loss: number; lossPct: number } {
  const fatIn = q3((num(milkL) * (1 + clr / 1000) * num(milkFatPct)) / 100);
  const fatOut = q3(products.reduce((s, p) => s + (num(p.qty) * num(p.fatPct)) / 100, 0));
  return { fatIn, fatOut, loss: q3(fatIn - fatOut), lossPct: fatIn > 0 ? round2(((fatIn - fatOut) / fatIn) * 100) : 0 };
}
