/**
 * Stock group / category filters for the inventory reports (7S, roadmap 7.66): Reorder Status, Stock Ageing and
 * Movement Analysis narrow to the items in a group or category, sub-groups included — the same rule as the
 * Inventory page's filters (`itemsUnder`). Filter values: '' = everything, '-' = items with no (live) group /
 * category, else a node id. Pure.
 */
import type { StockItem } from './inventory';
import { itemsUnder, type StockTreeNode } from './stock-groups';

export interface ItemFilter {
  group: string;
  category: string;
}

export const NO_FILTER: ItemFilter = { group: '', category: '' };

/** Ids of the items that pass the filter, or null when nothing is filtered. */
export function filteredItemIds(
  f: ItemFilter, items: readonly Pick<StockItem, 'id' | 'group_id' | 'category_id'>[], groups: readonly StockTreeNode[], categories: readonly StockTreeNode[],
): Set<string> | null {
  if (!f.group && !f.category) return null;
  let rows = [...items];
  if (f.group) rows = itemsUnder(f.group === '-' ? '' : f.group, groups, rows, 'group');
  if (f.category) rows = itemsUnder(f.category === '-' ? '' : f.category, categories, rows, 'category');
  return new Set(rows.map((i) => i.id));
}

/** Keep the rows whose item passes (`ids` null = keep all). */
export function applyItemFilter<T>(rows: readonly T[], ids: ReadonlySet<string> | null, itemId: (row: T) => string): T[] {
  return ids ? rows.filter((r) => ids.has(itemId(r))) : [...rows];
}
