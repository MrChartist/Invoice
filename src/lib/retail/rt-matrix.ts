/**
 * RT-C2 size × colour grid: one grid on a sale or supplier bill → one line per non-zero cell (the variant child item,
 * its HSN / GST, one rate or a rate per cell; a price-band item's line is marked for the band, RT-C1), and back
 * (the grid opens with the bill's current quantities; a changed cell updates its line, a cleared cell removes it — never
 * a duplicate line). The stock grid of a style reads the stock engine per child and godown, with the units sold in the
 * last 30 days. Variant children come from `variants.ts` (8.85); nothing new is stored. Pure, except nothing.
 */
import { cleanAxes, combinations, type VariantAxis } from '../variants';
import type { StockItem } from '../inventory';
import { num, round2 } from '../invoice-calc';
import { lineFactor } from '../units';
import { shiftDay } from '../dates';
import type { InvoiceItem, InvoiceRecord } from '../../types/invoice';
import type { PurchaseLine } from '../../types/purchases';

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();

/** The parent's axes: rows = axis 1, columns = axis 2 (if any), tabs = axis 3 (if any). */
export function gridAxes(parent: Pick<StockItem, 'variant_axes'>): VariantAxis[] {
  return cleanAxes(parent.variant_axes ?? []);
}

/** Cell key of a combination: the axis values in axis order, lower-cased. */
export const cellKey = (attrs: Record<string, string> | undefined, axes: readonly VariantAxis[]) => axes.map((a) => norm(attrs?.[a.name])).join('|');

/** Every cell of the grid with its child item (undefined = the child does not exist yet). */
export function gridCells(parent: StockItem, all: readonly StockItem[]): { key: string; attrs: Record<string, string>; child?: StockItem }[] {
  const axes = gridAxes(parent);
  const kids = new Map(all.filter((i) => i.variant_of === parent.id).map((k) => [cellKey(k.variant_attrs, axes), k]));
  return combinations(axes).map((attrs) => ({ key: cellKey(attrs, axes), attrs, child: kids.get(cellKey(attrs, axes)) }));
}

/** Parents that have a grid (a stock item with `variant_axes` and no parent of its own). */
export const gridParents = (all: readonly StockItem[]): StockItem[] => all.filter((i) => !i.variant_of && gridAxes(i).length > 0).sort((a, b) => a.name.localeCompare(b.name));

/** The parent of a line's item (a child or the parent itself, by name), for the editor's Grid button. */
export function parentOfName(name: string, all: readonly StockItem[]): StockItem | undefined {
  const it = all.find((i) => norm(i.name) === norm(name));
  const p = it?.variant_of ? all.find((i) => i.id === it.variant_of) : it;
  return p && gridAxes(p).length ? p : undefined;
}

/** One cell typed in the grid. */
export interface GridQty { key: string; qty: number; rate?: number }

type AnyLine = { id: string; name: string; quantity: number; rate: number; item_id?: string };
const childOfLine = (l: AnyLine, kids: readonly StockItem[]) => kids.find((k) => (l.item_id ? l.item_id === k.id : norm(l.name) === norm(k.name)));

/** The grid's quantities (and rates) from the bill's current lines. */
export function linesToGrid(lines: readonly AnyLine[], parent: StockItem, all: readonly StockItem[]): Record<string, { qty: number; rate: number }> {
  const axes = gridAxes(parent);
  const kids = all.filter((i) => i.variant_of === parent.id);
  const out: Record<string, { qty: number; rate: number }> = {};
  for (const l of lines) {
    const k = childOfLine(l, kids);
    if (!k) continue;
    const key = cellKey(k.variant_attrs, axes);
    out[key] = { qty: round2((out[key]?.qty ?? 0) + num(l.quantity)), rate: num(l.rate) };
  }
  return out;
}

/**
 * Apply the grid to the bill's lines: a non-zero cell sets its child's line (updated in place, the first one kept,
 * extra duplicates dropped) or adds one; a zero cell removes its child's line; blank lines are dropped. `make` builds
 * a new line for a child. `rate` is the one rate for every cell (a cell's own rate wins). Missing children are skipped
 * (returned in `missing`).
 */
export function gridToLines<L extends AnyLine>(lines: readonly L[], parent: StockItem, all: readonly StockItem[], grid: readonly GridQty[], rate: number, make: (child: StockItem, qty: number, rate: number) => L): { lines: L[]; missing: string[] } {
  const cells = new Map(gridCells(parent, all).map((c) => [c.key, c]));
  const kids = all.filter((i) => i.variant_of === parent.id);
  const want = new Map<string, { qty: number; rate: number }>();
  const missing: string[] = [];
  for (const g of grid) {
    const c = cells.get(g.key);
    if (!c) continue;
    if (!c.child) {
      if (num(g.qty) > 0) missing.push(Object.values(c.attrs).join(' / '));
      continue;
    }
    want.set(c.child.id, { qty: Math.max(num(g.qty), 0), rate: num(g.rate) > 0 ? num(g.rate) : num(rate) });
  }
  const done = new Set<string>();
  const out: L[] = [];
  for (const l of lines) {
    const k = childOfLine(l, kids);
    const w = k ? want.get(k.id) : undefined;
    if (!k || !w) {
      if (String(l.name ?? '').trim() || num(l.rate) || num(l.quantity) > 1) out.push(l);
      continue;
    }
    if (done.has(k.id) || w.qty <= 0) continue;
    done.add(k.id);
    out.push({ ...l, quantity: w.qty, rate: w.rate });
  }
  for (const k of kids) {
    const w = want.get(k.id);
    if (w && w.qty > 0 && !done.has(k.id)) out.push(make(k, w.qty, w.rate));
  }
  return { lines: out, missing };
}

/** A new sale line for a child (its own HSN / GST, else the parent's; a band item is marked for the band). */
export function saleLine(child: StockItem, parent: StockItem, qty: number, rate: number, id: string): InvoiceItem {
  const band = child.gst_band ?? parent.gst_band;
  return {
    id, name: child.name, type: 'Product', hsn: child.hsn ?? parent.hsn ?? '', unit: child.unit || parent.unit || 'PCS', quantity: qty, rate,
    tax_rate: num(child.tax_rate ?? parent.tax_rate), discount_percent: 0, amount: round2(qty * rate),
    ...(band ? { band_rate: { kind: band, value_per_piece: 0 } } : {}),
  };
}

/** A new supplier-bill line for a child (stock-in by `item_id`). */
export function purchaseLine(child: StockItem, parent: StockItem, qty: number, rate: number, id: string): PurchaseLine {
  return { id, name: child.name, hsn: child.hsn ?? parent.hsn ?? '', unit: child.unit || parent.unit || 'PCS', quantity: qty, rate, tax_rate: num(child.tax_rate ?? parent.tax_rate), item_id: child.id };
}

/* ── Stock grid ── */

export interface StockCell { key: string; attrs: Record<string, string>; child?: StockItem; qty: number; sold: number }

/**
 * The style's stock as cells: on-hand quantity per child (`stockOf` = the engine's quantity, or one godown's) and the
 * units sold in the last 30 days. Cells at zero (or below) are sold out.
 */
export function stockGrid(parent: StockItem, all: readonly StockItem[], stockOf: (id: string) => number, sold: ReadonlyMap<string, number>): StockCell[] {
  return gridCells(parent, all).map((c) => ({ ...c, qty: c.child ? round2(stockOf(c.child.id)) : 0, sold: c.child ? sold.get(c.child.id) ?? 0 : 0 }));
}

const SALE_DOCS = new Set(['INVOICE', 'TAX_INVOICE', 'BILL_OF_SUPPLY']);

/** Units (base unit) of each item sold on sale documents dated in the 30 days up to `today` (by line name). */
export function soldLast30(invoices: readonly InvoiceRecord[], items: readonly StockItem[], today: string): Map<string, number> {
  const from = shiftDay(today, -29);
  const byName = new Map(items.map((i) => [norm(i.name), i.id]));
  const out = new Map<string, number>();
  for (const inv of invoices) {
    const d = String(inv?.issue_date ?? '').slice(0, 10);
    if (!SALE_DOCS.has(inv?.doc_type) || inv.status === 'Draft' || inv.status === 'Cancelled' || d < from || d > today) continue;
    for (const l of inv.items ?? []) {
      const id = byName.get(norm(l.name));
      if (id) out.set(id, round2((out.get(id) ?? 0) + num(l.quantity) * lineFactor(l)));
    }
  }
  return out;
}

/** CSV of a stock grid: one row per cell. */
export function stockGridCsv(parent: StockItem, cells: readonly StockCell[]): string {
  const axes = gridAxes(parent);
  const q = (s: unknown) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  return [[...axes.map((a) => a.name), 'Item', 'In stock', 'Sold (30 days)'].map(q).join(','), ...cells.map((c) => [...axes.map((a) => c.attrs[a.name]), c.child?.name ?? '', c.qty, c.sold].map(q).join(','))].join('\n');
}
