/**
 * Sales orders (`SALES_ORDER`, series `SO/FY../0001`): a confirmed customer order that is
 * NOT a tax document — never revenue, receivable, GST, books or stock (every classifier
 * uses an allow-list of tax types, so it is excluded by construction).
 *
 * Fulfilment is derived, never stored. A challan / invoice converted from an order carries
 * `sales_order_id` on the record and `order_line_id` (the order line's id) on each of its
 * lines; the same stamps ride along when that challan is later converted to an invoice.
 * Per order line:
 *   - invoiced  = quantity on live (non-cancelled) INVOICE / TAX_INVOICE documents
 *   - delivered = quantity on live challans that were not made from an invoice, plus
 *                 invoices that were not made from a challan (goods go with the invoice)
 * so SO → challan → invoice counts the goods once as delivered and once as invoiced.
 * Draft documents count too (they already reserve the quantity); credit notes do not.
 *
 * State: Draft / Open / Partly fulfilled / Fulfilled (every line delivered AND invoiced) /
 * Closed (the user closed it, `order_closed_on`) / Cancelled.
 */

import type { InvoiceItem, InvoiceRecord } from '../types/invoice';
import { num, round2 } from './invoice-calc';

export type OrderState = 'Draft' | 'Open' | 'Partly fulfilled' | 'Fulfilled' | 'Closed' | 'Cancelled';
export const ORDER_STATES: OrderState[] = ['Open', 'Partly fulfilled', 'Fulfilled', 'Closed'];

/** What a conversion from an order fills in: challans take what is still to deliver, invoices what is still to bill. */
export type FulfilKind = 'deliver' | 'invoice';

export interface OrderLineStatus {
  item: InvoiceItem;
  ordered: number;
  delivered: number;
  invoiced: number;
  pendingDelivery: number;
  pendingInvoice: number;
}

export interface OrderFulfilment {
  lines: OrderLineStatus[];
  state: OrderState;
  /** Ids of the live challans / invoices raised against the order. */
  documentIds: string[];
}

interface LinkLike {
  from_id: string;
  to_id: string;
  relation: string;
}

type Doc = Pick<InvoiceRecord, 'id' | 'doc_type' | 'status' | 'items' | 'sales_order_id'>;

const isInvoice = (t: string | undefined) => t === 'INVOICE' || t === 'TAX_INVOICE' || t === 'BILL_OF_SUPPLY';

/** Per order line: delivered / invoiced quantity, plus which documents touched it. */
interface Tally {
  delivered: Map<string, number>;
  invoiced: Map<string, number>;
  docs: string[];
}

/**
 * Pure: one pass over every document, grouped by sales order. Use this for lists (one
 * index for all orders); `orderFulfilment` wraps it for a single order.
 */
export function buildOrderIndex(invoices: readonly Doc[], links: readonly LinkLike[]): Map<string, Tally> {
  const typeOf = new Map(invoices.map((i) => [i.id, i.doc_type]));
  // Which document each one was converted from (first link wins, as in the document chain).
  const parentType = new Map<string, string | undefined>();
  for (const l of links) {
    if (l.relation !== 'converted' || parentType.has(l.to_id)) continue;
    parentType.set(l.to_id, typeOf.get(l.from_id));
  }
  const out = new Map<string, Tally>();
  for (const d of invoices) {
    if (!d.sales_order_id || d.status === 'Cancelled') continue;
    const challan = d.doc_type === 'DELIVERY_CHALLAN';
    const inv = isInvoice(d.doc_type);
    if (!challan && !inv) continue;
    const from = parentType.get(d.id);
    const delivers = challan ? !isInvoice(from) : from !== 'DELIVERY_CHALLAN';
    let t = out.get(d.sales_order_id);
    if (!t) {
      t = { delivered: new Map(), invoiced: new Map(), docs: [] };
      out.set(d.sales_order_id, t);
    }
    let touched = false;
    for (const it of d.items ?? []) {
      if (!it.order_line_id) continue;
      const q = num(it.quantity);
      touched = true;
      if (inv) t.invoiced.set(it.order_line_id, round2((t.invoiced.get(it.order_line_id) ?? 0) + q));
      if (delivers) t.delivered.set(it.order_line_id, round2((t.delivered.get(it.order_line_id) ?? 0) + q));
    }
    if (touched) t.docs.push(d.id);
  }
  return out;
}

const EPS = 1e-6;

/** Pure: fulfilment of one order from a prebuilt index. */
export function fulfilmentFromIndex(
  order: Pick<InvoiceRecord, 'id' | 'status' | 'items' | 'order_closed_on'>,
  index: Map<string, Tally>,
): OrderFulfilment {
  const t = index.get(order.id);
  const lines: OrderLineStatus[] = (order.items ?? [])
    .filter((item) => num(item.quantity) > 0)
    .map((item) => {
      const ordered = num(item.quantity);
      const delivered = t?.delivered.get(item.id) ?? 0;
      const invoiced = t?.invoiced.get(item.id) ?? 0;
      return {
        item,
        ordered,
        delivered,
        invoiced,
        pendingDelivery: Math.max(0, round2(ordered - delivered)),
        pendingInvoice: Math.max(0, round2(ordered - invoiced)),
      };
    });
  const done = lines.length > 0 && lines.every((l) => l.pendingDelivery <= EPS && l.pendingInvoice <= EPS);
  const started = lines.some((l) => l.delivered > EPS || l.invoiced > EPS);
  let state: OrderState;
  if (order.status === 'Cancelled') state = 'Cancelled';
  else if (done) state = 'Fulfilled';
  else if (order.order_closed_on) state = 'Closed';
  else if (started) state = 'Partly fulfilled';
  else state = order.status === 'Draft' ? 'Draft' : 'Open';
  return { lines, state, documentIds: t?.docs ?? [] };
}

export function orderFulfilment(
  order: Pick<InvoiceRecord, 'id' | 'status' | 'items' | 'order_closed_on'>,
  invoices: readonly Doc[],
  links: readonly LinkLike[],
): OrderFulfilment {
  return fulfilmentFromIndex(order, buildOrderIndex(invoices, links));
}

/** Pending quantity per order line id for the next challan (`deliver`) or invoice (`invoice`). */
export function pendingQuantities(f: OrderFulfilment, kind: FulfilKind): Record<string, number> {
  const out: Record<string, number> = {};
  for (const l of f.lines) {
    const q = kind === 'deliver' ? l.pendingDelivery : l.pendingInvoice;
    if (q > EPS) out[l.item.id] = q;
  }
  return out;
}

/** Why an order cannot be converted any further, or null. */
export function orderConversionBlocked(f: OrderFulfilment, kind: FulfilKind): string | null {
  if (f.state === 'Cancelled') return 'This sales order is cancelled.';
  if (f.state === 'Closed') return 'This sales order is closed. Reopen it to raise more documents against it.';
  if (Object.keys(pendingQuantities(f, kind)).length === 0) {
    return kind === 'deliver'
      ? 'Every line on this sales order has already been delivered.'
      : 'Every line on this sales order has already been invoiced.';
  }
  return null;
}

/** Badge tone for an order state (reuses the invoice badge palette). */
export function orderTone(state: OrderState): 'draft' | 'sent' | 'partial' | 'paid' | 'cancelled' {
  switch (state) {
    case 'Fulfilled':
      return 'paid';
    case 'Partly fulfilled':
      return 'partial';
    case 'Open':
      return 'sent';
    case 'Closed':
    case 'Cancelled':
      return 'cancelled';
    default:
      return 'draft';
  }
}

/** A user may close an order that is issued and not yet fulfilled (or reopen a closed one). */
export function canCloseOrder(f: OrderFulfilment): boolean {
  return f.state === 'Open' || f.state === 'Partly fulfilled';
}

/* ── Sales order outstanding (WP-8, P1-12 sales side — Tally "Sales Order Outstandings") ── */

type OrderDoc = Doc & Pick<InvoiceRecord, 'invoice_number' | 'issue_date' | 'due_date' | 'client' | 'order_closed_on'>;

export interface SoOutstandingRow {
  orderId: string;
  number: string;
  date: string;
  /** The order's due date (yyyy-mm-dd), '' when none. */
  due: string;
  party: string;
  lineId: string;
  item: string;
  hsn: string;
  unit: string;
  /** Base units per line unit (alternate units, WP-8). */
  unitFactor: number;
  ordered: number;
  delivered: number;
  invoiced: number;
  pendingDelivery: number;
  pendingInvoice: number;
  /** Net rate per line unit (after the line discount). */
  rate: number;
  /** Pending delivery × rate (the order value still to be supplied). */
  value: number;
  /** Days past the due date on `asOf` while goods are still to deliver (0 = not overdue). */
  overdueDays: number;
}

const dayNumber = (d: string): number => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000 : NaN;
};

/**
 * Every open sales-order line with goods still to deliver or bill on `asOf`: issued orders dated on or
 * before it, not cancelled, closed or fulfilled. Delivered / invoiced come from the same index as the
 * order list (`buildOrderIndex`), so the report and the order badges always agree.
 */
export function salesOrderOutstanding(invoices: readonly OrderDoc[], links: readonly LinkLike[], asOf: string): SoOutstandingRow[] {
  const index = buildOrderIndex(invoices, links);
  const rows: SoOutstandingRow[] = [];
  for (const o of invoices) {
    if (o.doc_type !== 'SALES_ORDER' || o.status === 'Draft' || o.status === 'Cancelled' || !o.issue_date || o.issue_date.slice(0, 10) > asOf) continue;
    const f = fulfilmentFromIndex(o, index);
    if (f.state !== 'Open' && f.state !== 'Partly fulfilled') continue;
    const due = (o.due_date ?? '').slice(0, 10);
    for (const l of f.lines) {
      if (l.pendingDelivery <= EPS && l.pendingInvoice <= EPS) continue;
      const rate = round2(num(l.item.rate) * (1 - Math.min(Math.max(num(l.item.discount_percent), 0), 100) / 100));
      const late = due && due < asOf && l.pendingDelivery > EPS ? dayNumber(asOf) - dayNumber(due) : 0;
      rows.push({
        orderId: o.id, number: o.invoice_number ?? '', date: o.issue_date.slice(0, 10), due, party: o.client?.name ?? '',
        lineId: l.item.id, item: l.item.name, hsn: l.item.hsn ?? '', unit: l.item.unit ?? '',
        unitFactor: num(l.item.unit_factor) > 0 ? num(l.item.unit_factor) : 1,
        ordered: l.ordered, delivered: l.delivered, invoiced: l.invoiced,
        pendingDelivery: l.pendingDelivery, pendingInvoice: l.pendingInvoice,
        rate, value: round2(l.pendingDelivery * rate), overdueDays: Number.isFinite(late) ? Math.max(late, 0) : 0,
      });
    }
  }
  return rows.sort((a, b) => (a.due || a.date).localeCompare(b.due || b.date) || a.number.localeCompare(b.number, undefined, { numeric: true }));
}

export type OutstandingGroupBy = 'party' | 'item' | 'due';

export interface OutstandingGroup {
  key: string;
  /** Party / item name; for `due`: 'overdue' | 'week' | 'later' | 'none' (the screen translates these). */
  label: string;
  rows: SoOutstandingRow[];
  value: number;
  overdue: number;
}

/** Rows grouped by party, by item, or by due date (overdue · due within 7 days · later · no due date). */
export function groupOutstanding(rows: readonly SoOutstandingRow[], by: OutstandingGroupBy, asOf: string): OutstandingGroup[] {
  const bucket = (r: SoOutstandingRow) => {
    if (!r.due) return 'none';
    if (r.overdueDays > 0 || r.due < asOf) return 'overdue';
    return dayNumber(r.due) - dayNumber(asOf) <= 7 ? 'week' : 'later';
  };
  const order = ['overdue', 'week', 'later', 'none'];
  const map = new Map<string, OutstandingGroup>();
  for (const r of rows) {
    const label = by === 'party' ? r.party || '-' : by === 'item' ? r.item || '-' : bucket(r);
    const key = label.toLowerCase();
    const g = map.get(key) ?? { key, label, rows: [], value: 0, overdue: 0 };
    g.rows.push(r);
    g.value = round2(g.value + r.value);
    if (r.overdueDays > 0) g.overdue++;
    map.set(key, g);
  }
  const list = [...map.values()];
  return by === 'due'
    ? list.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key))
    : list.sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}
