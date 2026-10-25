/**
 * Amount due on an invoice — the ONE definition every "what does the customer still owe" reader uses.
 *
 *   due = receivable total − TDS withheld − amount received − live credit notes linked to it
 *
 * `invoice.balance_due` stays what it always was (total − TDS − received, before credit notes), so
 * stored records keep one meaning; credit notes are linked through `doc_links` (relation
 * `credit_note`) and applied here. A debit note is its own receivable document (own number, due date,
 * payments and status), so it is never added to the original's due — that would collect it twice.
 *
 * Status follows the same maths (`settledStatus`): Paid once nothing is due (≤ 0.005), Partially Paid
 * once something is settled by a receipt or a credit note. A credit note never invents a receipt:
 * receivables read it as a credit allocated to the bill, not as money received.
 *
 * Pure and tiny (it loads with the notifications chunk): no storage, no React.
 */

import type { InvoiceRecord, InvoiceStatus } from '../types/invoice';
import { round2 } from './invoice-calc';
import { receivableBalance, receivableTotal, type RcmFields } from './rcm';

/** At or below this the invoice is settled (rounding dust). */
export const SETTLED_EPS = 0.005;

/** A `doc_links` row, as far as this module needs it. */
export interface CreditLinkRow {
  from_id: string;
  to_id: string;
  relation: string;
}

/** Invoice id → Σ live credit notes linked to it. */
export type CreditMap = ReadonlyMap<string, number>;

type DocLike = Pick<InvoiceRecord, 'id' | 'doc_type' | 'status'> & RcmFields;

/** An issued credit note (a draft is not issued yet; a cancelled one reduces nothing). */
export function isLiveCreditNote(doc: Pick<InvoiceRecord, 'doc_type' | 'status'>): boolean {
  return doc.doc_type === 'CREDIT_NOTE' && doc.status !== 'Draft' && doc.status !== 'Cancelled';
}

/**
 * Σ live credit notes per original invoice, from `doc_links`. One pass over the links; the id index
 * is only built when there is at least one credit-note link (the common no-credit case stays O(links)).
 * Amounts are in each note's own currency (a note copies its invoice's), so pass the same records
 * (raw or converted) the caller reads the invoices from.
 */
export function linkedCredits(links: readonly CreditLinkRow[] | undefined, invoices: readonly DocLike[]): Map<string, number> {
  const out = new Map<string, number>();
  if (!links?.length) return out;
  let byId: Map<string, DocLike> | undefined;
  const seen = new Set<string>();
  for (const l of links) {
    if (l.relation !== 'credit_note' || seen.has(l.to_id)) continue;
    byId ??= new Map(invoices.map((i) => [i.id, i]));
    const note = byId.get(l.to_id);
    if (!note || !isLiveCreditNote(note)) continue;
    seen.add(l.to_id);
    out.set(l.from_id, round2((out.get(l.from_id) ?? 0) + receivableTotal(note)));
  }
  return out;
}

/**
 * What the customer still owes on `inv` once `credited` (its live linked credit notes) is applied,
 * never below zero. A stored Paid or Cancelled document owes nothing.
 */
export function amountDue(
  inv: Pick<InvoiceRecord, 'status'> & RcmFields,
  credited: number | undefined = 0,
): number {
  if (inv.status === 'Paid' || inv.status === 'Cancelled') return 0;
  const due = round2(receivableBalance(inv) - (Number(credited) || 0));
  return due > SETTLED_EPS ? due : 0;
}

/**
 * Money status from the amounts: `payable` = receivable total − TDS, `paid` = received so far,
 * `credited` = live linked credit notes. Cancelled stays cancelled; a document with nothing settled
 * falls back from Paid / Partially Paid to Sent and otherwise keeps its status (Draft, Sent …).
 */
export function settledStatus(status: InvoiceStatus, payable: number, paid: number, credited = 0): InvoiceStatus {
  if (status === 'Cancelled') return status;
  if (payable > 0 && round2(payable - paid - credited) <= SETTLED_EPS) return 'Paid';
  if (paid > 0 || credited > 0) return 'Partially Paid';
  if (status === 'Paid' || status === 'Partially Paid') return 'Sent';
  return status;
}
