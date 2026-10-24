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
