/**
 * Logo / signature images stored once, by reference (schema v3).
 *
 * An invoice's `sender` snapshot used to embed the profile's `logo` / `signature`
 * data URLs, so a 60 kB logo was copied into every invoice. Now the images live
 * once in the `mrchartist_inv_assets` table and the stored snapshot holds a
 * reference (`asset:<id>`). `storage.ts` swaps the two transparently:
 * `setTable` interns inline images, `getTable` resolves references, so every
 * reader (templates, preview, PDF, client copy, e-invoice print) still receives
 * the exact same data URL it was saved with (Critical Rule 3).
 *
 * The id is a synchronous content hash (two 32-bit FNV-1a style passes plus the
 * length). It must be synchronous because `setTable` is, which rules out
 * `crypto.subtle.digest`. It does not need to be cryptographic: interning
 * compares the full content, and on the (astronomically unlikely) collision the
 * id gets a `~n` suffix, so a reference can never point at the wrong image.
 *
 * This module is pure (no storage access) so it can sit on the boot path.
 */

export const ASSET_TABLE = 'assets';
export const ASSET_REF = 'asset:';

/** Tables whose rows carry a sender snapshot, and where it lives in a row. */
export const SNAPSHOT_TABLES = new Set(['invoices', 'recurring']);

const IMAGE_FIELDS = ['logo', 'signature'] as const;

export interface AssetRow {
  id: string;
  data: string;
}

export interface AssetIndex {
  byId: Map<string, string>;
  /** Reverse lookup. Resolved snapshots reuse the same string instances, so lookups stay O(1). */
  byData: Map<string, string>;
}

export const isAssetRef = (v: unknown): v is string => typeof v === 'string' && v.startsWith(ASSET_REF);
const isInlineImage = (v: unknown): v is string => typeof v === 'string' && v.startsWith('data:');

export function emptyAssets(): AssetIndex {
  return { byId: new Map(), byData: new Map() };
}

/** Tolerant parse of the stored asset table (bad rows are skipped, never thrown). */
export function parseAssets(raw: string | null | undefined): AssetIndex {
  const idx = emptyAssets();
  if (!raw) return idx;
  let rows: unknown;
  try {
    rows = JSON.parse(raw);
  } catch {
    return idx;
  }
  if (!Array.isArray(rows)) return idx;
  for (const r of rows as Partial<AssetRow>[]) {
    if (r && typeof r.id === 'string' && typeof r.data === 'string' && !idx.byId.has(r.id)) {
      idx.byId.set(r.id, r.data);
      if (!idx.byData.has(r.data)) idx.byData.set(r.data, r.id);
    }
  }
  return idx;
}

export function serializeAssets(idx: AssetIndex): string {
  const rows: AssetRow[] = [];
  for (const [id, data] of idx.byId) rows.push({ id, data });
  return JSON.stringify(rows);
}

/** Synchronous content hash: length + two independent 32-bit passes, as base36/hex. */
export function hashContent(s: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995);
    b ^= b >>> 15;
  }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
  return `${s.length.toString(36)}-${hex(a)}${hex(b)}`;
}

/** Store `data` once and return its reference. Mutates `idx`. */
export function internImage(idx: AssetIndex, data: string): string {
  const known = idx.byData.get(data);
  if (known) return ASSET_REF + known;
  const base = hashContent(data);
  let id = base;
  for (let n = 1; idx.byId.has(id) && idx.byId.get(id) !== data; n++) id = `${base}~${n}`;
  idx.byId.set(id, data);
  idx.byData.set(data, id);
  return ASSET_REF + id;
}

/** The data URL behind a reference ('' when the asset is missing); any other value is returned as is. */
export function resolveImage(idx: AssetIndex, v: string): string {
  if (!isAssetRef(v)) return v;
  return idx.byId.get(v.slice(ASSET_REF.length)) ?? '';
}

type Sender = Record<string, unknown>;
type Row = Record<string, unknown>;

function mapSender(sender: unknown, fn: (v: string) => string): Sender | null {
  if (!sender || typeof sender !== 'object') return null;
  const s = sender as Sender;
  let out: Sender | null = null;
  for (const f of IMAGE_FIELDS) {
    const v = s[f];
    if (typeof v !== 'string') continue;
    const next = fn(v);
    if (next !== v) (out ??= { ...s })[f] = next;
  }
  return out;
}

/** Apply `fn` to every snapshot image in a row; returns the same object when nothing changed. */
function mapRow(row: unknown, fn: (v: string) => string): unknown {
  if (!row || typeof row !== 'object') return row;
  const r = row as Row;
  let out: Row | null = null;
  const sender = mapSender(r.sender, fn);
  if (sender) (out ??= { ...r }).sender = sender;
  const tpl = r.template;
  if (tpl && typeof tpl === 'object') {
    const tplSender = mapSender((tpl as Row).sender, fn);
    if (tplSender) (out ??= { ...r }).template = { ...(tpl as Row), sender: tplSender };
  }
  return out ?? row;
}

/** Replace inline snapshot images with references (interning them into `idx`). Never mutates the input rows. */
export function encodeRows<T>(rows: T[], idx: AssetIndex): { rows: T[]; added: boolean } {
  const before = idx.byId.size;
  const out = rows.map((r) => mapRow(r, (v) => (isInlineImage(v) ? internImage(idx, v) : v)) as T);
  return { rows: out, added: idx.byId.size !== before };
}

/** Resolve references back to the data URLs they were saved with. */
export function decodeRows<T>(rows: T[], idx: AssetIndex): T[] {
  return rows.map((r) => mapRow(r, (v) => resolveImage(idx, v)) as T);
}

/** Every asset id referenced by `rows` (used for backup validation and clean-up). */
export function referencedAssets(rows: unknown[], into: Set<string> = new Set()): Set<string> {
  for (const r of rows) {
    mapRow(r, (v) => {
      if (isAssetRef(v)) into.add(v.slice(ASSET_REF.length));
      return v;
    });
  }
  return into;
}
