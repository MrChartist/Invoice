/**
 * Channel SKU → item map (R5-A2). A marketplace lists the seller's goods under its own ids (seller SKU, ASIN, FSN,
 * Meesho SKU) and sometimes as a "pack of N". Each `channel_skus` row maps one listing to one catalogue item
 * (`items_catalog`) with `qty_per_unit` units per listing unit; a kit item maps once and explodes as kits do.
 *
 * Bulk fill from a listing file matches, in order: the catalogue `sku`, `barcode`, `short_code` (exact, auto) and
 * then the title (fuzzy — only ever a suggestion, never saved without the user). Pure helpers + a guarded store.
 */
import type { ChannelSku } from '../../types/marketplace-r5';
import type { InvoiceItem } from '../../types/invoice';
import { requireAccess } from '../access';
import { generateId, getTable, peekTable, setTable } from '../storage';
import { CHANNEL_SKUS_TABLE } from './channels';

export type CatalogueRow = Pick<InvoiceItem, 'id' | 'name'> & Partial<Pick<InvoiceItem, 'sku' | 'barcode' | 'short_code' | 'hsn' | 'unit' | 'tax_rate' | 'rate'>>;

const key = (s: unknown) => String(s ?? '').trim().toLowerCase();

export function loadSkuMap(channelId?: string): ChannelSku[] {
  const rows = peekTable<ChannelSku>(CHANNEL_SKUS_TABLE).filter((r) => r && typeof r.id === 'string' && typeof r.channel_sku === 'string');
  return channelId ? rows.filter((r) => r.channel_id === channelId) : rows;
}

export interface SkuHit {
  item_id: string;
  qty_per_unit: number;
  /** How it was found: a saved map row, or the catalogue's own SKU (qty 1). */
  via: 'map' | 'catalogue';
}

/**
 * The item behind a channel's SKU / listing id: the saved map row first (by channel SKU, then listing id), then a
 * catalogue item whose own `sku` equals the channel SKU (one unit). Undefined = unmapped.
 */
export function lookupSku(
  map: readonly ChannelSku[],
  channelId: string,
  ref: { sku?: string; listingId?: string },
  catalogue: readonly CatalogueRow[] = [],
): SkuHit | undefined {
  const sku = key(ref.sku);
  const lid = key(ref.listingId);
  const mine = map.filter((m) => m.channel_id === channelId);
  const row = (sku && mine.find((m) => key(m.channel_sku) === sku)) || (lid && mine.find((m) => key(m.listing_id) === lid)) || undefined;
  if (row) return { item_id: row.item_id, qty_per_unit: row.qty_per_unit > 0 ? row.qty_per_unit : 1, via: 'map' };
  const own = sku ? catalogue.find((c) => key(c.sku) === sku) : undefined;
  return own?.id ? { item_id: own.id, qty_per_unit: 1, via: 'catalogue' } : undefined;
}

export type ListingMatchHow = 'sku' | 'barcode' | 'short_code' | 'title';

export interface ListingRow {
  sku: string;
  listing_id?: string;
  title?: string;
}

export interface ListingMatch extends ListingRow {
  item_id?: string;
  how?: ListingMatchHow;
  /** True for a title match: shown as a suggestion, never saved automatically. */
  suggestion?: boolean;
}

const words = (s: string) => new Set(key(s).replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w.length > 1));

/** Token overlap 0..1 of two titles. */
export function titleScore(a: string, b: string): number {
  const x = words(a);
  const y = words(b);
  if (!x.size || !y.size) return 0;
  let inter = 0;
  for (const w of x) if (y.has(w)) inter++;
  return inter / new Set([...x, ...y]).size;
}

/** Listing-file match: sku → barcode → short code (exact) → title (fuzzy ≥ 0.5, suggestion only). */
export function matchListing(rows: readonly ListingRow[], catalogue: readonly CatalogueRow[]): ListingMatch[] {
  return rows.map((r) => {
    const s = key(r.sku);
    const exact = (field: 'sku' | 'barcode' | 'short_code') => (s ? catalogue.find((c) => key(c[field]) === s) : undefined);
    for (const how of ['sku', 'barcode', 'short_code'] as const) {
      const hit = exact(how);
      if (hit?.id) return { ...r, item_id: hit.id, how };
    }
    if (r.title) {
      let best: CatalogueRow | undefined;
      let score = 0;
      for (const c of catalogue) {
        const sc = titleScore(r.title, c.name);
        if (sc > score) {
          score = sc;
          best = c;
        }
      }
      if (best?.id && score >= 0.5) return { ...r, item_id: best.id, how: 'title' as const, suggestion: true };
    }
    return { ...r };
  });
}

export class SkuMapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SkuMapError';
  }
}

/** Add or update map rows (one channel SKU once per channel). A master edit. */
export function saveSkuRows(rows: readonly (Omit<ChannelSku, 'id'> & { id?: string })[]): ChannelSku[] {
  requireAccess('master.edit');
  const all = getTable<ChannelSku>(CHANNEL_SKUS_TABLE);
  const out: ChannelSku[] = [];
  for (const r of rows) {
    const sku = String(r.channel_sku ?? '').trim();
    if (!sku || !r.channel_id || !r.item_id) throw new SkuMapError('A map row needs the channel SKU and the item.');
    const qty = Number(r.qty_per_unit);
    if (!(qty > 0) || !Number.isFinite(qty)) throw new SkuMapError(`${sku}: units per listing must be above zero.`);
    const idx = all.findIndex((m) => m.id === r.id || (m.channel_id === r.channel_id && key(m.channel_sku) === key(sku)));
    const row: ChannelSku = {
      id: idx >= 0 ? all[idx].id : r.id || generateId(),
      channel_id: r.channel_id,
      channel_sku: sku,
      ...(r.listing_id?.trim() ? { listing_id: r.listing_id.trim() } : {}),
      item_id: r.item_id,
      qty_per_unit: qty,
      ...(r.note?.trim() ? { note: r.note.trim() } : {}),
    };
    if (idx >= 0) all[idx] = row;
    else all.push(row);
    out.push(row);
  }
  setTable(CHANNEL_SKUS_TABLE, all);
  return out;
}

export function removeSkuRow(id: string): void {
  requireAccess('master.edit');
  setTable(CHANNEL_SKUS_TABLE, getTable<ChannelSku>(CHANNEL_SKUS_TABLE).filter((m) => m.id !== id));
}

/** Distinct unmapped channel SKUs met in an import (first sighting order). */
export function unmappedList(refs: readonly { sku?: string; listingId?: string; title?: string }[]): { sku: string; listingId?: string; title?: string; count: number }[] {
  const out = new Map<string, { sku: string; listingId?: string; title?: string; count: number }>();
  for (const r of refs) {
    const k = key(r.sku) || key(r.listingId);
    if (!k) continue;
    const prev = out.get(k);
    if (prev) prev.count++;
    else out.set(k, { sku: String(r.sku ?? '').trim(), ...(r.listingId ? { listingId: r.listingId } : {}), ...(r.title ? { title: r.title } : {}), count: 1 });
  }
  return [...out.values()];
}
