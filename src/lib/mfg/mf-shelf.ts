/**
 * MF-D2 shelf life at dispatch (pack `foodmfg`):
 *  - remaining shelf life of a batch on a day, as % of its total life (packed / MFG date → expiry) and in days;
 *  - FEFO with a floor: a client with `Client.mf.min_shelf_pct` (or `min_shelf_days`) gets only batches with at least
 *    that much life left on the dispatch date; a shortfall reads "no batch with ≥ 70% life — n units qualify";
 *  - the near-expiry desk: stock by batch and godown in remaining-life buckets with a suggested action;
 *  - the food / FMCG scheme presets for the R8 scheme screen (data only) and the Circular 251/08/2025 note.
 * Batches hold base units (the editor converts a line's alternate unit with `lineFactor` before comparing). Pure — no
 * storage. Working paper: dates follow the FSS labelling rules as summarised (MF14); the floor is a trade term.
 */
// The FEFO floor lives in `mf-shelf-floor.ts`, imported by the editor alone so it stays inside the editor chunk (no shared
// chunk, no extra preload entry on first paint); the desk keeps this small copy of the remaining-life maths.
const dayNo = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86400000;
function remainingLife(b: { mfg?: string; expiry?: string }, day: string): { pct: number | null; days: number | null } {
  if (!b.expiry) return { pct: null, days: null };
  const days = Math.round(dayNo(b.expiry) - dayNo(day));
  if (!b.mfg) return { pct: null, days };
  const total = Math.round(dayNo(b.expiry) - dayNo(b.mfg));
  const pct = total > 0 ? Math.max(Math.min(Math.round((days / total) * 1000) / 10, 100), 0) : days >= 0 ? 100 : 0;
  return { pct: days < 0 ? 0 : pct, days };
}

/* ── Near-expiry desk ─────────────────────────────────────────── */

export type LifeBucket = 'expired' | 'lt25' | 'lt50' | 'lt70' | 'ok' | 'unknown';
export const LIFE_BUCKETS: readonly LifeBucket[] = ['expired', 'lt25', 'lt50', 'lt70', 'ok', 'unknown'];

export function bucketOf(pct: number | null, days: number | null): LifeBucket {
  if (days !== null && days < 0) return 'expired';
  if (pct === null) return 'unknown';
  return pct < 25 ? 'lt25' : pct < 50 ? 'lt50' : pct < 70 ? 'lt70' : 'ok';
}

/** Suggested action per bucket (the expiry tab stays the list of expired stock). */
export const BUCKET_ACTION: Readonly<Record<LifeBucket, string>> = {
  expired: 'Expired: see Inventory → Expiry; a "destroyed" return posts a QC scrap journal (Sec 17(5)(h) note, MF32)',
  lt25: 'Liquidate now (local trade / staff sale) or return to factory',
  lt50: 'Push to general trade; not for modern trade',
  lt70: 'General trade only (most modern-trade buyers want ≥ 70%)',
  ok: '-',
  unknown: 'Add the MFG / packed date to the batch',
};

export interface NearExpiryRow {
  item_id: string;
  item: string;
  batch: string;
  godown: string;
  qty: number;
  mfg?: string;
  expiry?: string;
  pct: number | null;
  days: number | null;
  bucket: LifeBucket;
}

interface TrackingLike {
  item: { id: string; name: string; track_batches?: boolean };
  batches: readonly { batch: string; mfg?: string; expiry?: string; byGodown: Record<string, number> }[];
}

/** Stock by batch and godown with remaining life on `day`, shortest life first. Only batches with an expiry. */
export function nearExpiry(tracking: Iterable<TrackingLike>, day: string): NearExpiryRow[] {
  const out: NearExpiryRow[] = [];
  for (const t of tracking) {
    if (!t.item.track_batches) continue;
    for (const b of t.batches) {
      if (!b.batch || !b.expiry) continue;
      const r = remainingLife(b, day);
      for (const [godown, qty] of Object.entries(b.byGodown)) {
        if (!(qty > 0.0005)) continue;
        out.push({ item_id: t.item.id, item: t.item.name, batch: b.batch, godown, qty, mfg: b.mfg, expiry: b.expiry, pct: r.pct, days: r.days, bucket: bucketOf(r.pct, r.days) });
      }
    }
  }
  return out.sort((a, b) => (a.days ?? 1e9) - (b.days ?? 1e9) || a.item.localeCompare(b.item) || a.godown.localeCompare(b.godown));
}

/** Units per bucket. */
export function bucketTotals(rows: readonly NearExpiryRow[]): Record<LifeBucket, number> {
  const out = Object.fromEntries(LIFE_BUCKETS.map((b) => [b, 0])) as Record<LifeBucket, number>;
  for (const r of rows) out[r.bucket] = Math.round((out[r.bucket] + r.qty) * 1000) / 1000;
  return out;
}

/* ── Schemes (R8 scheme screen presets; data only) ────────────── */

/** Circular 251/08/2025-GST (12 Sep 2025) note shown with post-sale discounts by financial credit note (MF15). */
export const CIRCULAR_251_NOTE =
  'Post-sale discount by financial credit note (FCN, no GST): the supply value does not change and the dealer reverses no ITC (Circular 251/08/2025-GST, 12 Sep 2025); a promotion the dealer is separately paid for is a taxable service, verify MF15.';

export interface FoodSchemePreset {
  id: 'free_goods' | 'slab_free' | 'display_claim';
  label: string;
  /** Fields merged into a new R8 scheme (`schemesDb.save`) for the picked item. */
  scheme: { buy_qty: number; free_qty: number; free_slabs?: { min_qty: number; free_qty: number }[] };
  note: string;
}

/** Food / FMCG presets: "10 + 1", quantity slabs, and the display claim (settled by FCN, not a scheme line). */
export const FOOD_SCHEME_PRESETS: readonly FoodSchemePreset[] = [
  { id: 'free_goods', label: '10 + 1 free goods', scheme: { buy_qty: 10, free_qty: 1 }, note: 'Free goods on the bill: GST as for any scheme (Circular 92/11/2019).' },
  { id: 'slab_free', label: 'Slab: 24 + 2, 48 + 5', scheme: { buy_qty: 24, free_qty: 2, free_slabs: [{ min_qty: 24, free_qty: 2 }, { min_qty: 48, free_qty: 5 }] }, note: 'Highest slab reached applies (R8 slab scheme).' },
  { id: 'display_claim', label: 'Quarterly secondary discount / display claim', scheme: { buy_qty: 0, free_qty: 0 }, note: CIRCULAR_251_NOTE },
];

/** The scheme input for a preset on an item (display claims have no scheme line: settle them by FCN). */
export function presetScheme(p: FoodSchemePreset, item: { id: string; name: string }, from: string) {
  if (p.id === 'display_claim') return null;
  return { item_id: item.id, item_name: item.name, buy_qty: p.scheme.buy_qty, free_qty: p.scheme.free_qty, valid_from: from, ...(p.scheme.free_slabs ? { free_slabs: p.scheme.free_slabs } : {}) };
}
