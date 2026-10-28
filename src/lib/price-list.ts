/**
 * Selling price lists in the invoice editor (7S, roadmap 7.66). A stock item may carry dated selling prices
 * (`StockItem.selling_prices`, maintained on the item form, WP-8). When an item is picked on a document line, the
 * price in force on the document date becomes the line's base rate — replacing the catalogue rate — and is noted
 * as "Price list" on the line.
 *
 * Precedence is unchanged otherwise: a customer price level's own rate for the item still wins (a level's
 * % discount applies to the price-list rate), and a quantity slab below that rate still applies (`resolvePrice`).
 * A rate the user typed is never overwritten by a later re-price.
 *
 * Pure and tiny on purpose: it runs in the editor chunk on item pick only (one item lookup), never per keystroke.
 */
import { num, round2 } from './invoice-calc';

export const PRICE_LIST_BASIS = 'Price list';

interface Priced {
  name: string;
  aliases?: string[];
  hsn?: string;
  track_stock?: boolean;
  selling_prices?: { from: string; rate: number }[];
}

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Rate in force on `day` (latest entry dated on or before it), or undefined. Same rule as `rateOn` (stock-query). */
export function listRateOn(list: Priced['selling_prices'], day: string): number | undefined {
  let best: { from: string; rate: number } | undefined;
  for (const e of list ?? []) {
    const from = String(e?.from ?? '').slice(0, 10);
    const rate = num(e?.rate, -1);
    if (!ISO.test(from) || rate < 0 || from > day) continue;
    if (!best || from >= best.from) best = { from, rate };
  }
  return best ? round2(best.rate) : undefined;
}

/**
 * The selling price-list rate for a line's item on `day`: the stock item whose name (or an alias) matches the line
 * name — and HSN, when both have one. Undefined when no item matches or it has no price in force.
 */
export function priceListRate(items: readonly Priced[], name: string, hsn: string | undefined, day: string): number | undefined {
  const n = norm(name);
  if (!n || !ISO.test(day)) return undefined;
  const h = String(hsn ?? '').replace(/\D/g, '');
  for (const it of items) {
    if (!it?.selling_prices?.length) continue;
    if (norm(it.name) !== n && !(it.aliases ?? []).some((a) => norm(a) === n)) continue;
    const ih = String(it.hsn ?? '').replace(/\D/g, '');
    if (h && ih && !ih.startsWith(h.slice(0, 4)) && !h.startsWith(ih.slice(0, 4))) continue;
    const r = listRateOn(it.selling_prices, day);
    if (r !== undefined) return r;
  }
  return undefined;
}
