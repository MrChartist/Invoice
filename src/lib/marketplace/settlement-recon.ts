/**
 * Per-order settlement reconciliation (R5-A4.4): for each order of a channel — invoice value (the A3 document), sale
 * settled, fees, TCS, TDS, net received, settled % = net ÷ invoice value — and a status:
 *  - `refunded`  a refund line or a credit note for the order;
 *  - `settled`   paid, within the tolerance of what was expected;
 *  - `short`     sale settled or net received below expectation by more than the tolerance;
 *  - `excess_fee` fees above the channel's expected fee % (per item group, typed once);
 *  - `unsettled` no settlement line and the invoice is older than the payout cycle + 7 days;
 *  - `pending`   no settlement line yet, still inside the cycle.
 * Pure; the CSV export goes through the shared formula-injection guard (`toCsv`).
 */
import type { InvoiceRecord } from '../../types/invoice';
import type { SalesChannel, Settlement, SettlementBucket } from '../../types/marketplace-r5';
import { num, round2 } from '../invoice-calc';
import { shiftDay } from '../dates';
import { toCsv } from '../csv';
import { DEFAULT_PAYOUT_CYCLE, expectedFeePct } from './channels';
import { FEE_BUCKETS } from './settlement-import';

export type OrderStatus = 'settled' | 'short' | 'unsettled' | 'refunded' | 'excess_fee' | 'pending';

export const ORDER_STATUSES: readonly OrderStatus[] = ['settled', 'short', 'excess_fee', 'unsettled', 'refunded', 'pending'];

export interface OrderRecon {
  order_id: string;
  doc_id?: string;
  number: string;
  date: string;
  invoice_value: number;
  sale: number;
  refund: number;
  fees: number;
  gst_on_fees: number;
  tcs: number;
  tds: number;
  other: number;
  net: number;
  /** net ÷ invoice value × 100 (null without an invoice). */
  settled_pct: number | null;
  fee_pct: number | null;
  status: OrderStatus;
  settlement_ids: string[];
}

export interface ReconOptions {
  today: string;
  /** Rupee tolerance (default ₹1). */
  tolerance?: number;
  /** Stock group of a document's first item (for per-group expected fee %). */
  groupOf?: (doc: InvoiceRecord) => string | undefined;
}

const FEES = new Set<SettlementBucket>(FEE_BUCKETS);

export function reconcileOrders(channel: SalesChannel, docs: readonly InvoiceRecord[], settlements: readonly Settlement[], opts: ReconOptions): OrderRecon[] {
  const tol = opts.tolerance ?? 1;
  const cycle = channel.payout_cycle_days ?? DEFAULT_PAYOUT_CYCLE;
  const byOrder = new Map<string, OrderRecon>();
  const keyOf = (s: string) => s.trim().toLowerCase();
  const get = (orderId: string): OrderRecon => {
    const k = keyOf(orderId);
    let r = byOrder.get(k);
    if (!r) {
      r = { order_id: orderId, number: '', date: '', invoice_value: 0, sale: 0, refund: 0, fees: 0, gst_on_fees: 0, tcs: 0, tds: 0, other: 0, net: 0, settled_pct: null, fee_pct: null, status: 'pending', settlement_ids: [] };
      byOrder.set(k, r);
    }
    return r;
  };
  const credited = new Set<string>();
  const saleDoc = new Map<string, InvoiceRecord>();
  for (const d of docs) {
    if (d.channel_id !== channel.id || !d.channel_order_id || d.status === 'Cancelled' || d.status === 'Draft' || d.channel_order_id.startsWith('SUMMARY:')) continue;
    if (d.doc_type === 'CREDIT_NOTE') {
      credited.add(keyOf(d.channel_order_id));
      continue;
    }
    const r = get(d.channel_order_id);
    r.doc_id = d.id;
    r.number = d.invoice_number;
    r.date = d.issue_date;
    r.invoice_value = round2(r.invoice_value + num(d.total));
    saleDoc.set(keyOf(d.channel_order_id), d);
  }
  for (const s of settlements) {
    if (s.channel_id !== channel.id) continue;
    for (const l of s.lines) {
      if (!l.order_id) continue;
      const r = get(l.order_id);
      if (!r.settlement_ids.includes(s.id)) r.settlement_ids.push(s.id);
      const a = l.amount;
      if (l.bucket === 'sale' || l.bucket === 'shipping_recovered') r.sale = round2(r.sale + a);
      else if (l.bucket === 'refund') r.refund = round2(r.refund - a);
      else if (FEES.has(l.bucket)) r.fees = round2(r.fees - a);
      else if (l.bucket === 'gst_on_fees') r.gst_on_fees = round2(r.gst_on_fees - a);
      else if (l.bucket === 'tcs') r.tcs = round2(r.tcs - a);
      else if (l.bucket === 'tds_194o') r.tds = round2(r.tds - a);
      else r.other = round2(r.other + a);
      r.net = round2(r.net + a);
    }
  }
  for (const [k, r] of byOrder) {
    const doc = saleDoc.get(k);
    r.settled_pct = r.invoice_value > 0 ? round2((r.net / r.invoice_value) * 100) : null;
    r.fee_pct = r.invoice_value > 0 ? round2(((r.fees + r.gst_on_fees) / r.invoice_value) * 100) : null;
    const expectedPct = expectedFeePct(channel, doc && opts.groupOf ? opts.groupOf(doc) : undefined);
    if (credited.has(k) || r.refund > 0) r.status = 'refunded';
    else if (!r.settlement_ids.length) r.status = r.date && shiftDay(r.date, cycle + 7) < opts.today ? 'unsettled' : 'pending';
    else if (expectedPct !== undefined && r.fee_pct !== null && r.fee_pct > expectedPct + 0.5) r.status = 'excess_fee';
    else if (r.invoice_value > 0 && (r.sale < r.invoice_value - tol || (expectedPct !== undefined && r.net < r.invoice_value * (1 - expectedPct / 100) - r.tcs - r.tds - tol))) r.status = 'short';
    else r.status = 'settled';
  }
  return [...byOrder.values()].sort((a, b) => (a.date || '9') .localeCompare(b.date || '9') || a.order_id.localeCompare(b.order_id));
}

export function statusCounts(rows: readonly OrderRecon[]): Record<OrderStatus, number> {
  const out = Object.fromEntries(ORDER_STATUSES.map((s) => [s, 0])) as Record<OrderStatus, number>;
  for (const r of rows) out[r.status]++;
  return out;
}

/** CSV of the order view (text cells neutralised against formula injection). */
export function orderReconCsv(rows: readonly OrderRecon[]): string {
  return toCsv([
    ['Order id', 'Document', 'Date', 'Invoice value', 'Sale settled', 'Refund', 'Fees', 'GST on fees', 'TCS', 'TDS 194-O', 'Other', 'Net received', 'Settled %', 'Status'],
    ...rows.map((r) => [r.order_id, r.number, r.date, r.invoice_value, r.sale, r.refund, r.fees, r.gst_on_fees, r.tcs, r.tds, r.other, r.net, r.settled_pct ?? '', r.status]),
  ]);
}
