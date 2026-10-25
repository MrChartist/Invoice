/**
 * Draft bills (8C): supplier bills / expenses that are NOT in the books yet — captured from an
 * e-invoice QR, drafted by a recurring-bill schedule, or held for the owner's approval.
 *
 * They live in their own table `purchase_drafts`, never in `purchases`, so no report, GST paper,
 * ledger, stock or payables figure can see them (the same reason a pending sales document is a
 * Draft). Each row is a `PurchaseRecord` shape with `status: 'draft'` plus `draft` metadata; posting
 * copies it into `purchases` through `purchasesDb.save` (period lock, roles, approval gate) and
 * deletes the draft. If a draft row ever reached `purchases`, `readPurchase` readers still skip it
 * (`isVoidStatus('draft')`) — guarded by tests/purchase-contract.test.ts.
 */

import type { PurchaseRecord } from '../types/purchases';
import { requireAccess } from './access';
import { generateId, getTable, setTable } from './storage';
import { releaseDropped, releaseAttachments } from './attachments';

export const PURCHASE_DRAFTS_TABLE = 'purchase_drafts';

export type DraftSource = 'capture' | 'recurring' | 'approval' | 'manual';

export interface DraftApproval {
  state: 'pending' | 'rejected';
  requested_by: string;
  requested_at: string;
  /** Rupee value the request was made for. */
  amount: number;
  decided_by?: string;
  decided_at?: string;
  /** The owner's reason when rejected. */
  note?: string;
}

export interface DraftMeta {
  source: DraftSource;
  created_at: string;
  /** `doc_inbox` row it came from. */
  inbox_id?: string;
  /** Invoice value read from the e-invoice QR (the posted bill is checked against it). */
  expected_total?: number;
  /** Things the user must finish before posting ('gst' = GST split unknown from the QR). */
  review?: string[];
  /** Buyer GSTIN on the e-invoice when it is none of our profiles' GSTINs. */
  foreign_buyer?: string;
  approval?: DraftApproval;
  /** Expense paid on the spot: record this payment when the held expense is approved. */
  pay_now?: { method: string; date: string; reference?: string; bank_account_id?: string; tds_amount?: number };
}

export type PurchaseDraft = PurchaseRecord & { status: 'draft'; draft: DraftMeta };

const now = () => new Date().toISOString();

/** Tolerant read: rows without the draft envelope are dropped (hand-edited / partial backups). */
export function readDrafts(rows: unknown[]): PurchaseDraft[] {
  return rows.filter((r): r is PurchaseDraft => !!r && typeof r === 'object' && typeof (r as PurchaseDraft).id === 'string' && !!(r as PurchaseDraft).draft);
}

/** The bill fields of a draft, ready for `purchasesDb.save` (draft envelope and status removed). */
export function billOfDraft(d: PurchaseDraft): Omit<PurchaseRecord, 'id'> {
  const { id: _id, status: _status, draft: _draft, created_at: _c, updated_at: _u, ...bill } = d;
  void [_id, _status, _draft, _c, _u];
  return bill;
}

export const draftsDb = {
  all: (): PurchaseDraft[] => readDrafts(getTable<unknown>(PURCHASE_DRAFTS_TABLE)),
  get: (id: string): PurchaseDraft | undefined => draftsDb.all().find((d) => d.id === id),

  save(input: Omit<PurchaseRecord, 'id'> & { id?: string; draft: DraftMeta }): PurchaseDraft {
    requireAccess('books.edit');
    const rows = draftsDb.all();
    const existing = input.id ? rows.find((r) => r.id === input.id) : undefined;
    const row: PurchaseDraft = {
      ...existing,
      ...input,
      id: existing?.id ?? input.id ?? generateId(),
      status: 'draft',
      amount_paid: 0,
      created_at: existing?.created_at ?? now(),
      updated_at: now(),
    };
    setTable(PURCHASE_DRAFTS_TABLE, existing ? rows.map((r) => (r.id === row.id ? row : r)) : [...rows, row]);
    if (existing) releaseDropped(existing.attachments, row.attachments);
    return row;
  },

  /** Delete a draft. `keepFiles` when its attachments moved to the posted bill. */
  remove(id: string, opts: { keepFiles?: boolean } = {}): void {
    requireAccess('books.edit');
    const rows = draftsDb.all();
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    setTable(PURCHASE_DRAFTS_TABLE, rows.filter((r) => r.id !== id));
    if (!opts.keepFiles && row.attachments?.length) releaseAttachments(row.attachments.map((a) => a.id));
  },
};
