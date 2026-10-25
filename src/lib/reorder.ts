/**
 * Reorder levels and the Reorder Status report (Tally parity, Phase 7).
 *
 * Per stock item: `reorder_level` (company-wide), optional `reorder_by_godown` and `min_order_qty`.
 *   shortfall = max(0, reorder level − closing)
 *   pending   = quantity still to receive on open / partly received purchase orders (WP-8: less goods
 *               already received on receipt notes (GRN) that are not billed yet, in base units)
 *   suggested = shortfall − pending, raised to the minimum order quantity (0 when nothing is needed)
 * Pending POs are company-wide, so per-godown rows show them but do not subtract them twice.
 *
 * Pure except for `loadReorderStatus`; the bell provider lives in stock-alerts.ts (lazy).
 */

import type { PurchaseOrder, PurchaseOrderLine, PurchaseRecord, ReceiptNote } from '../types/purchases';
import { MAIN_GODOWN_ID } from '../types/stock';
import type { AppNotification } from './notifications';
import { num, round2 } from './invoice-calc';
import { buildItemIndex, loadPositions, type StockItem, type StockPosition } from './inventory';
import { poFulfilment } from './purchase-orders';
import { purchaseOrderOutstanding } from './receipt-notes';
import { lineFactor } from './units';
import { loadTracking, type TrackingMap } from './stock-tracking';
import { getTable } from './storage';

const EPS = 1e-9;
const roundQty = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000 || 0;

export interface ReorderRow {
  item: StockItem;
  /** Godown id for a per-godown level; undefined = company-wide. */
  godown?: string;
  closing: number;
  reorderLevel: number;
  shortfall: number;
  pendingPo: number;
  minOrderQty: number;
  suggested: number;
  /** At or below the reorder level. */
  below: boolean;
  /** Last purchase rate (else average cost) and the vendor of the last purchase, for a PO. */
  rate: number;
  vendor?: string;
}

/**
 * Quantity still to receive per stock item id (base units) on open / partly received purchase orders.
 * With `receiptNotes` (WP-8) goods accepted on a GRN count as received before the bill arrives, using
 * the same rule as the Purchase Order Outstanding report.
 */
export function pendingPoQty(
  orders: readonly PurchaseOrder[], purchases: readonly PurchaseRecord[], items: readonly StockItem[], receiptNotes?: readonly ReceiptNote[],
): Map<string, number> {
  const tracked = items.filter((i) => i.track_stock);
  const index = buildItemIndex(tracked);
  const byId = new Map(tracked.map((i) => [i.id, i]));
  const itemOf = (l: PurchaseOrderLine) => (l.item_id ? byId.get(l.item_id) : undefined) ?? index.find(l.name, l.hsn);
  const out = new Map<string, number>();
  if (receiptNotes) {
    const lines = new Map(orders.flatMap((po) => (po?.lines ?? []).map((l) => [l.id, l] as const)));
    for (const r of purchaseOrderOutstanding(orders, purchases, receiptNotes, '9999-12-31')) {
      const l = lines.get(r.lineId);
      const it = l && itemOf(l);
      if (!it || r.pending <= EPS) continue;
      out.set(it.id, roundQty((out.get(it.id) ?? 0) + r.pending * lineFactor(l)));
    }
    return out;
  }
  for (const po of orders) {
    const f = poFulfilment(po, purchases);
    if (f.state === 'Closed' || f.state === 'Received') continue;
    for (const l of f.lines) {
      const it = itemOf(l.line);
      if (!it || l.pending <= EPS) continue;
      out.set(it.id, roundQty((out.get(it.id) ?? 0) + l.pending * lineFactor(l.line)));
    }
  }
  return out;
}

export function suggestedQty(shortfall: number, pending: number, moq: number): number {
  const net = roundQty(shortfall - pending);
  if (net <= EPS) return 0;
  return roundQty(Math.max(net, Math.max(num(moq), 0)));
}

function lastPurchase(p: StockPosition): { rate: number; vendor?: string } {
  for (let i = p.ledger.length - 1; i >= 0; i--) {
    const r = p.ledger[i];
    if (r.kind === 'purchase' && r.rate > 0) return { rate: r.rate, vendor: r.party || undefined };
  }
  return { rate: p.avgCost > 0 ? p.avgCost : num(p.item.opening_rate) };
}

/** Reorder Status rows: every item with a reorder level (company-wide and per godown), shortfalls first. */
export function reorderStatus(
  positions: readonly StockPosition[], pending: Map<string, number>, tracking?: TrackingMap,
): ReorderRow[] {
  const rows: ReorderRow[] = [];
  for (const p of positions) {
    if (!p.item.track_stock) continue;
    const moq = Math.max(num(p.item.min_order_qty), 0);
    const last = lastPurchase(p);
    const po = pending.get(p.item.id) ?? 0;
    const level = num(p.item.reorder_level);
    if (level > 0) {
      const shortfall = roundQty(Math.max(0, level - p.qty));
      rows.push({
        item: p.item, closing: p.qty, reorderLevel: level, shortfall, pendingPo: po, minOrderQty: moq,
        suggested: suggestedQty(shortfall, po, moq), below: p.qty <= level + EPS, rate: round2(last.rate), vendor: last.vendor,
      });
    }
    for (const [godown, raw] of Object.entries(p.item.reorder_by_godown ?? {})) {
      const lvl = num(raw);
      if (!(lvl > 0)) continue;
      const closing = roundQty(tracking?.get(p.item.id)?.byGodown[godown || MAIN_GODOWN_ID] ?? 0);
      const shortfall = roundQty(Math.max(0, lvl - closing));
      rows.push({
        item: p.item, godown, closing, reorderLevel: lvl, shortfall, pendingPo: po, minOrderQty: moq,
        // A company-wide row already nets the POs off; a godown row nets them only when it is the item's only level.
        suggested: suggestedQty(shortfall, level > 0 ? 0 : po, moq), below: closing <= lvl + EPS, rate: round2(last.rate), vendor: last.vendor,
      });
    }
  }
  return rows.sort((a, b) => Number(b.below) - Number(a.below) || b.suggested - a.suggested || a.item.name.localeCompare(b.item.name));
}

/** Purchase-order lines for the chosen reorder rows (one line per item, quantities summed). */
export function poLinesFromReorder(rows: readonly ReorderRow[], newId: () => string): PurchaseOrderLine[] {
  const byItem = new Map<string, PurchaseOrderLine>();
  for (const r of rows) {
    if (!(r.suggested > 0)) continue;
    const prev = byItem.get(r.item.id);
    if (prev) prev.quantity = roundQty(prev.quantity + r.suggested);
    else {
      byItem.set(r.item.id, {
        id: newId(), name: r.item.name, ...(r.item.hsn ? { hsn: r.item.hsn } : {}), unit: r.item.unit, item_id: r.item.id,
        quantity: r.suggested, rate: r.rate, tax_rate: num(r.item.tax_rate),
      });
    }
  }
  return [...byItem.values()];
}

/** Bell notice: items at or below their reorder level with something still to order. */
export function reorderNotices(rows: readonly ReorderRow[], at: string): AppNotification[] {
  const due = rows.filter((r) => r.below && r.suggested > 0);
  if (due.length === 0) return [];
  const names = due.slice(0, 3).map((r) => r.item.name).join(', ') + (due.length > 3 ? ` and ${due.length - 3} more` : '');
  return [{
    id: `stock-reorder:${due.length}:${due.map((r) => r.item.id).sort().join(',').slice(0, 80)}`,
    severity: 'warning',
    title: `${due.length} item${due.length === 1 ? '' : 's'} at or below reorder level`,
    detail: `${names}. Review the Reorder Status and raise a purchase order.`,
    href: '/manufacturing?tab=reorder',
    cta: 'Reorder status',
    at,
  }];
}

/** Live Reorder Status. */
export function loadReorderStatus(): ReorderRow[] {
  const positions = loadPositions();
  const items = positions.map((p) => p.item);
  const pending = pendingPoQty(getTable<PurchaseOrder>('purchase_orders'), getTable<PurchaseRecord>('purchases'), items, getTable<ReceiptNote>('receipt_notes'));
  const needsGodowns = items.some((i) => i.reorder_by_godown && Object.keys(i.reorder_by_godown).length);
  return reorderStatus(positions, pending, needsGodowns ? loadTracking() : undefined);
}
