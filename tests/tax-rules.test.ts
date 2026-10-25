import { test } from 'node:test';
import assert from 'node:assert/strict';
import { b2clThreshold, b2clThresholdLabel, GST_SLABS, ruleAt, tcsPresets, tdsSections } from '../src/lib/tax-rules.ts';
import { TDS_SECTIONS, TCS_PRESETS } from '../src/types/invoice.ts';

test('ruleAt picks the last version on or before the date, oldest before the first', () => {
  const v = [{ from: '2020-01-01', value: 'a' }, { from: '2022-06-15', value: 'b' }];
  assert.equal(ruleAt(v, '2019-12-31'), 'a');
  assert.equal(ruleAt(v, '2022-06-14'), 'a');
  assert.equal(ruleAt(v, '2022-06-15'), 'b');
  assert.equal(ruleAt(v, '2022-06-15T10:00:00'), 'b');
});

test('B2CL threshold: ₹2.5 lakh until 31 Jul 2024, ₹1 lakh from 1 Aug 2024', () => {
  assert.equal(b2clThreshold('2024-07-31'), 250000);
  assert.equal(b2clThreshold('2024-08-01'), 100000);
  assert.equal(b2clThresholdLabel('2023-04-01'), '₹2.5 lakh');
  assert.equal(b2clThresholdLabel('2026-04-01'), '₹1 lakh');
});

test('194H TDS is 5% before 1 Oct 2024 and 2% after', () => {
  const rate = (d: string) => tdsSections(d).find((s) => s.section === '194H')?.rate;
  assert.equal(rate('2024-09-30'), 5);
  assert.equal(rate('2024-10-01'), 2);
  assert.equal(TDS_SECTIONS.find((s) => s.section === '194H')?.rate, 2);
});

test('206C(1H) TCS presets are withdrawn from 1 Apr 2025', () => {
  assert.ok(tcsPresets('2025-03-31').some((p) => p.label.startsWith('206C(1H)')));
  assert.ok(!tcsPresets('2025-04-01').some((p) => p.label.startsWith('206C(1H)')));
  assert.ok(!TCS_PRESETS.some((p) => p.label.startsWith('206C(1H)')));
});

test('GST slabs include the 40% slab', () => {
  assert.ok((GST_SLABS as readonly number[]).includes(40));
});

test('RBI Bank Rate (MSMED interest): 5.50% from 5 Dec 2025, earlier dates unchanged', async () => {
  const { rbiBankRate } = await import('../src/lib/tax-rules.ts');
  assert.equal(rbiBankRate('2025-12-04'), 5.75);
  assert.equal(rbiBankRate('2025-12-05'), 5.5);
});
