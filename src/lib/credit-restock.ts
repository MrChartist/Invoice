/**
 * Does a credit note bring goods back into stock?
 *
 * Only a sales return does. A credit note for a discount, a rate difference, a GST correction or a
 * cancelled service reduces the value of the sale but no goods come back, so it must not add stock,
 * return serials or take cost of goods sold back (inventory, stock tracking, profitability).
 *
 * The answer, best source first:
 *  1. `goods_returned` stored on the note (the "Goods returned to stock" box on the credit-note form,
 *     on by default only for the "Sales return" reason);
 *  2. the reason on the note's `doc_links` row, else the "Reason: …" sentence the note was created
 *     with: the non-goods reasons below return nothing, anything else (Sales return, a custom reason)
 *     does;
 *  3. nothing known (a hand-made credit note): goods come back, as before.
 *
 * Pure: no storage.
 */

/** Credit-note reasons that never bring goods back. */
export const NON_GOODS_CREDIT_REASONS = ['discount', 'rate difference', 'gst correction', 'cancellation of service'] as const;

export interface RestockNote {
  id?: string;
  doc_type?: string;
  goods_returned?: boolean;
  notes?: string;
}

export interface RestockLink {
  to_id: string;
  relation: string;
  reason?: string;
}

/** The default for the form's "Goods returned to stock" box for a reason. */
export function reasonReturnsGoods(reason: string | undefined | null): boolean {
  const r = String(reason ?? '').trim().toLowerCase();
  if (!r) return true;
  return !(NON_GOODS_CREDIT_REASONS as readonly string[]).includes(r);
}

/** The reason a credit note was raised for: its link first, else the sentence in its notes. */
export function creditNoteReason(note: RestockNote, links: readonly RestockLink[] = []): string {
  const link = note.id ? links.find((l) => l.relation === 'credit_note' && l.to_id === note.id && l.reason?.trim()) : undefined;
  if (link?.reason) return link.reason.trim();
  const m = /Reason:\s*([^.]+)\./.exec(String(note.notes ?? ''));
  return m ? m[1].trim() : '';
}

/** True when the credit note moves goods back into stock (always false for any other document). */
export function creditNoteReturnsGoods(note: RestockNote, links: readonly RestockLink[] = []): boolean {
  if (note.doc_type !== 'CREDIT_NOTE') return false;
  if (typeof note.goods_returned === 'boolean') return note.goods_returned;
  return reasonReturnsGoods(creditNoteReason(note, links));
}
