/**
 * Stock event source for WP-3 (purchase returns, receipt notes, rejections out). Registered in
 * `collectEvents` (inventory.ts) with one call; the inventory engine itself is unchanged.
 *
 *  - Receipt note (GRN): goods IN on the GRN date. Valued at the rate of the bill lines that bill it
 *    (weighted), else the GRN's own rate. A bill line with `grn_line_id` does not bring those goods in
 *    again (`grnCoverage` — up to the GRN line's accepted quantity; any excess on the bill still
 *    comes in on the bill).
 *  - Rejection out: goods OUT on its date (kind `adjustment`, so it is neither a sale nor COGS).
 *  - Purchase return / supplier note with goods: goods OUT on the note date (kind `adjustment`), from
 *    the bill line's godown and batch. Value-only notes move no stock.
 *  - WP-8: quantities are converted to the item's base unit (`unit_factor` of the GRN / bill line, see
 *    units.ts) and a line's picked `item_id` wins over name + HSN matching.
 *
 * Pure apart from `loadReturnStockDocs` (storage read, used by `liveInputs`).
 */

import type { PurchaseReturn, ReceiptNote } from '../types/purchases';
import type { ItemIndex, PurchaseLike, StockEvent, StockItem } from './inventory';
import { num, round2 } from './invoice-calc';
import { isVoidStatus, readPurchase, readPurchaseLines } from './purchase-normalize';
import { getTable } from './storage';
import { lineFactor } from './units';

export interface ReturnStockDocs {
  notes: readonly PurchaseReturn[];
  receipts: readonly ReceiptNote[];
}

type Push = (itemId: string, ev: Omit<StockEvent, 'seq' | 'rank' | 'godown'> & { godown?: string }) => void;

const day = (d: unknown) => String(d ?? '').slice(0, 10);

export function loadReturnStockDocs(): ReturnStockDocs {
  return { notes: getTable<PurchaseReturn>('purchase_returns'), receipts: getTable<ReceiptNote>('receipt_notes') };
}

/** Accepted quantity (received − rejected) per GRN line id. */
function acceptedByGrnLine(receipts: readonly ReceiptNote[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const g of receipts) {
    if (g?.kind !== 'GRN') continue;
    for (const l of g.lines ?? []) if (l?.id && num(l.quantity) > 0) out.set(l.id, (out.get(l.id) ?? 0) + num(l.quantity) * lineFactor(l));
  }
  for (const r of receipts) {
    if (r?.kind !== 'REJECTION_OUT') continue;
    for (const l of r.lines ?? []) if (l?.grn_line_id && out.has(l.grn_line_id)) out.set(l.grn_line_id, Math.max((out.get(l.grn_line_id) ?? 0) - Math.max(num(l.quantity), 0) * lineFactor(l), 0));
  }
  return out;
}

/**
 * How much of a bill line's quantity (base units) a live GRN already brought in. `take(lineId, qty)` returns the
 * covered part and consumes it, so two bill lines cannot both skip the same goods.
 */
export function grnCoverage(docs?: ReturnStockDocs): { take(grnLineId: string, qty: number): number } {
  const left = docs ? acceptedByGrnLine(docs.receipts) : new Map<string, number>();
  return {
    take(grnLineId, qty) {
      if (!grnLineId || !left.size) return 0;
      const cap = left.get(grnLineId) ?? 0;
      const used = Math.min(Math.max(qty, 0), cap);
      if (used > 0) left.set(grnLineId, cap - used);
      return used;
    },
  };
}

/** Weighted unit cost of the live bill lines that bill each GRN line. */
function billRates(purchases: readonly PurchaseLike[]): Map<string, number> {
  const acc = new Map<string, { q: number; v: number }>();
  for (const p of purchases) {
    const b = readPurchase(p);
    if (!b || isVoidStatus(b.status) || b.isExpense) continue;
    for (const l of readPurchaseLines(p)) {
      if (!l.grnLineId || !(l.quantity > 0)) continue;
      const a = acc.get(l.grnLineId) ?? { q: 0, v: 0 };
      a.q += l.quantity * l.unitFactor; // per base unit
      a.v += l.quantity * (l.unitCost + l.landedUnit);
      acc.set(l.grnLineId, a);
    }
  }
  return new Map([...acc].map(([k, a]) => [k, a.q > 0 ? a.v / a.q : 0]));
}

/** Push every WP-3 stock event (GRN in, rejection out, purchase return out). */
export function returnStockEvents(
  docs: ReturnStockDocs | undefined, purchases: readonly PurchaseLike[], index: ItemIndex, push: Push,
  /** WP-8: tracked stock item by id, for lines that carry the picked `item_id`. */
  byId?: (id: string) => StockItem | undefined,
): void {
  if (!docs) return;
  const find = (l: { name: string; hsn?: string; item_id?: string }) => (l.item_id && byId?.(l.item_id)) || index.find(l.name, l.hsn);
  const rates = docs.receipts.length ? billRates(purchases) : new Map<string, number>();
  const grnNumber = new Map(docs.receipts.filter((g) => g?.kind === 'GRN').map((g) => [g.id, g.number]));
  for (const g of docs.receipts) {
    if (!g || !day(g.date)) continue;
    const isGrn = g.kind === 'GRN';
    const party = g.vendor_name ? ` · ${g.vendor_name}` : '';
    for (const l of g.lines ?? []) {
      const it = find(l);
      const factor = lineFactor(l);
      const q = num(l.quantity) * factor;
      if (!it || !(q > 0)) continue;
      const base = { date: day(g.date), refType: isGrn ? 'grn' : 'rejection_out', refId: g.id, refNumber: g.number, party: g.vendor_name, godown: l.godown_id, batch: l.batch_no || undefined };
      if (isGrn) {
        const billed = rates.get(l.id);
        push(it.id, { ...base, kind: 'purchase', qty: q, rate: billed && billed > 0 ? billed : num(l.rate) / factor, particulars: `Receipt note: ${g.number}${party}`, mfg: l.mfg_date || undefined, expiry: l.expiry_date || undefined });
      } else {
        const from = g.grn_id ? grnNumber.get(g.grn_id) : undefined;
        push(it.id, { ...base, kind: 'adjustment', qty: -q, particulars: `Rejection out: ${g.number}${from ? ` (${from})` : ''}${party}` });
      }
    }
  }
  // A returned line is in its bill line's unit: convert with that line's factor (and use its item).
  const billLine = new Map<string, { item_id?: string; unit_factor?: number }>();
  if (docs.notes.length) {
    for (const p of purchases) for (const l of ((p as { lines?: unknown }).lines as { id?: string; item_id?: string; unit_factor?: number }[] | undefined) ?? []) if (l?.id) billLine.set(l.id, l);
  }
  for (const n of docs.notes) {
    if (!n || !n.goods_returned || !day(n.date) || !(num(n.total) > 0)) continue;
    const party = n.vendor_name ? ` · ${n.vendor_name}` : '';
    for (const l of n.lines ?? []) {
      const src = l.bill_line_id ? billLine.get(l.bill_line_id) : undefined;
      const factor = lineFactor(src);
      const it = find({ name: l.name, hsn: l.hsn, item_id: src?.item_id });
      const q = round2(num(l.quantity)) * factor;
      if (!it || !(q > 0)) continue;
      push(it.id, {
        date: day(n.date),
        kind: 'adjustment',
        qty: -q,
        saleRate: num(l.rate) / factor,
        particulars: `Purchase return: ${n.note_number}${n.bill_number ? ` (bill ${n.bill_number})` : ''}${party}`,
        refType: 'purchase_return',
        refId: n.id,
        refNumber: n.note_number,
        party: n.vendor_name,
        godown: l.godown_id,
        batch: l.batch_no || undefined,
        serials: l.serials?.length ? l.serials : undefined,
      });
    }
  }
}
