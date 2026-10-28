/**
 * R2-B5: sales order → back-to-back purchase order, and the backorder view (QuickBooks "Convert to
 * purchase order", Xero backorders).
 *
 *  - "Create purchase order" on a sales order proposes, per order line, the quantity still to deliver
 *    less free stock (in the line's godown when it names one, used once across lines of the same item;
 *    "full quantity" ignores stock) less what earlier back-to-back POs of this order already asked for
 *    (a short-closed PO counts only what it received). Quantities are in the order line's
 *    unit; stock is in base units and converted with `lineFactor` (alternate units).
 *  - The supplier per line is pre-filled with the item's last supplier; one PO is created per supplier.
 *    PO lines carry `so_line_id`, the PO `so_id` (and `drop_ship` + the customer's `ship_to`).
 *  - Backorders: open order lines that wait on stock, with their linked PO lines, the PO expected date
 *    and how much has arrived (GRN accepted or billed directly — the Purchase Order Outstanding rule,
 *    `purchaseOrderOutstanding`). "Fulfil" is offered once the goods are in.
 *  - Cancelling a sales order warns about its open linked POs.
 *
 * Reads purchase bills / GRNs only through `purchaseOrderOutstanding` (tests/purchase-contract.test.ts).
 * Pure except the "Storage" section.
 */

import type { InvoiceItem, InvoiceRecord } from '../types/invoice';
import type { PurchaseOrder, PurchaseOrderLine, PurchaseRecord, ReceiptNote } from '../types/purchases';
import { buildOrderIndex, fulfilmentFromIndex, type OrderFulfilment } from './sales-orders';
import { purchaseOrderOutstanding } from './receipt-notes';
import { lineFactor } from './units';
import { num, round2 } from './invoice-calc';
import { poTotals, purchaseOrdersDb, PURCHASE_ORDERS_TABLE } from './purchase-orders';
import { resolveStateCode } from './india-states';
import { generateId, getTable } from './storage';
import { withTablesRollback } from './table-txn';
import { SERIES_TABLE } from './series-counters';
import { buildItemIndex, loadPositions } from './inventory';
import { loadTracking } from './stock-tracking';

export interface LinkLike {
  from_id: string;
  to_id: string;
  relation: string;
}

const EPS = 1e-6;
const roundQty = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000 || 0;
const clean = (s: unknown) => String(s ?? '').trim();

/** Free stock of the line's item (base units) — in its godown when given; undefined = not a stock item. */
export type FreeStockFn = (line: Pick<InvoiceItem, 'name' | 'hsn' | 'godown_id'>) => { itemId: string; qty: number } | undefined;
/** Last supplier and rate of a stock item. */
export type LastSupplierFn = (itemId: string) => { vendor_name?: string; vendor_id?: string; rate?: number } | undefined;

/**
 * Quantity per sales-order line id already asked for on this order's back-to-back POs (line units). A
 * short-closed PO (`closed_on`) counts only what it received (`received`: PO line id → quantity, from
 * `poLinesReceived`; absent = nothing known) — the rest will never come, so it is proposed again (QA5-2 F21).
 */
export function onOrderQty(soId: string, orders: readonly PurchaseOrder[], received?: ReadonlyMap<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  for (const po of orders) {
    if (po?.so_id !== soId) continue;
    for (const l of po.lines ?? []) {
      if (!l.so_line_id) continue;
      const q = po.closed_on ? Math.min(Math.max(num(received?.get(l.id)), 0), num(l.quantity)) : num(l.quantity);
      out.set(l.so_line_id, roundQty((out.get(l.so_line_id) ?? 0) + q));
    }
  }
  return out;
}

/** Received quantity per PO line, closed POs included (GRN accepted + bills not from a GRN, `purchaseOrderOutstanding`). */
export function poLinesReceived(orders: readonly PurchaseOrder[], purchases: readonly PurchaseRecord[], notes: readonly ReceiptNote[]): Map<string, number> {
  const asOpen = orders.filter(Boolean).map((po) => (po.closed_on ? { ...po, closed_on: undefined } : po));
  const open = new Map(purchaseOrderOutstanding(asOpen, purchases, notes, '9999-12-31').map((r) => [r.lineId, r.received]));
  const out = new Map<string, number>();
  for (const po of asOpen) for (const l of po.lines ?? []) out.set(l.id, open.has(l.id) ? open.get(l.id)! : num(l.quantity));
  return out;
}

export interface SoToPoRow {
  line: InvoiceItem;
  pendingDelivery: number;
  /** Free stock in the line's unit (0 for a non-stock line). */
  free: number;
  onOrder: number;
  /** Proposed PO quantity (line units). */
  short: number;
  itemId?: string;
  vendor_name: string;
  vendor_id?: string;
  rate: number;
}

/**
 * Pure: the proposal for "Create purchase order". `fullQty` orders the whole pending quantity (still
 * less what earlier back-to-back POs asked for), ignoring stock.
 */
export function soToPoRows(f: OrderFulfilment, soId: string, orders: readonly PurchaseOrder[], opts: { free?: FreeStockFn; lastSupplier?: LastSupplierFn; fullQty?: boolean; received?: ReadonlyMap<string, number> } = {}): SoToPoRow[] {
  const asked = onOrderQty(soId, orders, opts.received);
  // QA5-2 F21: free stock (base units, per item and godown) is used once across the order's lines of one item.
  const left = new Map<string, number>();
  return f.lines
    .filter((l) => l.pendingDelivery > EPS)
    .map((l) => {
      const factor = lineFactor(l.item);
      const stock = opts.free?.(l.item);
      const onOrder = asked.get(l.item.id) ?? 0;
      const key = stock ? `${stock.itemId}|${l.item.godown_id ?? ''}` : '';
      const avail = stock ? Math.max(left.get(key) ?? stock.qty, 0) : 0;
      const need = Math.max(l.pendingDelivery - onOrder, 0) * factor;
      const take = Math.min(avail, need);
      if (stock) left.set(key, avail - take);
      const free = stock ? Math.max(roundQty(take / factor), 0) : 0;
      const short = Math.max(roundQty(l.pendingDelivery - (opts.fullQty ? 0 : free) - onOrder), 0);
      const sup = stock ? opts.lastSupplier?.(stock.itemId) : undefined;
      return {
        line: l.item, pendingDelivery: l.pendingDelivery, free, onOrder, short, ...(stock ? { itemId: stock.itemId } : {}),
        vendor_name: sup?.vendor_name ?? '', ...(sup?.vendor_id ? { vendor_id: sup.vendor_id } : {}),
        rate: round2(num(sup?.rate) > 0 ? num(sup?.rate) * factor : 0),
      };
    });
}

export interface PoPick {
  soLineId: string;
  quantity: number;
  rate: number;
  vendor_name: string;
  vendor_id?: string;
  vendor_gstin?: string;
}

export type PoDraft = Omit<PurchaseOrder, 'id' | 'po_number'>;

/** Pure: one PO per supplier for the picked lines (lines carry `so_line_id`; the PO `so_id`, drop-ship address). */
export function buildBackToBackPos(so: InvoiceRecord, picks: readonly PoPick[], opts: {
  date: string; expected_date?: string; dropShip?: boolean; businessState?: string; newId?: () => string;
}): PoDraft[] {
  const newId = opts.newId ?? generateId;
  const byVendor = new Map<string, { pick: PoPick; lines: PurchaseOrderLine[] }>();
  for (const p of picks) {
    const line = (so.items ?? []).find((i) => i.id === p.soLineId);
    if (!line || !(num(p.quantity) > 0)) continue;
    if (!clean(p.vendor_name)) throw new Error(`Choose a supplier for "${line.name || 'item'}".`);
    const k = clean(p.vendor_name).toLowerCase();
    const g = byVendor.get(k) ?? { pick: p, lines: [] };
    g.lines.push({
      id: newId(), name: line.name, ...(line.hsn ? { hsn: line.hsn } : {}), ...(line.unit ? { unit: line.unit } : {}),
      quantity: roundQty(num(p.quantity)), rate: round2(num(p.rate)), tax_rate: num(line.tax_rate),
      ...(num(line.unit_factor) > 0 && num(line.unit_factor) !== 1 ? { unit_factor: num(line.unit_factor) } : {}),
      so_line_id: line.id,
    });
    byVendor.set(k, g);
  }
  const ship = so.ship_to && (so.ship_to.address || so.ship_to.name) ? so.ship_to : {
    name: so.client?.company || so.client?.name, address: so.client?.address, city: so.client?.city, zip: so.client?.zip,
    state_code: so.client?.state_code, gstin: so.client?.gstin,
  };
  return [...byVendor.values()].map(({ pick, lines }) => {
    const pos = resolveStateCode({ gstin: pick.vendor_gstin }) || opts.businessState || '';
    const t = poTotals(lines, pos || undefined, opts.businessState);
    return {
      date: opts.date, ...(opts.expected_date ? { expected_date: opts.expected_date } : {}),
      ...(pick.vendor_id ? { vendor_id: pick.vendor_id } : {}), vendor_name: clean(pick.vendor_name),
      ...(clean(pick.vendor_gstin) ? { vendor_gstin: clean(pick.vendor_gstin).toUpperCase() } : {}),
      ...(pos ? { place_of_supply: pos } : {}),
      lines, taxable: t.taxable, cgst: t.cgst, sgst: t.sgst, igst: t.igst, total: t.total,
      notes: `Against sales order ${so.invoice_number} (${so.client?.name ?? ''})${opts.dropShip ? ' — deliver directly to the customer' : ''}`,
      so_id: so.id,
      ...(opts.dropShip ? { drop_ship: true, ship_to: Object.fromEntries(Object.entries(ship).filter(([, v]) => clean(v))) } : {}),
    };
  });
}

/* ── Backorders ─────────────────────────────────────────────────── */

export interface LinkedPoLine {
  poId: string;
  number: string;
  vendor: string;
  expected: string;
  ordered: number;
  received: number;
  pending: number;
  closed: boolean;
}

export type BackorderStatus = 'awaiting_po' | 'on_order' | 'arrived';

export interface BackorderRow {
  orderId: string;
  orderNumber: string;
  party: string;
  due: string;
  lineId: string;
  item: string;
  unit: string;
  pendingDelivery: number;
  free: number;
  /** Still short after free stock (line units). */
  short: number;
  pos: LinkedPoLine[];
  status: BackorderStatus;
}

/** Received / pending per PO line (GRN accepted + bills not from a GRN), the Purchase Order Outstanding rule. */
export function poLineProgress(orders: readonly PurchaseOrder[], purchases: readonly PurchaseRecord[], notes: readonly ReceiptNote[]): Map<string, { received: number; pending: number }> {
  const open = new Map(purchaseOrderOutstanding(orders, purchases, notes, '9999-12-31').map((r) => [r.lineId, r]));
  const out = new Map<string, { received: number; pending: number }>();
  for (const po of orders) {
    for (const l of po?.lines ?? []) {
      const r = open.get(l.id);
      const ordered = num(l.quantity);
      if (r) out.set(l.id, { received: r.received, pending: r.pending });
      // Not outstanding: fully received, or the PO is closed (then count what the bills / GRNs say is unknown → 0 pending).
      else out.set(l.id, { received: po.closed_on ? 0 : ordered, pending: 0 });
    }
  }
  return out;
}

/**
 * Open sales-order lines waiting on goods: short of free stock, or with a back-to-back PO line still
 * open. Status: no PO yet / on order / arrived (linked POs received at least the short quantity).
 */
export function backorderRows(input: {
  invoices: readonly InvoiceRecord[]; links: readonly LinkLike[]; orders: readonly PurchaseOrder[];
  purchases: readonly PurchaseRecord[]; notes: readonly ReceiptNote[]; free?: FreeStockFn;
}): BackorderRow[] {
  const index = buildOrderIndex(input.invoices, input.links);
  const progress = poLineProgress(input.orders, input.purchases, input.notes);
  const rows: BackorderRow[] = [];
  for (const so of input.invoices) {
    if (so.doc_type !== 'SALES_ORDER' || so.status === 'Draft' || so.status === 'Cancelled') continue;
    const f = fulfilmentFromIndex(so, index);
    if (f.state !== 'Open' && f.state !== 'Partly fulfilled') continue;
    const linked = input.orders.filter((po) => po?.so_id === so.id);
    for (const l of f.lines) {
      if (l.pendingDelivery <= EPS) continue;
      const factor = lineFactor(l.item);
      const stock = input.free?.(l.item);
      const free = stock ? Math.max(roundQty(stock.qty / factor), 0) : 0;
      const pos: LinkedPoLine[] = [];
      for (const po of linked) {
        for (const pl of po.lines ?? []) {
          if (pl.so_line_id !== l.item.id) continue;
          const pr = progress.get(pl.id) ?? { received: 0, pending: num(pl.quantity) };
          pos.push({ poId: po.id, number: po.po_number, vendor: po.vendor_name, expected: po.expected_date ?? '', ordered: num(pl.quantity), received: pr.received, pending: pr.pending, closed: !!po.closed_on });
        }
      }
      const short = Math.max(roundQty(l.pendingDelivery - free), 0);
      const openPo = pos.some((p) => !p.closed && p.pending > EPS);
      if (short <= EPS && !openPo) continue;
      // A line that is not a stock item (a service) only waits when a PO was raised for it.
      if (!stock && !pos.length && input.free) continue;
      // Arrived: free stock now covers the line, or every linked PO line is received / closed.
      const arrived = pos.length > 0 && (short <= EPS || !openPo);
      rows.push({
        orderId: so.id, orderNumber: so.invoice_number, party: so.client?.name ?? '', due: (so.due_date ?? '').slice(0, 10),
        lineId: l.item.id, item: l.item.name, unit: l.item.unit ?? '', pendingDelivery: l.pendingDelivery, free, short, pos,
        status: arrived ? 'arrived' : pos.length ? 'on_order' : 'awaiting_po',
      });
    }
  }
  return rows.sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || a.orderNumber.localeCompare(b.orderNumber, undefined, { numeric: true }));
}

/** Back-to-back POs of a sales order that are still open (warning before cancelling the order). */
export function openLinkedPos(soId: string, orders: readonly PurchaseOrder[], purchases: readonly PurchaseRecord[], notes: readonly ReceiptNote[]): PurchaseOrder[] {
  const linked = orders.filter((po) => po?.so_id === soId && !po.closed_on);
  if (!linked.length) return [];
  const progress = poLineProgress(linked, purchases, notes);
  return linked.filter((po) => (po.lines ?? []).some((l) => (progress.get(l.id)?.pending ?? 0) > EPS));
}

/* ── Storage ────────────────────────────────────────────────────── */

/** Save the POs (one per supplier) in one step; numbering through the PO series (`PO/FY…`). */
export function createBackToBackPos(drafts: readonly PoDraft[]): PurchaseOrder[] {
  if (!drafts.length) throw new Error('Nothing to order: every picked line has a quantity of zero.');
  return withTablesRollback([PURCHASE_ORDERS_TABLE, SERIES_TABLE], () => drafts.map((d) => purchaseOrdersDb.save(d)));
}

/** Live free stock (godown-aware) and last supplier of stock items, for the dialog and the backorder view. */
export function liveStockFns(): { free: FreeStockFn; lastSupplier: LastSupplierFn } {
  const positions = loadPositions();
  const index = buildItemIndex(positions.map((p) => p.item).filter((i) => i.track_stock));
  const byId = new Map(positions.map((p) => [p.item.id, p]));
  let tracking: ReturnType<typeof loadTracking> | null = null;
  const free: FreeStockFn = (line) => {
    const it = index.find(line.name, line.hsn);
    const p = it && byId.get(it.id);
    if (!p) return undefined;
    if (line.godown_id) {
      tracking ??= loadTracking();
      return { itemId: p.item.id, qty: tracking.get(p.item.id)?.byGodown[line.godown_id] ?? 0 };
    }
    return { itemId: p.item.id, qty: p.qty };
  };
  const vendors = getTable<{ id: string; name: string }>('vendors');
  const lastSupplier: LastSupplierFn = (itemId) => {
    const p = byId.get(itemId);
    if (!p) return undefined;
    for (let i = p.ledger.length - 1; i >= 0; i--) {
      const r = p.ledger[i];
      if (r.kind === 'purchase' && r.party) {
        const v = vendors.find((x) => x.name.trim().toLowerCase() === String(r.party).trim().toLowerCase());
        return { vendor_name: r.party, ...(v ? { vendor_id: v.id } : {}), rate: r.rate };
      }
    }
    return undefined;
  };
  return { free, lastSupplier };
}

/** Live: open back-to-back POs of a sales order. */
export function loadOpenLinkedPos(soId: string): PurchaseOrder[] {
  return openLinkedPos(soId, getTable<PurchaseOrder>(PURCHASE_ORDERS_TABLE), getTable<PurchaseRecord>('purchases'), getTable<ReceiptNote>('receipt_notes'));
}
