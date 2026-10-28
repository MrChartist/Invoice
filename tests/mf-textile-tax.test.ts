/**
 * MF-C5 textile classes: before / after 22 Sep 2025; the garment / made-up band by value per piece (R9 rules read only);
 * every row unverified; a typed rate wins (notice only); the editor's band hook marks a line by `mf_class` without the
 * apparel pack; the pricing memo of a style.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bandMemo, classNotice, classRate, textileClassAt, TEXTILE_CLASSES } from '../src/lib/mfg/mf-textile-tax.ts';
import { TEXTILE_CLASS_RULES } from '../src/lib/mfg-rules.ts';
import type { StockItem } from '../src/lib/inventory.ts';

test('MMF fibre 18 → 5 and MMF yarn 12 → 5 from 22 Sep 2025; cotton yarn / fabric 5; job-work classes', () => {
  assert.deepEqual([classRate('mmf_fibre', '2025-09-21'), classRate('mmf_fibre', '2025-09-22')], [18, 5]);
  assert.deepEqual([classRate('mmf_yarn', '2025-09-21'), classRate('mmf_yarn', '2025-09-22')], [12, 5]);
  assert.deepEqual([classRate('cotton_yarn', '2026-01-01'), classRate('fabric', '2026-01-01'), classRate('jw_textile', '2026-01-01'), classRate('jw_other', '2026-01-01')], [5, 5, 5, 18]);
  assert.deepEqual([classRate('jw_print_ch48_49', '2025-09-21'), classRate('jw_print_ch48_49', '2025-09-22')], [12, 5]);
  for (const c of TEXTILE_CLASSES) for (const r of TEXTILE_CLASS_RULES[c]) assert.equal(r.verified, false, `${c} ${r.from} stays unverified until the CA answers`);
  assert.equal(textileClassAt('mmf_yarn', '2026-01-01').ca, 'MF1');
});

test('garments / made-ups follow the R9 band per piece: ≤ ₹2,500 5%, above 18% (from 22 Sep 2025)', () => {
  assert.deepEqual([classRate('garment', '2026-01-01', 899), classRate('garment', '2026-01-01', 2999), classRate('made_up', '2026-01-01', 2600)], [5, 18, 18]);
  assert.equal(classRate('garment', '2026-01-01', 2600, true), 5, 'MRP-inclusive: 2,600 ÷ 1.05 ≤ 2,500');
});

test('a typed rate wins: only a notice when it differs from the class', () => {
  assert.equal(classNotice('fabric', '2026-01-01', 5), '');
  assert.match(classNotice('mmf_yarn', '2026-01-01', 12), /differs.*5%.*MF1/);
  assert.equal(classNotice('not_a_class', '2026-01-01', 12), '');
});

test('the editor band hook marks a sale line by mf_class (garment → apparel, made_up → made_ups) without the apparel pack', () => {
  const src = readFileSync('src/components/creator/pricing-actions.ts', 'utf8');
  assert.match(src, /cls === 'garment' \? 'apparel' : cls === 'made_up' \? 'made_ups'/);
});

test('pricing memo: sizes whose list price falls in the 18% band', () => {
  const it = (id: string, size: string, sale: number): StockItem => ({ id, name: id, unit: 'PCS', track_stock: true, opening_qty: 0, opening_rate: 0, reorder_level: 0, variant_of: 'p', variant_attrs: { Size: size }, sale_rate: sale });
  const parent: StockItem = { id: 'p', name: 'Sherwani', unit: 'PCS', track_stock: true, opening_qty: 0, opening_rate: 0, reorder_level: 0, variant_axes: [{ name: 'Size', values: ['M', 'L', 'XL'] }] };
  const m = bandMemo(parent, [parent, it('a', 'M', 2400), it('b', 'L', 2600), it('c', 'XL', 2900)], '2026-01-01');
  assert.deepEqual(m, { limit: 2500, above: ['L', 'XL'], rate: 18 });
});
