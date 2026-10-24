/**
 * Synchronous SHA-256 (FIPS 180-4) of a string's UTF-8 bytes, as lowercase hex.
 *
 * Exists because `audit.record` is synchronous and runs inside sync data-layer code,
 * while WebCrypto's `subtle.digest` is async-only. Kept deliberately tiny: the round
 * constants are derived from the primes at first use instead of being spelled out.
 * Checked against the NIST vectors in `tests/audit-chain.test.ts`.
 */

const K: number[] = [];
const H0: number[] = [];

/** First 32 bits of the fractional part. */
const frac = (x: number) => ((x - Math.floor(x)) * 2 ** 32) >>> 0;
const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

function init(): void {
  for (let n = 2; K.length < 64; n++) {
    let prime = true;
    for (let d = 2; d * d <= n; d++) if (n % d === 0) prime = false;
    if (!prime) continue;
    if (H0.length < 8) H0.push(frac(Math.sqrt(n)));
    K.push(frac(Math.cbrt(n)));
  }
}

export function sha256(text: string): string {
  if (!K.length) init();
  const bytes = new TextEncoder().encode(text);
  const len = bytes.length;
  // Message + 0x80 + 64-bit big-endian bit length, padded to 64-byte blocks, as 32-bit words.
  const m = new Uint32Array(((len + 72) >>> 6) << 4);
  for (let i = 0; i < len; i++) m[i >> 2] |= bytes[i] << (24 - (i & 3) * 8);
  m[len >> 2] |= 0x80 << (24 - (len & 3) * 8);
  m[m.length - 2] = Math.floor(len / 0x20000000);
  m[m.length - 1] = len << 3;

  const h = H0.slice();
  const w = new Uint32Array(64);
  for (let o = 0; o < m.length; o += 16) {
    for (let i = 0; i < 64; i++) {
      if (i < 16) w[i] = m[o + i];
      else {
        const a = w[i - 15];
        const b = w[i - 2];
        w[i] = (rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)) + w[i - 7] + (rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10)) + w[i - 16];
      }
    }
    let [a, b, c, d, e, f, g, k] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (k + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      k = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    [a, b, c, d, e, f, g, k].forEach((x, i) => (h[i] = (h[i] + x) | 0));
  }
  return h.map((x) => (x >>> 0).toString(16).padStart(8, '0')).join('');
}
