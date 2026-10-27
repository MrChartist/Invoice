/** AG-C4: the ≤ 25 kg pre-packaged rule, loose counter sales, end-use classes and the e-way hint by line mix. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { EXEMPT_EWAY_NOTE, classRate, endUseClass, ewayHint, looseOf, needsEndUse, packClass, suggestLine, withinPackLimit } from '../src/lib/agri/ag-packing.ts';

const D = '2026-10-27';

test('class pick by pack size and label: 25 kg exactly is packed (5%), 25.01 kg or unlabelled is loose (nil)', () => {
  const rice = { ag_class: 'cereal_loose' as const, ag_labelled: true };
  assert.equal(packClass({ ...rice, ag_pack_kg: 25 }, { date: D }), 'cereal_packed_25');
  assert.equal(packClass({ ...rice, ag_pack_kg: 25.01 }, { date: D }), 'cereal_loose');
  assert.equal(packClass({ ...rice, ag_pack_kg: 50 }, { date: D }), 'cereal_loose');
  assert.equal(packClass({ ...rice, ag_pack_kg: 10, ag_labelled: false }, { date: D }), 'cereal_loose');
  assert.equal(packClass({ ...rice, ag_pack_kg: 0 }, { date: D }), 'cereal_loose', 'no pack size → loose');
  assert.equal(packClass({ ag_class: 'flour_packed_25', ag_pack_kg: 30, ag_labelled: true }, { date: D }), 'flour_loose', 'a packed class over the limit falls back to loose');
  assert.equal(packClass({ ag_class: 'broken_rice', ag_pack_kg: 25, ag_labelled: true }, { date: D }), 'cereal_packed_25', 'broken rice packs like cereals');
  assert.equal(packClass({ ag_class: 'edible_oil', ag_pack_kg: 15, ag_labelled: true }), 'edible_oil', 'no pair → unchanged');
  assert.equal(packClass({}), undefined);
  assert.equal(withinPackLimit({ ag_pack_kg: 25, ag_labelled: true, unit: 'LTR' }, D), true, '25 L for a litre unit');
  assert.equal(looseOf('pulses_packed_25'), 'pulses_loose');
  const s5 = suggestLine({ ...rice, ag_pack_kg: 25 }, { date: D });
  const s0 = suggestLine({ ...rice, ag_pack_kg: 50 }, { date: D });
  assert.deepEqual([s5?.rate, s5?.exempt, s0?.rate, s0?.exempt], [5, false, 0, true]);
  assert.match(s5?.note ?? '', /25 kg → 5% \(N 6\/2022\)[\s\S]*AG5/);
});

test('a retail sale from a > 25 kg bag at the counter is loose, even when the item is a labelled pack', () => {
  assert.equal(packClass({ ag_class: 'cereal_loose', ag_pack_kg: 10, ag_labelled: true }, { counterLoose: true, date: D }), 'cereal_loose');
  assert.equal(suggestLine({ ag_class: 'pulses_loose', ag_pack_kg: 5, ag_labelled: true }, { counterLoose: true, date: D })?.rate, 0);
});

test('end-use choice: bran / cake as feed nil, otherwise 5%; DORB 5% whatever the use; husk nil', () => {
  assert.equal(endUseClass('rice_bran_feed', false), 'rice_bran_other');
  assert.equal(endUseClass('oil_cake_other', true), 'oil_cake_feed');
  assert.equal(endUseClass('dorb', true), 'dorb');
  assert.deepEqual([needsEndUse('rice_bran_feed'), needsEndUse('dorb'), needsEndUse(undefined)], [true, false, false]);
  assert.deepEqual([suggestLine({ ag_class: 'rice_bran_feed' }, { asFeed: false, date: D })?.rate, suggestLine({ ag_class: 'oil_cake_other' }, { asFeed: true, date: D })?.rate], [5, 0]);
  assert.deepEqual([classRate('dorb', D)?.rate, classRate('rice_husk', D)?.rate, classRate('rice_husk', D)?.hsn], [5, 0, '1213']);
});

test('e-way hint by line mix: exempt-only → "may not be needed — verify AG12"; taxable above ₹50,000 → prompt; services ignored', () => {
  assert.deepEqual(ewayHint([{ taxable: 90000, tax_rate: 0 }, { taxable: 40000, tax_rate: 0 }]), { kind: 'exempt_note', text: EXEMPT_EWAY_NOTE });
  assert.match(EXEMPT_EWAY_NOTE, /AG12/);
  assert.deepEqual(ewayHint([{ taxable: 60000, tax_rate: 5 }, { taxable: 90000, tax_rate: 0 }]), { kind: 'prompt', taxable: 60000 }, 'the value test is on the taxable lines');
  assert.deepEqual(ewayHint([{ taxable: 40000, tax_rate: 5 }, { taxable: 90000, tax_rate: 0 }]), { kind: 'none' });
  assert.deepEqual(ewayHint([{ taxable: 90000, tax_rate: 18, service: true }]), { kind: 'none' });
});
