/**
 * QA8 T15: the save gate for agency lines (TR-C1). An issued sale may not sell more of a principal's lot than the lot
 * still holds (after every other live sale, credit notes that return goods counting back), nor sell a cancelled or
 * missing lot — whose sales could never be settled on a bikri patti. Runs with the stock checks
 * (`liveDocTrackingIssues`), so the editor, POS, recurring and batch runs all stop on it; the owner may override in
 * the editor with a reason (audited). Pure; no heavy imports (it rides in the stock-tracking chunk).
 */
import type { InvoiceRecord } from '../../types/invoice';
import type { Arrival } from '../../types/trade-r8';

const SOLD = new Set(['INVOICE', 'TAX_INVOICE', 'BILL_OF_SUPPLY']);
const q3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000 || 0;
const qty = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

type Doc = Pick<InvoiceRecord, 'doc_type' | 'items'> & Partial<Pick<InvoiceRecord, 'id'>>;
type Other = Pick<InvoiceRecord, 'id' | 'doc_type' | 'status' | 'items'> & Partial<Pick<InvoiceRecord, 'goods_returned'>>;

/** Lot problems of `doc` ('' free list when fine). `invoices` = every stored document (the doc's own copy is skipped). */
export function lotIssues(doc: Doc, invoices: readonly Other[], arrivals: readonly Pick<Arrival, 'id' | 'number' | 'lot_no' | 'qty' | 'unit' | 'status'>[]): string[] {
  if (!SOLD.has(doc.doc_type ?? 'INVOICE')) return [];
  const need = new Map<string, number>();
  for (const l of doc.items ?? []) if (l?.arrival_id && qty(l.quantity) > 0) need.set(l.arrival_id, (need.get(l.arrival_id) ?? 0) + qty(l.quantity));
  if (!need.size) return [];
  const sold = new Map<string, number>();
  for (const inv of invoices) {
    if (!inv || inv.id === doc.id || inv.status === 'Draft' || inv.status === 'Cancelled') continue;
    const t = inv.doc_type ?? 'INVOICE';
    const sign = SOLD.has(t) ? 1 : t === 'CREDIT_NOTE' && inv.goods_returned !== false ? -1 : 0;
    if (sign) for (const l of inv.items ?? []) if (l?.arrival_id && need.has(l.arrival_id)) sold.set(l.arrival_id, (sold.get(l.arrival_id) ?? 0) + sign * qty(l.quantity));
  }
  const out: string[] = [];
  for (const [id, q] of need) {
    const a = arrivals.find((x) => x.id === id);
    if (!a) out.push('An agency line names a lot that no longer exists.');
    else if (a.status === 'cancelled') out.push(`Lot ${a.lot_no} (${a.number}) is cancelled: its sales could never be settled on a bikri patti.`);
    else {
      const left = q3(qty(a.qty) - (sold.get(id) ?? 0));
      if (q > left + 1e-9) out.push(`Lot ${a.lot_no} (${a.number}): only ${left} ${a.unit} left to sell; this document sells ${q3(q)}.`);
    }
  }
  return out;
}
