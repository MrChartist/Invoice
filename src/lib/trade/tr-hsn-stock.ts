/**
 * TR-C4 HSN-wise stock: closing quantity (base unit) and value at cost per HSN × godown as on a date. Value is
 * company-wide (costing is not per godown), so a godown's share is the item's value × its share of the quantity.
 * Pure; the live reader is `loadHsnStock` in `tr-stock-live.ts`.
 */
import { round2 } from '../invoice-calc';
import { toCsv } from '../csv';

export interface HsnStockItem {
  hsn?: string;
  unit?: string;
  qty: number;
  value: number;
  /** Quantity per godown id (tracked items); absent = all in the Main godown. */
  byGodown?: Readonly<Record<string, number>>;
}

export interface HsnStockRow {
  hsn: string;
  godown: string;
  unit: string;
  qty: number;
  value: number;
}

const roundQty = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000 || 0;

/** Rows per HSN × godown × unit (zero rows left out), sorted by HSN then godown. */
export function hsnStock(items: readonly HsnStockItem[], mainId = 'main'): HsnStockRow[] {
  const map = new Map<string, HsnStockRow>();
  for (const it of items) {
    if (!(Math.abs(it.qty) > 1e-9) && !(Math.abs(it.value) > 0.004)) continue;
    const hsn = String(it.hsn ?? '').replace(/\s+/g, '');
    const unit = String(it.unit ?? '').trim().toUpperCase();
    const split = it.byGodown && Object.keys(it.byGodown).length ? Object.entries(it.byGodown).filter(([, q]) => Math.abs(q) > 1e-9) : [[mainId, it.qty] as [string, number]];
    const totalQty = split.reduce((t, [, q]) => t + q, 0);
    for (const [godown, q] of split) {
      const key = `${hsn}|${godown}|${unit}`;
      const row = map.get(key) ?? { hsn, godown, unit, qty: 0, value: 0 };
      row.qty = roundQty(row.qty + q);
      row.value = round2(row.value + (Math.abs(totalQty) > 1e-9 ? (it.value * q) / totalQty : it.value / split.length));
      map.set(key, row);
    }
  }
  return [...map.values()].filter((r) => Math.abs(r.qty) > 1e-9 || Math.abs(r.value) > 0.004).sort((a, b) => a.hsn.localeCompare(b.hsn) || a.godown.localeCompare(b.godown));
}

/** Totals of the rows (value; quantity only per unit). */
export const hsnStockTotal = (rows: readonly HsnStockRow[]): number => round2(rows.reduce((t, r) => t + r.value, 0));

export function hsnStockCsv(rows: readonly HsnStockRow[], godownName: (id: string) => string): string {
  return toCsv([['HSN', 'Godown', 'UQC', 'Quantity', 'Value (₹)'], ...rows.map((r) => [r.hsn, godownName(r.godown), r.unit, r.qty, r.value])]);
}
