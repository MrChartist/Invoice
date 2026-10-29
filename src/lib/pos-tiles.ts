/**
 * POS tile grid (roadmap 8.22): favourites and stock-group tabs for loose items that have no barcode
 * (vegetables, sweets, hardware sold by the piece). Pure.
 *
 *  - Groups: one tab per top-level stock group (`stock_groups`, WP-8) that has sellable items; an item
 *    in a sub-group sits under its top-level group. Items match their stock item by name.
 *  - Favourites: the items starred on this device (`mrchartist_pos_favs`, a device-local viewing
 *    preference outside the `mrchartist_inv_` prefix, like the printer mode — never backed up or
 *    synced; it holds item ids only), else the most sold items in recent POS bills.
 *  - Stock class: tracked items at zero / below zero are shown in red (search and tiles).
 */

import type { InvoiceItem, InvoiceRecord } from '../types/invoice';

export const POS_FAVS_KEY = 'mrchartist_pos_favs';
export const MAX_TILES = 24;

interface GroupNode { id: string; name: string; parent_id?: string }
interface StockLike { name: string; group_id?: string }

export interface TileTab {
  /** 'fav' or the top-level stock group id. */
  id: string;
  name: string;
  items: InvoiceItem[];
}

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();

/** Top-level ancestor of a group (cycles and missing parents stop at the last known node). */
export function topGroup(id: string | undefined, groups: readonly GroupNode[]): GroupNode | null {
  if (!id) return null;
  const byId = new Map(groups.map((g) => [g.id, g]));
  let node = byId.get(id) ?? null;
  const seen = new Set<string>();
  while (node?.parent_id && byId.has(node.parent_id) && !seen.has(node.id)) {
    seen.add(node.id);
    node = byId.get(node.parent_id)!;
  }
  return node;
}

/** One tab per top-level group with items, sorted by name; items keep the order of `sources`. */
export function groupTabs(sources: readonly InvoiceItem[], stock: readonly StockLike[], groups: readonly GroupNode[]): TileTab[] {
  if (!groups.length) return [];
  const groupOf = new Map<string, string>();
  for (const s of stock) if (s.group_id) groupOf.set(norm(s.name), s.group_id);
  const tabs = new Map<string, TileTab>();
  for (const item of sources) {
    const top = topGroup(groupOf.get(norm(item.name)), groups);
    if (!top) continue;
    const tab = tabs.get(top.id) ?? { id: top.id, name: top.name, items: [] };
    if (tab.items.length < MAX_TILES) tab.items.push(item);
    tabs.set(top.id, tab);
  }
  return [...tabs.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Items most often sold on recent POS bills (by number of bills), best first. */
export function frequentItems(sources: readonly InvoiceItem[], invoices: readonly InvoiceRecord[], limit = 12, lookback = 300): InvoiceItem[] {
  const pos = invoices.filter((i) => i.pos && i.status !== 'Cancelled').slice(-lookback);
  const count = new Map<string, number>();
  for (const bill of pos) {
    for (const name of new Set((bill.items ?? []).filter((l) => !l.free_of).map((l) => norm(l.name)))) count.set(name, (count.get(name) ?? 0) + 1);
  }
  return sources
    .filter((s) => count.has(norm(s.name)))
    .sort((a, b) => (count.get(norm(b.name)) ?? 0) - (count.get(norm(a.name)) ?? 0))
    .slice(0, limit);
}

/** Favourites tab: starred ids in `sources` order, else the frequent items. */
export function favouriteItems(sources: readonly InvoiceItem[], starred: readonly string[], invoices: readonly InvoiceRecord[]): InvoiceItem[] {
  const ids = new Set(starred);
  const picked = sources.filter((s) => ids.has(s.id)).slice(0, MAX_TILES);
  return picked.length ? picked : frequentItems(sources, invoices);
}

/**
 * PENDING 50: "Price list" tab — items with a selling price list in force today, each tile carrying that rate
 * (`rateOf` = `priceListRate` for the day; undefined = no list price).
 */
export function priceListItems(sources: readonly InvoiceItem[], rateOf: (item: InvoiceItem) => number | undefined): InvoiceItem[] {
  const out: InvoiceItem[] = [];
  for (const s of sources) {
    const rate = rateOf(s);
    if (rate !== undefined && out.length < MAX_TILES) out.push({ ...s, rate });
  }
  return out;
}

/** 'neg' below zero, 'zero' at zero, 'ok' otherwise; null = not a tracked stock item. */
export function stockClass(qty: number | null | undefined): 'neg' | 'zero' | 'ok' | null {
  if (qty === null || qty === undefined || !Number.isFinite(qty)) return null;
  if (qty < -1e-9) return 'neg';
  if (Math.abs(qty) <= 1e-9) return 'zero';
  return 'ok';
}

/** Starred ids from their stored JSON (tolerant). */
export function parseFavs(raw: string | null | undefined): string[] {
  try {
    const v = JSON.parse(raw ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 60) : [];
  } catch {
    return [];
  }
}

/** Star / unstar an id. */
export function toggleFav(list: readonly string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id].slice(-60);
}

/* ── Device preference (browser only) ─────────────────────────── */

export function loadFavs(): string[] {
  try {
    return parseFavs(localStorage.getItem(POS_FAVS_KEY));
  } catch {
    return [];
  }
}

export function saveFavs(list: readonly string[]): void {
  try {
    localStorage.setItem(POS_FAVS_KEY, JSON.stringify(list));
  } catch {
    /* private window: not remembered */
  }
}
