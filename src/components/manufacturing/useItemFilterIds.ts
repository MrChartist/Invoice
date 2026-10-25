import { useMemo } from 'react';
import { stockCategoriesDb, stockGroupsDb } from '../../lib/stock-groups';
import { filteredItemIds, type ItemFilter } from '../../lib/stock-filters';
import type { StockItem } from '../../lib/inventory';

/** 7S: ids passing the group / category filter (null = all), memoised on the filter and items. */
export function useItemFilterIds(f: ItemFilter, items: readonly StockItem[]): Set<string> | null {
  return useMemo(() => filteredItemIds(f, items, stockGroupsDb.all(), stockCategoriesDb.all()), [f, items]);
}
