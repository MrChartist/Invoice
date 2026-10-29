/**
 * PERF-5: `pako` is aliased to src/lib/stubs/pako-fflate.ts in the build (fast-png, jsPDF's PNG decoder, is its only
 * importer). The stub must inflate exactly what pako inflates, in the way fast-png drives it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as pako from 'pako';
import { Inflate, inflate } from '../src/lib/stubs/pako-fflate.ts';

/** Deterministic, partly repetitive bytes (like PNG scanlines). */
function sample(n: number, seed: number): Uint8Array {
  const out = new Uint8Array(n);
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    out[i] = i % 7 === 0 ? (x >>> 24) : out[Math.max(0, i - 4)] ^ (i & 3);
  }
  return out;
}

/** Splits a zlib stream like PNG IDAT chunks. */
function split(z: Uint8Array, size: number): Uint8Array[] {
  const parts: Uint8Array[] = [];
  for (let i = 0; i < z.length; i += size) parts.push(z.subarray(i, i + size));
  return parts;
}

test('Inflate matches pako.Inflate when fed chunk by chunk (fast-png IDAT pattern)', () => {
  for (const [n, level, size] of [[0, 6, 8], [1, 0, 1], [5000, 1, 100], [200_000, 6, 8192], [65_536, 9, 1000]] as const) {
    const raw = sample(n, n + level);
    const z = pako.deflate(raw, { level });
    const ref = new pako.Inflate();
    const ours = new Inflate();
    for (const part of split(z, size)) {
      ref.push(part);
      ours.push(part);
      assert.equal(ours.err, 0);
    }
    assert.equal(ref.err, 0);
    assert.deepEqual(ours.result, ref.result, `n=${n} level=${level}`);
    assert.deepEqual(ours.result, raw);
  }
});

test('inflate matches pako.inflate (iCCP profile)', () => {
  const raw = sample(3000, 7);
  const z = pako.deflate(raw);
  assert.deepEqual(inflate(z), pako.inflate(z));
});

test('a fresh Inflate per frame (APNG) starts empty', () => {
  const a = pako.deflate(sample(100, 1));
  const b = pako.deflate(sample(200, 2));
  const first = new Inflate();
  first.push(a);
  assert.deepEqual(first.result, sample(100, 1));
  const second = new Inflate();
  second.push(b);
  assert.deepEqual(second.result, sample(200, 2));
});

test('corrupt or truncated data throws where pako reports an error', () => {
  const z = pako.deflate(sample(5000, 3));
  const flipped = z.slice();
  flipped[flipped.length - 1] ^= 1; // bad Adler-32 trailer
  const truncated = z.subarray(0, z.length - 10);
  for (const bad of [flipped, truncated, new Uint8Array([0x78, 0x9c, 0xff, 0xff, 0xff, 0xff])]) {
    const ref = new pako.Inflate();
    ref.push(bad);
    assert.ok(ref.err !== 0 || ref.result === undefined, 'pako does not decode it either');
    const ours = new Inflate();
    ours.push(bad);
    assert.throws(() => ours.result);
    assert.throws(() => inflate(bad));
  }
});

test('vite.config.ts aliases pako to the stub', () => {
  const cfg = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8');
  assert.match(cfg, /pako: fileURLToPath\(new URL\('\.\/src\/lib\/stubs\/pako-fflate\.ts', import\.meta\.url\)\)/);
});
