/** RT-A2: MRP guard (warn / block, batch vs catalogue MRP, units, invoice discount, pharma combined), GST-cut MRP. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { KEYS, getTable, setJson, setTable } from '../src/lib/storage.ts';
import { basisFromRates, effectiveMrp, labelPriceNow, mrpAfterRateChange, mrpIssues, pricesPerBaseUnit as perUnit, relabelDue, withMrpIssues } from '../src/lib/retail/rt-mrp.ts';
import { RETAIL_SETTINGS_KEY, saveRetailSettings } from '../src/lib/retail/rt-settings.ts';
import { recordMrpOverrides } from '../src/lib/stock-tracking.ts';
import { audit } from '../src/lib/audit.ts';
import { liveDocTrackingIssues, liveMrpIssues } from '../src/lib/stock-tracking.ts';
import { PHARMA_SETTINGS_KEY } from '../src/lib/pharma-gate.ts';
import { mrpLessRate } from '../src/lib/pricing.ts';
import { relabelQueue, setMrpBasis, stampLabelsPrinted } from '../src/lib/retail/rt-mrp-store.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

const line = (o: Record<string, unknown> = {}) => ({ id: 'l1', name: 'Biscuit', quantity: 1, rate: 48, tax_rate: 0, amount: 48, ...o });
const doc = (items: Record<string, unknown>[], o: Record<string, unknown> = {}) => ({ doc_type: 'INVOICE', status: 'Sent', issue_date: '2026-07-10', items, ...o }) as never;

test('GST-cut MRP: 12 → 5 % lowers ₹45 to ₹42.19; never raised; basis until a day', () => {
  assert.equal(mrpAfterRateChange(45, 12, 5), 42.19);
  assert.equal(mrpAfterRateChange(45, 5, 12), 45, 'a rate increase never raises the MRP');
  assert.equal(effectiveMrp(45, { rate: 12 }, 5), 42.19);
  assert.equal(effectiveMrp(45, { rate: 12, until: '2025-09-21' }, 5, '2025-09-20'), 42.19);
  assert.equal(effectiveMrp(45, { rate: 12, until: '2025-09-21' }, 5, '2025-10-01'), 45, 'received after the cut: new MRP');
  assert.equal(effectiveMrp(45, undefined, 5), 45);
  assert.deepEqual(basisFromRates([{ from: '2017-07-01', rate: 12 }, { from: '2025-09-22', rate: 5 }], '2026-01-01'), { rate: 12, until: '2025-09-21' });
  assert.equal(basisFromRates([{ from: '2017-07-01', rate: 5 }, { from: '2025-09-22', rate: 18 }], '2026-01-01'), undefined, 'an increase gives no basis');
  assert.equal(mrpLessRate({ rate: 0, mrp: 45, mrp_less_percent: 10, mrp_tax_basis: { rate: 12 }, tax_rate: 5 }), 37.97, '"MRP less %" starts from the effective MRP');
  assert.equal(mrpLessRate({ rate: 0, mrp: 45, mrp_less_percent: 10 }), 40.5);
});

test('price per base unit: inclusive / exclusive GST, line discount, invoice discount share, alternate units', () => {
  const pricesPerBaseUnit = (d: Parameters<typeof perUnit>[0]) => perUnit(d).map((n) => Math.round(n * 100) / 100);
  assert.deepEqual(pricesPerBaseUnit({ items: [line({ rate: 40, tax_rate: 18 })] }), [47.2]);
  assert.deepEqual(pricesPerBaseUnit({ price_includes_tax: true, items: [line({ rate: 47.2, tax_rate: 18 })] }), [47.2]);
  assert.deepEqual(pricesPerBaseUnit({ items: [line({ rate: 50, discount_percent: 10 })] }), [45]);
  const [a, b] = pricesPerBaseUnit({ discount_type: 'AMOUNT', discount_rate: 10, items: [line({ rate: 50 }), line({ id: 'l2', name: 'Tea', rate: 50 })] });
  assert.equal(a, 45);
  assert.equal(b, 45, 'an amount discount is shared by line value');
  assert.deepEqual(pricesPerBaseUnit({ items: [line({ rate: 480, unit_factor: 10 })] }), [48], 'a box of 10 at ₹480 is ₹48 a unit');
});

test('warn vs block; owner asked, clerk refused; credit note and free lines not checked', () => {
  const d = { doc_type: 'INVOICE', items: [line(), line({ id: 'f', name: 'Free', rate: 0, free_of: 'l1' })] };
  const mrpOf = () => 45;
  const w = mrpIssues(d, { mode: 'warn', mrpOf, owner: false });
  assert.equal(w.warnings.length, 1);
  assert.match(w.warnings[0], /Biscuit: ₹48\.00 a unit .* above the MRP ₹45\.00/);
  const owner = mrpIssues(d, { mode: 'block', mrpOf, owner: true });
  assert.deepEqual([owner.errors.length, owner.confirm.length], [0, 1]);
  const clerk = mrpIssues(d, { mode: 'block', mrpOf, owner: false });
  assert.equal(clerk.errors.length, 1);
  assert.match(clerk.errors[0], /only the owner/);
  assert.deepEqual(mrpIssues({ ...d, doc_type: 'CREDIT_NOTE' }, { mode: 'block', mrpOf, owner: false }), { errors: [], warnings: [], confirm: [] });
  assert.deepEqual(mrpIssues(d, { mode: 'off', mrpOf, owner: false }).errors, []);
  assert.deepEqual(mrpIssues({ ...d, items: [line({ rate: 45 })] }, { mode: 'block', mrpOf, owner: false }).errors, [], 'at the MRP is fine');
  const merged = withMrpIssues({ errors: [], expired: [], warnings: [] }, owner);
  assert.equal(merged.expired.length, 1, 'the owner sees the existing "Sell anyway" confirmation');
});

test('live: catalogue MRP; batch MRP beats it; GST-cut basis on the stock item; off by default', () => {
  setTable(KEYS.items, [{ id: 'c1', name: 'Biscuit', rate: 48, mrp: 50, tax_rate: 0 }]);
  assert.deepEqual(liveMrpIssues(doc([line()])).warnings, [], 'guard off: nothing');
  saveRetailSettings({ mrp_guard: 'warn' });
  assert.equal(liveMrpIssues(doc([line({ rate: 51 })])).warnings.length, 1, 'catalogue MRP ₹50');
  assert.equal(liveMrpIssues(doc([line({ rate: 48 })])).warnings.length, 0);
  // A batch-tracked stock item whose batch says MRP ₹45: the batch MRP wins.
  setTable('stock_items', [{ id: 's1', name: 'Biscuit', unit: 'NOS', track_stock: true, track_batches: true, opening_qty: 0, opening_rate: 0, reorder_level: 0 }]);
  setTable('purchases', [{ id: 'p1', kind: 'PURCHASE', vendor_name: 'V', bill_number: 'B1', date: '2026-07-01', status: 'unpaid', lines: [{ id: 'pl', name: 'Biscuit', quantity: 10, rate: 30, tax_rate: 0, batch_no: 'B1', mrp: 45 }], taxable: 300, cgst: 0, sgst: 0, igst: 0, total: 300, amount_paid: 0, itc_eligible: true }]);
  assert.equal(liveMrpIssues(doc([line({ rate: 48, batch_no: 'B1' })])).warnings.length, 1, 'batch MRP ₹45 beats catalogue ₹50');
  setMrpBasis('Biscuit', { rate: 12 });
  const w = liveMrpIssues(doc([line({ rate: 43, batch_no: 'B1', tax_rate: 5, price: 0 })], { price_includes_tax: true }));
  assert.equal(w.warnings.length, 1, '₹43 is above the effective MRP ₹42.19');
  assert.match(w.warnings[0], /MRP ₹42\.19/);
});

test('pharma "block above MRP" and the guard together: the stricter applies, reported once', () => {
  setJson(PHARMA_SETTINGS_KEY, { enabled: true, block_above_mrp: true });
  setJson(RETAIL_SETTINGS_KEY, { mrp_guard: 'warn' });
  setTable('stock_items', [{ id: 's1', name: 'Syrup', unit: 'NOS', track_stock: true, track_batches: true, opening_qty: 0, opening_rate: 0, reorder_level: 0 }]);
  setTable('purchases', [{ id: 'p1', kind: 'PURCHASE', vendor_name: 'V', bill_number: 'B1', date: '2026-07-01', status: 'unpaid', lines: [{ id: 'pl', name: 'Syrup', quantity: 10, rate: 30, tax_rate: 0, batch_no: 'S1', mrp: 45 }], taxable: 300, cgst: 0, sgst: 0, igst: 0, total: 300, amount_paid: 0, itc_eligible: true }]);
  const r = liveDocTrackingIssues(doc([line({ name: 'Syrup', rate: 48, batch_no: 'S1' })]));
  assert.equal(r.errors.length, 1, 'the pharma block (stricter) stops the sale');
  assert.equal(r.warnings.filter((w) => /MRP check/.test(w)).length, 0, 'not reported twice');
});

test('owner override is audited; relabel queue after a price change', () => {
  recordMrpOverrides({ id: 'i1', invoice_number: 'INV/1' }, ['Biscuit: ₹48.00 a unit (incl. GST) is above the MRP ₹45.00 (MRP check)', 'Expired batch'], 'Owner', (r) => audit.record(r));
  const row = getTable<{ summary: string; doc_number?: string }>('audit_log').find((a) => /Sale above MRP allowed/.test(a.summary));
  assert.ok(row && row.doc_number === 'INV/1' && !/Expired/.test(row.summary));
  setTable(KEYS.items, [{ id: 'c1', name: 'Biscuit', rate: 48, mrp: 50, tax_rate: 0, barcode: '8901' }]);
  assert.equal(stampLabelsPrinted(['c1'], '2026-07-01T00:00:00Z'), 1);
  assert.deepEqual(relabelQueue(), []);
  setTable(KEYS.items, getTable<Record<string, unknown>>(KEYS.items).map((i) => ({ ...i, rate: 46 })));
  assert.deepEqual(relabelQueue().map((r) => r.key), ['c1']);
  assert.deepEqual(labelPriceNow({ rate: 46, mrp: 45, tax_rate: 5, mrp_tax_basis: { rate: 12 } }), { rate: 46, mrp: 42.19 });
  assert.equal(relabelDue([{ rate: 10, mrp: 0 }]).length, 0, 'never printed: not queued');
});
