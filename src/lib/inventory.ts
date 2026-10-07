/**
 * Inventory / stock summary (Tally / Vyapar style).
 *
 * Stock is DERIVED, never stored: a position is computed on read from
 *   opening balance + manual `stock_moves` + invoice lines + purchase lines.
 * Invoices and purchases are read-only inputs and are never mutated.
 *
 * Pure logic (everything above the "persistence" banner) has no browser APIs
 * so it is unit-tested under node:test.
 *
 * Costing: weighted-average (default) or FIFO. Sales are costed at issue time
 * (COGS); sales returns come back in at the cost of the most recent issue.
 */

import type { InvoiceItem, InvoiceRecord } from '../types/invoice';
import { round2, num } from './invoice-calc';
import { DB_PREFIX, generateId, getJson, getTable, setJson, setTable } from './storage';

/* ── Types ───────────────────────────────────────────────────── */

export type CostingMethod = 'WEIGHTED_AVG' | 'FIFO';
export type MoveKind = 'opening' | 'sale' | 'purchase' | 'adjustment' | 'return';
export type StockStatus = 'untracked' | 'negative' | 'out' | 'low' | 'ok';

export interface StockItem {
  id: string;
  /** Matches the catalogue / invoice line name (case-insensitive). */
  name: string;
  sku?: string;
  hsn?: string;
  unit: string;
  track_stock: boolean;
  opening_qty: number;
  opening_rate: number;
  reorder_level: number;
  sale_rate?: number;
  tax_rate?: number;
  location?: string;
  created_at?: string;
}

export interface StockMove {
  id: string;
  item_id: string;
  /** YYYY-MM-DD */
  date: string;
  /** Signed: positive = stock in, negative = stock out. */
  qty: number;
  /** Unit cost for stock-in; sale rate for stock-out (informational). */
  rate: number;
  kind: MoveKind;
  ref_type?: string;
  ref_id?: string;
  note?: string;
}

/** Minimal, defensive view of a purchase bill (the purchases module owns the real type). */
export interface PurchaseLike {
  id?: string;
  status?: string;
  bill_number?: string;
  invoice_number?: string;
  vendor_name?: string;
  date?: string;
  bill_date?: string;
  issue_date?: string;
  invoice_date?: string;
  lines?: PurchaseLineLike[];
  items?: PurchaseLineLike[];
}
export interface PurchaseLineLike {
  name?: string;
  description?: string;
  hsn?: string;
  quantity?: number;
  qty?: number;
  rate?: number;
  unit_price?: number;
  amount?: number;
  discount_percent?: number;
}

export interface InventorySettings {
  method: CostingMethod;
  /** Delivery challans reduce stock when true (default false). */
  includeChallans: boolean;
}

export const DEFAULT_SETTINGS: InventorySettings = { method: 'WEIGHTED_AVG', includeChallans: false };

export interface LedgerRow {
  key: string;
  date: string;
  kind: MoveKind;
  particulars: string;
  refType?: string;
  refId?: string;
  qtyIn: number;
  qtyOut: number;
  /** Unit rate of this movement (cost for in, unit COGS for out). */
  rate: number;
  /** Value of this movement (in: cost in, out: cost of goods issued). */
  amount: number;
  /** Running quantity after this row. */
  balance: number;
  /** Running stock value after this row. */
  value: number;
}

export interface StockPosition {
  item: StockItem;
  qty: number;
  value: number;
  /** Closing value / qty (0 when no stock). */
  avgCost: number;
  purchasedQty: number;
  purchasedValue: number;
  soldQty: number;
  /** Net sales value (qty x rate after line discount, ex-tax). */
  revenue: number;
  /** Cost of goods sold for the sales. */
  cogs: number;
  returnedQty: number;
  adjustedInQty: number;
  adjustedOutQty: number;
  status: StockStatus;
  isLow: boolean;
  isNegative: boolean;
  lastMovement: string;
  ledger: LedgerRow[];
}

/** The slice of an invoice the engine reads. */
export type InvoiceLike = Partial<
  Pick<InvoiceRecord, 'id' | 'doc_type' | 'status' | 'issue_date' | 'invoice_number' | 'items' | 'client'>
>;

export interface StockInputs {
  items: StockItem[];
  moves: StockMove[];
  invoices: InvoiceLike[];
  purchases?: PurchaseLike[];
  method?: CostingMethod;
  includeChallans?: boolean;
  /** Ignore everything dated after this (YYYY-MM-DD). */
  asOf?: string;
  /** Skip this invoice (used to ask "what if I edit it"). */
  excludeInvoiceId?: string;
}

const EPS = 1e-9;
const OPENING_DATE = '0000-00-00';

/* ── Matching ────────────────────────────────────────────────── */

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();

export interface ItemIndex {
  find(name: string, hsn?: string): StockItem | undefined;
}

/** Name (case-insensitive) is primary; HSN breaks ties and rejects conflicting codes. */
export function buildItemIndex(items: StockItem[]): ItemIndex {
  const byName = new Map<string, StockItem[]>();
  for (const it of items) {
    const k = norm(it.name);
    if (!k) continue;
    const list = byName.get(k);
    if (list) list.push(it);
    else byName.set(k, [it]);
  }
  return {
    find(name, hsn) {
      const list = byName.get(norm(name));
      if (!list) return undefined;
      const h = norm(hsn);
      if (!h) return list[0];
      const exact = list.find((i) => norm(i.hsn) === h);
      if (exact) return exact;
      return list.find((i) => !norm(i.hsn));
    },
  };
}

/* ── Events ──────────────────────────────────────────────────── */

interface StockEvent {
  date: string;
  /** Same-day ordering: opening, stock-in, stock-out. */
  rank: number;
  seq: number;
  kind: MoveKind;
  qty: number;
  /** Cost rate for ins (undefined = derive), ignored for outs. */
  rate?: number;
  saleRate?: number;
  particulars: string;
  refType?: string;
  refId?: string;
}

function dayOf(d: unknown): string {
  return String(d ?? '').slice(0, 10);
}

function rankFor(kind: MoveKind, qty: number): number {
  if (kind === 'opening') return 0;
  return qty >= 0 ? 1 : 2;
}

function netRate(line: Pick<InvoiceItem, 'rate' | 'discount_percent'>): number {
  return num(line.rate) * (1 - Math.min(Math.max(num(line.discount_percent), 0), 100) / 100);
}

function invoiceEffect(
  doc: string | undefined,
  status: string | undefined,
  includeChallans: boolean,
): 'out' | 'in' | null {
  if (status === 'Draft' || status === 'Cancelled') return null;
  if (doc === 'INVOICE' || doc === 'TAX_INVOICE' || doc === undefined) return 'out';
  if (doc === 'CREDIT_NOTE') return 'in';
  if (doc === 'DELIVERY_CHALLAN') return includeChallans ? 'out' : null;
  return null; // QUOTATION / PROFORMA never touch stock
}

function purchaseDate(p: PurchaseLike): string {
  return dayOf(p.bill_date ?? p.date ?? p.issue_date ?? p.invoice_date);
}

/** Collect every stock event for every tracked item. Pure; inputs untouched. */
export function collectEvents(input: StockInputs): Map<string, StockEvent[]> {
  const { items, moves, invoices, purchases = [], includeChallans = false, asOf, excludeInvoiceId } = input;
  const out = new Map<string, StockEvent[]>();
  const index = buildItemIndex(items.filter((i) => i.track_stock));
  let seq = 0;
  const push = (itemId: string, ev: Omit<StockEvent, 'seq' | 'rank'>) => {
    if (asOf && ev.date > asOf) return;
    const list = out.get(itemId) ?? [];
    list.push({ ...ev, rank: rankFor(ev.kind, ev.qty), seq: seq++ });
    out.set(itemId, list);
  };

  for (const it of items) {
    if (!it.track_stock) continue;
    out.set(it.id, []);
    if (num(it.opening_qty) !== 0) {
      push(it.id, {
        date: OPENING_DATE,
        kind: 'opening',
        qty: num(it.opening_qty),
        rate: num(it.opening_rate),
        particulars: 'Opening balance',
      });
    }
  }

  const byId = new Map(items.map((i) => [i.id, i]));
  for (const m of moves) {
    const it = byId.get(m.item_id);
    if (!it || !it.track_stock || !num(m.qty)) continue;
    const q = num(m.qty);
    const note = m.note ? ` — ${m.note}` : '';
    const label =
      m.kind === 'opening' ? 'Opening balance'
      : m.kind === 'adjustment' ? `Adjustment${note}`
      : m.kind === 'purchase' ? `Purchase${note}`
      : m.kind === 'return' ? `Return${note}`
      : `Sale${note}`;
    push(it.id, {
      date: m.kind === 'opening' ? dayOf(m.date) || OPENING_DATE : dayOf(m.date),
      kind: m.kind,
      qty: q,
      rate: num(m.rate) > 0 ? num(m.rate) : undefined,
      saleRate: q < 0 ? num(m.rate) : undefined,
      particulars: label,
      refType: m.ref_type ?? 'move',
      refId: m.ref_id ?? m.id,
    });
  }

  for (const inv of invoices) {
    if (!inv || (excludeInvoiceId && inv.id === excludeInvoiceId)) continue;
    const effect = invoiceEffect(inv.doc_type, inv.status, includeChallans);
    if (!effect) continue;
    const date = dayOf(inv.issue_date);
    const clientName = inv.client?.name ? ` · ${inv.client.name}` : '';
    for (const line of inv.items ?? []) {
      const it = index.find(line.name, line.hsn);
      const q = num(line.quantity);
      if (!it || q <= 0) continue;
      if (effect === 'out') {
        push(it.id, {
          date,
          kind: 'sale',
          qty: -q,
          saleRate: netRate(line),
          particulars: `${inv.doc_type === 'DELIVERY_CHALLAN' ? 'Challan' : 'Sale'} — ${inv.invoice_number ?? ''}${clientName}`,
          refType: 'invoice',
          refId: inv.id,
        });
      } else {
        push(it.id, {
          date,
          kind: 'return',
          qty: q,
          saleRate: netRate(line),
          particulars: `Sales return — ${inv.invoice_number ?? ''}${clientName}`,
          refType: 'invoice',
          refId: inv.id,
        });
      }
    }
  }

  for (const p of purchases) {
    if (!p) continue;
    const st = norm(p.status);
    if (st === 'draft' || st === 'cancelled' || st === 'canceled') continue;
    const date = purchaseDate(p);
    for (const line of p.lines ?? p.items ?? []) {
      const it = index.find(line.name ?? line.description ?? '', line.hsn);
      const q = num(line.quantity ?? line.qty);
      if (!it || q <= 0) continue;
      let rate = num(line.rate ?? line.unit_price);
      if (!rate && num(line.amount)) rate = num(line.amount) / q;
      rate *= 1 - Math.min(Math.max(num(line.discount_percent), 0), 100) / 100;
      push(it.id, {
        date,
        kind: 'purchase',
        qty: q,
        rate,
        particulars: `Purchase — ${p.bill_number ?? p.invoice_number ?? ''}${p.vendor_name ? ` · ${p.vendor_name}` : ''}`,
        refType: 'purchase',
        refId: p.id,
      });
    }
  }

  for (const list of out.values()) {
    list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.rank - b.rank || a.seq - b.seq));
  }
  return out;
}

/* ── Costing engines ─────────────────────────────────────────── */

interface Costing {
  receive(qty: number, rate: number): void;
  /** Returns the total cost of goods issued. */
  issue(qty: number): number;
  qty(): number;
  value(): number;
  unit(): number;
}

function weightedAverage(): Costing {
  let qty = 0;
  let value = 0;
  let last = 0;
  const unitNow = () => (qty > EPS ? value / qty : last);
  return {
    receive(q, rate) {
      value += q * rate;
      qty += q;
      if (qty > EPS) last = value / qty;
      else {
        last = rate;
        value = Math.abs(qty) < EPS ? 0 : qty * rate;
      }
    },
    issue(q) {
      const u = unitNow();
      const cost = q * u;
      qty -= q;
      value -= cost;
      last = u;
      if (qty <= EPS) value = Math.abs(qty) < EPS ? 0 : qty * u;
      return cost;
    },
    qty: () => qty,
    value: () => value,
    unit: unitNow,
  };
}

function fifo(): Costing {
  const layers: { qty: number; rate: number }[] = [];
  let deficit = 0;
  let last = 0;
  const layerQty = () => layers.reduce((s, l) => s + l.qty, 0);
  const layerValue = () => layers.reduce((s, l) => s + l.qty * l.rate, 0);
  return {
    receive(q, rate) {
      let rest = q;
      if (deficit > EPS) {
        const cover = Math.min(rest, deficit);
        deficit -= cover;
        rest -= cover;
      }
      last = rate;
      if (rest > EPS) layers.push({ qty: rest, rate });
    },
    issue(q) {
      let rest = q;
      let cost = 0;
      while (rest > EPS && layers.length) {
        const l = layers[0];
        const take = Math.min(rest, l.qty);
        cost += take * l.rate;
        l.qty -= take;
        rest -= take;
        last = l.rate;
        if (l.qty <= EPS) layers.shift();
      }
      if (rest > EPS) {
        cost += rest * last;
        deficit += rest;
      }
      return cost;
    },
    qty: () => layerQty() - deficit,
    value: () => layerValue() - deficit * last,
    unit: () => (layers.length ? layers[0].rate : last),
  };
}

/* ── Position per item ───────────────────────────────────────── */

export function statusOf(item: StockItem, qty: number): StockStatus {
  if (!item.track_stock) return 'untracked';
  if (qty < -EPS) return 'negative';
  if (Math.abs(qty) < EPS) return 'out';
  if (num(item.reorder_level) > 0 && qty <= num(item.reorder_level) + EPS) return 'low';
  return 'ok';
}

function roundQty(n: number): number {
  return Math.round((n + Number.EPSILON) * 1000) / 1000 || 0;
}

function emptyPosition(item: StockItem): StockPosition {
  return {
    item, qty: 0, value: 0, avgCost: 0, purchasedQty: 0, purchasedValue: 0, soldQty: 0, revenue: 0,
    cogs: 0, returnedQty: 0, adjustedInQty: 0, adjustedOutQty: 0,
    status: item.track_stock ? 'out' : 'untracked', isLow: false, isNegative: false,
    lastMovement: '', ledger: [],
  };
}

function runItem(item: StockItem, events: StockEvent[], method: CostingMethod): StockPosition {
  const c = method === 'FIFO' ? fifo() : weightedAverage();
  const pos = emptyPosition(item);
  let lastIssueUnit: number | undefined;

  events.forEach((ev, i) => {
    const q = Math.abs(ev.qty);
    let rate: number;
    let amount: number;
    if (ev.qty > 0) {
      if (ev.kind === 'return') rate = ev.rate ?? lastIssueUnit ?? c.unit();
      else if (ev.kind === 'opening') rate = ev.rate ?? 0;
      else rate = ev.rate ?? c.unit();
      c.receive(q, rate);
      amount = q * rate;
      if (ev.kind === 'purchase') {
        pos.purchasedQty += q;
        pos.purchasedValue += amount;
      } else if (ev.kind === 'return') {
        pos.returnedQty += q;
        // A return reverses the sale: net units, revenue and COGS shrink.
        pos.soldQty -= q;
        pos.revenue -= q * (ev.saleRate ?? 0);
        pos.cogs -= amount;
      } else if (ev.kind === 'adjustment') pos.adjustedInQty += q;
    } else {
      const cost = c.issue(q);
      amount = cost;
      rate = q > 0 ? cost / q : 0;
      lastIssueUnit = rate;
      if (ev.kind === 'adjustment') pos.adjustedOutQty += q;
      else {
        pos.soldQty += q;
        pos.revenue += q * (ev.saleRate ?? 0);
        pos.cogs += cost;
      }
    }
    if (ev.kind !== 'opening' && ev.date > pos.lastMovement) pos.lastMovement = ev.date;
    pos.ledger.push({
      key: `${i}-${ev.refId ?? ev.kind}`,
      date: ev.date === OPENING_DATE ? '' : ev.date,
      kind: ev.kind,
      particulars: ev.particulars,
      refType: ev.refType,
      refId: ev.refId,
      qtyIn: ev.qty > 0 ? q : 0,
      qtyOut: ev.qty < 0 ? q : 0,
      rate: round2(rate),
      amount: round2(amount),
      balance: roundQty(c.qty()),
      value: round2(c.value()),
    });
  });

  pos.qty = roundQty(c.qty());
  pos.value = round2(c.value());
  pos.avgCost = pos.qty > 0 ? round2(pos.value / pos.qty) : round2(c.unit());
  pos.purchasedValue = round2(pos.purchasedValue);
  pos.revenue = round2(pos.revenue);
  pos.cogs = round2(pos.cogs);
  pos.status = statusOf(item, pos.qty);
  pos.isNegative = pos.status === 'negative';
  pos.isLow = item.track_stock && num(item.reorder_level) > 0 && pos.qty <= num(item.reorder_level) + EPS;
  return pos;
}

/** Full stock position for every item (tracked and untracked). */
export function computeStock(input: StockInputs): StockPosition[] {
  const method = input.method ?? 'WEIGHTED_AVG';
  const events = collectEvents(input);
  return input.items.map((item) =>
    item.track_stock ? runItem(item, events.get(item.id) ?? [], method) : emptyPosition(item),
  );
}

/* ── Reports ─────────────────────────────────────────────────── */

export interface StockTotals {
  stockValue: number;
  skus: number;
  tracked: number;
  lowCount: number;
  negativeCount: number;
  outCount: number;
}

export function summarize(positions: StockPosition[]): StockTotals {
  const tracked = positions.filter((p) => p.item.track_stock);
  return {
    stockValue: round2(tracked.reduce((s, p) => s + Math.max(p.value, 0), 0)),
    skus: positions.length,
    tracked: tracked.length,
    lowCount: tracked.filter((p) => p.isLow && !p.isNegative).length,
    negativeCount: tracked.filter((p) => p.isNegative).length,
    outCount: tracked.filter((p) => p.status === 'out').length,
  };
}

export interface MovementRow {
  item: StockItem;
  openingQty: number;
  openingValue: number;
  inQty: number;
  inValue: number;
  outQty: number;
  outValue: number;
  closingQty: number;
  closingValue: number;
}

/** Opening / in / out / closing per item for [from, to] (inclusive, YYYY-MM-DD). */
export function movementSummary(positions: StockPosition[], from: string, to: string): MovementRow[] {
  return positions
    .filter((p) => p.item.track_stock)
    .map((p) => {
      let openingQty = 0, openingValue = 0, inQty = 0, inValue = 0, outQty = 0, outValue = 0;
      let closingQty = 0, closingValue = 0;
      for (const r of p.ledger) {
        const d = r.date || OPENING_DATE;
        if (d < from) {
          openingQty = r.balance;
          openingValue = r.value;
        }
        if (d <= to) {
          closingQty = r.balance;
          closingValue = r.value;
        }
        if (d >= from && d <= to && r.kind !== 'opening') {
          inQty += r.qtyIn;
          inValue += r.qtyIn ? r.amount : 0;
          outQty += r.qtyOut;
          outValue += r.qtyOut ? r.amount : 0;
        }
      }
      return {
        item: p.item, openingQty: roundQty(openingQty), openingValue: round2(openingValue),
        inQty: roundQty(inQty), inValue: round2(inValue), outQty: roundQty(outQty),
        outValue: round2(outValue), closingQty: roundQty(closingQty), closingValue: round2(closingValue),
      };
    });
}

export interface DeadStockRow {
  position: StockPosition;
  lastMovement: string;
  daysIdle: number;
}

function daysBetween(a: string, b: string): number {
  const ms = new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime();
  return Math.floor(ms / 86400000);
}

/** In-stock items with no movement for at least `days` days (opening excluded). */
export function deadStock(positions: StockPosition[], days: number, today: string): DeadStockRow[] {
  const rows: DeadStockRow[] = [];
  for (const p of positions) {
    if (!p.item.track_stock || p.qty <= 0) continue;
    const last = p.lastMovement || dayOf(p.item.created_at);
    const idle = last ? daysBetween(last, today) : days;
    if (idle >= days) rows.push({ position: p, lastMovement: p.lastMovement, daysIdle: idle });
  }
  return rows.sort((a, b) => b.daysIdle - a.daysIdle);
}

export interface MarginRow {
  item: StockItem;
  soldQty: number;
  avgSaleRate: number;
  avgCostRate: number;
  marginPerUnit: number;
  marginPct: number;
  totalMargin: number;
}

/** Realised margin from sales so far; falls back to sale_rate vs current cost when nothing sold. */
export function marginReport(positions: StockPosition[]): MarginRow[] {
  return positions
    .filter((p) => p.item.track_stock)
    .map((p) => {
      let avgSale: number;
      let avgCost: number;
      if (p.soldQty > EPS) {
        avgSale = p.revenue / p.soldQty;
        avgCost = p.cogs / p.soldQty;
      } else {
        avgSale = num(p.item.sale_rate);
        avgCost = p.avgCost;
      }
      const perUnit = avgSale - avgCost;
      return {
        item: p.item,
        soldQty: roundQty(p.soldQty),
        avgSaleRate: round2(avgSale),
        avgCostRate: round2(avgCost),
        marginPerUnit: round2(perUnit),
        marginPct: avgSale > 0 ? round2((perUnit / avgSale) * 100) : 0,
        totalMargin: round2(p.revenue - p.cogs),
      };
    });
}

/* ── Manual moves ────────────────────────────────────────────── */

export function makeAdjustment(opts: {
  item_id: string;
  date: string;
  direction: 'add' | 'remove';
  qty: number;
  /** Unit cost for additions (0 = use current average). */
  rate?: number;
  reason: string;
  id?: string;
}): StockMove {
  const q = Math.abs(num(opts.qty));
  return {
    id: opts.id ?? generateId(),
    item_id: opts.item_id,
    date: opts.date,
    qty: opts.direction === 'add' ? q : -q,
    rate: Math.max(num(opts.rate), 0),
    kind: 'adjustment',
    note: opts.reason.trim(),
  };
}

/* ── Warnings for the invoice creator ────────────────────────── */

export interface StockShortfall {
  itemId: string;
  name: string;
  unit: string;
  requested: number;
  available: number;
  shortBy: number;
}

/**
 * Lines on a document that would take stock below zero. Only INVOICE /
 * TAX_INVOICE (and DELIVERY_CHALLAN when enabled) can short-ship. If the
 * document is already saved (`id`), its own recorded effect is excluded first.
 */
export function shortfallsFor(
  doc: Pick<InvoiceRecord, 'doc_type' | 'items'> & Partial<Pick<InvoiceRecord, 'id'>>,
  inputs: Omit<StockInputs, 'excludeInvoiceId'>,
): StockShortfall[] {
  if (invoiceEffect(doc.doc_type, 'Sent', !!inputs.includeChallans) !== 'out') return [];
  const positions = computeStock({ ...inputs, excludeInvoiceId: doc.id });
  const index = buildItemIndex(positions.map((p) => p.item).filter((i) => i.track_stock));
  const byId = new Map(positions.map((p) => [p.item.id, p]));
  const wanted = new Map<string, number>();
  for (const line of doc.items ?? []) {
    const it = index.find(line.name, line.hsn);
    const q = num(line.quantity);
    if (it && q > 0) wanted.set(it.id, (wanted.get(it.id) ?? 0) + q);
  }
  const out: StockShortfall[] = [];
  for (const [id, requested] of wanted) {
    const p = byId.get(id);
    if (!p) continue;
    const available = Math.max(p.qty, 0);
    if (requested > available + EPS) {
      out.push({
        itemId: id, name: p.item.name, unit: p.item.unit, requested: roundQty(requested),
        available: roundQty(available), shortBy: roundQty(requested - available),
      });
    }
  }
  return out;
}

export function describeShortfall(s: StockShortfall): string {
  return s.available <= 0
    ? `${s.name}: out of stock (need ${s.requested} ${s.unit})`
    : `${s.name}: only ${s.available} ${s.unit} in stock (need ${s.requested})`;
}

/* ── CSV ─────────────────────────────────────────────────────── */

function csvCell(v: unknown): string {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s) && Number.isNaN(Number(s))) s = `'${s}`; // spreadsheet-injection guard
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function stockSummaryCsv(positions: StockPosition[]): string {
  const head = ['Item', 'SKU', 'HSN', 'Unit', 'Location', 'Tracked', 'Quantity', 'Avg cost', 'Stock value', 'Reorder level', 'Sale rate', 'GST %', 'Status'];
  const rows = positions.map((p) => [
    p.item.name, p.item.sku ?? '', p.item.hsn ?? '', p.item.unit, p.item.location ?? '',
    p.item.track_stock ? 'Yes' : 'No', p.qty, p.avgCost, p.value, num(p.item.reorder_level),
    num(p.item.sale_rate), num(p.item.tax_rate), p.status,
  ]);
  return [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}

export function ledgerCsv(p: StockPosition): string {
  const head = ['Date', 'Particulars', 'In', 'Out', 'Rate', 'Balance', 'Value'];
  const rows = p.ledger.map((r) => [r.date, r.particulars, r.qtyIn || '', r.qtyOut || '', r.rate, r.balance, r.value]);
  return [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}

/* ================================================================
   Persistence + convenience helpers (browser; fail-soft)
   ================================================================ */

export const TABLES = { items: 'stock_items', moves: 'stock_moves' } as const;
const SETTINGS_KEY = `${DB_PREFIX}inventory_settings`;

export function loadSettings(): InventorySettings {
  const s = getJson<Partial<InventorySettings>>(SETTINGS_KEY, {});
  return {
    method: s.method === 'FIFO' ? 'FIFO' : 'WEIGHTED_AVG',
    includeChallans: !!s.includeChallans,
  };
}

export function saveSettings(s: InventorySettings): void {
  setJson(SETTINGS_KEY, s);
}

export const stockDb = {
  items: () => getTable<StockItem>(TABLES.items),
  moves: () => getTable<StockMove>(TABLES.moves),
  saveItem(item: StockItem): void {
    const all = getTable<StockItem>(TABLES.items);
    const i = all.findIndex((x) => x.id === item.id);
    if (i >= 0) all[i] = item;
    else all.push(item);
    setTable(TABLES.items, all);
  },
  /** Deleting an item also removes its manual moves. */
  deleteItem(id: string): void {
    setTable(TABLES.items, getTable<StockItem>(TABLES.items).filter((x) => x.id !== id));
    setTable(TABLES.moves, getTable<StockMove>(TABLES.moves).filter((m) => m.item_id !== id));
  },
  addMove(move: StockMove): void {
    setTable(TABLES.moves, [...getTable<StockMove>(TABLES.moves), move]);
  },
  deleteMove(id: string): void {
    setTable(TABLES.moves, getTable<StockMove>(TABLES.moves).filter((m) => m.id !== id));
  },
};

export function blankStockItem(partial: Partial<StockItem> = {}): StockItem {
  return {
    id: generateId(), name: '', unit: 'NOS', track_stock: true, opening_qty: 0, opening_rate: 0,
    reorder_level: 0, created_at: new Date().toISOString(), ...partial,
  };
}

function liveInputs(): StockInputs {
  const settings = loadSettings();
  return {
    items: stockDb.items(),
    moves: stockDb.moves(),
    invoices: getTable<InvoiceRecord>('invoices'),
    purchases: getTable<PurchaseLike>('purchases'),
    method: settings.method,
    includeChallans: settings.includeChallans,
  };
}

/** Load everything from localStorage and compute positions. */
export function loadPositions(overrides: Partial<StockInputs> = {}): StockPosition[] {
  return computeStock({ ...liveInputs(), ...overrides });
}

export interface StockLevel {
  itemId: string;
  qty: number;
  unit: string;
  avgCost: number;
  value: number;
  reorderLevel: number;
  status: StockStatus;
}

/** Find a level in a pre-computed list (use this in loops instead of getStockLevel). */
export function findLevel(positions: StockPosition[], itemName: string, hsn?: string): StockLevel | null {
  const it = buildItemIndex(positions.map((p) => p.item).filter((i) => i.track_stock)).find(itemName, hsn);
  const p = it && positions.find((x) => x.item.id === it.id);
  if (!p) return null;
  return {
    itemId: p.item.id, qty: p.qty, unit: p.item.unit, avgCost: p.avgCost, value: p.value,
    reorderLevel: num(p.item.reorder_level), status: p.status,
  };
}

/** Current stock level for an item name (null when not a tracked stock item). */
export function getStockLevel(itemName: string, hsn?: string): StockLevel | null {
  try {
    return findLevel(loadPositions(), itemName, hsn);
  } catch {
    return null;
  }
}

/** Number of tracked items at/below their reorder level (includes negative stock). */
export function lowStockCount(): number {
  try {
    return loadPositions().filter((p) => p.isLow).length;
  } catch {
    return 0;
  }
}

/** Shortfall lines for a draft/saved document, using live data. [] when all is well. */
export function stockWarningForInvoice(
  invoice: Pick<InvoiceRecord, 'doc_type' | 'items'> & Partial<Pick<InvoiceRecord, 'id'>>,
): StockShortfall[] {
  try {
    return shortfallsFor(invoice, liveInputs());
  } catch {
    return [];
  }
}
