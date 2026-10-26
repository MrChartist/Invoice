/**
 * R3-C2 job evidence on documents:
 *  - item photos: an invoice line snapshots its catalogue item's `image` (`asset:<id>`) so later
 *    catalogue photo changes never change a saved document; printed only when the design turns
 *    `show_item_images` on (never on the GST grid or thermal paper);
 *  - photo pages: image attachments marked "Print on document" print after the totals, 2 × 2 per page,
 *    ordered Before → After → Other, at most 12;
 *  - receiver signature ("Received by"): an event snapshot on an issued invoice / delivery challan,
 *    written once, replaced only by the owner with a reason, audited. The PNG is interned in the
 *    `assets` table and the document keeps the `asset:<id>` reference.
 * The e-Invoice / e-Way JSON builders never read any of these fields.
 */

import type { InvoiceRecord } from '../types/invoice';
import type { AttachmentRef } from '../types/attachments';
import type { AttachmentPrint, DeliveryProof, PhotoGroup } from '../types/docs-r3';
import { ASSET_TABLE, internImage, isAssetRef, parseAssets, resolveImage, serializeAssets, type AssetIndex } from './assets';
import { SIG, MAX_SIGNATURE_CHARS } from './doc-snapshots';
import { currentActor, currentRole, requireAccess } from './access';
import { audit } from './audit';
import { assertUnlocked } from './period-lock';
import { DB_PREFIX, KEYS, getTable, readRaw, setTable, writeRaw } from './storage';
import { withTablesRollback } from './table-txn';

/* ── Item photos: `snapshotLineImages` / `lineImageRef` live in `line-images.ts` (kept out of this module so the editor chunk stays small). */

/* ── Photo pages ─────────────────────────────────────────────── */

export const PHOTO_GROUPS: readonly PhotoGroup[] = ['before', 'after', 'other'];
export const MAX_PRINTED_PHOTOS = 12;
export const PHOTOS_PER_PAGE = 4;
const CAPTION_MAX = 80;

/** Clean a stored print flag; undefined when absent or malformed. */
export function sanitizePrint(v: unknown): AttachmentPrint | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const o = v as Record<string, unknown>;
  const group: PhotoGroup = PHOTO_GROUPS.includes(o.group as PhotoGroup) ? (o.group as PhotoGroup) : 'other';
  const caption = typeof o.caption === 'string' ? Array.from(o.caption, (ch) => ((ch.codePointAt(0) ?? 0) < 32 ? ' ' : ch)).join('').trim().slice(0, CAPTION_MAX) : '';
  return { group, ...(caption ? { caption } : {}) };
}

/** Image attachments marked for printing, Before → After → Other (stable within a group), capped at 12. */
export function printablePhotos(refs: readonly AttachmentRef[] | undefined): AttachmentRef[] {
  const marked = (refs ?? []).filter((r) => r && String(r.mime).startsWith('image/') && sanitizePrint(r.print));
  const rank = (r: AttachmentRef) => PHOTO_GROUPS.indexOf(sanitizePrint(r.print)?.group ?? 'other');
  return marked
    .map((r, i) => ({ r, i }))
    .sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i)
    .map((x) => x.r)
    .slice(0, MAX_PRINTED_PHOTOS);
}

/** Split printable photos into pages of four (a 2 × 2 grid each). */
export function photoPages<T>(photos: readonly T[], perPage = PHOTOS_PER_PAGE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < photos.length; i += perPage) out.push(photos.slice(i, i + perPage));
  return out;
}

/** Set / clear the print flag of one attachment (pure). Marking more than 12 is refused with `false`. */
export function setPrintFlag(refs: readonly AttachmentRef[], id: string, print: AttachmentPrint | null): AttachmentRef[] | false {
  const already = refs.filter((r) => r.id !== id && sanitizePrint(r.print)).length;
  if (print && already >= MAX_PRINTED_PHOTOS) return false;
  return refs.map((r) => {
    if (r.id !== id) return r;
    const next = { ...r };
    const clean = print ? sanitizePrint(print) : undefined;
    if (clean) next.print = clean;
    else delete next.print;
    return next;
  });
}

/* ── Receiver signature (proof of delivery) ──────────────────── */

const SIGNABLE = new Set(['INVOICE', 'TAX_INVOICE', 'BILL_OF_SUPPLY', 'DELIVERY_CHALLAN']);

export type ProofIssue = 'notSignable' | 'draft' | 'cancelled' | 'already' | 'receiver' | 'signature' | 'reason' | 'owner';

export interface ProofInput {
  receiver: string;
  remark?: string;
  /** PNG / JPEG data URL from the signature pad. */
  signature?: string;
  /** Required to replace an existing proof (owner only). */
  reason?: string;
  now?: Date;
}

/** True for a document the "Get signature" action applies to (issued invoice / bill of supply / challan). */
export function canTakeProof(doc: Pick<InvoiceRecord, 'doc_type' | 'status'> | undefined): boolean {
  return !!doc && SIGNABLE.has(doc.doc_type) && doc.status !== 'Draft' && doc.status !== 'Cancelled';
}

/** Problems before a proof is written (empty = may write). `role` decides who may replace one. */
export function proofIssues(doc: Pick<InvoiceRecord, 'doc_type' | 'status' | 'delivery_proof'> | undefined, input: ProofInput, role: string = 'owner'): ProofIssue[] {
  if (!doc || !SIGNABLE.has(doc.doc_type)) return ['notSignable'];
  const out: ProofIssue[] = [];
  if (doc.status === 'Draft') out.push('draft');
  if (doc.status === 'Cancelled') out.push('cancelled');
  if (doc.delivery_proof) {
    if (role !== 'owner') out.push('owner');
    if (!input.reason?.trim()) out.push('reason');
  }
  if (!input.receiver.trim()) out.push('receiver');
  if (!(input.signature && input.signature.length <= MAX_SIGNATURE_CHARS && SIG.test(input.signature))) out.push('signature');
  return out;
}

/** Clean a stored proof (normalizeRecord-style); null when unusable. */
export function sanitizeDeliveryProof(raw: unknown): DeliveryProof | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const receiver = typeof o.receiver === 'string' ? o.receiver.trim().slice(0, 80) : '';
  const at = typeof o.signed_at === 'string' ? o.signed_at : '';
  const signature = typeof o.signature === 'string' ? o.signature : '';
  if (!receiver || !at || Number.isNaN(Date.parse(at)) || !(isAssetRef(signature) || SIG.test(signature))) return null;
  const out: DeliveryProof = { receiver, signed_at: at, signature };
  if (typeof o.remark === 'string' && o.remark.trim()) out.remark = o.remark.trim().slice(0, 120);
  if (Array.isArray(o.replaced)) {
    const rep = o.replaced
      .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
      .map((r) => ({ at: String(r.at ?? ''), by: String(r.by ?? ''), reason: String(r.reason ?? '').slice(0, 200) }))
      .filter((r) => r.at && r.reason);
    if (rep.length) out.replaced = rep;
  }
  return out;
}

/**
 * Build the proof: the signature data URL is interned into `idx` (the `assets` table index) and the
 * proof keeps the `asset:<id>` reference. `previous` (being replaced) moves its history forward.
 */
export function buildDeliveryProof(input: ProofInput, idx: AssetIndex, previous?: DeliveryProof, by = ''): DeliveryProof {
  const signature = internImage(idx, String(input.signature));
  const now = (input.now ?? new Date()).toISOString();
  const proof: DeliveryProof = { receiver: input.receiver.trim().slice(0, 80), signed_at: now, signature };
  if (input.remark?.trim()) proof.remark = input.remark.trim().slice(0, 120);
  if (previous) proof.replaced = [...(previous.replaced ?? []), { at: now, by: by || 'Owner', reason: String(input.reason ?? '').trim().slice(0, 200) }];
  return proof;
}

const ASSETS_KEY = DB_PREFIX + ASSET_TABLE;

/** The data URL behind a proof's signature ('' when missing or unsafe). */
export function proofSignatureData(proof: Pick<DeliveryProof, 'signature'> | undefined, assetsRaw: string | null = readRaw(ASSETS_KEY)): string {
  const v = proof?.signature ?? '';
  const data = isAssetRef(v) ? resolveImage(parseAssets(assetsRaw), v) : v;
  return SIG.test(data) ? data : '';
}

/**
 * Write (or, owner only with a reason, replace) the receiver signature on a saved document.
 * Respects roles and the period lock; the signature PNG goes to `assets` first so the reference never
 * dangles; the invoice write is all-or-nothing; one audit row.
 */
export function setDeliveryProof(id: string, input: ProofInput): InvoiceRecord {
  requireAccess('doc.edit');
  const invoices = getTable<InvoiceRecord>(KEYS.invoices);
  const idx = invoices.findIndex((i) => i.id === id);
  if (idx < 0) throw new Error('Document not found.');
  const before = invoices[idx];
  const issues = proofIssues(before, input, currentRole());
  if (issues.length) throw new Error(PROOF_ERRORS[issues[0]]);
  const overridden = assertUnlocked(before, 'edit') === 'overridden';
  const by = currentActor()?.name ?? '';
  const assets = parseAssets(readRaw(ASSETS_KEY));
  const size = assets.byId.size;
  const proof = buildDeliveryProof(input, assets, before.delivery_proof, by);
  if (assets.byId.size !== size) writeRaw(ASSETS_KEY, serializeAssets(assets));
  const next: InvoiceRecord = { ...before, delivery_proof: proof, updated_at: new Date().toISOString() };
  withTablesRollback([KEYS.invoices], () => {
    const rows = [...invoices];
    rows[idx] = next;
    setTable(KEYS.invoices, rows);
  });
  try {
    const replaced = !!before.delivery_proof;
    audit.record({
      entity: 'invoice',
      entity_id: id,
      action: 'update',
      doc_number: before.invoice_number,
      summary: `${replaced ? 'Receiver signature replaced' : 'Receiver signature taken'} on ${before.invoice_number || 'document'} — received by ${proof.receiver}${replaced ? ` (reason: ${proof.replaced?.at(-1)?.reason})` : ''}${overridden ? ' (period-lock override)' : ''}`,
    });
  } catch {
    /* logging never breaks the write */
  }
  return next;
}

/** English messages for data-layer refusals (the dialog shows its own translated text first). */
export const PROOF_ERRORS: Record<ProofIssue, string> = {
  notSignable: 'A receiver signature can be taken on an invoice, bill of supply or delivery challan.',
  draft: 'Issue the document before taking the receiver signature.',
  cancelled: 'This document is cancelled.',
  already: 'This document already has a receiver signature.',
  receiver: 'Enter the name of the person receiving.',
  signature: 'Ask the receiver to sign in the box.',
  reason: 'Give a reason for replacing the signature.',
  owner: 'Only the owner can replace a receiver signature.',
};
