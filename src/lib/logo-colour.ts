/**
 * "Suggest accent from logo" (R2-C5). The logo is drawn on a small canvas on the device (no
 * network) and its pixels go through `suggestAccents`, a pure function over RGBA data:
 *   1. transparent and near-neutral pixels (greys, near-white, near-black) are ignored;
 *   2. the rest are bucketed (4 bits per channel) and counted;
 *   3. the most common buckets become candidates (their mean colour), skipping near-duplicates;
 *   4. each candidate is darkened until it reads on white paper (contrast ≥ 3:1), so the accent works
 *      as text and as a band whose text colour comes from `contrastText`.
 * Returns up to three hex swatches, most dominant first; [] for a logo with no real colour.
 */

import { contrastText, sanitizeHex } from './design-prefs';

export interface AccentSuggestion {
  hex: string;
  /** Text colour to use on this accent (white / near-black), from `contrastText`. */
  onText: string;
  /** Share of the coloured pixels in this bucket, 0–1. */
  share: number;
}

const toHex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;

function lin(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance of an RGB colour. */
export function luminance(r: number, g: number, b: number): number {
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Contrast ratio of a colour against white. */
export function contrastOnWhite(r: number, g: number, b: number): number {
  return 1.05 / (luminance(r, g, b) + 0.05);
}

/** True for pixels that carry no usable hue: greys, near-white, near-black. */
export function isNeutral(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max < 40) return true; // near-black
  if (min > 225) return true; // near-white
  const sat = max === 0 ? 0 : (max - min) / max;
  return sat < 0.22 || max - min < 28;
}

/** Darken (keeping the hue) until the colour has at least `ratio`:1 contrast on white. */
export function ensureContrast(r: number, g: number, b: number, ratio = 3): [number, number, number] {
  let k = 1;
  let out: [number, number, number] = [r, g, b];
  for (let i = 0; i < 40 && contrastOnWhite(...out) < ratio; i++) {
    k *= 0.92;
    out = [r * k, g * k, b * k];
  }
  return out.map((v) => Math.round(v)) as [number, number, number];
}

const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Up to `max` accent swatches from RGBA pixel data (row-major, 4 bytes per pixel). */
export function suggestAccents(rgba: ArrayLike<number>, max = 3): AccentSuggestion[] {
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  let coloured = 0;
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    const r = rgba[i];
    const g = rgba[i + 1];
    const b = rgba[i + 2];
    const a = rgba[i + 3];
    if (a < 128 || isNeutral(r, g, b)) continue;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const s = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    s.n++;
    s.r += r;
    s.g += g;
    s.b += b;
    buckets.set(key, s);
    coloured++;
  }
  if (!coloured) return [];
  const ranked = [...buckets.values()].sort((x, y) => y.n - x.n);
  const picked: { rgb: number[]; n: number }[] = [];
  for (const s of ranked) {
    const rgb = [s.r / s.n, s.g / s.n, s.b / s.n];
    const near = picked.find((p) => dist(p.rgb, rgb) < 48);
    if (near) {
      near.n += s.n;
      continue;
    }
    if (picked.length >= max) continue;
    picked.push({ rgb, n: s.n });
  }
  const out: AccentSuggestion[] = [];
  for (const p of picked.sort((x, y) => y.n - x.n)) {
    const [r, g, b] = ensureContrast(p.rgb[0], p.rgb[1], p.rgb[2]);
    const hex = sanitizeHex(toHex(r, g, b)) as string;
    if (out.some((o) => o.hex === hex)) continue;
    out.push({ hex, onText: contrastText(hex), share: Math.round((p.n / coloured) * 1000) / 1000 });
  }
  return out;
}

/** Browser only: draw a logo (data URL / same-origin URL) on a small canvas and suggest accents. */
export async function suggestAccentsFromImage(src: string, size = 64): Promise<AccentSuggestion[]> {
  if (!src || typeof document === 'undefined') return [];
  const img = new Image();
  img.decoding = 'async';
  img.src = src;
  await img.decode();
  const scale = Math.min(1, size / Math.max(img.naturalWidth || size, img.naturalHeight || size));
  const w = Math.max(1, Math.round((img.naturalWidth || size) * scale));
  const h = Math.max(1, Math.round((img.naturalHeight || size) * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return [];
  ctx.drawImage(img, 0, 0, w, h);
  return suggestAccents(ctx.getImageData(0, 0, w, h).data);
}
