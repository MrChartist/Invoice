/**
 * Closing stock for the ledger statements (WP-2, P0-3). Stock is a REPORT-TIME line, never a stored
 * voucher: `postings.ts` stays untouched and nothing is written twice.
 *
 * A `StockValuer` answers two questions for any date:
 *   value(d)     stock-in-hand at the END of `d`, in paise (the inventory engine's FIFO / weighted
 *                average valuation, or the closing-stock figure the user typed);
 *   openingIn(d) the part of that stock that came in as OPENING stock (item-master opening quantity,
 *                dated "opening" moves, or the typed opening figure) on or before `d`.
 *
 * Statements then use, the way Tally does with "Integrate accounts and inventory":
 *   Trading account   opening stock = value(start − 1) + openings inside the period;
 *                     closing stock = value(end)  →  gross profit moves by (closing − opening)
 *   Balance sheet     Inventories += value(asOf);  "Difference in opening balances" (capital) is
 *                     credited with openingIn(asOf), so the sheet still ties.
 * The opening stock never becomes profit; every other change in stock value does (purchases are
 * expensed in full by the postings, so closing stock is what turns them into cost of goods sold).
 *
 * Pure except `loadClosingStockConfig` / `saveClosingStockConfig` (one JSON key, company data, in
 * backups). Working papers — verify with your CA.
 */

import type { StockPosition } from '../inventory';
import { getJson, setJson, DB_PREFIX } from '../storage';

export type ClosingStockMode = 'inventory' | 'manual' | 'none';

export interface ClosingStockEntry {
  /** YYYY-MM-DD: the value applies from the end of this day until the next entry. */
  date: string;
  /** Integer paise. */
  value: number;
}

export interface ClosingStockConfig {
  /** Absent = automatic: the inventory engine when any item tracks stock, else none. */
  mode?: ClosingStockMode;
  /** Manual mode: stock at the start of the books (paise), shown as opening stock. */
  opening?: number;
  /** Manual mode: date-wise closing stock values typed by the user. */
  entries?: ClosingStockEntry[];
}

export interface StockValuer {
  mode: Exclude<ClosingStockMode, 'none'>;
  /** Short description for report notes ("Inventory, FIFO", "Typed closing stock"). */
  label: string;
  value(date: string): number;
  openingIn(date: string): number;
}

export const CLOSING_STOCK_KEY = `${DB_PREFIX}closing_stock`;

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const paise = (rupees: number) => Math.round((Number.isFinite(rupees) ? rupees : 0) * 100);

/** Tolerant read of the stored config (bad rows dropped, entries sorted by date). */
export function normalizeClosingStockConfig(raw: unknown): ClosingStockConfig {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const mode = o.mode === 'inventory' || o.mode === 'manual' || o.mode === 'none' ? o.mode : undefined;
  const entries = (Array.isArray(o.entries) ? o.entries : [])
    .map((e) => (e && typeof e === 'object' ? (e as Record<string, unknown>) : {}))
    .filter((e) => typeof e.date === 'string' && ISO.test(e.date) && Number.isFinite(Number(e.value)))
    .map((e) => ({ date: e.date as string, value: Math.round(Number(e.value)) }))
    .sort((a, b) => a.date.localeCompare(b.date));
  // One value per date: the last one typed wins.
  const byDate = new Map(entries.map((e) => [e.date, e]));
  const opening = Number(o.opening);
  return { ...(mode ? { mode } : {}), ...(Number.isFinite(opening) && opening ? { opening: Math.round(opening) } : {}), entries: [...byDate.values()] };
}

export function loadClosingStockConfig(): ClosingStockConfig {
  return normalizeClosingStockConfig(getJson<unknown>(CLOSING_STOCK_KEY, {}));
}

export function saveClosingStockConfig(cfg: ClosingStockConfig): ClosingStockConfig {
  const clean = normalizeClosingStockConfig(cfg);
  setJson(CLOSING_STOCK_KEY, clean);
  return clean;
}

/** Last row at or before `date` in a date-sorted list ('' sorts first = opening). */
function lastAtOrBefore<T extends { date: string }>(rows: readonly T[], date: string): T | undefined {
  let lo = 0;
  let hi = rows.length - 1;
  let found: T | undefined;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].date <= date) {
      found = rows[mid];
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/**
 * Valuer over the inventory engine's positions (`computeStock` — read only). Each item's ledger
 * rows carry the running value after every movement, in date order, so one costing run answers
 * every date. A negative item value (negative stock) counts as nil, as in the stock summary.
 */
export function inventoryValuer(positions: readonly StockPosition[], method: string = 'WEIGHTED_AVG'): StockValuer {
  const items = positions
    .filter((p) => p.item.track_stock && p.ledger.length)
    .map((p) => {
      const rows = p.ledger.map((r) => ({ date: r.date, value: r.value }));
      // Defensive: the engine emits rows in date order; keep it stable if a caller hands unsorted rows.
      const sorted = rows.every((r, i) => i === 0 || rows[i - 1].date <= r.date) ? rows : [...rows].sort((a, b) => a.date.localeCompare(b.date));
      const openings: { date: string; total: number }[] = [];
      let acc = 0;
      for (const r of p.ledger) {
        if (r.kind !== 'opening' || !r.qtyIn) continue;
        acc += r.amount;
        openings.push({ date: r.date, total: acc });
      }
      openings.sort((a, b) => a.date.localeCompare(b.date));
      return { rows: sorted, openings };
    });
  return {
    mode: 'inventory',
    label: method === 'FIFO' ? 'FIFO' : 'Weighted average',
    value: (date) => items.reduce((s, it) => s + Math.max(paise(lastAtOrBefore(it.rows, date)?.value ?? 0), 0), 0),
    openingIn: (date) => items.reduce((s, it) => s + paise(lastAtOrBefore(it.openings, date)?.total ?? 0), 0),
  };
}

/** Valuer over typed figures: the latest entry on or before the date, else the opening figure. */
export function manualValuer(cfg: ClosingStockConfig): StockValuer {
  const entries = normalizeClosingStockConfig(cfg).entries ?? [];
  const opening = Math.round(cfg.opening ?? 0);
  return {
    mode: 'manual',
    label: 'Typed closing stock',
    value: (date) => lastAtOrBefore(entries, date)?.value ?? opening,
    openingIn: () => opening,
  };
}

/** Resolve the configured mode. `positions` is only read in inventory mode (lazy: pass a thunk). */
export function stockValuerFor(
  cfg: ClosingStockConfig,
  positions: () => readonly StockPosition[],
  method?: string,
): StockValuer | undefined {
  const mode = effectiveMode(cfg, positions);
  if (mode === 'manual') return manualValuer(cfg);
  if (mode === 'inventory') return inventoryValuer(positions(), method);
  return undefined;
}

export function effectiveMode(cfg: ClosingStockConfig, positions: () => readonly StockPosition[]): ClosingStockMode {
  if (cfg.mode) return cfg.mode;
  return positions().some((p) => p.item.track_stock) ? 'inventory' : 'none';
}

/** Stock movement a statement window adds to profit: closing − opening, with openings excluded. */
export function stockChange(stock: StockValuer | undefined, end: string, dayBeforeStart: string): { opening: number; closing: number } {
  if (!stock) return { opening: 0, closing: 0 };
  const openingsInside = stock.openingIn(end) - stock.openingIn(dayBeforeStart);
  return { opening: stock.value(dayBeforeStart) + openingsInside, closing: stock.value(end) };
}
