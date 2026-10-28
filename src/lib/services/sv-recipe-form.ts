/**
 * SV-C4 "Products used per service" on the stock-item form (PENDING #21): the service item becomes a KIT whose default
 * BOM lists the products one service uses (quantity per service, in each product's base unit). The existing kit engine
 * (`events-kits.ts`) issues them on every sale and `recipeReport` adds them up — this only writes the same master
 * rows the Kit + BOM screens write (`bomsDb.save`, `master.edit`). Lazy: loaded by the form's row only.
 */
import type { StockItem } from '../inventory';
import { num } from '../invoice-calc';
import { bomsDb } from '../manufacturing';
import { generateId, getTable } from '../storage';

export interface RecipeLine { item_id: string; qty: number }
export const RECIPE_BOM_NAME = 'Products used';

/** The products of the item's default BOM (empty when it has none). */
export function recipeOf(itemId: string): RecipeLine[] {
  const mine = bomsDb.forItem(itemId);
  const bom = mine.find((b) => b.is_default) ?? mine[0];
  const batch = num(bom?.batch_qty) > 0 ? num(bom!.batch_qty) : 1;
  return (bom?.components ?? []).map((c) => ({ item_id: c.item_id, qty: num(c.qty) / batch }));
}

/** Pure check of typed lines: '' or the first problem. */
export function recipeProblem(lines: readonly RecipeLine[], itemId: string): string {
  for (const l of lines) {
    if (!l.item_id) return 'Pick the product on every line.';
    if (l.item_id === itemId) return 'A service cannot use itself.';
    if (!(num(l.qty) > 0)) return 'Type the quantity used per service.';
  }
  return new Set(lines.map((l) => l.item_id)).size === lines.length ? '' : 'A product is listed twice.';
}

/** Write the products as the item's default BOM (after the item itself is saved). Nothing to write = nothing done. */
export function saveRecipe(itemId: string, lines: readonly RecipeLine[]): void {
  if (!lines.length) return;
  const items = getTable<StockItem>('stock_items');
  const mine = bomsDb.forItem(itemId);
  const bom = mine.find((b) => b.is_default) ?? mine[0];
  bomsDb.save({
    ...(bom ?? {}), id: bom?.id, item_id: itemId, name: bom?.name ?? RECIPE_BOM_NAME, batch_qty: 1, is_default: true,
    // A product already on the BOM keeps its own fields (scrap %, godown).
    components: lines.map((l) => ((old) => ({ ...old, id: old?.id ?? generateId(), item_id: l.item_id, qty: num(l.qty) }))(bom?.components.find((c) => c.item_id === l.item_id))),
    outputs: bom?.outputs ?? [],
  }, items);
}
