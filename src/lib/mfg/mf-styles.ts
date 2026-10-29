/**
 * MF-C1 styles: a style is a stock item with size × colour `variant_axes` (8.85 variants, the R9 grid's axes) plus `StockItem.mf.style` (fabric per piece — by colour when the colour map names another fabric — trims, the
 * default size ratio and the routing). A production order of a style takes a size × colour grid (`ProductionOrder.mf.grid`)
 * whose cells sum to the planned quantity; each cell is a variant child. Pure, except `saveStyle` (`master.edit`).
 */
import './mf-registry';
import type { StockItem } from '../inventory';
import { getTable, setTable } from '../storage';
import { requireAccess } from '../access';
import { num } from '../invoice-calc';
import { cleanAxes } from '../variants';
import type { MfStyle } from '../../types/mfg-r13';

const gridAxes = (p: Pick<StockItem, 'variant_axes'>) => cleanAxes(p.variant_axes ?? []);
/** Variant parents with a grid (as `rt-matrix.ts` `gridParents`, without loading the R9 module). */
export const gridParents = (all: readonly StockItem[]): StockItem[] => all.filter((i) => !i.variant_of && gridAxes(i).length > 0).sort((a, b) => a.name.localeCompare(b.name));

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();
const SIZE = /^(size|साइज़|sz)$/i;
const COLOUR = /^(colou?r|shade|रंग)$/i;

/** The style part of an item (absent / malformed → undefined). */
export function styleOf(item: unknown): MfStyle | undefined {
  const s = (item as { mf?: { style?: unknown } } | undefined)?.mf?.style;
  return s && typeof s === 'object' && Array.isArray((s as MfStyle).fabric_items) ? (s as MfStyle) : undefined;
}

/** Sizes and colours of a style: the axis named Size / Colour, else axis 1 = size, axis 2 = colour. */
export function styleAxes(parent: Pick<StockItem, 'variant_axes'>): { size: string; colour: string; sizes: string[]; colours: string[] } {
  const axes = gridAxes(parent);
  const s = axes.find((a) => SIZE.test(a.name)) ?? axes[0];
  const c = axes.find((a) => a !== s && COLOUR.test(a.name)) ?? axes.find((a) => a !== s);
  return { size: s?.name ?? '', colour: c?.name ?? '', sizes: s?.values ?? [], colours: c?.values ?? [''] };
}

/** The variant child of a size and colour (undefined when it does not exist yet). */
export function childFor(parent: StockItem, all: readonly StockItem[], size: string, colour: string): StockItem | undefined {
  const ax = styleAxes(parent);
  return all.find((c) => c.variant_of === parent.id && norm(c.variant_attrs?.[ax.size]) === norm(size) && (!ax.colour || norm(c.variant_attrs?.[ax.colour]) === norm(colour)));
}

/** Fabric of a colour: its item and the standard metres per piece. */
export function fabricFor(style: MfStyle | undefined, colour: string): { item_id: string; per_piece_m: number } | undefined {
  for (const f of style?.fabric_items ?? []) {
    const mapped = Object.entries(f.colour_map ?? {}).find(([c]) => norm(c) === norm(colour))?.[1];
    if (mapped) return { item_id: mapped, per_piece_m: num(f.per_piece_m) };
  }
  const f = style?.fabric_items?.[0];
  return f ? { item_id: f.item_id, per_piece_m: num(f.per_piece_m) } : undefined;
}

export type OrderGrid = { colour: string; qty: number[] }[];

/** Grid total (pieces). */
export const gridTotal = (grid: OrderGrid | undefined): number => (grid ?? []).reduce((s, r) => s + r.qty.reduce((t, q) => t + Math.max(num(q), 0), 0), 0);

/**
 * The children of an order grid (sizes in the style's order) — refuses a grid that does not sum to the planned quantity
 * or names a cell whose variant does not exist.
 */
export function gridChildren(parent: StockItem, all: readonly StockItem[], grid: OrderGrid, planned: number): { item_id: string; size: string; colour: string; qty: number }[] {
  const { sizes } = styleAxes(parent);
  if (Math.abs(gridTotal(grid) - num(planned)) > 1e-9) throw new Error(`The size × colour grid has ${gridTotal(grid)} pieces; the order plans ${num(planned)}.`);
  const out: { item_id: string; size: string; colour: string; qty: number }[] = [];
  for (const r of grid) {
    sizes.forEach((size, i) => {
      const qty = num(r.qty[i]);
      if (!(qty > 0)) return;
      const child = childFor(parent, all, size, r.colour);
      if (!child) throw new Error(`${parent.name}: no variant for ${size}${r.colour ? ` / ${r.colour}` : ''}, create the variants first.`);
      out.push({ item_id: child.id, size, colour: r.colour, qty });
    });
  }
  return out;
}

/** Problems with a style definition ('' = fine). */
export function validateStyle(parent: Pick<StockItem, 'name' | 'variant_axes'>, s: MfStyle): string {
  if (!gridAxes(parent).length) return `${parent.name}: add sizes (and colours) as variants first.`;
  if (!s.fabric_items.length || s.fabric_items.some((f) => !f.item_id || !(num(f.per_piece_m) > 0))) return 'Name the fabric and its metres per piece.';
  if ((s.trims ?? []).some((t) => !t.item_id || !(num(t.per_piece) > 0))) return 'Every trim needs an item and a quantity per piece.';
  return '';
}

/** Save the style part of an item and its textile class (`master.edit`; the row keeps every other field). */
export function saveStyle(itemId: string, s: MfStyle, cls?: string): void {
  requireAccess('master.edit');
  const all = getTable<StockItem>('stock_items');
  const it = all.find((i) => i.id === itemId);
  if (!it) throw new Error('Item not found.');
  const err = validateStyle(it, s);
  if (err) throw new Error(err);
  const mf = { ...((it as { mf?: object }).mf ?? {}), style: s };
  const kids = new Set(all.filter((i) => i.variant_of === itemId).map((i) => i.id));
  // MF-C5: the class goes on the style and its variants (the editor's band hook reads the picked item).
  setTable('stock_items', all.map((i) => (i.id === itemId ? ({ ...i, mf, ...(cls !== undefined ? { mf_class: cls || undefined } : {}) } as StockItem) : kids.has(i.id) && cls !== undefined ? ({ ...i, mf_class: cls || undefined } as StockItem) : i)));
}

/** Styles: variant parents that carry a style part. */
export const styleItems = (all: readonly StockItem[]): StockItem[] => all.filter((i) => !i.variant_of && styleOf(i)).sort((a, b) => a.name.localeCompare(b.name));
