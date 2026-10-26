/**
 * Restaurant tables & running orders (R3-A1). Pure: masters, floor status, tokens, adding lines,
 * move / merge / transfer, and the settle builder that turns an order into a POS invoice record.
 *
 *  - An order is not an invoice: no number, no GST, never in reports. It becomes one POS invoice on
 *    Settle (`savePosBill`, same numbering / stock / tenders / Z report as the counter), or one per
 *    part for an item / seat split (split-bill.ts).
 *  - Area price level: lines are priced through `resolvePrice` (the POS / editor pricing path) when
 *    added, and re-priced when the order moves to an area with another level (typed rates stay).
 *  - Service charge: optional per area, off by default, removable per bill. It is booked as the bill's
 *    `other_charges` with `charges_taxable` (taxed like the food it follows) and named on the bill as
 *    "Service charge (optional)". Verify with your CA / legal adviser.
 *  - Aggregator orders (Swiggy / Zomato typed in): restaurant service through an e-commerce operator
 *    u/s 9(5) — the bill carries `eco_gstin` + `eco_section: 'PAY_9_5'` and no tax of its own, so the
 *    existing GSTR-1 build reports its value in Table 14(b) / GSTR-3B 3.1.1(ii). Verify with your CA.
 */
import type { InvoiceItem, InvoiceRecord } from '../../types/invoice';
import type {
  DiningArea, DiningTable, OrderChannel, OrderEvent, OrderLine, TableOrder,
} from '../../types/restaurant';
import { num, round2 } from '../invoice-calc';
import { resolvePrice, type PriceLevel } from '../pricing';
import { buildPosRecord, withTotals, type PosBuildInput } from '../pos';

export const STARTER_AREA_ID = 'area_dine_in';
export const SERVICE_CHARGE_LABEL = 'Service charge (optional)';
export const KITCHEN = 'Kitchen';

/** The starter set: one area "Dine-in" with tables 1–10. */
export function starterMasters(): { areas: DiningArea[]; tables: DiningTable[] } {
  return {
    areas: [{ id: STARTER_AREA_ID, name: 'Dine-in', sort: 1 }],
    tables: Array.from({ length: 10 }, (_, i) => ({ id: `tbl_${i + 1}`, name: String(i + 1), seats: 4, area_id: STARTER_AREA_ID, sort: i + 1 })),
  };
}

const pad = (n: number) => String(n).padStart(2, '0');
/** Local calendar day of a moment (never the UTC day). */
export function localDay(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Live orders (open or bill printed, not settled / void). */
export const isLive = (o: Pick<TableOrder, 'status'>): boolean => o.status === 'open' || o.status === 'printed';

/* ── Amounts ─────────────────────────────────────────────────── */

export const lineValue = (l: Pick<OrderLine, 'quantity' | 'rate' | 'discount_percent'>): number =>
  round2(num(l.quantity) * num(l.rate) * (1 - Math.min(Math.max(num(l.discount_percent), 0), 100) / 100));

/** Running amount of an order before tax (Σ line values). */
export const orderSubtotal = (o: Pick<TableOrder, 'lines'>): number => round2(o.lines.reduce((s, l) => s + lineValue(l), 0));

/** Service charge % in force on an order (0 when removed or off). */
export const serviceChargePct = (o: Pick<TableOrder, 'service_charge_pct' | 'service_charge_off' | 'channel'>): number =>
  o.service_charge_off || o.channel === 'aggregator' ? 0 : Math.min(Math.max(num(o.service_charge_pct), 0), 100);

export const serviceChargeOn = (subtotal: number, pct: number): number => round2((Math.max(num(subtotal), 0) * Math.max(num(pct), 0)) / 100);

/* ── Floor status ────────────────────────────────────────────── */

export type TableState = 'free' | 'occupied' | 'printed' | 'settling';

export interface TableStatus {
  table: DiningTable;
  state: TableState;
  order?: TableOrder;
  covers: number;
  amount: number;
  minutes: number;
}

export function orderState(o: TableOrder): TableState {
  if (!isLive(o)) return 'free';
  if (o.payers?.some((p) => p.paid)) return 'settling';
  return o.status === 'printed' ? 'printed' : 'occupied';
}

/** Each table of `area` with its live order, sorted by `sort`, then name. */
export function floor(tables: readonly DiningTable[], orders: readonly TableOrder[], areaId: string, now: Date = new Date()): TableStatus[] {
  const live = new Map(orders.filter((o) => isLive(o) && o.table_id).map((o) => [o.table_id as string, o]));
  return tables
    .filter((t) => t.area_id === areaId)
    .sort((a, b) => num(a.sort) - num(b.sort) || a.name.localeCompare(b.name, undefined, { numeric: true }))
    .map((table) => {
      const order = live.get(table.id);
      if (!order) return { table, state: 'free' as const, covers: 0, amount: 0, minutes: 0 };
      const opened = Date.parse(order.opened_at);
      return {
        table,
        state: orderState(order),
        order,
        covers: order.covers,
        amount: orderSubtotal(order),
        minutes: Number.isFinite(opened) ? Math.max(Math.floor((now.getTime() - opened) / 60000), 0) : 0,
      };
    });
}

/** Next takeaway / delivery / aggregator token: counted per local day across those channels. */
export function nextToken(orders: readonly Pick<TableOrder, 'day' | 'token'>[], day: string): number {
  return orders.filter((o) => o.day === day).reduce((m, o) => Math.max(m, num(o.token)), 0) + 1;
}

/* ── Opening an order ────────────────────────────────────────── */

export interface NewOrderInput {
  id: string;
  channel: OrderChannel;
  area_id: string;
  table_id?: string;
  covers?: number;
  captain?: { id: string; name: string };
  client?: TableOrder['client'];
  eco_gstin?: string;
  eco_name?: string;
  ref?: string;
  service_charge_pct?: number;
  now: Date;
  /** Every order (for the daily token). */
  orders: readonly TableOrder[];
}

export function newOrder(input: NewOrderInput): TableOrder {
  const at = input.now.toISOString();
  const day = localDay(input.now);
  const by = input.captain?.name ?? '';
  const order: TableOrder = {
    id: input.id,
    day,
    area_id: input.area_id,
    channel: input.channel,
    covers: Math.max(Math.floor(num(input.covers)), input.channel === 'dine_in' ? 1 : 0),
    lines: [],
    kots: [],
    log: [{ at, by, kind: 'open', ...(input.table_id ? { to: input.table_id } : {}) }],
    status: 'open',
    opened_at: at,
  };
  if (input.table_id && input.channel === 'dine_in') order.table_id = input.table_id;
  else order.token = nextToken(input.orders, day);
  if (input.captain) {
    order.captain_id = input.captain.id;
    order.captain_name = input.captain.name;
  }
  if (input.client?.name?.trim()) order.client = { ...input.client, name: input.client.name.trim() };
  if (input.channel === 'aggregator') {
    const g = (input.eco_gstin ?? '').trim().toUpperCase();
    if (g) order.eco_gstin = g;
    if (input.eco_name?.trim()) order.eco_name = input.eco_name.trim();
    if (input.ref?.trim()) order.ref = input.ref.trim();
  } else if (num(input.service_charge_pct) > 0) order.service_charge_pct = round2(num(input.service_charge_pct));
  return order;
}

/* ── Lines ───────────────────────────────────────────────────── */

/** Rate of a catalogue item at `qty` in an area with `level` (level / slab via the pricing path). */
export function areaPrice(item: Pick<InvoiceItem, 'id' | 'rate' | 'qty_slabs' | 'mrp' | 'mrp_less_percent'>, qty: number, level: PriceLevel | null | undefined): { rate: number; basis?: string } {
  const q = resolvePrice(item, qty, level ?? null);
  return { rate: q.rate, ...(q.basis ? { basis: q.basis } : {}) };
}

export interface AddLineOptions {
  newId: () => string;
  qty?: number;
  level?: PriceLevel | null;
  by?: string;
  at: string;
  seat?: number;
  note?: string;
  fallbackTaxRate?: number;
  /** Children (priced modifiers) and a free-modifier note: the line is always its own line. */
  children?: OrderLine[];
}

/** Turn a catalogue item into an order line (priced for the area). */
export function lineFromItem(source: InvoiceItem & { group_id?: string }, opts: AddLineOptions): OrderLine {
  const qty = num(opts.qty, 1) > 0 ? num(opts.qty, 1) : 1;
  const price = areaPrice(source, qty, opts.level);
  const line: OrderLine = {
    id: opts.newId(),
    name: source.name,
    type: source.type || 'Product',
    hsn: source.hsn ?? '',
    unit: source.unit || 'NOS',
    quantity: qty,
    rate: price.rate,
    tax_rate: typeof source.tax_rate === 'number' ? source.tax_rate : num(opts.fallbackTaxRate),
    amount: round2(qty * price.rate),
    item_id: source.id,
  };
  if (num(source.cess_rate) > 0) line.cess_rate = num(source.cess_rate);
  if (num(source.cess_per_unit) > 0) line.cess_per_unit = num(source.cess_per_unit);
  if (num(source.unit_factor) > 0 && num(source.unit_factor) !== 1) line.unit_factor = num(source.unit_factor);
  if (source.sold_by_weight) line.sold_by_weight = true;
  if (source.group_id) line.group_id = source.group_id;
  if (price.basis) line.price_basis = price.basis;
  if (opts.by) line.added_by = opts.by;
  line.added_at = opts.at;
  if (opts.seat && opts.seat > 0) line.seat = Math.floor(opts.seat);
  if (opts.note?.trim()) line.note = opts.note.trim();
  return line;
}

/**
 * Add an item to an order: the same plain item (no modifiers, note or other seat) raises the quantity
 * of its line; anything else is a new line, followed by its modifier children.
 */
export function addItem(order: TableOrder, source: InvoiceItem & { group_id?: string }, opts: AddLineOptions): { order: TableOrder; lineId: string } {
  const qty = num(opts.qty, 1) > 0 ? num(opts.qty, 1) : 1;
  const plain = !opts.children?.length && !opts.note?.trim();
  const hasChildren = (id: string) => order.lines.some((l) => l.modifier_of === id);
  const idx = plain
    ? order.lines.findIndex((l) => !l.modifier_of && !l.note && !hasChildren(l.id) && (l.item_id ? l.item_id === source.id : l.name === source.name) && (l.seat ?? 0) === (opts.seat ?? 0))
    : -1;
  let lines: OrderLine[];
  let lineId: string;
  if (idx >= 0) {
    const cur = order.lines[idx];
    const quantity = round2(num(cur.quantity) + qty);
    let rate = cur.rate;
    let basis = cur.price_basis;
    if (!cur.typed_rate) {
      const p = areaPrice(source, quantity, opts.level);
      rate = p.rate;
      basis = p.basis;
    }
    const next: OrderLine = { ...cur, quantity, rate, amount: round2(quantity * rate) };
    if (basis) next.price_basis = basis;
    else delete next.price_basis;
    lines = order.lines.map((l, n) => (n === idx ? next : l));
    lineId = cur.id;
  } else {
    const line = lineFromItem(source, { ...opts, qty });
    const children = (opts.children ?? []).map((c) => ({ ...c, modifier_of: line.id, quantity: round2(num(c.quantity) || qty), seat: line.seat }));
    for (const c of children) {
      c.amount = round2(num(c.quantity) * num(c.rate));
      if (!c.seat) delete c.seat;
    }
    lines = [...order.lines, line, ...children];
    lineId = line.id;
  }
  return { order: { ...order, lines, log: [...order.log, { at: opts.at, by: opts.by ?? '', kind: 'add', line: source.name, qty }] }, lineId };
}

/** Re-price the lines of an order for another area's price level (typed rates and modifier children stay). */
export function repriceLines(lines: readonly OrderLine[], catalog: readonly InvoiceItem[], level: PriceLevel | null | undefined): OrderLine[] {
  const byId = new Map(catalog.map((c) => [c.id, c]));
  return lines.map((l) => {
    if (l.typed_rate || l.modifier_of) return l;
    const item = l.item_id ? byId.get(l.item_id) : undefined;
    if (!item) return l;
    const p = areaPrice(item, num(l.quantity), level);
    const out: OrderLine = { ...l, rate: p.rate, amount: round2(num(l.quantity) * p.rate) };
    if (p.basis) out.price_basis = p.basis;
    else delete out.price_basis;
    return out;
  });
}

/* ── Move / merge / transfer ─────────────────────────────────── */

const ev = (e: OrderEvent): OrderEvent => e;

/** Move an order to a free table (the target must have no live order). */
export function moveOrder(order: TableOrder, to: DiningTable, orders: readonly TableOrder[], by: string, at: string): TableOrder {
  if (!isLive(order)) throw new Error('This order is already closed.');
  if (orders.some((o) => o.id !== order.id && isLive(o) && o.table_id === to.id)) throw new Error(`Table ${to.name} is not free.`);
  return {
    ...order,
    table_id: to.id,
    area_id: to.area_id,
    channel: 'dine_in',
    log: [...order.log, ev({ at, by, kind: 'move', from: order.table_id ?? (order.token ? `#${order.token}` : ''), to: to.id })],
  };
}

/**
 * Merge `source` into `target`: lines appended (ids kept), both KOT histories kept (the source's
 * tickets marked `from_order`), covers added, logs joined. The source is voided as "merged".
 */
export function mergeOrders(target: TableOrder, source: TableOrder, by: string, at: string): { target: TableOrder; source: TableOrder } {
  if (target.id === source.id) throw new Error('Pick another order to merge.');
  if (!isLive(target) || !isLive(source)) throw new Error('Only open orders can be merged.');
  const merged: TableOrder = {
    ...target,
    status: 'open',
    lines: [...target.lines, ...source.lines],
    kots: [...target.kots, ...source.kots.map((k) => ({ ...k, from_order: k.from_order ?? source.id }))],
    covers: num(target.covers) + num(source.covers),
    log: [...target.log, ...source.log.map((e) => ({ ...e })), ev({ at, by, kind: 'merge', from: source.table_id ?? source.id, to: target.table_id ?? target.id })],
  };
  delete merged.printed_at;
  return {
    target: merged,
    source: { ...source, status: 'void', lines: [], kots: [], log: [...source.log, ev({ at, by, kind: 'merge', from: source.table_id ?? source.id, to: target.table_id ?? target.id, note: 'merged' })] },
  };
}

export interface TransferPick {
  line_id: string;
  /** Quantity to move (whole line when absent). */
  qty?: number;
}

/**
 * Transfer selected lines (with their modifier children) to another live order. A partial quantity
 * splits the line; the kitchen-sent quantity travels with it (`sent_offset`), so nothing is re-sent.
 */
export function transferLines(
  from: TableOrder,
  to: TableOrder,
  picks: readonly TransferPick[],
  sentQty: (order: TableOrder, lineId: string) => number,
  newId: () => string,
  by: string,
  at: string,
): { from: TableOrder; to: TableOrder } {
  if (from.id === to.id) throw new Error('Pick another table.');
  if (!isLive(from) || !isLive(to)) throw new Error('Only open orders can take a transfer.');
  let src = [...from.lines];
  const moved: OrderLine[] = [];
  const log: OrderEvent[] = [];
  for (const p of picks) {
    const line = src.find((l) => l.id === p.line_id && !l.modifier_of);
    if (!line) continue;
    const qty = p.qty === undefined ? num(line.quantity) : Math.min(Math.max(num(p.qty), 0), num(line.quantity));
    if (qty <= 0) continue;
    const sent = sentQty(from, line.id);
    const children = src.filter((l) => l.modifier_of === line.id);
    if (qty >= num(line.quantity) - 1e-9) {
      src = src.filter((l) => l.id !== line.id && l.modifier_of !== line.id);
      // Whole line: its sent quantity moves with it.
      moved.push({ ...line, sent_offset: round2(sent - sentFromKots(to, line.id)) }, ...children.map((c) => ({ ...c, sent_offset: round2(sentQty(from, c.id) - sentFromKots(to, c.id)) })));
    } else {
      const ratio = qty / num(line.quantity);
      const movedSent = Math.min(qty, sent);
      const id = newId();
      moved.push({ ...line, id, quantity: round2(qty), amount: round2(qty * num(line.rate)), sent_offset: round2(movedSent) });
      const childMoves = children.map((c) => {
        const cq = round2(num(c.quantity) * ratio);
        const cs = Math.min(cq, sentQty(from, c.id));
        return { child: c, moved: { ...c, id: newId(), modifier_of: id, quantity: cq, amount: round2(cq * num(c.rate)), sent_offset: round2(cs) }, sent: cs, qty: cq };
      });
      moved.push(...childMoves.map((m) => m.moved));
      src = src.map((l) => {
        if (l.id === line.id) {
          const rest = round2(num(l.quantity) - qty);
          return { ...l, quantity: rest, amount: round2(rest * num(l.rate)), sent_offset: round2(num(l.sent_offset) - movedSent) };
        }
        const cm = childMoves.find((m) => m.child.id === l.id);
        if (cm) {
          const rest = round2(num(l.quantity) - cm.qty);
          return { ...l, quantity: rest, amount: round2(rest * num(l.rate)), sent_offset: round2(num(l.sent_offset) - cm.sent) };
        }
        return l;
      });
    }
    log.push(ev({ at, by, kind: 'transfer', line: line.name, qty, from: from.table_id ?? from.id, to: to.table_id ?? to.id }));
  }
  if (!moved.length) throw new Error('Pick at least one line to transfer.');
  return {
    from: { ...from, lines: src, log: [...from.log, ...log] },
    to: { ...to, lines: [...to.lines, ...moved], log: [...to.log, ...log] },
  };
}

/** Σ KOT quantities of a line id on an order (no offset). */
export function sentFromKots(order: Pick<TableOrder, 'kots'>, lineId: string): number {
  let q = 0;
  for (const k of order.kots) for (const l of k.lines) if (l.line_id === lineId) q += k.kind === 'cancel' ? -num(l.qty) : num(l.qty);
  return round2(q);
}

/* ── Settle builder ──────────────────────────────────────────── */

const ORDER_ONLY: readonly string[] = ['item_id', 'group_id', 'option_id', 'typed_rate', 'added_by', 'added_at', 'sent_offset'];

/** Order lines as invoice lines (restaurant-only fields dropped; the note prints as the description). */
export function invoiceItemsOf(lines: readonly OrderLine[]): InvoiceItem[] {
  return lines
    .filter((l) => l.name.trim() && num(l.quantity) > 0)
    .map((l) => {
      const out: Record<string, unknown> = { ...l };
      for (const k of ORDER_ONLY) delete out[k];
      if (l.note) out.description = l.note;
      out.amount = round2(num(l.quantity) * num(l.rate));
      return out as unknown as InvoiceItem;
    });
}

export interface SettleBuildInput extends Omit<PosBuildInput, 'items' | 'party'> {
  order: TableOrder;
  /** Lines of this bill (defaults to every order line; a split part passes its own). */
  items?: InvoiceItem[];
  /** The saved customer, when the order names one that exists. */
  client?: PosBuildInput['party']['client'];
}

/** Apply the order's service charge, operator and link to a built POS record (totals recomputed). */
export function finishOrderRecord(rec: InvoiceRecord, order: TableOrder): InvoiceRecord {
  let out: InvoiceRecord = { ...rec, table_order_id: order.id };
  if (order.channel === 'aggregator' && order.eco_gstin) {
    // Sec 9(5): the operator pays the GST; the restaurant's bill carries no tax (value-only reporting).
    out = {
      ...out,
      eco_gstin: order.eco_gstin,
      eco_section: 'PAY_9_5',
      items: out.items.map((i) => {
        const x = { ...i, tax_rate: 0 };
        delete x.cess_rate;
        delete x.cess_per_unit;
        return x;
      }),
    };
  }
  const pct = serviceChargePct(order);
  if (pct > 0) {
    const subtotal = round2(out.items.reduce((s, l) => s + lineValue(l), 0));
    const charge = serviceChargeOn(subtotal, pct);
    if (charge > 0) {
      out = {
        ...out,
        other_charges: charge,
        charges_taxable: true,
        notes: [out.notes, `Other charges = ${SERVICE_CHARGE_LABEL} @ ${pct}%: ₹${charge.toFixed(2)}. It is voluntary — ask us to remove it.`].filter(Boolean).join('\n'),
      };
    }
  }
  const party = order.channel === 'aggregator' ? `${order.eco_name || 'Aggregator'}${order.ref ? ` order ${order.ref}` : ''}` : '';
  const where = order.table_id ? '' : order.token ? `Token ${order.token}` : '';
  const ref = [where, party].filter(Boolean).join(' · ');
  if (ref) out = { ...out, po_number: out.po_number || ref };
  return withTotals(out);
}

/** The POS invoice record for settling `order` (not saved, not numbered). */
export function buildSettleRecord(input: SettleBuildInput): InvoiceRecord {
  const { order } = input;
  const items = input.items ?? invoiceItemsOf(order.lines);
  const rec = buildPosRecord({
    items,
    party: input.client ? { client: input.client } : { name: order.client?.name, phone: order.client?.phone },
    settings: input.settings,
    sender: input.sender,
    templateId: input.templateId,
    day: input.day,
    docType: input.docType,
  });
  return finishOrderRecord(rec, order);
}
