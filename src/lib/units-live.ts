/**
 * Live unit context for the line editors (WP-8): the user's unit symbols and, when any stock item has
 * alternate units, a finder for a line's item and its unit choices. Read on demand (catalogue focus),
 * never per keystroke. Kept out of units.ts so that module stays free of the stock engine import.
 */
import { buildItemIndex, stockDb, type StockItem } from './inventory';
import { unitPickContext, unitSymbols, unitsDb, type UnitPickContext } from './units';

export interface LiveUnits {
  /** Symbols for a plain unit picker (built-in + the user's own). */
  symbols: string[];
  /** Null when no stock item has an alternate unit. */
  pick: UnitPickContext | null;
  /** Tracked stock items, for the bill line's item picker. */
  items: StockItem[];
}

export function liveUnits(): LiveUnits {
  try {
    const items = stockDb.items().filter((i) => i.track_stock);
    return { symbols: unitSymbols(unitsDb.stored()), pick: unitPickContext(items, buildItemIndex(items)), items };
  } catch {
    return { symbols: unitSymbols([]), pick: null, items: [] };
  }
}
