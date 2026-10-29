/**
 * PERF-5: build-time stand-in for `pako`, whose only importer is `fast-png` (jsPDF's PNG decoder for `addImage`).
 * jsPDF already bundles `fflate` (its own deflate), so the zlib inflate fast-png needs comes from there instead of a
 * second zlib library (~20 kB gz of the PDF chunk). Aliased in vite.config.ts; `tests/pako-fflate.test.ts` checks it
 * against pako byte for byte.
 *
 * fast-png uses: `new Inflate()`, `push(chunk)` once per IDAT / fdAT chunk, `err` after each push, `result` once all
 * chunks are in (then a fresh `Inflate` per frame), and `inflate(bytes)` for an iCCP profile. `push` only collects;
 * the stream is inflated when `result` is read. Like pako, the zlib Adler-32 trailer is checked (fflate skips it), so
 * corrupt or truncated data throws there (pako set `err` and fast-png threw on it) instead of decoding silently.
 * `fflate` is jsPDF's own dependency (resolved from node_modules like jsPDF resolves it).
 */
import { unzlibSync, zlibSync } from 'fflate';

/** Adler-32 of `d` (RFC 1950), as pako checks it. */
function adler32(d: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < d.length; ) {
    const end = Math.min(i + 5552, d.length);
    for (; i < end; i++) {
      a += d[i];
      b += a;
    }
    a %= 65521;
    b %= 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/** zlib inflate with the trailer check pako makes. */
function unzlib(z: Uint8Array): Uint8Array {
  const out = unzlibSync(z);
  const n = z.length;
  const want = n >= 6 ? ((z[n - 4] << 24) | (z[n - 3] << 16) | (z[n - 2] << 8) | z[n - 1]) >>> 0 : -1;
  if (adler32(out) !== want) throw new Error('incorrect data check');
  return out;
}

export class Inflate {
  err = 0;
  msg = '';
  private chunks: Uint8Array[] = [];
  private out: Uint8Array | undefined;

  push(data: Uint8Array): boolean {
    this.chunks.push(data);
    this.out = undefined;
    return true;
  }

  get result(): Uint8Array {
    if (!this.out) {
      const all = new Uint8Array(this.chunks.reduce((n, c) => n + c.length, 0));
      let at = 0;
      for (const c of this.chunks) {
        all.set(c, at);
        at += c.length;
      }
      this.out = unzlib(all);
    }
    return this.out;
  }
}

export const inflate = (data: Uint8Array): Uint8Array => unzlib(data);

/** fast-png's encoder imports it; the app never encodes PNGs (tree-shaken), kept so the import resolves. */
export const deflate = (data: Uint8Array, opts?: { level?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 }): Uint8Array =>
  zlibSync(data, { level: opts?.level ?? 6 });
