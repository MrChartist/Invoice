/**
 * Attachments (roadmap 6.12): receipt photos / PDFs kept with a purchase bill, an
 * expense or an invoice. Internal only — never printed on a template.
 *
 * A record carries `attachments?: AttachmentRef[]`; the file itself is stored once,
 * by content hash, under its own key `mrchartist_inv_att_<id>` (see src/lib/attachments.ts).
 * Additive-only like every persisted shape.
 */

export type AttachmentMime = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' | 'application/pdf';

export interface AttachmentRef {
  /** Content id (hash of the stored data URL); the same file attached twice is stored once. */
  id: string;
  /** Original file name, for display / download only. */
  name: string;
  mime: AttachmentMime;
  /** Stored size in bytes (after image compression). */
  size: number;
  /** ISO timestamp of when it was attached. */
  added_at: string;
}
