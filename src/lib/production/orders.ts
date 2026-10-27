/**
 * Production orders (R4-A1, `WO/FY<yy-yy>/<seq>`): make to stock or make to order, with a shop-floor (WIP) godown.
 *
 *   Planned → Released → In progress → Completed → Closed   (or Cancelled)
 *
 *  - Release explodes the BOM for the planned quantity into required materials (scrap % included, base units) and
 *    creates the "Shop floor (WIP)" godown (`kind: 'wip'`) the first time. Release moves no stock.
 *  - Issue materials saves a NORMAL stock transfer (`STR/FY…`) from a store to the WIP godown, tagged
 *    `production_order_id`; "Return unused" is an STR the other way. The stock engine is untouched.
 *  - Report output saves a NORMAL Manufacturing Journal (`MFG/FY…`) tagged `production_order_id` that consumes from the
 *    WIP godown, in proportion to the reported quantity, from the batches issued to the order. Partial output is fine.
 *  - Close refuses while the WIP godown still holds material issued to the order, unless it is written off as scrap
 *    (a consume-only Stock Journal tagged `production_order_id`). Closing freezes the order; reopening is logged.
 *
 * Required / issued / consumed / held and the status are DERIVED from those vouchers on read, so deleting an STR or a
 * journal (through its own guards) simply recomputes the order. Nothing here posts to Books or the ledger.
 *
 * Pure above the "Storage" divider (tests/production-orders.test.ts).
 */
import type { AdditionalCost, Bom, ManufacturingVoucher, StockJournal, VoucherOutputLine, VoucherStockLine } from '../../types/manufacturing';
import type { InvoiceItem, InvoiceRecord } from '../../types/invoice';
import { MAIN_GODOWN_ID, type Godown, type StockTransfer, type StockTransferLine } from '../../types/stock';
import type { ProductionMaterial, ProductionOrder, ProductionOrderLog, ProductionOrderStatus } from '../../types/production-r4';
import { num } from '../invoice-calc';
import { lineFactor } from '../units';
import { buildItemIndex, type StockInputs, type StockItem } from '../inventory';
import { fefoAllocate, serialsInStock, transferIssues, type TrackingMap } from '../stock-tracking';
import type { OrderFulfilment } from '../sales-orders';
import { generateId, peekTable, setTable } from '../storage';
import { currentActor, requireAccess } from '../access';
import { assertUnlocked } from '../period-lock';
import { audit } from '../audit';
import { nextSeriesNumberFor, numberFitsFy, recordSeries } from '../series-counters';
import { withTablesRollback } from '../table-txn';
import { godownsDb, transfersDb } from '../godowns';
import { MFG_TABLE, SJ_TABLE, consumptionShortfalls, manufacturingDb, saveConsumeOnlyJournal } from '../manufacturing';
import { opsForRelease } from '../mfg/mf-ops'; // R13 (MF-A2): copies the default routing at release (shopfloor pack only)

export const ORDERS_TABLE = 'production_orders';
export const ORDER_PREFIX = 'WO';
export const WIP_GODOWN_NAME = 'Shop floor (WIP)';

const EPS = 1e-6;
const rq = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000 || 0;
const bkey = (b: string | undefined) => (b ?? '').trim().toUpperCase();

/* ── Explosion ────────────────────────────────────────────────── */

/** Required materials for `planned` finished units: qty / batch_qty × component × (1 + scrap %), base units. */
export function explodeOrder(bom: Pick<Bom, 'batch_qty' | 'components'>, planned: number, newId: () => string = generateId): ProductionMaterial[] {
  const per = 1 / (num(bom.batch_qty) > 0 ? num(bom.batch_qty) : 1);
  return (bom.components ?? []).filter((c) => c.item_id && num(c.qty) > 0).map((c) => {
    const unit = num(c.qty) * per * (1 + Math.max(num(c.scrap_pct), 0) / 100);
    const base = num(c.qty) * per * num(planned);
    const qty = rq(unit * num(planned));
    return {
      id: newId(), item_id: c.item_id, qty, per_unit: Math.round(unit * 1e6) / 1e6,
      ...(qty - base > EPS ? { scrap: rq(qty - base) } : {}), ...(c.godown_id ? { godown_id: c.godown_id } : {}),
    };
  });
}

/* ── Progress (derived from the vouchers that name the order) ── */

export interface HeldBatch { batch: string; qty: number }

export interface OrderProgress {
  issues: StockTransfer[];
  returns: StockTransfer[];
  outputs: ManufacturingVoucher[];
  writeOffs: StockJournal[];
  /** Per item, base units. */
  issued: Map<string, number>;
  returned: Map<string, number>;
  consumed: Map<string, number>;
  writtenOff: Map<string, number>;
  /** Still on the shop floor for this order: issued − returned − consumed − written off. */
  held: Map<string, number>;
  /** Held quantity per batch (batch items), in the order the batches were issued. */
  heldBatches: Map<string, HeldBatch[]>;
  heldSerials: Map<string, string[]>;
  /** Σ finished quantity reported. */
  output: number;
}

export interface OrderDocs {
  transfers: readonly StockTransfer[];
  mfg: readonly ManufacturingVoucher[];
  journals: readonly StockJournal[];
}

const add = (m: Map<string, number>, k: string, q: number) => m.set(k, rq((m.get(k) ?? 0) + q));

/** Everything the order's issue / return transfers, output journals and write-offs add up to. Pure. */
export function orderProgress(order: Pick<ProductionOrder, 'id' | 'wip_godown_id'>, docs: OrderDocs): OrderProgress {
  const wip = order.wip_godown_id;
  const mine = <T extends { production_order_id?: string }>(rows: readonly T[]) => rows.filter((r) => r?.production_order_id === order.id);
  const transfers = mine(docs.transfers).sort((a, b) => a.date.localeCompare(b.date) || a.transfer_number.localeCompare(b.transfer_number, undefined, { numeric: true }));
  const issues = transfers.filter((t) => t.to_godown === wip);
  const returns = transfers.filter((t) => t.from_godown === wip && t.to_godown !== wip);
  const outputs = mine(docs.mfg).sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number, undefined, { numeric: true }));
  const writeOffs = mine(docs.journals);
  const issued = new Map<string, number>();
  const returned = new Map<string, number>();
  const consumed = new Map<string, number>();
  const writtenOff = new Map<string, number>();
  // Batch and serial ledger of the shop floor for this order.
  const batches = new Map<string, Map<string, HeldBatch>>();
  const serials = new Map<string, Set<string>>();
  const move = (itemId: string, q: number, batch?: string, list?: readonly string[]) => {
    if (batch?.trim()) {
      const m = batches.get(itemId) ?? new Map<string, HeldBatch>();
      const k = bkey(batch);
      const b = m.get(k) ?? { batch: batch.trim(), qty: 0 };
      b.qty = rq(b.qty + q);
      m.set(k, b);
      batches.set(itemId, m);
    }
    if (list?.length) {
      const s = serials.get(itemId) ?? new Set<string>();
      for (const x of list) {
        if (q > 0) s.add(x.trim());
        else s.delete(x.trim());
      }
      serials.set(itemId, s);
    }
  };
  for (const t of issues) {
    for (const l of t.lines ?? []) {
      const q = num(l.qty) * lineFactor(l);
      if (!l.item_id || !(q > 0)) continue;
      add(issued, l.item_id, q);
      move(l.item_id, q, l.batch_no, l.serials);
    }
  }
  for (const t of returns) {
    for (const l of t.lines ?? []) {
      const q = num(l.qty) * lineFactor(l);
      if (!l.item_id || !(q > 0)) continue;
      add(returned, l.item_id, q);
      move(l.item_id, -q, l.batch_no, l.serials);
    }
  }
  const consume = (target: Map<string, number>, lines: readonly VoucherStockLine[] | undefined) => {
    for (const l of lines ?? []) {
      const q = num(l.qty) * lineFactor(l);
      if (!l.item_id || !(q > 0) || (l.godown_id || MAIN_GODOWN_ID) !== wip) continue;
      add(target, l.item_id, q);
      move(l.item_id, -q, l.batch_no, l.serials);
    }
  };
  let output = 0;
  for (const v of outputs) {
    consume(consumed, v.components);
    output += num(v.qty);
  }
  for (const j of writeOffs) consume(writtenOff, j.consume);
  const held = new Map<string, number>();
  for (const id of new Set([...issued.keys(), ...returned.keys(), ...consumed.keys(), ...writtenOff.keys()])) {
    const h = rq((issued.get(id) ?? 0) - (returned.get(id) ?? 0) - (consumed.get(id) ?? 0) - (writtenOff.get(id) ?? 0));
    if (Math.abs(h) > EPS) held.set(id, h);
  }
  const heldBatches = new Map<string, HeldBatch[]>();
  for (const [id, m] of batches) {
    const list = [...m.values()].filter((b) => b.qty > EPS);
    if (list.length) heldBatches.set(id, list);
  }
  const heldSerials = new Map<string, string[]>();
  for (const [id, s] of serials) if (s.size) heldSerials.set(id, [...s]);
  return { issues, returns, outputs, writeOffs, issued, returned, consumed, writtenOff, held, heldBatches, heldSerials, output: rq(output) };
}

/** Effective status: stored milestones, with In progress / Completed derived from the output reported. */
export function orderStatus(order: Pick<ProductionOrder, 'status' | 'planned_qty'>, progress: Pick<OrderProgress, 'output'>): ProductionOrderStatus {
  if (order.status === 'cancelled' || order.status === 'closed' || order.status === 'planned') return order.status;
  if (order.status === 'completed' || progress.output >= num(order.planned_qty) - EPS) return 'completed';
  return progress.output > EPS ? 'in_progress' : 'released';
}

export interface MaterialRow {
  item_id: string;
  required: number;
  /** Net issued (issued − returned). */
  issued: number;
  consumed: number;
  writtenOff: number;
  held: number;
  /** Still to issue (never below 0). */
  balance: number;
  /** Issued more than required. */
  over: boolean;
  /** Issued although the BOM does not list it. */
  extra?: boolean;
}

/** Required, issued and balance per component (plus anything issued that the BOM does not list). */
export function materialRows(order: Pick<ProductionOrder, 'materials'>, p: OrderProgress): MaterialRow[] {
  const rows: MaterialRow[] = [];
  const seen = new Set<string>();
  const row = (itemId: string, required: number, extra = false): MaterialRow => {
    const issued = rq((p.issued.get(itemId) ?? 0) - (p.returned.get(itemId) ?? 0));
    return {
      item_id: itemId, required: rq(required), issued, consumed: p.consumed.get(itemId) ?? 0, writtenOff: p.writtenOff.get(itemId) ?? 0,
      held: p.held.get(itemId) ?? 0, balance: rq(Math.max(0, required - issued)), over: issued > required + EPS, ...(extra ? { extra: true } : {}),
    };
  };
  const req = new Map<string, number>();
  for (const m of order.materials ?? []) req.set(m.item_id, (req.get(m.item_id) ?? 0) + num(m.qty));
  for (const [id, q] of req) {
    rows.push(row(id, q));
    seen.add(id);
  }
  for (const id of p.issued.keys()) if (!seen.has(id)) rows.push(row(id, 0, true));
  return rows;
}

/** Over-issue warnings (allowed, but worth a second look). */
export function overIssueWarnings(rows: readonly MaterialRow[], nameOf: (id: string) => string): string[] {
  return rows.filter((r) => r.over).map((r) => (r.extra ? `${nameOf(r.item_id)} is not on the BOM.` : `${nameOf(r.item_id)}: ${r.issued} issued, ${r.required} required.`));
}

/* ── Builders ─────────────────────────────────────────────────── */

/**
 * Transfer lines for issuing `want` (item → base units; default: every balance) from `from`: batch items split
 * first-expiry-first, serial items take the first serials in stock there. A shortfall stays on an unbatched line
 * (the transfer check reports it).
 */
export function buildIssueLines(
  rows: readonly MaterialRow[], items: readonly StockItem[], tracking: TrackingMap, date: string, from: string,
  want?: ReadonlyMap<string, number>, newId: () => string = generateId,
): StockTransferLine[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const out: StockTransferLine[] = [];
  for (const r of rows) {
    const q = rq(want ? (want.get(r.item_id) ?? 0) : r.balance);
    const item = byId.get(r.item_id);
    if (!item || !(q > EPS)) continue;
    const t = tracking.get(item.id);
    if (item.track_batches) {
      const { lines, short } = fefoAllocate(t, date, q, from);
      for (const b of lines) out.push({ id: newId(), item_id: item.id, qty: b.qty, batch_no: b.batch });
      if (short > EPS || lines.length === 0) out.push({ id: newId(), item_id: item.id, qty: lines.length ? short : q });
    } else if (item.track_serials) {
      const n = Math.floor(q + EPS);
      out.push({ id: newId(), item_id: item.id, qty: n || q, serials: serialsInStock(t, from).slice(0, n) });
    } else out.push({ id: newId(), item_id: item.id, qty: q });
  }
  return out;
}

/** Lines that move everything still held for the order (batches and serials kept). Used by return and write-off. */
export function heldLines(p: OrderProgress, newId: () => string = generateId): StockTransferLine[] {
  const out: StockTransferLine[] = [];
  for (const [itemId, qty] of p.held) {
    if (!(qty > EPS)) continue;
    const batches = p.heldBatches.get(itemId) ?? [];
    let rest = qty;
    for (const b of batches) {
      const take = rq(Math.min(rest, b.qty));
      if (take > EPS) out.push({ id: newId(), item_id: itemId, qty: take, batch_no: b.batch });
      rest = rq(rest - take);
    }
    if (rest > EPS) {
      const serials = p.heldSerials.get(itemId);
      out.push({ id: newId(), item_id: itemId, qty: rest, ...(serials?.length ? { serials: serials.slice(0, Math.round(rest)) } : {}) });
    }
  }
  return out;
}

export interface OutputDraftOptions {
  qty: number;
  date: string;
  batch_no?: string;
  expiry_date?: string;
  serials?: string[];
  /** Finished goods godown (default: the order's output godown, else Main). */
  godown_id?: string;
}

/**
 * Manufacturing Journal for `opts.qty` finished units of the order: each material consumed from the WIP godown at
 * per-unit × qty (capped at what the order still holds there), batches taken from what was issued, by-products /
 * scrap from the BOM. The user may edit the lines before saving.
 */
export function buildOutputVoucher(
  order: ProductionOrder, p: OrderProgress, bom: Pick<Bom, 'batch_qty' | 'outputs'> | undefined, opts: OutputDraftOptions, newId: () => string = generateId,
  extra?: { scrapLines?: VoucherOutputLine[]; conversion?: AdditionalCost[] }, // R13 (MF-A3 / MF-D5): job-card scrap, conversion cost
): Omit<ManufacturingVoucher, 'id' | 'number'> {
  const wip = order.wip_godown_id;
  const components: VoucherStockLine[] = [];
  const perUnit = new Map<string, number>();
  for (const m of order.materials ?? []) perUnit.set(m.item_id, (perUnit.get(m.item_id) ?? 0) + num(m.per_unit));
  for (const [itemId, per] of perUnit) {
    const held = p.held.get(itemId) ?? 0;
    let rest = rq(Math.min(per * num(opts.qty), Math.max(held, 0)));
    if (!(rest > EPS)) continue;
    for (const b of p.heldBatches.get(itemId) ?? []) {
      const take = rq(Math.min(rest, b.qty));
      if (take > EPS) components.push({ id: newId(), item_id: itemId, qty: take, godown_id: wip, batch_no: b.batch });
      rest = rq(rest - take);
      if (!(rest > EPS)) break;
    }
    if (rest > EPS) {
      const serials = p.heldSerials.get(itemId);
      components.push({ id: newId(), item_id: itemId, qty: rest, godown_id: wip, ...(serials?.length ? { serials: serials.slice(0, Math.round(rest)) } : {}) });
    }
  }
  const factor = num(opts.qty) / (num(bom?.batch_qty) > 0 ? num(bom?.batch_qty) : 1);
  const outputs: VoucherOutputLine[] = (bom?.outputs ?? []).filter((o) => o.item_id && num(o.qty) > 0).map((o) => ({
    id: newId(), item_id: o.item_id, qty: rq(num(o.qty) * factor), kind: o.kind,
    ...(o.kind === 'co_product' ? { cost_pct: num(o.cost_pct) } : { rate: Math.max(num(o.rate), 0) }),
    ...(o.godown_id ? { godown_id: o.godown_id } : {}),
  }));
  const godown = opts.godown_id || order.output_godown_id || undefined;
  return {
    date: opts.date, item_id: order.item_id, ...(order.bom_id ? { bom_id: order.bom_id } : {}), qty: num(opts.qty),
    ...(godown && godown !== MAIN_GODOWN_ID ? { godown_id: godown } : {}),
    ...(opts.batch_no?.trim() ? { batch_no: opts.batch_no.trim(), mfg_date: opts.date } : {}),
    ...(opts.expiry_date ? { expiry_date: opts.expiry_date } : {}),
    ...(opts.serials?.length ? { serials: opts.serials } : {}),
    components, outputs: extra?.scrapLines?.length ? [...outputs, ...extra.scrapLines] : outputs, costs: extra?.conversion?.length ? [...extra.conversion] : [], production_order_id: order.id, narration: `Output against ${order.number}`,
  };
}

/** Default finished batch for the n-th output of an order: "WO-26-27-0001-2". */
export function defaultOutputBatch(order: Pick<ProductionOrder, 'number'>, n: number): string {
  return `${order.number.replace(/\/FY/, '-').replace(/\//g, '-')}-${n}`;
}

/* ── Rules ────────────────────────────────────────────────────── */

const hasHeld = (p: OrderProgress) => [...p.held.values()].some((q) => q > EPS);

/** Why the order cannot be closed now ('' = it can). `writeOff` = the user chose "Write off as scrap". */
export function closeIssue(order: Pick<ProductionOrder, 'status'>, p: OrderProgress, writeOff: boolean): string {
  if (order.status === 'closed') return 'This production order is already closed.';
  if (order.status === 'cancelled') return 'This production order is cancelled.';
  if (order.status === 'planned') return 'Release the order before closing it.';
  if (hasHeld(p) && !writeOff) return 'The shop floor still holds material issued to this order. Return it unused, or close with "Write off as scrap".';
  return '';
}

/** Why the order cannot be cancelled ('' = it can): output reported, or material still on the shop floor. */
export function cancelIssue(order: Pick<ProductionOrder, 'status'>, p: OrderProgress): string {
  if (order.status === 'closed') return 'A closed order cannot be cancelled. Reopen it first.';
  if (order.status === 'cancelled') return 'This production order is already cancelled.';
  if (p.outputs.length) return 'Output has been reported against this order. Close it instead.';
  if (hasHeld(p)) return 'Return or write off the material on the shop floor before cancelling.';
  return '';
}

/** Why the order cannot be deleted ('' = it can): only an order with no issue, output or write-off. */
export function deleteIssue(p: OrderProgress): string {
  if (p.issues.length || p.returns.length || p.outputs.length || p.writeOffs.length) return 'Material was issued or output reported against this order, so it can only be cancelled.';
  return '';
}

export function validateOrder(o: Pick<ProductionOrder, 'date' | 'item_id' | 'planned_qty' | 'due_date'>, items: readonly StockItem[], boms: readonly Bom[]): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.date ?? '')) return 'Choose the order date.';
  const item = items.find((i) => i.id === o.item_id);
  if (!item || !item.track_stock) return 'Choose the finished item (a stock item that tracks stock).';
  if (!boms.some((b) => b.item_id === o.item_id)) return `${item.name} has no bill of materials. Add a BOM first.`;
  if (!(num(o.planned_qty) > 0)) return 'The planned quantity must be above zero.';
  if (o.due_date && o.due_date < o.date) return 'The due date is before the order date.';
  return '';
}

/* ── Make to order / from MRP ─────────────────────────────────── */

export type OrderDraft = Pick<ProductionOrder, 'item_id' | 'planned_qty'> & Partial<Pick<ProductionOrder, 'bom_id' | 'so_id' | 'so_line_id' | 'plan_id' | 'due_date' | 'narration'>>;

/**
 * One draft order per pending (still to deliver) sales-order line whose item has a BOM, net of what live orders for
 * that line already plan. Quantities are converted to the item's base unit.
 */
export function ordersFromSo(
  so: Pick<InvoiceRecord, 'id' | 'invoice_number' | 'due_date'>, fulfilment: Pick<OrderFulfilment, 'lines'>,
  items: readonly StockItem[], boms: readonly Bom[], existing: readonly Pick<ProductionOrder, 'so_id' | 'so_line_id' | 'planned_qty' | 'status'>[],
): OrderDraft[] {
  const index = buildItemIndex(items.filter((i) => i.track_stock));
  const out: OrderDraft[] = [];
  for (const l of fulfilment.lines) {
    if (!(l.pendingDelivery > EPS)) continue;
    const line = l.item as InvoiceItem & { item_id?: string };
    const item = (line.item_id && items.find((i) => i.id === line.item_id && i.track_stock)) || index.find(line.name, line.hsn);
    if (!item) continue;
    const bom = boms.filter((b) => b.item_id === item.id).sort((a, b) => Number(!!b.is_default) - Number(!!a.is_default))[0];
    if (!bom) continue;
    const planned = existing.filter((o) => o.so_id === so.id && o.so_line_id === line.id && o.status !== 'cancelled').reduce((s, o) => s + num(o.planned_qty), 0);
    const qty = rq(l.pendingDelivery * lineFactor(line) - planned);
    if (!(qty > EPS)) continue;
    out.push({ item_id: item.id, bom_id: bom.id, planned_qty: qty, so_id: so.id, so_line_id: line.id, ...(so.due_date ? { due_date: so.due_date } : {}), narration: `Make to order ${so.invoice_number ?? ''}`.trim() });
  }
  return out;
}

/** Ids of live (not cancelled / closed) orders past their due date and not completed, as of `today`. */
export function overdueOrders(orders: readonly ProductionOrder[], status: (o: ProductionOrder) => ProductionOrderStatus, today: string): ProductionOrder[] {
  return orders.filter((o) => {
    const s = status(o);
    return !!o.due_date && o.due_date < today && (s === 'planned' || s === 'released' || s === 'in_progress');
  });
}

/* ================================================================
   Storage
   ================================================================ */

export function loadOrderDocs(): OrderDocs {
  return {
    transfers: peekTable<StockTransfer>('stock_transfers'),
    mfg: peekTable<ManufacturingVoucher>('manufacturing_vouchers'),
    journals: peekTable<StockJournal>('stock_journals'),
  };
}

export const ordersStore = {
  all: (): ProductionOrder[] => peekTable<ProductionOrder>(ORDERS_TABLE).filter((o) => o && typeof o.id === 'string'),
  get: (id: string): ProductionOrder | undefined => ordersStore.all().find((o) => o.id === id),
  /** Writes one order (callers hold the guards). */
  put(order: ProductionOrder): void {
    const rows = ordersStore.all();
    setTable(ORDERS_TABLE, rows.some((r) => r.id === order.id) ? rows.map((r) => (r.id === order.id ? order : r)) : [...rows, order]);
  },
};

/** The order's live status (stored milestones + its vouchers). */
export function liveStatus(order: ProductionOrder, docs: OrderDocs = loadOrderDocs()): ProductionOrderStatus {
  return orderStatus(order, orderProgress(order, docs));
}

/** A log row by the signed-in local user. */
export function logRow(action: ProductionOrderLog['action'], note: string | undefined, by: string | undefined): ProductionOrderLog {
  return { at: new Date().toISOString(), ...(by ? { by } : {}), action, ...(note ? { note } : {}) };
}

/** The WIP godown (kind 'wip'), if one exists. */
export const wipGodownOf = (list: readonly Godown[]): Godown | undefined => list.find((g) => g.kind === 'wip');

const lockOf = (o: { id: string; date: string; number: string }) => ({ id: o.id, issue_date: o.date, invoice_number: o.number });
const actorName = () => currentActor()?.name;
const tagOverride = (state: string) => (state === 'overridden' ? ' (period lock overridden)' : '');

function logAudit(o: ProductionOrder, action: 'create' | 'update' | 'delete', summary: string): void {
  try {
    audit.record({ entity: 'manufacturing', entity_id: o.id, action, doc_number: o.number, summary });
  } catch {
    /* logging never breaks a save */
  }
}

/** Persist the order with its live status recomputed and one more log row. */
function persist(order: ProductionOrder, row: ProductionOrderLog | null, docs: OrderDocs = loadOrderDocs()): ProductionOrder {
  const base = { ...order, ...(row ? { log: [...(order.log ?? []), row] } : {}), updated_at: new Date().toISOString() };
  const next: ProductionOrder = { ...base, status: orderStatus(base, orderProgress(base, docs)) };
  ordersStore.put(next);
  return next;
}

function mustGet(id: string): ProductionOrder {
  const o = ordersStore.get(id);
  if (!o) throw new Error('This production order no longer exists.');
  return o;
}

function assertOpen(o: ProductionOrder, what: string): void {
  if (o.status === 'closed') throw new Error(`Production order ${o.number} is closed. Reopen it to ${what}.`);
  if (o.status === 'cancelled') throw new Error(`Production order ${o.number} is cancelled.`);
  if (o.status === 'planned') throw new Error(`Release production order ${o.number} first.`);
}

/** The WIP godown, created ("Shop floor (WIP)", kind 'wip') the first time an order is released. */
export function ensureWipGodown(): Godown {
  const found = wipGodownOf(godownsDb.list());
  if (found) return found;
  const taken = godownsDb.list().some((g) => g.name.trim().toLowerCase() === WIP_GODOWN_NAME.toLowerCase());
  return godownsDb.save({ name: taken ? `${WIP_GODOWN_NAME} 2` : WIP_GODOWN_NAME, kind: 'wip' });
}

export interface ProductionOrderInput {
  id?: string;
  date: string;
  item_id: string;
  bom_id?: string;
  planned_qty: number;
  due_date?: string;
  so_id?: string;
  so_line_id?: string;
  plan_id?: string;
  cost_centre_id?: string;
  store_godown_id?: string;
  output_godown_id?: string;
  output_to_qc?: boolean;
  narration?: string;
  standard_conversion?: number;
}

export const productionOrdersDb = {
  all: ordersStore.all,
  get: ordersStore.get,
  nextNumber: (date?: string): string => nextSeriesNumberFor(ORDER_PREFIX, date, ordersStore.all().map((o) => o.number)),

  /**
   * Create, or edit a planned / released order (books.edit, period lock on the order date, WO series, audited). A
   * released order keeps its exploded materials unless the item, BOM or quantity changed (then they are re-exploded).
   */
  save(input: ProductionOrderInput, items: readonly StockItem[], boms: readonly Bom[]): ProductionOrder {
    requireAccess('books.edit');
    const err = validateOrder(input, items, boms);
    if (err) throw new Error(err);
    const rows = ordersStore.all();
    const existing = input.id ? rows.find((r) => r.id === input.id) : undefined;
    if (existing && (existing.status === 'closed' || existing.status === 'cancelled')) throw new Error(`Production order ${existing.number} is ${existing.status}.`);
    if (existing) assertUnlocked(lockOf(existing), 'edit');
    const number = existing && numberFitsFy(existing.number, input.date) ? existing.number : productionOrdersDb.nextNumber(input.date);
    const id = existing?.id ?? input.id ?? generateId();
    const state = assertUnlocked(lockOf({ id, date: input.date, number }), existing ? 'edit' : 'create');
    if (rows.some((r) => r.id !== id && r.number.toUpperCase() === number.toUpperCase())) throw new Error(`Order number ${number} is already used.`);
    const bom = boms.find((b) => b.id === input.bom_id && b.item_id === input.item_id)
      ?? boms.filter((b) => b.item_id === input.item_id).sort((a, b) => Number(!!b.is_default) - Number(!!a.is_default))[0];
    const reExplode = !!existing?.materials && (existing.item_id !== input.item_id || existing.bom_id !== bom?.id || num(existing.planned_qty) !== num(input.planned_qty));
    const clean = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined && v !== '')) as Partial<ProductionOrderInput>;
    const order = {
      ...(existing ?? { status: 'planned' as const, log: [], wip_godown_id: '' }),
      ...clean,
      id, number, date: input.date, item_id: input.item_id, planned_qty: num(input.planned_qty), ...(bom ? { bom_id: bom.id } : {}),
      ...(reExplode && bom ? { materials: explodeOrder(bom, num(input.planned_qty)) } : {}),
      created_at: existing?.created_at ?? new Date().toISOString(),
    } as ProductionOrder;
    if (existing && !input.output_to_qc) delete order.output_to_qc;
    const saved = withTablesRollback([ORDERS_TABLE, 'series_counters'], () => {
      const out = persist(order, logRow(existing ? 'edit' : 'create', undefined, actorName()));
      recordSeries(number);
      return out;
    });
    const name = items.find((i) => i.id === saved.item_id)?.name ?? 'item';
    logAudit(saved, existing ? 'update' : 'create', `${existing ? 'Edited' : 'Created'} production order ${number}: ${saved.planned_qty} × ${name}${saved.so_id ? ' (make to order)' : ''}${tagOverride(state)}`);
    return saved;
  },

  /** Planned → Released: explode the BOM into required materials and make sure the WIP godown exists. Moves no stock. */
  release(id: string, boms: readonly Bom[]): ProductionOrder {
    requireAccess('books.edit');
    const o = mustGet(id);
    if (o.status !== 'planned') throw new Error(`Production order ${o.number} is already released.`);
    const bom = boms.find((b) => b.id === o.bom_id) ?? boms.find((b) => b.item_id === o.item_id && b.is_default) ?? boms.find((b) => b.item_id === o.item_id);
    if (!bom) throw new Error('This item has no bill of materials any more.');
    const saved = withTablesRollback([ORDERS_TABLE, 'godowns'], () => {
      const wip = ensureWipGodown();
      const ops = opsForRelease(o); // R13 (MF-A2): snapshot of the default routing, shopfloor pack only
      return persist({ ...o, status: 'released', bom_id: bom.id, wip_godown_id: wip.id, materials: explodeOrder(bom, num(o.planned_qty)), ...(ops ? { mf: { ...o.mf, ops } } : {}) }, logRow('release', undefined, actorName()));
    });
    logAudit(saved, 'update', `Released production order ${o.number}: ${saved.materials?.length ?? 0} material line(s) for ${saved.planned_qty} unit(s)`);
    return saved;
  },

  /**
   * Issue materials: a normal stock transfer `from` → the WIP godown, tagged with the order. Refused when the source
   * godown cannot cover it; returns the transfer and any over-issue warnings (allowed).
   */
  issue(id: string, x: { date: string; from: string; lines: StockTransferLine[]; notes?: string }, items: readonly StockItem[], inputs: StockInputs): { transfer: StockTransfer; warnings: string[] } {
    requireAccess('books.edit');
    const o = mustGet(id);
    assertOpen(o, 'issue material');
    const lines = x.lines.filter((l) => l.item_id && num(l.qty) > 0);
    const draft = { id: '', date: x.date, from_godown: x.from || MAIN_GODOWN_ID, to_godown: o.wip_godown_id, lines };
    const problems = transferIssues(draft, inputs);
    if (problems.length) throw new Error(problems[0]);
    const nameOf = (i: string) => items.find((it) => it.id === i)?.name ?? 'Item';
    const transfer = withTablesRollback([ORDERS_TABLE, 'stock_transfers', 'series_counters'], () => {
      const t = transfersDb.save({ date: x.date, from_godown: draft.from_godown, to_godown: o.wip_godown_id, lines, production_order_id: o.id, notes: x.notes || `Issue to ${o.number}` });
      persist(o, logRow('issue', t.transfer_number, actorName()));
      return t;
    });
    const after = orderProgress(o, loadOrderDocs());
    return { transfer, warnings: overIssueWarnings(materialRows(o, after), nameOf) };
  },

  /** Return unused: an STR from the WIP godown back to `to` (default the store / Main) of everything still held (or `lines`). */
  returnUnused(id: string, x: { date: string; to?: string; lines?: StockTransferLine[] }, inputs: StockInputs): StockTransfer {
    requireAccess('books.edit');
    const o = mustGet(id);
    if (o.status === 'cancelled') throw new Error(`Production order ${o.number} is cancelled.`);
    const lines = (x.lines ?? heldLines(orderProgress(o, loadOrderDocs()))).filter((l) => l.item_id && num(l.qty) > 0);
    if (!lines.length) throw new Error('Nothing issued to this order is left on the shop floor.');
    const draft = { id: '', date: x.date, from_godown: o.wip_godown_id, to_godown: x.to || o.store_godown_id || MAIN_GODOWN_ID, lines };
    const problems = transferIssues(draft, inputs);
    if (problems.length) throw new Error(problems[0]);
    return withTablesRollback([ORDERS_TABLE, 'stock_transfers', 'series_counters'], () => {
      const t = transfersDb.save({ date: x.date, from_godown: draft.from_godown, to_godown: draft.to_godown, lines, production_order_id: o.id, notes: `Return unused from ${o.number}` });
      persist(o, logRow('return', t.transfer_number, actorName()));
      return t;
    });
  },

  /** Report output: a normal Manufacturing Journal tagged with the order (consumes from the WIP godown). */
  reportOutput(id: string, draft: Omit<ManufacturingVoucher, 'id' | 'number'>, items: readonly StockItem[], inputs: StockInputs): ManufacturingVoucher {
    requireAccess('books.edit');
    const o = mustGet(id);
    assertOpen(o, 'report output');
    if (draft.item_id !== o.item_id) throw new Error('The output must be the order\'s finished item.');
    const short = consumptionShortfalls(draft.components, draft.date, inputs);
    if (short.length) throw new Error(short[0]);
    return withTablesRollback([ORDERS_TABLE, MFG_TABLE, 'series_counters'], () => {
      const v = manufacturingDb.save({ ...draft, production_order_id: o.id }, items, inputs);
      persist(o, logRow('output', `${v.number}: ${v.qty}`, actorName()));
      return v;
    });
  },

  /** "Mark completed" before the planned quantity is reached. */
  markCompleted(id: string): ProductionOrder {
    requireAccess('books.edit');
    const o = mustGet(id);
    assertOpen(o, 'complete it');
    const saved = persist({ ...o, status: 'completed' }, logRow('complete', undefined, actorName()));
    logAudit(saved, 'update', `Marked production order ${o.number} completed`);
    return saved;
  },

  /**
   * Close: refused while the shop floor holds material issued to the order, unless `writeOff` — then a consume-only
   * Stock Journal tagged with the order writes it off as scrap on `date`. Closing freezes the order.
   */
  close(id: string, x: { date: string; writeOff?: boolean }, items: readonly StockItem[], inputs: StockInputs): ProductionOrder {
    requireAccess('books.edit');
    const o = mustGet(id);
    const p = orderProgress(o, loadOrderDocs());
    const issue = closeIssue(o, p, !!x.writeOff);
    if (issue) throw new Error(issue);
    const saved = withTablesRollback([ORDERS_TABLE, SJ_TABLE, 'series_counters'], () => {
      let note: string | undefined;
      if (x.writeOff && [...p.held.values()].some((q) => q > EPS)) {
        const consume = heldLines(p).map((l) => ({ ...l, godown_id: o.wip_godown_id }));
        const j = saveConsumeOnlyJournal({ date: x.date, consume, production_order_id: o.id, narration: `Shop-floor scrap written off on closing ${o.number}` }, items, inputs);
        note = j.number;
        persist(o, logRow('write_off', j.number, actorName()));
      }
      return persist({ ...mustGet(id), status: 'closed', closed_at: x.date }, logRow('close', note, actorName()));
    });
    logAudit(saved, 'update', `Closed production order ${o.number}${x.writeOff ? ' (shop-floor balance written off as scrap)' : ''}`);
    return saved;
  },

  /** Reopen a closed order (logged). */
  reopen(id: string, note?: string): ProductionOrder {
    requireAccess('books.edit');
    const o = mustGet(id);
    if (o.status !== 'closed') throw new Error('Only a closed order can be reopened.');
    const { closed_at: _c, ...rest } = o;
    void _c;
    const saved = persist({ ...rest, status: 'released' }, logRow('reopen', note, actorName()));
    logAudit(saved, 'update', `Reopened production order ${o.number}${note ? `: ${note}` : ''}`);
    return saved;
  },

  /** Cancel: no output, and the shop floor must be empty for the order first. */
  cancel(id: string, note?: string): ProductionOrder {
    requireAccess('books.edit');
    const o = mustGet(id);
    const issue = cancelIssue(o, orderProgress(o, loadOrderDocs()));
    if (issue) throw new Error(issue);
    const saved = persist({ ...o, status: 'cancelled' }, logRow('cancel', note, actorName()));
    logAudit(saved, 'update', `Cancelled production order ${o.number}`);
    return saved;
  },

  /** Delete: only an order nothing was issued / reported against (else cancel). Period lock on the order date. */
  remove(id: string): void {
    requireAccess('books.edit');
    const o = ordersStore.get(id);
    if (!o) return;
    const issue = deleteIssue(orderProgress(o, loadOrderDocs()));
    if (issue) throw new Error(issue);
    const state = assertUnlocked(lockOf(o), 'delete');
    setTable(ORDERS_TABLE, ordersStore.all().filter((r) => r.id !== id));
    logAudit(o, 'delete', `Deleted production order ${o.number}${tagOverride(state)}`);
  },
};
