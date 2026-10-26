import './helpers/shim.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import {
  DEFAULT_DESIGN, MAX_LETTERHEAD_BYTES, activeArt, applyPreset, marginVars, pageSlices, resolveDesignFrom, sanitizeArt, sanitizeDesign,
  sanitizeLetterhead, sanitizeMargins, storeArtwork,
} from '../src/lib/design-prefs.ts';
import { SAFE_IMAGE } from '../src/lib/item-images.ts';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('margins clamp to 0–30 mm in half-mm steps', () => {
  assert.deepEqual(sanitizeMargins({ top: -4, right: 45, bottom: 10.26, left: 'x' }), { top: 0, right: 30, bottom: 10.5, left: 12.5 });
  assert.equal(sanitizeMargins(null), undefined);
  assert.deepEqual(marginVars(DEFAULT_DESIGN), {}, 'no margins → no change to the paper');
  assert.deepEqual(marginVars({ margins_mm: { top: 10, right: 5, bottom: 8, left: 12 } }), { '--tpl-pt': '10mm', '--tpl-px': '12mm', '--tpl-pr': '5mm', '--tpl-pb': '8mm' });
});

test('pageSlices: plain pages unchanged; header / footer bands on page 1 vs every page', () => {
  assert.deepEqual(pageSlices(2000, { paper: 'A4' }), [{ top: 0, height: 1123 }, { top: 1123, height: 1123 }]);
  assert.deepEqual(pageSlices(2000, { paper: 'A4' }, null), pageSlices(2000, { paper: 'A4' }));
  // Footer on every page, header band only on page 1 (part of the paper there).
  const foot = pageSlices(2400, { paper: 'A4' }, { footer: 100 });
  assert.deepEqual(foot.slice(0, 2), [{ top: 0, height: 1023, offset: 0 }, { top: 1023, height: 1023, offset: 0 }]);
  assert.equal(foot.length, 3);
  // Header repeated on every page: pages 2+ start below the band.
  const every = pageSlices(2400, { paper: 'A4' }, { header: 150, everyPage: true, footer: 100 });
  assert.deepEqual(every.slice(0, 2), [{ top: 0, height: 1023, offset: 0 }, { top: 1023, height: 873, offset: 150 }]);
  const once = pageSlices(2400, { paper: 'A4' }, { header: 150, everyPage: false });
  assert.deepEqual(once, pageSlices(2400, { paper: 'A4' }), 'a page-1-only header needs no extra room');
  assert.deepEqual(pageSlices(3000, { paper: 'thermal80' }, { footer: 100 }), [{ top: 0, height: 3000 }], 'thermal roll is one page');
});

test('pre-printed stationery excludes letterhead artwork; thermal never prints it', () => {
  const d = sanitizeDesign({ letterhead: { image: 'asset:abc', mode: 'header' }, footer_image: 'asset:def' });
  assert.deepEqual(activeArt(d), { letterhead: { image: 'asset:abc', mode: 'header', every_page: false }, footer: 'asset:def' });
  assert.equal(activeArt({ ...d, preprinted: { on: true, top_mm: 40, left_mm: 0 } }), null);
  assert.equal(activeArt({ ...d, paper: 'thermal80' }), null);
  assert.equal(activeArt(DEFAULT_DESIGN), null);
});

test('sanitise rejects non-image data URLs (same rule as catalogue photos) and oversize art', () => {
  assert.equal(SAFE_IMAGE.test(PNG), true);
  assert.equal(sanitizeArt(PNG), PNG);
  assert.equal(sanitizeArt('data:image/svg+xml;base64,PHN2Zz4='), undefined);
  assert.equal(sanitizeArt('data:text/html;base64,PGI+'), undefined);
  assert.equal(sanitizeArt('javascript:alert(1)'), undefined);
  assert.equal(sanitizeLetterhead({ image: 'data:image/svg+xml;base64,AA==' }), undefined);
  const big = `data:image/png;base64,${'A'.repeat(Math.ceil((MAX_LETTERHEAD_BYTES * 4) / 3) + 400)}`;
  assert.equal(sanitizeArt(big), undefined);
  assert.throws(() => storeArtwork(big), /400 kB/);
  assert.throws(() => storeArtwork('data:image/svg+xml;base64,AA=='), /PNG or JPEG/);
});

test('artwork is stored once in assets; design fields are additive and survive presets / layering', () => {
  resetStorage();
  const ref = storeArtwork(PNG);
  assert.match(ref, /^asset:/);
  assert.equal(storeArtwork(PNG), ref, 'same image, same reference');
  const legacy = sanitizeDesign({});
  assert.equal('margins_mm' in legacy || 'letterhead' in legacy || 'footer_image' in legacy || 'show_item_images' in legacy, false);
  const own = sanitizeDesign({ margins_mm: { top: 5, right: 5, bottom: 5, left: 5 }, letterhead: { image: ref, mode: 'background' }, show_item_images: true });
  const preset = applyPreset(own, 'compact');
  assert.deepEqual(preset.margins_mm, own.margins_mm);
  assert.equal(preset.letterhead?.mode, 'background');
  const merged = resolveDesignFrom([{ profile_id: '__global__', footer_image: ref }, { profile_id: 'p1', show_item_images: true }], 'p1');
  assert.equal(merged.footer_image, ref);
  assert.equal(merged.show_item_images, true);
});
