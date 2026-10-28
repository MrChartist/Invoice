/**
 * Unprocessed documents (8.41): photos / PDFs of supplier bills and receipts waiting to be turned
 * into a bill or an expense — Zoho's "Documents inbox", Xero's "Files inbox". Table `doc_inbox`.
 *
 * A row keeps the file as an attachment reference (the file itself is stored once by content, see
 * attachments.ts) and, when an e-invoice QR was read from it, the decoded QR values. Rows are worked
 * off by turning them into a draft bill / expense (`draft_id`), or dismissed. Nothing here touches
 * the books. Insert API for other features (the PWA share target): `inboxDb.add`.
 */

import type { AttachmentRef } from '../types/attachments';
import type { EinvoiceQrData } from './einvoice-qr';
import { requireAccess } from './access';
import { generateId, getTable, setTable } from './storage';
import { readRefs, releaseAttachments } from './attachments';

export const DOC_INBOX_TABLE = 'doc_inbox';
/** At most this many rows are kept waiting; the oldest finished rows are pruned first. */
export const MAX_INBOX_ROWS = 300;

export type InboxSource = 'upload' | 'camera' | 'share' | 'paste';
export type InboxStatus = 'new' | 'done' | 'dismissed';

export interface InboxDoc {
  id: string;
  added_at: string;
  source: InboxSource;
  /** The file (one entry); absent for a QR text that was pasted / scanned without a picture. */
  attachments?: AttachmentRef[];
  status: InboxStatus;
  /** What the user wants it to become (from the share sheet / upload choice). */
  intent?: 'bill' | 'expense';
  /** Decoded e-invoice QR, when one was read. */
  qr?: EinvoiceQrData;
  /** Short reason the file could not be read automatically (shown on the row). */
  note?: string;
  /** Draft bill made from it (`purchase_drafts`), and the posted bill once it is posted. */
  draft_id?: string;
  purchase_id?: string;
  done_at?: string;
}

const clip = (s: unknown, n: number) => (typeof s === 'string' ? s.slice(0, n) : undefined);

export function readInbox(rows: unknown[]): InboxDoc[] {
  const out: InboxDoc[] = [];
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const x = r as Partial<InboxDoc>;
    if (typeof x.id !== 'string' || !x.id) continue;
    out.push({
      ...x,
      id: x.id,
      added_at: typeof x.added_at === 'string' ? x.added_at : '',
      source: x.source === 'camera' || x.source === 'share' || x.source === 'paste' ? x.source : 'upload',
      status: x.status === 'done' || x.status === 'dismissed' ? x.status : 'new',
      attachments: readRefs(x.attachments).slice(0, 1),
      note: clip(x.note, 200),
    } as InboxDoc);
  }
  return out;
}

/** Open rows first (newest first), then finished ones. Pure. */
export function sortInbox(rows: readonly InboxDoc[]): InboxDoc[] {
  return [...rows].sort((a, b) => Number(a.status !== 'new') - Number(b.status !== 'new') || b.added_at.localeCompare(a.added_at));
}

export const inboxDb = {
  all: (): InboxDoc[] => readInbox(getTable<unknown>(DOC_INBOX_TABLE)),
  get: (id: string): InboxDoc | undefined => inboxDb.all().find((r) => r.id === id),
  open: (): InboxDoc[] => sortInbox(inboxDb.all().filter((r) => r.status === 'new')),

  /** Insert a document (the file must already be stored with `attachFile` / `putAttachment`). */
  add(input: { source: InboxSource; file?: AttachmentRef; intent?: 'bill' | 'expense'; qr?: EinvoiceQrData; note?: string }): InboxDoc {
    requireAccess('books.edit');
    const row: InboxDoc = {
      id: generateId(),
      added_at: new Date().toISOString(),
      source: input.source,
      status: 'new',
      ...(input.file ? { attachments: [input.file] } : {}),
      ...(input.intent ? { intent: input.intent } : {}),
      ...(input.qr ? { qr: input.qr } : {}),
      ...(input.note ? { note: input.note.slice(0, 200) } : {}),
    };
    let rows = [...inboxDb.all(), row];
    // Keep the table bounded: drop the oldest finished rows (their files are released below).
    const dropped: InboxDoc[] = [];
    while (rows.length > MAX_INBOX_ROWS) {
      const i = rows.findIndex((r) => r.status !== 'new');
      if (i < 0) break;
      dropped.push(rows[i]);
      rows = rows.filter((_, j) => j !== i);
    }
    setTable(DOC_INBOX_TABLE, rows);
    const ids = dropped.flatMap((r) => (r.attachments ?? []).map((a) => a.id));
    if (ids.length) releaseAttachments(ids);
    return row;
  },

  update(id: string, patch: Partial<Omit<InboxDoc, 'id'>>): InboxDoc | undefined {
    requireAccess('books.edit');
    const rows = inboxDb.all();
    const row = rows.find((r) => r.id === id);
    if (!row) return undefined;
    const next: InboxDoc = { ...row, ...patch, id };
    if (next.status !== 'new' && !next.done_at) next.done_at = new Date().toISOString();
    setTable(DOC_INBOX_TABLE, rows.map((r) => (r.id === id ? next : r)));
    return next;
  },

  remove(id: string): void {
    requireAccess('books.edit');
    const rows = inboxDb.all();
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    setTable(DOC_INBOX_TABLE, rows.filter((r) => r.id !== id));
    const ids = (row.attachments ?? []).map((a) => a.id);
    if (ids.length) releaseAttachments(ids);
  },
};
