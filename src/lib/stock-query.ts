/**
 * Stock Query (WP-8, P2 — Tally's "Stock Query"): one screen per stock item with its closing stock
 * (and the compound alternate-unit reading), stock per godown and batch, the last purchase and sale
 * rates with the party, quantities pending on sales and purchase orders, and today's standard cost and
 * selling price from the dated price lists on the item (`standard_costs` / `selling_prices`).
 *
 * Price lists: each entry is effective from its date until the next one, so a new price never changes
 * what an older date reads (`rateOn`). Dates are bare `yyyy-mm-dd` strings compared as text (Rule 8).
 *
 * Pure apart from `loadStockQuery` (storage reads, lazy Inventory tab only).
 */

import type { InvoiceRecord } from '../types/invoice';
import type { Godown } from '../types/stock';
import type { PurchaseOrder, PurchaseRecord, ReceiptNote } from '../types/purchases';
import { num, round2 } from './invoice-calc';
import { isoDay } from './dates';
import { buildItemIndex, collectEvents, computeStock, type StockEvent, type StockItem, type StockPosition } from './inventory';
import { computeTracking, liveTrackingInputs, type ItemTracking } from './stock-tracking';
import { godownList, godownName, GODOWNS_TABLE } from './godowns';
import { pendingPoQty } from './reorder';
import { salesOrderOutstanding, type SoOutstandingRow } from './sales-orders';
import { compoundText } from './units';
import { getTable } from './storage';

const EPS = 1e-9;
const roundQty = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000 || 0;

/* ── Price lists ──────────────────────────────────────────────── */

export interface PriceEntry {
  /** yyyy-mm-dd the rate applies from. */
  from: string;
  rate: number;
}

/** Valid entries (real date, rate ≥ 0) sorted by date; a second entry on the same date replaces the first. */
export function cleanPriceList(list: unknown): PriceEntry[] | undefined {
  if (!Array.isArray(list)) return undefined;
  const byDay = new Map<string, number>();
  for (const raw of list) {
    const r = (raw ?? {}) as Partial<PriceEntry>;
    const from = isoDay(r.from);
    const rate = num(r.rate);
    if (!from || rate < 0 || r.rate === undefined || String(r.rate).trim() === '') continue;
    byDay.set(from, round2(rate));
  }
  const out = [...byDay].map(([from, rate]) => ({ from, rate })).sort((a, b) => a.from.localeCompare(b.from));
  return out.length ? out : undefined;
}

/** Why a price list cannot be saved, or ''. */
export function validatePriceList(list: readonly { from: string; rate: number | string }[]): string {
  const seen = new Set<string>();
  for (const e of list) {
    const blank = !String(e.from ?? '').trim() && String(e.rate ?? '').trim() === '';
    if (blank) continue;
    if (!isoDay(e.from)) return 'Every price needs the date it applies from.';
    if (String(e.rate ?? '').trim() === '' || num(e.rate) < 0) return 'Prices cannot be negative or empty.';
    if (seen.has(e.from)) return `Two prices start on ${e.from}.`;
    seen.add(e.from);
  }
  return '';
}

/** The rate in force on `day` (the latest entry dated on or before it), or undefined. */
export function rateOn(list: readonly PriceEntry[] | undefined, day: string): number | undefined {
  let found: PriceEntry | undefined;
  for (const e of cleanPriceList(list) ?? []) if (e.from <= day) found = e;
  return found?.rate;
}

/* ── Query ────────────────────────────────────────────────────── */

export interface RateRow {
  date: string;
  ref: string;
  party: string;
  qty: number;
  /** Per base unit: cost for purchases, net sale rate for sales. */
  rate: number;
}

export interface StockQueryResult {
  item: StockItem;
  qty: number;
  value: number;
  avgCost: number;
  /** "2 BOX 3 NOS" when the item has alternate units, else ''. */
  compound: string;
  byGodown: { id: string; name: string; qty: number }[];
  batches: { batch: string; expiry?: string; qty: number }[];
  lastPurchases: RateRow[];
  lastSales: RateRow[];
  /** Base units still to deliver on open sales orders / to receive on open purchase orders (incl. GRNs). */
  pendingSo: number;
  pendingPo: number;
  soLines: SoOutstandingRow[];
  standardCost?: number;
  sellingPrice?: number;
}

export interface StockQueryInput {
  position: StockPosition;
  /** The item's events (`collectEvents`), any order. */
  events: readonly StockEvent[];
  tracking?: ItemTracking;
  godowns: readonly Godown[];
  /** Outstanding sales-order lines of this item (`salesOrderOutstanding`, already matched). */
  soLines: readonly SoOutstandingRow[];
  pendingPo: number;
  day: string;
  /** How many recent purchase / sale rows to show (default 5). */
  limit?: number;
}

export function stockQuery(q: StockQueryInput): StockQueryResult {
  const { position: p } = q;
  const limit = q.limit ?? 5;
  const sorted = [...q.events].filter((e) => e.date <= q.day).sort((a, b) => (a.date === b.date ? b.seq - a.seq : b.date.localeCompare(a.date)));
  const pick = (kind: 'purchase' | 'sale'): RateRow[] =>
    sorted
      .filter((e) => e.kind === kind && (kind === 'purchase' ? e.qty > 0 && num(e.rate) > 0 : e.qty < 0))
      .slice(0, limit)
      .map((e) => ({ date: e.date, ref: e.refNumber ?? '', party: e.party ?? '', qty: roundQty(Math.abs(e.qty)), rate: round2(kind === 'purchase' ? num(e.rate) : num(e.saleRate)) }));
  const byGodown = Object.entries(q.tracking?.byGodown ?? {})
    .filter(([, n]) => Math.abs(n) > EPS)
    .map(([id, n]) => ({ id, name: godownName(q.godowns, id), qty: roundQty(n) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const batches = (q.tracking?.batches ?? [])
    .filter((b) => b.batch && Math.abs(b.qty) > EPS)
    .map((b) => ({ batch: b.batch, ...(b.expiry ? { expiry: b.expiry } : {}), qty: roundQty(b.qty) }));
  return {
    item: p.item, qty: p.qty, value: p.value, avgCost: p.avgCost, compound: compoundText(p.qty, p.item),
    byGodown, batches, lastPurchases: pick('purchase'), lastSales: pick('sale'),
    pendingSo: roundQty(q.soLines.reduce((s, r) => s + r.pendingDelivery * r.unitFactor, 0)),
    pendingPo: roundQty(q.pendingPo), soLines: [...q.soLines],
    standardCost: rateOn(p.item.standard_costs, q.day), sellingPrice: rateOn(p.item.selling_prices, q.day),
  };
}

/** Outstanding sales-order lines that belong to `item` (matched by name / alias + HSN like stock). */
export function soLinesFor(item: StockItem, rows: readonly SoOutstandingRow[], items: readonly StockItem[]): SoOutstandingRow[] {
  const index = buildItemIndex(items.filter((i) => i.track_stock));
  return rows.filter((r) => index.find(r.item, r.hsn)?.id === item.id);
}

/** Live Stock Query for one item (null when the item is unknown or not tracked). */
export function loadStockQuery(itemId: string, day: string): StockQueryResult | null {
  const input = liveTrackingInputs();
  const item = input.items.find((i) => i.id === itemId);
  if (!item || !item.track_stock) return null;
  const position = computeStock(input).find((p) => p.item.id === itemId);
  if (!position) return null;
  const events = collectEvents({ ...input, includeTransfers: false }).get(itemId) ?? [];
  const tracking = computeTracking(input).get(itemId);
  const invoices = getTable<InvoiceRecord>('invoices');
  const links = getTable<{ from_id: string; to_id: string; relation: string }>('doc_links');
  const soLines = soLinesFor(item, salesOrderOutstanding(invoices, links, day), input.items);
  const pendingPo = pendingPoQty(getTable<PurchaseOrder>('purchase_orders'), getTable<PurchaseRecord>('purchases'), input.items, getTable<ReceiptNote>('receipt_notes')).get(itemId) ?? 0;
  return stockQuery({ position, events, tracking, godowns: godownList(getTable<Godown>(GODOWNS_TABLE)), soLines, pendingPo, day });
}
