/**
 * Credit limits at billing (roadmap 6.25) — Vyapar / Zoho style "party is over its limit" notice.
 *
 * The client MASTER (table `clients`, matched by id, else by name) holds the optional
 * `credit_limit` (₹) and `credit_days`; the snapshot on an invoice never decides, so raising a
 * limit takes effect on every open draft at once. The check is advisory: the editor shows it and
 * never blocks saving.
 *
 *   outstanding  = rupee balance of the client's issued sales documents (invoices, debit notes),
 *                  excluding the document being edited
 *   this invoice = its total − TDS − amount already received, in rupees
 *   over limit   = outstanding + this invoice > credit_limit
 *   overdue      = documents with a balance older than credit_days (counted from the issue date)
 *
 * Bounced cheques (6.26) from the party are reported too. Foreign documents are converted at their
 * invoice rate; one without a rate is left out (it has no rupee value). Credit notes not yet set
 * off are not deducted — the figure errs on the side of warning.
 *
 * Pure: no storage. Imported by the editor, so keep it small.
 */

import type { Client, InvoiceRecord } from '../types/invoice';
import { fxRate } from './fx';
import { mulRound2, num, round2 } from './invoice-calc';
import { isoDay } from './dates';

/** Document types the limit applies to (what creates a receivable). */
const CREDIT_DOCS = new Set(['INVOICE', 'TAX_INVOICE', 'DEBIT_NOTE', 'BILL_OF_SUPPLY']);

export interface CreditDraft {
  id?: string;
  doc_type?: string;
  status?: string;
  total?: number;
  amount_paid?: number;
  tds_amount?: number;
  currency?: string;
  exchange_rate?: number;
}

/** The minimal cheque shape the check reads (see `src/types/cheques.ts`). */
export interface BounceLike {
  direction?: string;
  status?: string;
  client_id?: string;
  party_name?: string;
  bounced_on?: string;
}

export interface CreditCheck {
  limit?: number;
  creditDays?: number;
  /** Rupees owed on other open documents. */
  outstanding: number;
  /** Rupees this draft adds (0 for documents that are not invoices / debit notes). */
  thisInvoice: number;
  projected: number;
  /** projected − limit when over, else 0. */
  overBy: number;
  overdue: { count: number; amount: number; oldestDays: number };
  bounced: number;
  /** Readable, non-blocking warnings (empty = nothing to say). */
  warnings: string[];
}

const DAY = 86400000;
function daysBetween(a: string, b: string): number {
  const t = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
  return Math.round((t(b) - t(a)) / DAY);
}

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();

/** The client master row for an invoice snapshot: by id, else by name (case-insensitive). */
export function masterFor(snapshot: Pick<Client, 'id' | 'name'> | null | undefined, clients: readonly Client[]): Client | undefined {
  if (!snapshot) return undefined;
  if (snapshot.id) {
    const byId = clients.find((c) => c.id === snapshot.id);
    if (byId) return byId;
  }
  const name = norm(snapshot.name);
  return name ? clients.find((c) => norm(c.name) === name) : undefined;
}

/** Does this invoice belong to the client (by id, else by name)? */
export function belongsTo(inv: Pick<InvoiceRecord, 'client'>, client: Pick<Client, 'id' | 'name'>): boolean {
  const c = inv.client;
  if (!c) return false;
  if (client.id && c.id) return c.id === client.id;
  return norm(c.name) === norm(client.name) && norm(client.name) !== '';
}

/** Rupees still owed on a document (null when a foreign document has no rate). */
function openInr(inv: CreditDraft & { balance_due?: number }, useBalance: boolean): number | null {
  const rate = fxRate(inv);
  if (rate === null) return null;
  const raw = useBalance && typeof inv.balance_due === 'number'
    ? num(inv.balance_due)
    : num(inv.total) - num(inv.tds_amount) - num(inv.amount_paid);
  const open = Math.max(round2(raw), 0);
  return rate === 1 ? open : mulRound2(open, rate);
}

/** Bounced received cheques from this party. */
export function bouncedCount(cheques: readonly BounceLike[], client: Pick<Client, 'id' | 'name'>): number {
  return cheques.filter(
    (c) => c.direction === 'received' && c.status === 'bounced' &&
      ((client.id && c.client_id === client.id) || (!c.client_id && norm(c.party_name) === norm(client.name) && norm(client.name) !== '')),
  ).length;
}

export function creditCheck(input: {
  client: Client | undefined;
  draft: CreditDraft;
  invoices: readonly InvoiceRecord[];
  today: string;
  cheques?: readonly BounceLike[];
}): CreditCheck {
  const { client, draft, invoices, today } = input;
  const empty: CreditCheck = { outstanding: 0, thisInvoice: 0, projected: 0, overBy: 0, overdue: { count: 0, amount: 0, oldestDays: 0 }, bounced: 0, warnings: [] };
  if (!client) return empty;
  const limit = num(client.credit_limit) > 0 ? round2(num(client.credit_limit)) : undefined;
  const creditDays = num(client.credit_days) > 0 ? Math.round(num(client.credit_days)) : undefined;
  const bounced = input.cheques ? bouncedCount(input.cheques, client) : 0;
  if (limit === undefined && creditDays === undefined && bounced === 0) return empty;

  let outstanding = 0;
  const overdue = { count: 0, amount: 0, oldestDays: 0 };
  for (const inv of invoices) {
    if (draft.id && inv.id === draft.id) continue;
    if (!CREDIT_DOCS.has(inv.doc_type ?? 'INVOICE') || inv.status === 'Draft' || inv.status === 'Cancelled') continue;
    if (!belongsTo(inv, client)) continue;
    const open = openInr(inv, true);
    if (!open) continue;
    outstanding += open;
    const issued = isoDay(inv.issue_date);
    if (creditDays !== undefined && issued) {
      const age = daysBetween(issued, today);
      if (age > creditDays) {
        overdue.count++;
        overdue.amount += open;
        overdue.oldestDays = Math.max(overdue.oldestDays, age);
      }
    }
  }
  outstanding = round2(outstanding);
  overdue.amount = round2(overdue.amount);
  const counts = CREDIT_DOCS.has(draft.doc_type ?? 'INVOICE') && draft.status !== 'Cancelled';
  const thisInvoice = counts ? openInr(draft, false) ?? 0 : 0;
  const projected = round2(outstanding + thisInvoice);
  const overBy = limit !== undefined && projected > limit + 0.004 ? round2(projected - limit) : 0;

  const inr = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const warnings: string[] = [];
  if (overBy > 0) {
    warnings.push(
      `Over the credit limit by ${inr(overBy)}: ${inr(outstanding)} outstanding${thisInvoice ? ` + ${inr(thisInvoice)} on this document` : ''} against a limit of ${inr(limit!)}.`,
    );
  }
  if (overdue.count > 0) {
    warnings.push(
      `${overdue.count} bill${overdue.count === 1 ? '' : 's'} (${inr(overdue.amount)}) older than the ${creditDays}-day credit period — oldest ${overdue.oldestDays} days.`,
    );
  }
  if (bounced > 0) warnings.push(`${bounced} cheque${bounced === 1 ? '' : 's'} from this client bounced — consider advance payment.`);
  return { limit, creditDays, outstanding, thisInvoice, projected, overBy, overdue, bounced, warnings };
}
