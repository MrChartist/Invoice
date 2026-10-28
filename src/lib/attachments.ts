/**
 * Attachments (roadmap 6.12): receipt photos and PDFs kept with purchase bills, expenses
 * and invoices. Internal working files — templates never print them.
 *
 * Storage
 *  - Each file is stored ONCE, by content, under its own key `mrchartist_inv_att_<id>`
 *    (value: JSON `{id, mime, size, created_at, data}` with `data` a base64 data URL).
 *    One key per file rather than one big table so attaching a 2 MB scan writes 2 MB,
 *    not the whole attachment set, and so a commit to IndexedDB stays small. The keys sit
 *    under the `mrchartist_inv_` prefix, so backup, the safety snapshot, Erase and the
 *    forgot-PIN reset include them with no special casing.
 *  - The id is the synchronous content hash from assets.ts (`hashContent`), suffixed `~n`
 *    on a (theoretical) collision, so the same receipt attached to two bills is one file.
 *  - Records point at files with `attachments?: AttachmentRef[]` (`invoices`, `purchases`;
 *    the editor's autosaved `draft` counts as a reference too).
 *
 * Validation: only JPEG / PNG / WebP / GIF images and PDFs are accepted, judged by their
 * magic bytes (the declared MIME type and file name are ignored). Content is re-checked on
 * every read and on restore, so a doctored backup cannot smuggle in, say, HTML.
 *
 * Clean-up: deleting a record, or saving it without a file it had, releases the files no
 * other record (or the draft) still uses; `cleanupUnusedAttachments` sweeps everything
 * else (Settings → Data → storage health).
 *
 * Pure apart from the storage calls; tested in Node (tests/attachments.test.ts).
 */

import type {} from '../types/docs-r3'; // R3-C2: AttachmentRef.print
import { DB_PREFIX, SINGLETON_KEYS, listKeys, peekTable, readRaw, removeRaw, writeRaw } from './storage';
import { hashContent } from './assets';
import type { AttachmentMime, AttachmentRef } from '../types/attachments';

export type { AttachmentMime, AttachmentRef } from '../types/attachments';

export const ATTACHMENT_KEY_PREFIX = `${DB_PREFIX}att_`;
/** PDFs are stored as they are, up to this size. */
export const MAX_PDF_BYTES = 3 * 1024 * 1024;
/** Images are downscaled first; the stored result must still fit this. */
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
/** Largest photo accepted for downscaling (phone cameras produce 5–12 MB). */
export const MAX_IMAGE_INPUT_BYTES = 20 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_RECORD = 10;
/** Tables whose rows carry `attachments` (8C: draft bills and the unprocessed-documents inbox too). */
export const ATTACHMENT_OWNER_TABLES = ['invoices', 'purchases', 'purchase_drafts', 'doc_inbox', 'recycle_bin', 'labour_compliance', 'site_compliance', 'works_contracts'] as const; // R4-C4: kept while binned; R11 (CN-D2) / R17-C: PF / ESI proof; PENDING 14: contract closure documents

export const ACCEPTED_MIMES: readonly AttachmentMime[] = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];
/** `accept` attribute for file inputs (a hint only; content is checked by magic bytes). */
export const ATTACHMENT_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,application/pdf';

export class AttachmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AttachmentError';
  }
}

export interface StoredAttachment {
  id: string;
  mime: AttachmentMime;
  size: number;
  created_at: string;
  /** `data:<mime>;base64,<payload>` */
  data: string;
}

/* ── Content checks ─────────────────────────────────────────────── */

const startsWith = (b: Uint8Array, sig: readonly number[], at = 0) =>
  b.length >= at + sig.length && sig.every((v, i) => b[at + i] === v);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

/** The real type of a file from its first bytes, or null when it is not one we accept. */
export function sniffMime(bytes: Uint8Array): AttachmentMime | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, ascii('GIF87a')) || startsWith(bytes, ascii('GIF89a'))) return 'image/gif';
  if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8)) return 'image/webp';
  if (startsWith(bytes, ascii('%PDF-'))) return 'application/pdf';
  return null;
}

export const isImageMime = (m: string): boolean => m.startsWith('image/');

/** Check an upload's real type and size. Returns the sniffed type; throws a readable AttachmentError. */
export function validateUpload(bytes: Uint8Array): AttachmentMime {
  if (bytes.length === 0) throw new AttachmentError('That file is empty.');
  const mime = sniffMime(bytes);
  if (!mime) throw new AttachmentError('Only photos (JPG, PNG, WebP, GIF) and PDF files can be attached.');
  if (mime === 'application/pdf' && bytes.length > MAX_PDF_BYTES) {
    throw new AttachmentError(`That PDF is ${formatBytes(bytes.length)}. PDFs can be up to ${formatBytes(MAX_PDF_BYTES)}.`);
  }
  if (isImageMime(mime) && bytes.length > MAX_IMAGE_BYTES) {
    throw new AttachmentError(`That image is still ${formatBytes(bytes.length)} after compression (limit ${formatBytes(MAX_IMAGE_BYTES)}).`);
  }
  return mime;
}

export function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

/* ── Base64 ─────────────────────────────────────────────────────── */

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const DATA_URL = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]*={0,2})$/;

/** Split a base64 data URL; null when it is not one. */
function splitDataUrl(data: string): { mime: string; b64: string } | null {
  const m = DATA_URL.exec(data);
  return m ? { mime: m[1], b64: m[2] } : null;
}

/** Validate a stored value (from storage or a backup file). Null when damaged or not an accepted type. */
export function parseStoredAttachment(raw: string | null | undefined): StoredAttachment | null {
  if (!raw) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!v) return null; // a non-object has no string `id` / `data`, so the next line refuses it
  const r = v as Partial<StoredAttachment>;
  if (typeof r.id !== 'string' || !r.id || typeof r.data !== 'string') return null;
  const parts = splitDataUrl(r.data);
  if (!parts || !(ACCEPTED_MIMES as readonly string[]).includes(parts.mime)) return null;
  // Magic bytes of the payload must agree with the declared type (16 base64 chars = 12 bytes).
  let head: Uint8Array;
  try {
    head = base64ToBytes(parts.b64.slice(0, 16));
  } catch {
    return null;
  }
  if (sniffMime(head) !== parts.mime) return null;
  return {
    id: r.id,
    mime: parts.mime as AttachmentMime,
    size: typeof r.size === 'number' && r.size >= 0 ? r.size : Math.floor((parts.b64.length * 3) / 4),
    created_at: typeof r.created_at === 'string' ? r.created_at : '',
    data: r.data,
  };
}

/* ── Store / read ───────────────────────────────────────────────── */

export const attachmentKey = (id: string): string => ATTACHMENT_KEY_PREFIX + id;

/** File name safe to show and to offer as a download name. */
export function cleanFileName(name: string, mime: AttachmentMime): string {
  const last = name.split(/[\\/]/).pop() ?? '';
  const base = [...last].filter((c) => c.charCodeAt(0) >= 32 && !'<>:"|?*'.includes(c)).join('').trim().slice(0, 120);
  if (base) return base;
  return mime === 'application/pdf' ? 'document.pdf' : `image.${mime.split('/')[1]}`;
}

/**
 * Store a validated file (stored once by content) and return the reference for a record.
 * Throws AttachmentError for an unsupported / oversized file and StorageWriteError when the
 * browser refuses the write (quota).
 */
export function putAttachment(input: { bytes: Uint8Array; name: string }, now: Date = new Date()): AttachmentRef {
  const mime = validateUpload(input.bytes);
  const data = `data:${mime};base64,${bytesToBase64(input.bytes)}`;
  const base = hashContent(data);
  let id = base;
  for (let n = 1; ; n++) {
    const existing = parseStoredAttachment(readRaw(attachmentKey(id)));
    if (!existing) break;
    if (existing.data === data) break; // already stored: reuse it
    id = `${base}~${n}`;
  }
  if (!readRaw(attachmentKey(id))) {
    const row: StoredAttachment = { id, mime, size: input.bytes.length, created_at: now.toISOString(), data };
    writeRaw(attachmentKey(id), JSON.stringify(row));
  }
  return { id, name: cleanFileName(input.name, mime), mime, size: input.bytes.length, added_at: now.toISOString() };
}

export function getAttachment(id: string): StoredAttachment | null {
  const row = parseStoredAttachment(readRaw(attachmentKey(id)));
  return row && row.id === id ? row : null;
}

export function hasAttachment(id: string): boolean {
  return getAttachment(id) !== null;
}

/** Decoded bytes plus the sniffed type (for a Blob / object URL). Null when missing or damaged. */
export function attachmentBytes(id: string): { bytes: Uint8Array; mime: AttachmentMime } | null {
  const row = getAttachment(id);
  if (!row) return null;
  const parts = splitDataUrl(row.data);
  if (!parts) return null;
  const bytes = base64ToBytes(parts.b64);
  const mime = sniffMime(bytes);
  return mime && mime === row.mime ? { bytes, mime } : null;
}

/* ── References ─────────────────────────────────────────────────── */

/** Tolerant read of a record's `attachments` (bad entries dropped, duplicates collapsed). */
export function readRefs(v: unknown): AttachmentRef[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: AttachmentRef[] = [];
  for (const r of v as Partial<AttachmentRef>[]) {
    if (!r || typeof r.id !== 'string' || !r.id || seen.has(r.id)) continue;
    if (!(ACCEPTED_MIMES as readonly string[]).includes(String(r.mime))) continue;
    seen.add(r.id);
    out.push({
      id: r.id,
      name: typeof r.name === 'string' ? r.name : '',
      mime: r.mime as AttachmentMime,
      size: typeof r.size === 'number' ? r.size : 0,
      added_at: typeof r.added_at === 'string' ? r.added_at : '',
      // R3-C2 (additive): "Print on document" flag (cleaned by `printablePhotos` when printed; images only).
      ...(r.print ? { print: r.print } : {}),
    });
  }
  return out;
}

/** Ids referenced by rows that carry `attachments`. */
export function attachmentIdsIn(rows: unknown, into: Set<string> = new Set()): Set<string> {
  if (!Array.isArray(rows)) return into;
  for (const row of rows) {
    for (const r of readRefs((row as { attachments?: unknown } | null)?.attachments)) into.add(r.id); // non-objects carry none
  }
  return into;
}

/** Live store: tables through the shared parsed rows (`peekTable`, read-only), the small draft parsed as before. */
const liveParsed = (fullKey: string): unknown =>
  fullKey === SINGLETON_KEYS.draft ? parseJson(readRaw(fullKey)) : peekTable<unknown>(fullKey.slice(DB_PREFIX.length));

const parseJson = (raw: string | null | undefined): unknown => {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

/**
 * Every attachment id still in use: invoices, purchases and the editor's autosaved draft.
 * `read` defaults to live storage; backup validation passes the file's key/value map.
 */
export function referencedAttachmentIds(
  read: (fullKey: string) => string | null | undefined = readRaw,
  /** Already-parsed values by full key (backup validation parses each table once). */
  parsed?: (fullKey: string) => unknown,
): Set<string> {
  const ids = new Set<string>();
  // PERF-1: the live store is read through the shared parsed tables (runs on every save that drops a file).
  const get = parsed ?? (read === readRaw ? liveParsed : (k: string) => parseJson(read(k)));
  for (const t of ATTACHMENT_OWNER_TABLES) attachmentIdsIn(get(DB_PREFIX + t), ids);
  return attachmentIdsIn([get(SINGLETON_KEYS.draft)], ids); // a missing / non-object draft is skipped row by row
}

/** Ids of every stored file. */
export function storedAttachmentIds(): string[] {
  return listKeys(ATTACHMENT_KEY_PREFIX).map((k) => k.slice(ATTACHMENT_KEY_PREFIX.length));
}

/**
 * Remove the given files when nothing uses them any more. Call after a record that used them
 * was deleted or saved without them. Never throws (a failed clean-up only wastes space).
 */
export function releaseAttachments(ids: Iterable<string>): number {
  const wanted = [...new Set(ids)];
  if (!wanted.length) return 0;
  let removed = 0;
  try {
    const used = referencedAttachmentIds();
    for (const id of wanted) {
      if (used.has(id) || readRaw(attachmentKey(id)) === null) continue;
      removeRaw(attachmentKey(id));
      removed++;
    }
  } catch {
    /* best effort */
  }
  return removed;
}

/** Release what `before` had and `after` no longer has. */
export function releaseDropped(before: unknown, after: unknown): number {
  const keep = new Set(readRefs(after).map((r) => r.id));
  return releaseAttachments(readRefs(before).map((r) => r.id).filter((id) => !keep.has(id)));
}

export interface AttachmentUsage {
  count: number;
  chars: number;
  unusedIds: string[];
  unusedChars: number;
}

/** Stored files, their size, and the ones no record uses (for storage health). */
export function attachmentUsage(): AttachmentUsage {
  const used = referencedAttachmentIds();
  const usage: AttachmentUsage = { count: 0, chars: 0, unusedIds: [], unusedChars: 0 };
  for (const key of listKeys(ATTACHMENT_KEY_PREFIX)) {
    const chars = key.length + (readRaw(key)?.length ?? 0);
    const id = key.slice(ATTACHMENT_KEY_PREFIX.length);
    usage.count++;
    usage.chars += chars;
    if (!used.has(id)) {
      usage.unusedIds.push(id);
      usage.unusedChars += chars;
    }
  }
  return usage;
}

/** Delete every stored file no record (or the draft) refers to. Returns what was freed. */
export function cleanupUnusedAttachments(): { removed: number; chars: number } {
  const { unusedIds, unusedChars } = attachmentUsage();
  for (const id of unusedIds) removeRaw(attachmentKey(id));
  return { removed: unusedIds.length, chars: unusedChars };
}

/* ── Backups ────────────────────────────────────────────────────── */

export interface BackupAttachmentCheck {
  /** Valid files in the backup. */
  files: number;
  /** Damaged or disallowed files that were left out of the restore. */
  dropped: number;
  /** References in the backup's records whose file is not in it (shown as "file missing"). */
  missing: number;
}

/**
 * Check the attachment keys of a parsed backup IN PLACE: damaged or disallowed files (bad JSON,
 * a type other than image/PDF, magic bytes that disagree, an id that does not match its key) are
 * removed from `data`. Dangling references are counted, not refused: attachments are supporting
 * files, so a backup made without some of them still restores and the records show "file missing".
 */
export function checkBackupAttachments(data: Record<string, string>, parsed?: (fullKey: string) => unknown): BackupAttachmentCheck {
  let files = 0;
  let dropped = 0;
  const present = new Set<string>();
  for (const key of Object.keys(data)) {
    if (!key.startsWith(ATTACHMENT_KEY_PREFIX)) continue;
    const id = key.slice(ATTACHMENT_KEY_PREFIX.length);
    const row = parseStoredAttachment(data[key]);
    if (!row || row.id !== id) {
      delete data[key];
      dropped++;
      continue;
    }
    files++;
    present.add(id);
  }
  const refs = referencedAttachmentIds((k) => data[k], parsed);
  const missing = [...refs].filter((id) => !present.has(id)).length;
  return { files, dropped, missing };
}
