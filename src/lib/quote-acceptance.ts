/**
 * Quote acceptance offline (8G, 8.101 — Zoho "client accepts estimate", without a portal).
 *
 *  - Remote: the client-copy HTML of a quotation carries "Accept" / "Request changes" links — plain
 *    wa.me / mailto: links pre-filled with the quote number and amount (no script, works offline).
 *  - Counter: the client signs on the screen; signer, timestamp, amount and the PNG signature are
 *    snapshotted on the quote (`acceptance`) once, printed, quote_status → Accepted, audited
 *    (`localDb.invoices.setQuoteAcceptance`). A later edit of the quote never rewrites the snapshot.
 *
 * Pure: no storage, no DOM.
 */

import type { InvoiceRecord, QuoteAcceptance } from '../types/invoice';
import { SIG, sanitizeAcceptance } from './doc-snapshots';
import { requireAccess } from './access';
import { audit, invoiceUpdated } from './audit';
import { assertUnlocked } from './period-lock';
import { KEYS, getTable, setTable } from './storage';

export { sanitizeAcceptance } from './doc-snapshots';

export interface AcceptInput {
  signer: string;
  signature?: string;
  method?: 'counter' | 'remote';
  note?: string;
  now?: Date;
}

/** Problems before accepting (empty = may accept). */
export function acceptIssues(quote: Pick<InvoiceRecord, 'doc_type' | 'status' | 'acceptance'> | undefined, input: AcceptInput): ('notQuote' | 'draft' | 'already' | 'signer' | 'signature')[] {
  const out: ('notQuote' | 'draft' | 'already' | 'signer' | 'signature')[] = [];
  if (!quote || quote.doc_type !== 'QUOTATION') return ['notQuote'];
  if (quote.status === 'Draft') out.push('draft');
  if (quote.acceptance) out.push('already');
  if (!input.signer.trim()) out.push('signer');
  if ((input.method ?? 'counter') === 'counter' && !(input.signature && SIG.test(input.signature))) out.push('signature');
  return out;
}

/** The snapshot written on the quote. Amount = the quote's total at the moment of signing. */
export function buildAcceptance(quote: Pick<InvoiceRecord, 'total'>, input: AcceptInput): QuoteAcceptance {
  const acc = sanitizeAcceptance({
    signer: input.signer,
    signed_at: (input.now ?? new Date()).toISOString(),
    signature: input.signature,
    method: input.method ?? 'counter',
    amount: Number(quote.total) || 0,
    note: input.note,
  });
  if (!acc) throw new Error('Enter the name of the person accepting.');
  return acc;
}

/* ── Remote response links (client copy) ─────────────────────── */

export interface ResponseLinks {
  accept: string;
  changes: string;
}

const digits = (p: string | undefined) => {
  const d = String(p ?? '').replace(/\D/g, '');
  if (d.length === 10) return `91${d}`;
  return d.length >= 11 && d.length <= 15 ? d : '';
};

/**
 * "Accept" / "Request changes" links for a quotation: WhatsApp to the business's phone when it has
 * one, else e-mail. Null when the business has neither (the page then shows no buttons).
 */
export function responseLinks(
  quote: Pick<InvoiceRecord, 'invoice_number' | 'doc_type'> & { sender?: { companyPhone?: string; companyEmail?: string; companyName?: string } | null },
  amountText: string,
): ResponseLinks | null {
  if (quote.doc_type !== 'QUOTATION') return null;
  const no = quote.invoice_number || 'quotation';
  const acceptText = `I accept quotation ${no} for ${amountText}. Please go ahead.`;
  const changeText = `About quotation ${no} (${amountText}): I would like these changes: `;
  const phone = digits(quote.sender?.companyPhone);
  if (phone) {
    const wa = (t: string) => `https://wa.me/${phone}?text=${encodeURIComponent(t)}`;
    return { accept: wa(acceptText), changes: wa(changeText) };
  }
  const email = String(quote.sender?.companyEmail ?? '').trim();
  if (/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(email)) {
    const mail = (subject: string, body: string) => `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    return { accept: mail(`Accepted: ${no}`, acceptText), changes: mail(`Changes to ${no}`, changeText) };
  }
  return null;
}

/* ── Write (counter or remote acceptance) ────────────────────── */

const OVERRIDE_NOTE = ' (period-lock override)';

/**
 * Snapshot the client's acceptance on a quotation (signer, timestamp, amount, signature) and mark it
 * Accepted. Written once (a second call is refused); respects the period lock; audited. Later saves of
 * the quote keep the stored snapshot (`localDb.invoices.save`).
 */
export function setQuoteAcceptance(id: string, acceptance: QuoteAcceptance): InvoiceRecord {
  requireAccess('doc.edit');
  const invoices = getTable<InvoiceRecord>(KEYS.invoices);
  const idx = invoices.findIndex((i) => i.id === id);
  if (idx < 0) throw new Error('Quotation not found.');
  const before = invoices[idx];
  if (before.doc_type !== 'QUOTATION') throw new Error('Only a quotation can be accepted.');
  if (before.acceptance) throw new Error('This quotation is already accepted.');
  const overridden = assertUnlocked(before, 'edit') === 'overridden';
  invoices[idx] = { ...before, quote_status: 'Accepted', acceptance, updated_at: new Date().toISOString() };
  setTable(KEYS.invoices, invoices);
  try {
    const row = invoiceUpdated(before, invoices[idx], overridden ? OVERRIDE_NOTE : '');
    const how = acceptance.method === 'counter' ? 'signed at the counter' : 'accepted remotely';
    const base = row ?? { entity: 'invoice' as const, entity_id: id, action: 'update' as const, doc_number: before.invoice_number, summary: 'Quotation accepted' };
    audit.record({ ...base, summary: `${base.summary}: accepted by ${acceptance.signer} (${how})` });
  } catch {
    /* logging never breaks an acceptance */
  }
  return invoices[idx];
}
