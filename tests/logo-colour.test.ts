/** R2-C5: accent suggestions from fixed RGBA pixel arrays. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { contrastOnWhite, ensureContrast, isNeutral, suggestAccents } from '../src/lib/logo-colour.ts';
import { contrastText } from '../src/lib/design-prefs.ts';

/** n pixels of one colour. */
const px = (n: number, r: number, g: number, b: number, a = 255) => Array.from({ length: n }, () => [r, g, b, a]).flat();
const hexRgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];

test('neutral pixels are ignored: a black-and-white logo has no suggestion', () => {
  assert.deepEqual(suggestAccents([...px(50, 255, 255, 255), ...px(50, 0, 0, 0), ...px(20, 128, 128, 128)]), []);
  assert.ok(isNeutral(250, 250, 250) && isNeutral(10, 10, 10) && isNeutral(120, 125, 130));
  assert.ok(!isNeutral(26, 77, 148));
});

test('transparent pixels are ignored', () => {
  assert.deepEqual(suggestAccents(px(100, 255, 0, 0, 0)), []);
});

test('dominant colour first, near-duplicates merged, at most three', () => {
  const data = [
    ...px(60, 26, 77, 148), // navy
    ...px(10, 28, 79, 150), // near-duplicate navy
    ...px(25, 200, 30, 30), // red
    ...px(10, 20, 140, 60), // green
    ...px(5, 230, 200, 20), // yellow (4th)
    ...px(200, 255, 255, 255), // white background
  ];
  const out = suggestAccents(data);
  assert.equal(out.length, 3);
  const [first] = out;
  const [r, g, b] = hexRgb(first.hex);
  assert.ok(b > r && b > g, `navy first, got ${first.hex}`);
  assert.ok(first.share > 0.6, 'navy + its near-duplicate share');
  for (const s of out) {
    assert.ok(contrastOnWhite(...hexRgb(s.hex)) >= 3, `${s.hex} reads on white`);
    assert.equal(s.onText, contrastText(s.hex));
  }
});

test('a light colour is darkened until it reads on white (hue kept)', () => {
  const [r, g, b] = ensureContrast(255, 200, 0);
  assert.ok(contrastOnWhite(r, g, b) >= 3);
  assert.ok(r > g && g > b, 'still a yellow / amber hue');
  const out = suggestAccents(px(10, 255, 220, 40));
  assert.equal(out.length, 1);
  assert.ok(contrastOnWhite(...hexRgb(out[0].hex)) >= 3);
});
