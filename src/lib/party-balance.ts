/**
 * Party balance on the bill (8.5, daily khata loop) — the pure, storage-free half.
 *
 * Kirana / wholesale bills print "Previous balance ₹A + This bill ₹B = Total due ₹C". The figures
 * are frozen on the invoice (`party_balance_snapshot`) the first time it is issued, so a reprint a
 * month later shows exactly what the customer was handed (Critical Rule 3). Documents saved before
 * this existed carry no snapshot and print nothing. The computation itself (which needs the whole
 * receivables ledger) lives in `khata.ts` → `computePartyBalanceSnapshot`, so this file stays tiny
 * for `normalizeRecord`.
 */
import type { InvoiceRecord, PartyBalanceSnapshot } from '../types/invoice';
import { round2 } from './invoice-calc';
import { receivableTotal } from './rcm';

export type { PartyBalanceSnapshot };

const finite = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? round2(v) : undefined);

/** A stored snapshot, or undefined when absent / malformed (never throws). */
export function sanitizePartyBalance(value: unknown): PartyBalanceSnapshot | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const v = value as Record<string, unknown>;
  const previous = finite(v.previous);
  const bill = finite(v.bill);
  const asOf = typeof v.as_of === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.as_of) ? v.as_of : undefined;
  if (previous === undefined || bill === undefined || !asOf) return undefined;
  const paid = finite(v.paid);
  return { previous, bill, ...(paid && paid > 0 ? { paid } : {}), as_of: asOf };
}

/** Total due on the bill: previous + this bill − paid at the counter. */
export function partyBalanceTotal(s: PartyBalanceSnapshot): number {
  return round2(s.previous + s.bill - (s.paid ?? 0));
}

/** What a bill adds to the party's account: the receivable total less the TDS the customer keeps. */
export function billAmount(rec: InvoiceRecord): number {
  const total = receivableTotal(rec);
  const tds = Math.min(Math.max(Number(rec.tds_amount) || 0, 0), total);
  return round2(total - tds);
}

/** Documents that can carry the line: live sales bills in rupees. */
export function canCarryPartyBalance(rec: Pick<InvoiceRecord, 'doc_type' | 'status' | 'currency'>): boolean {
  const t = rec.doc_type || 'INVOICE';
  if (t !== 'INVOICE' && t !== 'TAX_INVOICE' && t !== 'BILL_OF_SUPPLY') return false;
  if (rec.status === 'Draft' || rec.status === 'Cancelled') return false;
  return (rec.currency || 'INR').toUpperCase() === 'INR';
}

/**
 * The snapshot a save should store.
 *  - A document that was already issued keeps the snapshot it has (only `bill` follows an edit of
 *    the bill itself); one issued before this feature (no snapshot) stays without — legacy prints nothing.
 *  - A new document, or a draft being issued now, gets a fresh one from `compute()`.
 */
export function nextPartyBalanceSnapshot(
  record: InvoiceRecord,
  stored: InvoiceRecord | undefined,
  compute: () => PartyBalanceSnapshot | undefined,
): PartyBalanceSnapshot | undefined {
  if (!canCarryPartyBalance(record)) return stored && stored.status !== 'Draft' ? sanitizePartyBalance(stored.party_balance_snapshot) : undefined;
  if (stored && stored.status !== 'Draft') {
    const kept = sanitizePartyBalance(stored.party_balance_snapshot);
    return kept ? { ...kept, bill: billAmount(record) } : undefined;
  }
  try {
    return compute();
  } catch {
    return undefined; // a balance line is never worth failing a save over
  }
}

/** Rows printed on the bill, or null when nothing should print (no snapshot / no previous balance). */
export function partyBalanceRows(s: PartyBalanceSnapshot | undefined): { previous: number; bill: number; paid: number; total: number } | null {
  const snap = sanitizePartyBalance(s);
  if (!snap || Math.abs(snap.previous) < 0.005) return null;
  return { previous: snap.previous, bill: snap.bill, paid: snap.paid ?? 0, total: partyBalanceTotal(snap) };
}
