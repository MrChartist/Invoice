/**
 * Purchase orders — table `purchase_orders` (`PurchaseOrder`, src/types/purchases.ts).
 *
 * A PO is a request to a supplier, not a tax or books document: GST, ITC, books and stock
 * only move when the supplier's bill is recorded. "Convert to bill" pre-fills the bill form
 * with the quantity still to receive; the saved bill carries `po_id` and each line
 * `po_line_id`, so received quantity is always derived from the bills (edit or delete a bill
 * and the PO follows). Numbering: `PO/FY<yy-yy>/<seq>` per Indian financial year.
 *
 * Everything above the "Storage" divider is pure and unit-tested.
 */

import type { PurchaseLine, PurchaseOrder, PurchaseOrderLine, PurchaseRecord } from '../types/purchases';
import { buildInvoiceNumber, getIndianFY, highestSequence } from './invoice-number';
import { num, round2 } from './invoice-calc';
import { generateId, getTable, setTable } from './storage';
import { computePurchaseTotals } from './purchases';
import { formatCurrency, formatDate } from './utils';
import { nextSeriesNumberFor, numberFitsFy, recordSeries } from './series-counters';
import { audit } from './audit';
import { requireAccess } from './access';

export const PURCHASE_ORDERS_TABLE = 'purchase_orders';
export const PO_PREFIX = 'PO';

export type PoState = 'Open' | 'Partly received' | 'Received' | 'Closed';
export const PO_STATES: PoState[] = ['Open', 'Partly received', 'Received', 'Closed'];

// ── Pure ─────────────────────────────────────────────────────────

/** Next `PO/FY<yy-yy>/<seq>` for a PO dated `date` (highest issued + 1, so deletes never reuse a number). */
export function nextPoNumber(existing: readonly string[], date?: string): string {
  const fy = getIndianFY(date).label;
  return buildInvoiceNumber(PO_PREFIX, fy, highestSequence([...existing], PO_PREFIX, fy) + 1);
}

export interface PoLineStatus {
  line: PurchaseOrderLine;
  ordered: number;
  received: number;
  pending: number;
}

export interface PoFulfilment {
  lines: PoLineStatus[];
  state: PoState;
  /** Bills recorded against this PO. */
  bills: PurchaseRecord[];
}

const EPS = 1e-6;

/** Pure: received vs ordered per line, from the bills whose `po_id` is this PO. */
export function poFulfilment(po: PurchaseOrder, purchases: readonly PurchaseRecord[]): PoFulfilment {
  const bills = purchases.filter((p) => p.po_id === po.id);
  const received = new Map<string, number>();
  for (const b of bills) {
    for (const l of b.lines ?? []) {
      if (!l.po_line_id) continue;
      received.set(l.po_line_id, round2((received.get(l.po_line_id) ?? 0) + num(l.quantity)));
    }
  }
  const lines = (po.lines ?? [])
    .filter((l) => num(l.quantity) > 0)
    .map((line) => {
      const ordered = num(line.quantity);
      const got = received.get(line.id) ?? 0;
      return { line, ordered, received: got, pending: Math.max(0, round2(ordered - got)) };
    });
  const done = lines.length > 0 && lines.every((l) => l.pending <= EPS);
  const started = lines.some((l) => l.received > EPS);
  const state: PoState = done ? 'Received' : po.closed_on ? 'Closed' : started ? 'Partly received' : 'Open';
  return { lines, state, bills };
}

export function poTone(state: PoState): 'sent' | 'partial' | 'paid' | 'cancelled' {
  return state === 'Received' ? 'paid' : state === 'Partly received' ? 'partial' : state === 'Closed' ? 'cancelled' : 'sent';
}

/** Why a PO cannot be billed any further, or null. */
export function poConversionBlocked(f: PoFulfilment): string | null {
  if (f.state === 'Closed') return 'This purchase order is closed. Reopen it to record more bills against it.';
  if (f.state === 'Received') return 'Everything on this purchase order has been received.';
  return null;
}

/** Bill fields "Convert to bill" pre-fills: vendor, place of supply and only the quantity still pending. */
export type BillSeed = Pick<PurchaseRecord, 'po_id' | 'vendor_id' | 'vendor_name' | 'vendor_gstin' | 'place_of_supply' | 'lines' | 'notes'>;

export function billSeedFromPo(po: PurchaseOrder, purchases: readonly PurchaseRecord[]): BillSeed {
  const f = poFulfilment(po, purchases);
  const blocked = poConversionBlocked(f);
  if (blocked) throw new Error(blocked);
  const lines: PurchaseLine[] = f.lines
    .filter((l) => l.pending > EPS)
    .map((l) => ({
      id: generateId(),
      name: l.line.name,
      hsn: l.line.hsn,
      unit: l.line.unit,
      quantity: l.pending,
      rate: num(l.line.rate),
      tax_rate: num(l.line.tax_rate),
      po_line_id: l.line.id,
      ...(l.line.item_id ? { item_id: l.line.item_id } : {}),
      ...(l.line.unit_factor ? { unit_factor: l.line.unit_factor } : {}),
    }));
  return {
    po_id: po.id,
    vendor_id: po.vendor_id,
    vendor_name: po.vendor_name,
    vendor_gstin: po.vendor_gstin,
    place_of_supply: po.place_of_supply,
    lines,
    notes: `Against purchase order ${po.po_number}`,
  };
}

/** Validates a PO draft; returns an error message or ''. */
export function validatePo(po: Pick<PurchaseOrder, 'vendor_name' | 'date' | 'expected_date' | 'lines'>): string {
  if (!po.vendor_name?.trim()) return 'Choose or create a vendor.';
  if (!po.date) return 'Choose the order date.';
  if (po.expected_date && po.expected_date < po.date) return 'Expected date cannot be before the order date.';
  const real = (po.lines ?? []).filter((l) => l.name.trim() || num(l.rate) > 0);
  if (real.length === 0) return 'Add at least one line.';
  if (real.some((l) => !l.name.trim())) return 'Every line needs an item name.';
  if (real.some((l) => num(l.quantity) <= 0)) return 'Every line needs a quantity above zero.';
  return '';
}

/** Totals for a PO's lines (same GST split as a bill: CGST+SGST inside the business's state, else IGST). */
export function poTotals(lines: PurchaseOrderLine[], placeOfSupply?: string, businessState?: string) {
  return computePurchaseTotals(lines, { placeOfSupply, businessState });
}

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

export interface PoBuyer {
  name: string;
  gstin?: string;
  address?: string;
  phone?: string;
  email?: string;
}

/** A complete, script-free HTML purchase order for printing or saving (every value escaped). */
export function poHtml(po: PurchaseOrder, buyer: PoBuyer, vendor?: { address?: string; phone?: string; email?: string }): string {
  const money = (n: number) => esc(formatCurrency(n));
  const rows = (po.lines ?? [])
    .map(
      (l, i) => `<tr><td>${i + 1}</td><td>${esc(l.name)}</td><td>${esc(l.hsn ?? '')}</td>
<td class="n">${esc(num(l.quantity))} ${esc(l.unit ?? '')}</td><td class="n">${money(num(l.rate))}</td>
<td class="n">${esc(num(l.tax_rate))}%</td><td class="n">${money(round2(num(l.quantity) * num(l.rate)))}</td></tr>`,
    )
    .join('');
  const igst = num(po.igst) > 0;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Purchase order ${esc(po.po_number)}</title>
<style>
  body { font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; color: #111; margin: 0; padding: 32px; }
  .sheet { max-width: 760px; margin: 0 auto; border: 1px solid #ccc; padding: 28px 32px; }
  h1 { font-size: 20px; letter-spacing: 0.08em; text-transform: uppercase; margin: 0 0 4px; }
  .muted { color: #555; font-size: 13px; }
  .head { display: flex; justify-content: space-between; gap: 16px; border-bottom: 2px solid #111; padding-bottom: 12px; margin-bottom: 16px; }
  .parties { display: flex; justify-content: space-between; gap: 24px; margin-bottom: 16px; font-size: 14px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { border-bottom: 1px solid #ddd; padding: 6px 4px; text-align: left; vertical-align: top; }
  th { color: #555; font-weight: 600; }
  .n { text-align: right; font-variant-numeric: tabular-nums; }
  .totals { margin-left: auto; width: 280px; margin-top: 12px; font-size: 14px; }
  .totals div { display: flex; justify-content: space-between; padding: 3px 0; }
  .grand { font-weight: 700; border-top: 2px solid #111; margin-top: 4px; padding-top: 6px !important; }
  .sign { margin-top: 48px; text-align: right; font-size: 13px; }
  @media print { body { padding: 0; } .sheet { border: 0; } }
</style></head>
<body><div class="sheet">
  <div class="head">
    <div><h1>Purchase order</h1><div class="muted">${esc(po.po_number)} · ${esc(formatDate(po.date))}</div>
      ${po.expected_date ? `<div class="muted">Expected by ${esc(formatDate(po.expected_date))}</div>` : ''}</div>
    <div style="text-align:right"><strong>${esc(buyer.name)}</strong>
      ${buyer.gstin ? `<div class="muted">GSTIN ${esc(buyer.gstin)}</div>` : ''}
      ${buyer.address ? `<div class="muted">${esc(buyer.address).replace(/\n/g, '<br>')}</div>` : ''}
      ${buyer.phone ? `<div class="muted">${esc(buyer.phone)}</div>` : ''}
      ${buyer.email ? `<div class="muted">${esc(buyer.email)}</div>` : ''}</div>
  </div>
  <div class="parties"><div><div class="muted">To (supplier)</div><strong>${esc(po.vendor_name)}</strong>
    ${po.vendor_gstin ? `<div class="muted">GSTIN ${esc(po.vendor_gstin)}</div>` : ''}
    ${vendor?.address ? `<div class="muted">${esc(vendor.address).replace(/\n/g, '<br>')}</div>` : ''}
    ${vendor?.phone ? `<div class="muted">${esc(vendor.phone)}</div>` : ''}</div></div>
  <table><thead><tr><th>#</th><th>Item</th><th>HSN/SAC</th><th class="n">Qty</th><th class="n">Rate</th><th class="n">GST</th><th class="n">Amount</th></tr></thead>
  <tbody>${rows}</tbody></table>
  <div class="totals">
    <div><span>Taxable value</span><span>${money(num(po.taxable))}</span></div>
    ${igst ? `<div><span>IGST</span><span>${money(num(po.igst))}</span></div>` : `<div><span>CGST</span><span>${money(num(po.cgst))}</span></div><div><span>SGST</span><span>${money(num(po.sgst))}</span></div>`}
    <div class="grand"><span>Total</span><span>${money(num(po.total))}</span></div>
  </div>
  ${po.notes ? `<p class="muted" style="margin-top:16px">${esc(po.notes).replace(/\n/g, '<br>')}</p>` : ''}
  <div class="sign">For ${esc(buyer.name)}<br><br><br>Authorised signatory</div>
</div></body></html>`;
}

// ── Storage ──────────────────────────────────────────────────────

const now = () => new Date().toISOString();

function logPo(id: string, action: 'create' | 'update' | 'delete', number: string, summary: string): void {
  try {
    audit.record({ entity: 'purchase_order', entity_id: id, action, doc_number: number, summary });
  } catch {
    /* logging never breaks a save */
  }
}

export const purchaseOrdersDb = {
  all: (): PurchaseOrder[] => getTable<PurchaseOrder>(PURCHASE_ORDERS_TABLE),
  get: (id: string): PurchaseOrder | undefined => purchaseOrdersDb.all().find((p) => p.id === id),

  /** Above every existing number and the series high-water mark (a deleted latest number is not reused). */
  nextNumber: (date?: string): string => nextSeriesNumberFor(PO_PREFIX, date, purchaseOrdersDb.all().map((p) => p.po_number)),

  /** Insert or update (matched by id). A new PO without a number gets the next one in its FY. */
  save(input: Omit<PurchaseOrder, 'id' | 'po_number'> & { id?: string; po_number?: string }): PurchaseOrder {
    requireAccess('books.edit');
    const rows = purchaseOrdersDb.all();
    const existing = input.id ? rows.find((r) => r.id === input.id) : undefined;
    const asked = (input.po_number ?? '').trim();
    // An edit that moves the date into another FY takes a number from that FY's series.
    const keep = existing && numberFitsFy(existing.po_number, input.date) ? existing.po_number : '';
    const number = (asked && asked !== existing?.po_number ? asked : '') || keep || purchaseOrdersDb.nextNumber(input.date);
    if (rows.some((r) => r.id !== existing?.id && r.po_number.toUpperCase() === number.toUpperCase())) {
      throw new Error(`Purchase order number ${number} is already used.`);
    }
    const record: PurchaseOrder = {
      ...existing,
      ...input,
      id: existing?.id ?? input.id ?? generateId(),
      po_number: number,
      created_at: existing?.created_at ?? now(),
      updated_at: now(),
    };
    setTable(PURCHASE_ORDERS_TABLE, existing ? rows.map((r) => (r.id === record.id ? record : r)) : [...rows, record]);
    recordSeries(number);
    logPo(record.id, existing ? 'update' : 'create', number, `${existing ? 'Edited' : 'Created'} purchase order ${number} to ${record.vendor_name}${existing && existing.po_number !== number ? ` (was ${existing.po_number})` : ''}`);
    return record;
  },

  /** Close (on `closedOn`, yyyy-mm-dd) or reopen (`undefined`) an order. */
  setClosed(id: string, closedOn: string | undefined): void {
    requireAccess('books.edit');
    const rows = purchaseOrdersDb.all();
    const po = rows.find((r) => r.id === id);
    if (po) logPo(id, 'update', po.po_number, `Purchase order ${po.po_number} ${closedOn ? `closed on ${closedOn}` : 'reopened'}`);
    setTable(
      PURCHASE_ORDERS_TABLE,
      rows.map((r) => {
        if (r.id !== id) return r;
        const next: PurchaseOrder = { ...r, updated_at: now() };
        if (closedOn) next.closed_on = closedOn;
        else delete next.closed_on;
        return next;
      }),
    );
  },

  /** Delete an order. Refused once a bill is recorded against it (close it instead). */
  remove(id: string, purchases: readonly PurchaseRecord[]): void {
    if (purchases.some((p) => p.po_id === id)) {
      throw new Error('Bills are recorded against this purchase order. Close it instead of deleting it.');
    }
    requireAccess('books.edit');
    const po = purchaseOrdersDb.get(id);
    setTable(PURCHASE_ORDERS_TABLE, purchaseOrdersDb.all().filter((p) => p.id !== id));
    if (po) logPo(id, 'delete', po.po_number, `Deleted purchase order ${po.po_number} (the number is not reused)`);
  },
};
