/**
 * MF-A4 dated MRP, built on `mrp.ts` (its low-level codes and default BOMs) without changing its single-horizon result.
 * Demand is dated (open sales orders by due date, released orders' materials not yet issued, typed / plan lines);
 * supply is dated (stock today, open purchase orders by expected date, open production orders by due date). Every item
 * is netted bucket by bucket (day or week) in low-level-code order; a planned receipt is released `lead` days earlier
 * (buy: `lead_days`; make: `make_days`, else the routing's planned hours ÷ the slowest centre's daily hours, rounded up),
 * and a made item's components are demanded on its release day. Past-due demand lands in the first bucket and is
 * flagged; a release before today is "late". Over a single bucket the totals equal `runMrp` (tests/mf-mrp-dated.test.ts).
 * Suggestions only: rows feed the existing "Create purchase order" / "Create production orders" actions.
 */
import type { Bom } from '../../types/manufacturing';
import type { PurchaseOrder, PurchaseRecord, ReceiptNote } from '../../types/purchases';
import type { InvoiceRecord } from '../../types/invoice';
import type { ProductionOrder } from '../../types/production-r4';
import type { StockItem } from '../inventory';
import { buildItemIndex } from '../inventory';
import { defaultBomMap, lowLevelCodes } from '../mrp';
import { num } from '../invoice-calc';
import { lineFactor } from '../units';
import { purchaseOrderOutstanding } from '../receipt-notes';
import { salesOrderOutstanding } from '../sales-orders';
import { loadOrderDocs, materialRows, orderProgress } from '../production/orders';
import { peekTable } from '../storage';
import { addDays, weekday } from './mf-centres';

export interface DatedQty { item_id: string; date: string; qty: number; source: string }
export interface DatedBucket { key: string; gross: number; receipts: number; planned: number; poh: number }
export interface PlannedOrder { qty: number; due: string; release: string; late: boolean }
export interface DatedRow {
  item: StockItem;
  level: number;
  action: 'make' | 'buy' | 'none';
  bomId?: string;
  lead: number;
  buckets: DatedBucket[];
  orders: PlannedOrder[];
  suggested: number;
  pastDue: boolean;
}

export interface DatedInput {
  items: readonly StockItem[];
  boms: readonly Bom[];
  stock: ReadonlyMap<string, number>;
  demand: readonly DatedQty[];
  supply?: readonly DatedQty[];
  start: string;
  by: 'day' | 'week';
  count: number;
  /** Manufacturing lead days of an item (default 0; see `makeDaysOf`). */
  makeDays?: (itemId: string) => number;
}

const EPS = 1e-6;
const rq = (x: number) => Math.round((x + Number.EPSILON) * 1000) / 1000 || 0;
const monday = (d: string) => addDays(d, -((weekday(d) + 6) % 7));

/** Bucket keys from `start` (week buckets start on Monday). */
export function bucketKeys(start: string, by: 'day' | 'week', count: number): string[] {
  const first = by === 'week' ? monday(start) : start;
  return Array.from({ length: Math.max(count, 1) }, (_, i) => addDays(first, by === 'week' ? i * 7 : i));
}

export function runDatedMrp(x: DatedInput): DatedRow[] {
  const keys = bucketKeys(x.start, x.by, x.count);
  const last = addDays(keys.at(-1)!, x.by === 'week' ? 6 : 0);
  const at = (date: string) => {
    if (date < keys[0]) return 0;
    if (date > last) return -1;
    const k = x.by === 'week' ? monday(date) : date;
    return keys.indexOf(k);
  };
  const byId = new Map(x.items.map((i) => [i.id, i]));
  const bomOf = defaultBomMap(x.boms);
  const demanded = [...new Set(x.demand.filter((d) => num(d.qty) > 0 && byId.has(d.item_id)).map((d) => d.item_id))];
  const levels = lowLevelCodes(demanded, bomOf);
  const gross = new Map<string, number[]>();
  const pastDue = new Set<string>();
  const g = (id: string) => gross.get(id) ?? gross.set(id, keys.map(() => 0)).get(id)!;
  for (const d of x.demand) {
    if (!byId.has(d.item_id) || !(num(d.qty) > 0)) continue;
    const b = at(d.date);
    if (b < 0) continue;
    if (d.date < x.start) pastDue.add(d.item_id);
    g(d.item_id)[b] = rq(g(d.item_id)[b] + num(d.qty));
  }
  const receipts = new Map<string, number[]>();
  for (const s of x.supply ?? []) {
    const b = at(s.date);
    if (b < 0 || !(num(s.qty) > 0)) continue;
    const r = receipts.get(s.item_id) ?? keys.map(() => 0);
    r[b] = rq(r[b] + num(s.qty));
    receipts.set(s.item_id, r);
  }
  const order = [...levels.entries()].sort((a, b) => a[1] - b[1] || (byId.get(a[0])?.name ?? '').localeCompare(byId.get(b[0])?.name ?? ''));
  const rows: DatedRow[] = [];
  for (const [id, level] of order) {
    const item = byId.get(id);
    if (!item) continue;
    const bom = bomOf.get(id);
    const lead = Math.max(Math.round(bom ? num(item.make_days) || (x.makeDays?.(id) ?? 0) : num(item.lead_days)), 0);
    let poh = item.track_stock ? rq(Math.max(x.stock.get(id) ?? 0, 0)) : 0;
    const gr = g(id);
    const rc = receipts.get(id) ?? keys.map(() => 0);
    const buckets: DatedBucket[] = [];
    const orders: PlannedOrder[] = [];
    keys.forEach((key, b) => {
      const avail = rq(poh + rc[b]);
      const net = rq(gr[b] - avail);
      let planned = 0;
      if (net > EPS) {
        planned = bom ? net : rq(Math.max(net, Math.max(num(item.min_order_qty), 0)));
        const release = addDays(key, -lead);
        orders.push({ qty: planned, due: key, release, late: release < x.start });
        if (bom) {
          const per = planned / (num(bom.batch_qty) > 0 ? num(bom.batch_qty) : 1);
          const rb = Math.max(at(release), 0);
          for (const c of bom.components ?? []) {
            if (!c.item_id || !(num(c.qty) > 0) || !levels.has(c.item_id)) continue;
            g(c.item_id)[rb] = rq(g(c.item_id)[rb] + num(c.qty) * per * (1 + Math.max(num(c.scrap_pct), 0) / 100));
          }
        }
      }
      poh = rq(avail + planned - gr[b]);
      buckets.push({ key, gross: gr[b], receipts: rc[b], planned, poh });
    });
    const suggested = rq(orders.reduce((s, o) => s + o.qty, 0));
    const totalGross = gr.reduce((s, v) => s + v, 0);
    if (totalGross > EPS || level === 0) rows.push({ item, level, action: suggested > EPS ? (bom ? 'make' : 'buy') : 'none', ...(bom ? { bomId: bom.id } : {}), lead, buckets, orders, suggested, pastDue: pastDue.has(id) });
  }
  return rows;
}

/* ── Sources (live data) ──────────────────────────────────────── */

/**
 * Dated demand and supply from the books: open sales-order lines (by due date, else order date), released orders'
 * materials still to issue (by order date) and their finished output still to come (by due date), open purchase-order
 * lines (by expected date, else order date). Lines are matched to stock items by id, else name + HSN; quantities in
 * base units (`lineFactor`). Purchases are read only through `purchaseOrderOutstanding` (shared `liveBills` reader).
 */
export function datedSources(items: readonly StockItem[], today: string): { demand: DatedQty[]; supply: DatedQty[] } {
  const index = buildItemIndex(items.filter((i) => i.track_stock));
  const demand: DatedQty[] = [];
  const supply: DatedQty[] = [];
  const invoices = peekTable<InvoiceRecord>('invoices');
  for (const r of salesOrderOutstanding(invoices as never, peekTable('doc_links') as never, today)) {
    const it = index.find(r.item, r.hsn);
    if (it && r.pendingDelivery > EPS) demand.push({ item_id: it.id, date: r.due || r.date, qty: rq(r.pendingDelivery * r.unitFactor), source: r.number });
  }
  const docs = loadOrderDocs();
  for (const o of peekTable<ProductionOrder>('production_orders')) {
    if (!o || !['released', 'in_progress'].includes(o.status)) continue;
    const p = orderProgress(o, docs);
    for (const m of materialRows(o, p)) if (m.balance > EPS) demand.push({ item_id: m.item_id, date: o.date, qty: m.balance, source: o.number });
    const left = rq(num(o.planned_qty) - p.output);
    if (left > EPS) supply.push({ item_id: o.item_id, date: o.due_date || o.date, qty: left, source: o.number });
  }
  const pos = peekTable<PurchaseOrder>('purchase_orders');
  const lines = new Map(pos.flatMap((po) => (po?.lines ?? []).map((l) => [l.id, l] as const)));
  for (const r of purchaseOrderOutstanding(pos, peekTable<PurchaseRecord>('purchases'), peekTable<ReceiptNote>('receipt_notes'), '9999-12-31')) {
    const l = lines.get(r.lineId);
    const it = l && ((l.item_id ? items.find((i) => i.id === l.item_id) : undefined) ?? index.find(l.name, l.hsn));
    if (it && r.pending > EPS) supply.push({ item_id: it.id, date: r.expected || r.date, qty: rq(r.pending * lineFactor(l)), source: r.number });
  }
  return { demand, supply };
}
