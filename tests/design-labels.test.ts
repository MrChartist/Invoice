/** R2-C5: Design Studio label overrides and title suffix. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_DESIGN,
  GLOBAL_PROFILE_ID,
  LABEL_KEYS,
  applyPreset,
  designForDoc,
  docTitleText,
  labelOverride,
  resolveDesignFrom,
  sanitizeDesign,
  sanitizeLabels,
} from '../src/lib/design-prefs.ts';

const rows = [
  { profile_id: GLOBAL_PROFILE_ID, labels: { qty: 'Units', rate: 'Price' }, title_suffix: { TAX_INVOICE: 'Goods' } },
  { profile_id: 'p1', labels: { qty: 'Hours' }, labels_by_type: { QUOTATION: { qty: 'Est. hours' } }, title_suffix: { TAX_INVOICE: 'Professional Services' } },
];

test('resolution order: document type → profile → global → default', () => {
  const d = resolveDesignFrom(rows, 'p1');
  assert.equal(labelOverride(d, 'qty', 'QUOTATION'), 'Est. hours', 'type wins');
  assert.equal(labelOverride(d, 'qty', 'TAX_INVOICE'), 'Hours', 'profile over global');
  assert.equal(labelOverride(d, 'rate', 'TAX_INVOICE'), 'Price', 'global when the profile has none');
  assert.equal(labelOverride(d, 'amount', 'TAX_INVOICE'), undefined, 'default when nobody overrides');
  const other = resolveDesignFrom(rows, 'p2');
  assert.equal(labelOverride(other, 'qty'), 'Units', 'a profile without a row gets the global labels');
  assert.equal(labelOverride(resolveDesignFrom([], 'p1'), 'qty'), undefined);
});

test('designForDoc flattens the type labels into one map the template reads', () => {
  const d = resolveDesignFrom(rows, 'p1');
  assert.equal(designForDoc(d, 'QUOTATION').labels?.qty, 'Est. hours');
  assert.equal(designForDoc(d, 'QUOTATION').labels?.rate, 'Price');
  assert.equal(designForDoc(d, 'TAX_INVOICE'), d, 'unchanged object when the type has no labels');
});

test('statutory title is kept: the suffix only appends', () => {
  const d = resolveDesignFrom(rows, 'p1');
  assert.equal(docTitleText('Tax Invoice', d, 'TAX_INVOICE'), 'Tax Invoice — Professional Services');
  assert.equal(docTitleText('Bill of Supply', d, 'BILL_OF_SUPPLY'), 'Bill of Supply');
  assert.equal(docTitleText('Tax Invoice', null, 'TAX_INVOICE'), 'Tax Invoice');
  const sneaky = sanitizeDesign({ title_suffix: { TAX_INVOICE: '   ' } });
  assert.equal(sneaky.title_suffix, undefined, 'a blank suffix cannot blank the title');
});

test('sanitising: unknown keys dropped, blanks removed, text capped, legacy objects round-trip unchanged', () => {
  assert.deepEqual(sanitizeLabels({ qty: '  Hours ', bogus: 'x', rate: '' }), { qty: 'Hours' });
  assert.equal(sanitizeLabels({}), undefined);
  assert.equal(sanitizeLabels({ qty: 'x'.repeat(100) })?.qty?.length, 40);
  const legacy = sanitizeDesign({ ...DEFAULT_DESIGN });
  assert.equal('labels' in legacy, false);
  assert.equal('labels_by_type' in legacy, false);
  assert.equal('title_suffix' in legacy, false);
  assert.deepEqual(sanitizeDesign({ labels_by_type: { NOPE: { qty: 'a' }, QUOTATION: { qty: 'b' } } }).labels_by_type, { QUOTATION: { qty: 'b' } });
  assert.ok(LABEL_KEYS.includes('qty') && LABEL_KEYS.includes('desc'));
});

test('a preset keeps the wording (labels, suffix)', () => {
  const d = resolveDesignFrom(rows, 'p1');
  const after = applyPreset(d, 'minimal');
  assert.equal(after.labels?.qty, 'Hours');
  assert.equal(after.title_suffix?.TAX_INVOICE, 'Professional Services');
  assert.equal(after.labels_by_type?.QUOTATION?.qty, 'Est. hours');
});
