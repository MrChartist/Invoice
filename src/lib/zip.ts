/**
 * Minimal ZIP reader / writer — no dependency.
 *
 * Reader: walks the central directory, inflates entries with the platform's
 * native `DecompressionStream('deflate-raw')` (every modern browser, Node >= 18)
 * and checks each entry's CRC-32. Built for untrusted files (an .xlsx someone
 * downloaded), so it refuses what it cannot handle safely:
 *  - archives larger than `MAX_IMPORT_BYTES` (25 MB);
 *  - more than `maxEntries` entries;
 *  - encrypted entries, ZIP64, multi-disk archives, methods other than STORE / DEFLATE;
 *  - zip bombs: inflation stops the moment one entry outgrows its declared size
 *    or the archive's running total passes `maxTotalBytes` (100 MB default).
 *
 * Writer: STORE or DEFLATE (native `CompressionStream('deflate-raw')`), UTF-8 names.
 * Used by the .xlsx writer and available for other bundles (e.g. a ZIP of PDFs).
 *
 * Pure apart from the two native stream classes; no DOM.
 */

import { MAX_IMPORT_BYTES } from './csv';

export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipError';
  }
}

/* ── CRC-32 (IEEE 802.3) ─────────────────────────────────────── */

let CRC_TABLE: Uint32Array | null = null;
function crcTable(): Uint32Array {
  if (CRC_TABLE) return CRC_TABLE;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  CRC_TABLE = t;
  return t;
}

export function crc32(data: Uint8Array): number {
  const t = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = t[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* ── Streams ─────────────────────────────────────────────────── */

/** Copy into a fresh ArrayBuffer-backed view (what the stream typings want). */
function own(data: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(data.byteLength);
  out.set(data);
  return out;
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

/**
 * Pipe `data` through a native (de)compression stream, aborting as soon as the
 * output passes `limit` bytes (the zip-bomb guard: nothing beyond the limit is
 * ever held in memory).
 */
async function runStream(
  stream: { writable: WritableStream<Uint8Array<ArrayBuffer>>; readable: ReadableStream<Uint8Array> },
  data: Uint8Array,
  limit: number,
  overLimit: () => string,
): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  // Rejections surface through the reader; swallow them here so they are not "unhandled".
  writer.write(own(data)).catch(() => {});
  writer.close().catch(() => {});
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        reader.cancel().catch(() => {});
        throw new ZipError(overLimit());
      }
      chunks.push(value);
    }
  } catch (err) {
    if (err instanceof ZipError) throw err;
    throw new ZipError('The file is damaged (compressed data could not be read).');
  }
  return concat(chunks, total);
}

function hasStreams(): boolean {
  return typeof DecompressionStream === 'function' && typeof CompressionStream === 'function';
}

export async function inflateRaw(data: Uint8Array, limit: number): Promise<Uint8Array> {
  if (typeof DecompressionStream !== 'function') throw new ZipError('This browser cannot read compressed files. Update it and try again.');
  return runStream(new DecompressionStream('deflate-raw'), data, limit, () => 'The file expands to more data than allowed (possible zip bomb).');
}

export async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream !== 'function') throw new ZipError('This browser cannot create compressed files.');
  return runStream(new CompressionStream('deflate-raw'), data, Number.MAX_SAFE_INTEGER, () => '');
}

/* ── Reader ──────────────────────────────────────────────────── */

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  crc: number;
  /** Offset of the local file header. */
  offset: number;
}

export interface ZipLimits {
  /** Largest archive accepted (bytes). Default MAX_IMPORT_BYTES (25 MB). */
  maxBytes?: number;
  /** Most entries accepted. Default 5000. */
  maxEntries?: number;
  /** Cap on the sum of inflated bytes across every entry read. Default 100 MB. */
  maxTotalBytes?: number;
}

export const ZIP_DEFAULTS = { maxBytes: MAX_IMPORT_BYTES, maxEntries: 5000, maxTotalBytes: 100 * 1024 * 1024 } as const;

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;

export interface ZipArchive {
  entries: ZipEntry[];
  has(name: string): boolean;
  /** Inflated bytes of one entry, or null when it is not in the archive. */
  read(name: string): Promise<Uint8Array | null>;
  /** Same as `read`, decoded as UTF-8. */
  text(name: string): Promise<string | null>;
}

const utf8 = new TextDecoder('utf-8');

function decodeName(bytes: Uint8Array, isUtf8: boolean): string {
  if (isUtf8) return utf8.decode(bytes);
  // CP437 for ASCII is identical; anything else is decoded as Latin-1 (good enough for lookups).
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

/** Normalise an entry path for lookups: forward slashes, no leading "/" or "./". */
export function zipPath(name: string): string {
  return name.replace(/\\/g, '/').replace(/^(\.\/|\/)+/, '');
}

export function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/** Open a ZIP held in memory. Throws `ZipError` with a readable message. */
export function openZip(input: Uint8Array | ArrayBuffer, limits: ZipLimits = {}): ZipArchive {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const maxBytes = limits.maxBytes ?? ZIP_DEFAULTS.maxBytes;
  const maxEntries = limits.maxEntries ?? ZIP_DEFAULTS.maxEntries;
  const maxTotal = limits.maxTotalBytes ?? ZIP_DEFAULTS.maxTotalBytes;
  if (bytes.length > maxBytes) throw new ZipError(`The file is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.`);
  if (bytes.length < 22) throw new ZipError('Not a ZIP / Excel file (too short).');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // End of central directory: last 22 bytes, plus up to 65535 bytes of comment.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (dv.getUint32(i, true) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError('Not a ZIP / Excel file (no central directory).');
  const disk = dv.getUint16(eocd + 4, true);
  const cdDisk = dv.getUint16(eocd + 6, true);
  const count = dv.getUint16(eocd + 10, true);
  const cdSize = dv.getUint32(eocd + 12, true);
  const cdOffset = dv.getUint32(eocd + 16, true);
  if (disk !== 0 || cdDisk !== 0) throw new ZipError('Multi-part ZIP archives are not supported.');
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw new ZipError('ZIP64 archives are not supported.');
  if (count > maxEntries) throw new ZipError(`The archive has too many entries (${count}).`);
  if (cdOffset + cdSize > eocd) throw new ZipError('The file is damaged (central directory out of range).');

  const entries: ZipEntry[] = [];
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (p + 46 > bytes.length || dv.getUint32(p, true) !== SIG_CENTRAL) throw new ZipError('The file is damaged (bad central directory entry).');
    const flags = dv.getUint16(p + 8, true);
    const method = dv.getUint16(p + 10, true);
    const crc = dv.getUint32(p + 16, true);
    const compressedSize = dv.getUint32(p + 20, true);
    const size = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const offset = dv.getUint32(p + 42, true);
    const name = zipPath(decodeName(bytes.subarray(p + 46, p + 46 + nameLen), (flags & 0x800) !== 0));
    if (flags & 0x1) throw new ZipError('The file is password-protected (encrypted). Remove the password in Excel and try again.');
    if (compressedSize === 0xffffffff || size === 0xffffffff || offset === 0xffffffff) throw new ZipError('ZIP64 archives are not supported.');
    if (method !== 0 && method !== 8) throw new ZipError(`Unsupported compression method ${method} in "${name}".`);
    entries.push({ name, method, compressedSize, size, crc, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }

  const byName = new Map(entries.map((e) => [e.name.toLowerCase(), e]));
  let inflatedTotal = 0;

  const read = async (name: string): Promise<Uint8Array | null> => {
    const e = byName.get(zipPath(name).toLowerCase());
    if (!e) return null;
    const lo = e.offset;
    if (lo + 30 > bytes.length || dv.getUint32(lo, true) !== SIG_LOCAL) throw new ZipError(`The file is damaged (bad local header for "${e.name}").`);
    if (dv.getUint16(lo + 6, true) & 0x1) throw new ZipError('The file is password-protected (encrypted).');
    const start = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true);
    const end = start + e.compressedSize;
    if (end > bytes.length) throw new ZipError(`The file is damaged ("${e.name}" is truncated).`);
    const raw = bytes.subarray(start, end);
    const budget = maxTotal - inflatedTotal;
    if (e.size > budget) throw new ZipError('The file expands to more data than allowed (possible zip bomb).');
    let out: Uint8Array;
    if (e.method === 0) {
      if (e.compressedSize !== e.size) throw new ZipError(`The file is damaged ("${e.name}" size mismatch).`);
      out = raw;
    } else {
      // Never inflate past the declared size: a liar is either damaged or a bomb.
      out = await inflateRaw(raw, Math.min(e.size, budget));
      if (out.length !== e.size) throw new ZipError(`The file is damaged ("${e.name}" size mismatch).`);
    }
    inflatedTotal += out.length;
    if (crc32(out) !== e.crc) throw new ZipError(`The file is damaged (checksum failed for "${e.name}").`);
    return out;
  };

  return {
    entries,
    has: (name) => byName.has(zipPath(name).toLowerCase()),
    read,
    text: async (name) => {
      const b = await read(name);
      return b ? utf8.decode(b) : null;
    },
  };
}

/* ── Writer ──────────────────────────────────────────────────── */

export interface ZipInput {
  name: string;
  data: Uint8Array | string;
}

export interface ZipWriteOptions {
  /** DEFLATE entries (default true when the platform supports it, else STORE). */
  compress?: boolean;
  /** Timestamp written on every entry (default now). */
  date?: Date;
}

function dosTime(d: Date): { time: number; date: number } {
  const year = Math.min(Math.max(d.getFullYear(), 1980), 2107);
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

const utf8enc = new TextEncoder();

/** Build a ZIP archive in memory. Names are written as UTF-8. */
export async function writeZip(files: readonly ZipInput[], options: ZipWriteOptions = {}): Promise<Uint8Array> {
  const compress = options.compress ?? hasStreams();
  const { time, date } = dosTime(options.date ?? new Date());
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const seen = new Set<string>();

  for (const f of files) {
    const name = zipPath(f.name);
    if (!name || seen.has(name.toLowerCase())) throw new ZipError(`Duplicate or empty file name "${f.name}" in archive.`);
    seen.add(name.toLowerCase());
    const nameBytes = utf8enc.encode(name);
    const data = typeof f.data === 'string' ? utf8enc.encode(f.data) : f.data;
    const crc = crc32(data);
    let body = data;
    let method = 0;
    if (compress && data.length > 64) {
      const deflated = await deflateRaw(data);
      if (deflated.length < data.length) {
        body = deflated;
        method = 8;
      }
    }
    if (offset > 0xfffffffe || data.length > 0xfffffffe) throw new ZipError('Archive too large (ZIP64 is not supported).');

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, SIG_LOCAL, true);
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, 0x800, true); // UTF-8 names
    lv.setUint16(8, method, true);
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, body.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);

    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, SIG_CENTRAL, true);
    cv.setUint16(4, 20, true); // version made by
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x800, true);
    cv.setUint16(10, method, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, body.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    cd.set(nameBytes, 46);

    parts.push(local, body);
    central.push(cd);
    offset += local.length + body.length;
  }

  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, SIG_EOCD, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);

  const all = [...parts, ...central, eocd];
  return concat(all, all.reduce((s, c) => s + c.length, 0));
}

/** `writeZip` wrapped as a Blob, ready for `downloadBlob`. */
export async function zipBlob(files: readonly ZipInput[], options?: ZipWriteOptions): Promise<Blob> {
  const bytes = await writeZip(files, options);
  return new Blob([own(bytes)], { type: 'application/zip' });
}
