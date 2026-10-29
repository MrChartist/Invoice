/**
 * Stock event source for kits (8.85 — BUSY / Zoho "composite item / kit"). Registered in `collectEvents`
 * (inventory.ts) with one call.
 *
 * A kit is a stock item with `kit: true` that is not stocked itself (`track_stock` off). Its components
 * are its BOM (`boms` table, Manufacturing → BOM: the default BOM of the kit item, else its first): per
 * `batch_qty` kits, `qty` of each component, grossed up by `scrap_pct`. A sale line naming the kit (by
 * name / alias, quantity in the line unit × `unit_factor`) issues every tracked component as a sale
 * (kind `sale`, so it is costed and counted in COGS); a credit note that returns goods brings them back
 * (kind `return`). The kit line's net value is spread over the components in proportion to their sale
 * rate × quantity (quantity alone when no component has a rate), so margins stay meaningful.
 * Components leave from the line's godown, else the BOM line's godown.
 *
 * Pure: the caller passes the documents, items, BOMs and its own effect rule (challans, drafts, links).
 */

import type { Bom } from '../types/manufacturing';
import type { InvoiceLike, StockEvent, StockItem } from './inventory';
import { num } from './invoice-calc';
import { lineFactor } from './units';

type Push = (itemId: string, ev: Omit<StockEvent, 'seq' | 'rank' | 'godown'> & { godown?: string; rank?: number }) => void;

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();
const day = (d: unknown) => String(d ?? '').slice(0, 10);

export interface KitComponent { item_id: string; per: number; godown_id?: string; share: number }

/** Kit item id → components per ONE kit (base units) with their value share. Pure. */
export function kitTable(items: readonly StockItem[], boms: readonly Bom[]): Map<string, KitComponent[]> {
  const out = new Map<string, KitComponent[]>();
  const byId = new Map(items.map((i) => [i.id, i]));
  for (const kit of items) {
    if (!kit?.kit) continue;
    const mine = boms.filter((b) => b?.item_id === kit.id);
    const bom = mine.find((b) => b.is_default) ?? mine[0];
    if (!bom) continue;
    const batch = num(bom.batch_qty) > 0 ? num(bom.batch_qty) : 1;
    const comps = (bom.components ?? [])
      .filter((c) => c?.item_id && c.item_id !== kit.id && num(c.qty) > 0)
      .map((c) => ({ item_id: c.item_id, per: (num(c.qty) * (1 + Math.max(num(c.scrap_pct), 0) / 100)) / batch, godown_id: c.godown_id }));
    if (!comps.length) continue;
    const weight = (c: { item_id: string; per: number }) => c.per * num(byId.get(c.item_id)?.sale_rate);
    const total = comps.reduce((s, c) => s + weight(c), 0);
    const qtyTotal = comps.reduce((s, c) => s + c.per, 0);
    out.set(kit.id, comps.map((c) => ({ ...c, share: total > 0 ? weight(c) / total : c.per / qtyTotal })));
  }
  return out;
}

/** Issue / return kit components for the kit lines of the documents. */
export function kitStockEvents(
  invoices: readonly InvoiceLike[],
  items: readonly StockItem[],
  boms: readonly Bom[] | undefined,
  effect: (inv: InvoiceLike) => 'out' | 'in' | null,
  push: Push,
): void {
  if (!boms?.length || !items.some((i) => i?.kit)) return;
  const table = kitTable(items, boms);
  if (!table.size) return;
  const byName = new Map<string, string>();
  for (const it of items) {
    if (!table.has(it.id)) continue;
    for (const n of [it.name, ...(it.aliases ?? [])]) if (norm(n) && !byName.has(norm(n))) byName.set(norm(n), it.id);
  }
  const tracked = new Set(items.filter((i) => i.track_stock).map((i) => i.id));
  for (const inv of invoices) {
    if (!inv) continue;
    const eff = effect(inv);
    if (!eff) continue;
    for (const line of inv.items ?? []) {
      const kitId = byName.get(norm(line.name));
      const kits = num(line.quantity) * lineFactor(line);
      if (!kitId || kits <= 0) continue;
      const lineValue = num(line.rate) * (1 - Math.min(Math.max(num(line.discount_percent), 0), 100) / 100) * num(line.quantity);
      for (const c of table.get(kitId) ?? []) {
        if (!tracked.has(c.item_id)) continue;
        const q = kits * c.per;
        push(c.item_id, {
          date: day(inv.issue_date),
          kind: eff === 'out' ? 'sale' : 'return',
          qty: eff === 'out' ? -q : q,
          saleRate: q > 0 ? (lineValue * c.share) / q : 0,
          particulars: `${eff === 'out' ? 'Kit sale' : 'Kit return'} — ${line.name} · ${inv.invoice_number ?? ''}${inv.client?.name ? ` · ${inv.client.name}` : ''}`,
          refType: 'invoice',
          refId: inv.id,
          refNumber: inv.invoice_number ?? '',
          party: inv.client?.name ?? '',
          godown: line.godown_id || c.godown_id,
        });
      }
    }
  }
}

/**
 * 8.88 (PENDING 47): the tracked components (base units) a document's kit lines take, for the editor's shortfall
 * warning — the same kit table, name / alias match and `unit_factor` as `kitStockEvents`. Item id → { qty, kits }. Pure.
 */
export function kitComponentDemand(
  lines: readonly { name?: string; quantity?: number; unit_factor?: number }[],
  items: readonly StockItem[],
  boms: readonly Bom[] | undefined,
): Map<string, { qty: number; kits: string[] }> {
  const out = new Map<string, { qty: number; kits: string[] }>();
  if (!boms?.length || !items.some((i) => i?.kit)) return out;
  const table = kitTable(items, boms);
  if (!table.size) return out;
  const byName = new Map<string, StockItem>();
  for (const it of items) {
    if (!table.has(it.id)) continue;
    for (const n of [it.name, ...(it.aliases ?? [])]) if (norm(n) && !byName.has(norm(n))) byName.set(norm(n), it);
  }
  const tracked = new Set(items.filter((i) => i.track_stock).map((i) => i.id));
  for (const line of lines) {
    const kit = byName.get(norm(line.name));
    const kits = num(line.quantity) * lineFactor(line as never);
    if (!kit || kits <= 0) continue;
    for (const c of table.get(kit.id) ?? []) {
      if (!tracked.has(c.item_id)) continue;
      const d = out.get(c.item_id) ?? { qty: 0, kits: [] };
      d.qty += kits * c.per;
      if (!d.kits.includes(kit.name)) d.kits.push(kit.name);
      out.set(c.item_id, d);
    }
  }
  return out;
}
