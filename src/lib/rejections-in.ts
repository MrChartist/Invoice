/**
 * Rejections In (P1-8, Tally "Rejections In"): a customer rejects goods sent on a delivery challan BEFORE the
 * challan is invoiced. Table `rejections_in`, numbered `RJI/FY<yy-yy>/<seq>`.
 *
 *  - Stock: the goods come back (kind `return` in `events-job-work.ts`) while the challan itself moves stock
 *    (Inventory setting "Delivery challans reduce stock"); otherwise the rejection only reduces the balance.
 *  - Challan balance: each line's quantity less what was rejected; converting the challan to an invoice bills
 *    only that balance (`documents.ts` reads `rejectedByLine`). A challan already invoiced takes a credit note.
 *  - Period lock, role (`books.edit`) and audit as for every dated voucher; numbers never reused.
 */

import type { RejectionIn } from '../types/job-work';
import type { InvoiceRecord } from '../types/invoice';
import { num } from './invoice-calc';
import { generateId, getTable, setTable } from './storage';
import { requireAccess } from './access';
import { assertUnlocked } from './period-lock';
import { audit } from './audit';
import { nextSeriesNumberFor, numberFitsFy, recordSeries } from './series-counters';

export const REJECTIONS_IN_TABLE = 'rejections_in';
export const REJECTION_IN_PREFIX = 'RJI';
const EPS = 1e-9;
const roundQty = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000 || 0;

type Challan = Pick<InvoiceRecord, 'id' | 'doc_type' | 'status' | 'invoice_number' | 'items'>;
type Link = { from_id: string; to_id: string; relation: string };

/** Quantity rejected per challan line id (in the challan line's unit), all rejections of the challan. */
export function rejectedByLine(rejections: readonly RejectionIn[], challanId: string, excludeId?: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rejections) {
    if (r?.challan_id !== challanId || r.id === excludeId) continue;
    for (const l of r.lines ?? []) if (l?.challan_line_id && num(l.quantity) > 0) out[l.challan_line_id] = roundQty((out[l.challan_line_id] ?? 0) + num(l.quantity));
  }
  return out;
}

export interface ChallanLineBalance {
  lineId: string;
  name: string;
  unit?: string;
  sent: number;
  rejected: number;
  balance: number;
}

/** Each challan line's quantity, what was rejected and the balance still with the customer. */
export function challanBalance(challan: Challan, rejections: readonly RejectionIn[], excludeId?: string): ChallanLineBalance[] {
  const rej = rejectedByLine(rejections, challan.id, excludeId);
  return (challan.items ?? []).filter((l) => num(l.quantity) > 0).map((l) => {
    const rejected = rej[l.id] ?? 0;
    return { lineId: l.id, name: l.name, ...(l.unit ? { unit: l.unit } : {}), sent: num(l.quantity), rejected, balance: roundQty(num(l.quantity) - rejected) };
  });
}

/** The live invoice made from this challan, if any (a rejection then needs a credit note instead). */
export function invoicedFrom(challanId: string, invoices: readonly Pick<InvoiceRecord, 'id' | 'doc_type' | 'status' | 'invoice_number'>[], links: readonly Link[]): string | undefined {
  for (const l of links) {
    if (l.relation !== 'converted' || l.from_id !== challanId) continue;
    const to = invoices.find((d) => d.id === l.to_id);
    if (to && to.status !== 'Cancelled' && to.status !== 'Draft' && to.doc_type !== 'DELIVERY_CHALLAN' && to.doc_type !== 'SALES_ORDER') return to.invoice_number || to.id;
  }
  return undefined;
}

/** Challans a rejection can be recorded against: live delivery challans not yet invoiced. */
export function openChallans<T extends Challan>(invoices: readonly T[], links: readonly Link[]): T[] {
  return invoices.filter((d) => d.doc_type === 'DELIVERY_CHALLAN' && d.status !== 'Draft' && d.status !== 'Cancelled' && !invoicedFrom(d.id, invoices, links));
}

/** Why the rejection cannot be saved, or ''. */
export function validateRejectionIn(r: Pick<RejectionIn, 'id' | 'date' | 'challan_id' | 'lines'>, challan: Challan | undefined, rejections: readonly RejectionIn[], invoices: readonly Pick<InvoiceRecord, 'id' | 'doc_type' | 'status' | 'invoice_number'>[], links: readonly Link[], challanDate?: string): string {
  if (!r.date) return 'Choose the date.';
  if (!challan || challan.doc_type !== 'DELIVERY_CHALLAN') return 'Choose the delivery challan.';
  if (challan.status === 'Draft' || challan.status === 'Cancelled') return `Challan ${challan.invoice_number} is ${challan.status === 'Draft' ? 'a draft' : 'cancelled'}.`;
  const inv = invoicedFrom(challan.id, invoices, links);
  if (inv) return `Challan ${challan.invoice_number} is already invoiced (${inv}): record the return as a credit note.`;
  if (challanDate && r.date < challanDate.slice(0, 10)) return 'A rejection cannot be dated before its challan.';
  const lines = (r.lines ?? []).filter((l) => num(l.quantity) > 0);
  if (!lines.length) return 'Enter the quantity rejected on at least one line.';
  const bal = new Map(challanBalance(challan, rejections, r.id).map((b) => [b.lineId, b]));
  for (const l of lines) {
    const b = bal.get(l.challan_line_id);
    if (!b) return `${l.name}: that line is not on the challan.`;
    if (num(l.quantity) > b.balance + EPS) return `${b.name}: only ${b.balance}${b.unit ? ` ${b.unit}` : ''} is left on the challan.`;
  }
  return '';
}

/* ── Storage ──────────────────────────────────────────────────── */

const now = () => new Date().toISOString();
const lockOf = (r: { id: string; date: string; number: string }) => ({ id: r.id, issue_date: r.date, invoice_number: r.number });

export const rejectionsInDb = {
  all: (): RejectionIn[] => getTable<RejectionIn>(REJECTIONS_IN_TABLE),
  nextNumber: (date?: string) => nextSeriesNumberFor(REJECTION_IN_PREFIX, date, rejectionsInDb.all().map((r) => r.number)),

  save(input: Omit<RejectionIn, 'id' | 'number'> & { id?: string; number?: string }): RejectionIn {
    requireAccess('books.edit');
    const invoices = getTable<InvoiceRecord>('invoices');
    const links = getTable<Link>('doc_links');
    const challan = invoices.find((d) => d.id === input.challan_id);
    const rows = rejectionsInDb.all();
    const draft = { ...input, lines: (input.lines ?? []).filter((l) => num(l.quantity) > 0).map((l) => ({ ...l, quantity: num(l.quantity) })) };
    const err = validateRejectionIn({ ...draft, id: input.id ?? '' }, challan, rows, invoices, links, challan?.issue_date);
    if (err) throw new Error(err);
    const existing = input.id ? rows.find((r) => r.id === input.id) : undefined;
    if (existing) assertUnlocked(lockOf(existing), 'edit');
    const kept = (input.number ?? '').trim() || existing?.number || '';
    const number = kept && numberFitsFy(kept, input.date) ? kept : nextSeriesNumberFor(REJECTION_IN_PREFIX, input.date, rows.map((r) => r.number));
    const id = existing?.id ?? input.id ?? generateId();
    const state = assertUnlocked(lockOf({ id, date: input.date, number }), existing ? 'edit' : 'create');
    const record: RejectionIn = {
      ...existing, ...draft, id, number, challan_number: challan?.invoice_number, client_name: challan?.client?.name || draft.client_name,
      created_at: existing?.created_at ?? now(), updated_at: now(),
    };
    setTable(REJECTIONS_IN_TABLE, existing ? rows.map((r) => (r.id === id ? record : r)) : [...rows, record]);
    recordSeries(number);
    const qty = record.lines.reduce((s, l) => s + l.quantity, 0);
    audit.record({
      entity: 'rejection_in', entity_id: id, action: existing ? 'update' : 'create', doc_number: number,
      summary: `${existing ? 'Edited' : 'Recorded'} rejection in ${number}: ${roundQty(qty)} unit(s) rejected on challan ${record.challan_number ?? ''}${record.client_name ? ` by ${record.client_name}` : ''}${state === 'overridden' ? ' (period lock overridden)' : ''}`,
    });
    return record;
  },

  remove(id: string): void {
    requireAccess('books.edit');
    const rows = rejectionsInDb.all();
    const r = rows.find((x) => x.id === id);
    if (!r) return;
    const state = assertUnlocked(lockOf(r), 'delete');
    setTable(REJECTIONS_IN_TABLE, rows.filter((x) => x.id !== id));
    audit.record({ entity: 'rejection_in', entity_id: id, action: 'delete', doc_number: r.number, summary: `Deleted rejection in ${r.number}${state === 'overridden' ? ' (period lock overridden)' : ''}` });
  },
};
