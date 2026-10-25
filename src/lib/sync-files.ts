/**
 * Folder sync (5.7): the files in the shared folder and their encryption. No network: the user's
 * cloud client (Google Drive / Dropbox / OneDrive / iCloud for desktop) moves the files.
 *
 * Layout under the folder the user picked (docs/features/sync.md):
 *
 *   mrchartist-sync/<group>/manifest.json                 written once by the device that created the group
 *   mrchartist-sync/<group>/devices/<deviceId>.mcsync     one per device, only ever written by that device
 *   mrchartist-sync/<group>/blobs/<deviceId>/<attId>.mcblob  attachment files that device uploaded
 *
 * Every byte of business data is encrypted: AES-GCM-256 under a key derived from the sync passphrase
 * (PBKDF2-SHA-256, 600k, the group's salt from the manifest) — the same envelope fields as encrypted
 * backups (`v, kdf, iter, salt, iv, ct`). The additional data binds each file to its group, kind and
 * device, so a file copied or renamed to look like another device's fails to decrypt. Payloads are
 * gzip-compressed before encryption where the browser can (`CompressionStream`).
 */

import { PBKDF2_ITERATIONS, base64ToBytes, bytesToBase64, randomBytes } from './crypto';

export const SYNC_APP = 'mrchartist-invoice-sync';
export const SYNC_ROOT = 'mrchartist-sync';
const KDF = 'PBKDF2-SHA256';
const MIN_ITER = 210_000;
const MAX_ITER = 5_000_000;
const CHECK_TEXT = 'mrchartist-sync-check';
export const DEVICE_EXT = '.mcsync';
export const BLOB_EXT = '.mcblob';
/** Group folder names: shown in the cloud folder in plain text, so keep them neutral. */
export const GROUP_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;
const DEVICE_RE = /^[A-Za-z0-9-]{8,64}$/;
const ATT_RE = /^[A-Za-z0-9~_-]{1,80}$/;

/* ── File System Access shapes (the subset we use; a fake implements it in tests) ── */

export type PermState = 'granted' | 'denied' | 'prompt';
export interface SyncFileHandle {
  kind?: 'file';
  getFile(): Promise<{ text(): Promise<string> }>;
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
}
export interface SyncDir {
  kind: 'directory';
  name: string;
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<SyncDir>;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<SyncFileHandle>;
  removeEntry?(name: string): Promise<void>;
  values(): AsyncIterable<{ kind: 'file' | 'directory'; name: string }>;
  queryPermission?(d: { mode: 'readwrite' }): Promise<PermState>;
  requestPermission?(d: { mode: 'readwrite' }): Promise<PermState>;
}

export class SyncFileError extends Error {
  readonly code: 'missing' | 'damaged' | 'wrong-key' | 'not-ours';
  constructor(message: string, code: SyncFileError['code']) {
    super(message);
    this.name = 'SyncFileError';
    this.code = code;
  }
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error('Secure cryptography is not available in this browser context (HTTPS required).');
  return s;
}

/* ── Keys ──────────────────────────────────────────────────────── */

export interface SyncKey {
  key: CryptoKey;
  salt: string;
  iter: number;
  /**
   * Raw key bytes (base64), present only right after derivation so vault mode can store the key sealed
   * (`sync-keystore.ts`). Never persisted readable.
   */
  raw?: string;
}

/** PBKDF2 → non-extractable AES-GCM key that can encrypt and decrypt (kept in IndexedDB like the backup key). */
export async function deriveSyncKey(passphrase: string, salt: string, iter: number): Promise<SyncKey> {
  if (!passphrase) throw new Error('A passphrase is required.');
  if (!Number.isInteger(iter) || iter < MIN_ITER || iter > MAX_ITER) throw new SyncFileError('The sync folder has unusual key settings.', 'damaged');
  const base = await subtle().importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle().deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: base64ToBytes(salt), iterations: iter }, base, 256);
  const key = await subtle().importKey('raw', bits, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  return { key, salt, iter, raw: bytesToBase64(new Uint8Array(bits)) };
}

/** Rebuild a non-extractable key from raw bytes (vault mode keeps them sealed). */
export async function importSyncKey(raw: string, salt: string, iter: number): Promise<SyncKey> {
  const key = await subtle().importKey('raw', base64ToBytes(raw), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  return { key, salt, iter };
}

/* ── Compression (best effort) ─────────────────────────────────── */

const canGzip = () => typeof CompressionStream === 'function' && typeof DecompressionStream === 'function' && typeof Response === 'function';

/** Largest decompressed payload accepted (a doctored file must not exhaust memory). */
export const MAX_PLAIN_BYTES = 256 * 1024 * 1024;

async function pipe(bytes: Uint8Array<ArrayBuffer>, stream: CompressionStream | DecompressionStream, limit = Infinity): Promise<Uint8Array<ArrayBuffer>> {
  const reader = new Blob([bytes]).stream().pipeThrough(stream).getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel().catch(() => undefined);
      throw new SyncFileError('The file is larger than this app accepts.', 'damaged');
    }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/* ── Envelopes ─────────────────────────────────────────────────── */

export interface SyncEnvelope {
  v: 1;
  kdf: typeof KDF;
  iter: number;
  salt: string;
  iv: string;
  ct: string;
  /** Plaintext was gzip-compressed before encryption. */
  z?: 'gzip';
}

interface SealedFile {
  app: typeof SYNC_APP;
  kind: 'device' | 'blob';
  v: 1;
  /** Writer's random device id (not secret; also the file name). */
  device: string;
  envelope: SyncEnvelope;
}

const aadFor = (parts: string[]) => enc.encode(['mcsync1', ...parts].join('|'));

export async function sealText(k: SyncKey, plaintext: string, aad: string[]): Promise<SyncEnvelope> {
  let bytes: Uint8Array<ArrayBuffer> = enc.encode(plaintext);
  let z: 'gzip' | undefined;
  if (canGzip()) {
    try {
      bytes = await pipe(bytes, new CompressionStream('gzip'));
      z = 'gzip';
    } catch {
      bytes = enc.encode(plaintext);
    }
  }
  const iv = randomBytes(12);
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: aadFor(aad) }, k.key, bytes);
  return { v: 1, kdf: KDF, iter: k.iter, salt: k.salt, iv: bytesToBase64(iv), ct: bytesToBase64(new Uint8Array(ct)), ...(z ? { z } : {}) };
}

function isEnvelope(e: unknown): e is SyncEnvelope {
  const x = e as SyncEnvelope | null;
  return !!x && typeof x === 'object' && x.v === 1 && x.kdf === KDF && Number.isInteger(x.iter) && typeof x.salt === 'string' &&
    typeof x.iv === 'string' && typeof x.ct === 'string' && (x.z === undefined || x.z === 'gzip');
}

export async function openText(k: SyncKey, e: SyncEnvelope, aad: string[], limit: number = MAX_PLAIN_BYTES): Promise<string> {
  if (e.salt !== k.salt || e.iter !== k.iter) throw new SyncFileError('This file was written with a different sync passphrase.', 'wrong-key');
  let plain: Uint8Array<ArrayBuffer>;
  try {
    const iv = base64ToBytes(e.iv);
    if (iv.length !== 12) throw new Error('bad iv');
    plain = new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv, additionalData: aadFor(aad) }, k.key, base64ToBytes(e.ct)));
  } catch {
    // Auth tag failed: a half-synced file, a damaged one, or a different key.
    throw new SyncFileError('The file is incomplete, damaged or not for this group.', 'damaged');
  }
  if (e.z === 'gzip') {
    if (!canGzip()) throw new SyncFileError('This browser cannot read compressed sync files.', 'damaged');
    plain = await pipe(plain, new DecompressionStream('gzip'), limit);
  }
  return dec.decode(plain);
}

/* ── Folder helpers ────────────────────────────────────────────── */

export interface GroupDirs {
  group: SyncDir;
  devices: SyncDir;
  blobs: SyncDir;
}

export async function readFileText(dir: SyncDir, name: string): Promise<string | null> {
  try {
    const h = await dir.getFileHandle(name);
    return await (await h.getFile()).text();
  } catch {
    return null;
  }
}

export async function writeFileText(dir: SyncDir, name: string, text: string): Promise<void> {
  const h = await dir.getFileHandle(name, { create: true });
  const w = await h.createWritable(); // Chromium writes a swap file and replaces atomically on close()
  await w.write(text);
  await w.close();
}

export async function listNames(dir: SyncDir, kind: 'file' | 'directory' = 'file'): Promise<string[]> {
  const out: string[] = [];
  try {
    for await (const e of dir.values()) if (e.kind === kind) out.push(e.name);
  } catch {
    /* unreadable folder: nothing listed */
  }
  return out.sort();
}

/** Groups (company folders) already present under `mrchartist-sync/` that carry a manifest. */
export async function listGroups(root: SyncDir): Promise<string[]> {
  let base: SyncDir;
  try {
    base = await root.getDirectoryHandle(SYNC_ROOT);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const name of await listNames(base, 'directory')) {
    if (!GROUP_RE.test(name)) continue;
    try {
      if ((await readFileText(await base.getDirectoryHandle(name), 'manifest.json')) !== null) out.push(name);
    } catch {
      /* skip */
    }
  }
  return out;
}

export async function openGroup(root: SyncDir, group: string, create: boolean): Promise<GroupDirs> {
  if (!GROUP_RE.test(group)) throw new Error('Use 2–40 lower-case letters, digits or dashes for the sync group name.');
  const base = await root.getDirectoryHandle(SYNC_ROOT, { create });
  const g = await base.getDirectoryHandle(group, { create });
  return {
    group: g,
    devices: await g.getDirectoryHandle('devices', { create: true }),
    blobs: await g.getDirectoryHandle('blobs', { create: true }),
  };
}

/* ── Manifest ──────────────────────────────────────────────────── */

export interface SyncManifest {
  app: typeof SYNC_APP;
  kind: 'manifest';
  v: 1;
  group: string;
  kdf: typeof KDF;
  iter: number;
  salt: string;
  /** A known text sealed with the group key: tells a joining device whether its passphrase is right. */
  check: SyncEnvelope;
  created_at: string;
}

export function parseManifest(text: string | null, group: string): SyncManifest | null {
  if (!text) return null;
  try {
    const m = JSON.parse(text) as SyncManifest;
    if (m?.app !== SYNC_APP || m.kind !== 'manifest' || m.v !== 1 || m.group !== group || m.kdf !== KDF) return null;
    if (!Number.isInteger(m.iter) || m.iter < MIN_ITER || m.iter > MAX_ITER || typeof m.salt !== 'string' || !isEnvelope(m.check)) return null;
    return m;
  } catch {
    return null;
  }
}

/**
 * Create the group's manifest (first device) or verify the passphrase against an existing one (joining).
 * Returns the derived key. Throws SyncFileError('wrong-key') for a wrong passphrase.
 */
export async function createOrJoinGroup(
  dirs: GroupDirs,
  group: string,
  passphrase: string,
  opts: { iter?: number; now?: Date } = {},
): Promise<{ key: SyncKey; created: boolean }> {
  const existing = parseManifest(await readFileText(dirs.group, 'manifest.json'), group);
  if (existing) {
    const key = await deriveSyncKey(passphrase, existing.salt, existing.iter);
    try {
      if ((await openText(key, existing.check, [group, 'manifest'])) !== CHECK_TEXT) throw new Error('mismatch');
    } catch {
      throw new SyncFileError('That passphrase does not open this sync group.', 'wrong-key');
    }
    return { key, created: false };
  }
  if ((await readFileText(dirs.group, 'manifest.json')) !== null) {
    throw new SyncFileError('This sync group has a damaged manifest.json. Pick another group name.', 'damaged');
  }
  const iter = opts.iter ?? PBKDF2_ITERATIONS;
  const key = await deriveSyncKey(passphrase, bytesToBase64(randomBytes(16)), iter);
  const manifest: SyncManifest = {
    app: SYNC_APP, kind: 'manifest', v: 1, group, kdf: KDF, iter, salt: key.salt,
    check: await sealText(key, CHECK_TEXT, [group, 'manifest']),
    created_at: (opts.now ?? new Date()).toISOString(),
  };
  await writeFileText(dirs.group, 'manifest.json', JSON.stringify(manifest, null, 2));
  return { key, created: true };
}

/* ── Device files and blobs ────────────────────────────────────── */

export const deviceFileName = (deviceId: string) => `${deviceId}${DEVICE_EXT}`;

export async function writeSealed(dir: SyncDir, name: string, k: SyncKey, kind: 'device' | 'blob', device: string, plaintext: string, aad: string[]): Promise<string> {
  const file: SealedFile = { app: SYNC_APP, kind, v: 1, device, envelope: await sealText(k, plaintext, aad) };
  const text = JSON.stringify(file);
  await writeFileText(dir, name, text);
  return text;
}

export async function readSealed(dir: SyncDir, name: string, k: SyncKey, kind: 'device' | 'blob', device: string, aad: string[]): Promise<string> {
  const text = await readFileText(dir, name);
  if (text === null) throw new SyncFileError('The file is missing.', 'missing');
  return openSealed(text, k, kind, device, aad);
}

/** Decrypt the text of a sealed file (already read). */
export async function openSealed(text: string, k: SyncKey, kind: 'device' | 'blob', device: string, aad: string[]): Promise<string> {
  let file: SealedFile;
  try {
    file = JSON.parse(text) as SealedFile;
  } catch {
    throw new SyncFileError('The file is incomplete or damaged.', 'damaged');
  }
  if (file?.app !== SYNC_APP || file.kind !== kind || file.v !== 1 || file.device !== device || !isEnvelope(file.envelope)) {
    throw new SyncFileError('Not a sync file from this app.', 'not-ours');
  }
  return openText(k, file.envelope, aad);
}

/** Device ids that have a file in `devices/`. */
export async function listDeviceIds(dirs: GroupDirs): Promise<string[]> {
  return (await listNames(dirs.devices))
    .filter((n) => n.endsWith(DEVICE_EXT))
    .map((n) => n.slice(0, -DEVICE_EXT.length))
    .filter((id) => DEVICE_RE.test(id));
}

export const isAttachmentId = (id: string) => ATT_RE.test(id);
export const isDeviceId = (id: string) => DEVICE_RE.test(id);

/** Retry helper for files the cloud client may still be writing. */
export async function withRetry<T>(fn: () => Promise<T>, attempts: number, delayMs: number): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (err instanceof SyncFileError && (err.code === 'wrong-key' || err.code === 'not-ours')) break;
      if (i < attempts - 1 && delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw last;
}
