import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRecord } from '../src/store/invoice-defaults.ts';
import { calculateInvoice } from '../src/lib/invoice-calc.ts';

const legacy = {
  id: 'inv1', invoice_number: 'INV/FY24-25/0001', issue_date: '2025-01-10', due_date: '2025-01-24',
  tax_rate: 18, discount_rate: 0, discount_type: 'PERCENT', round_off_enabled: true, amount_paid: 100,
  items: [{ id: 'a', name: 'Consulting', quantity: 2, rate: 500, amount: 1000 }],
  total: 1180, balance_due: 1080,
};

test('legacy record normalises with all advanced tax off', () => {
  const r = normalizeRecord(legacy);
  assert.equal(r.gst_mode, 'SINGLE');
  assert.equal(r.tcs_enabled, false);
  assert.equal(r.tds_enabled, false);
  assert.equal(r.price_includes_tax, false);
  assert.equal(r.round_mode, undefined);
  assert.equal(r.tds_on_taxable, true);
});

test('legacy record recalculates to exactly its issued totals', () => {
  const t = calculateInvoice(normalizeRecord(legacy));
  assert.equal(t.total, 1180);
  assert.equal(t.balance_due, 1080);
  assert.equal(t.tds_amount, 0);
  assert.equal(t.tcs_amount, 0);
});

test('new fields survive normalisation', () => {
  const r = normalizeRecord({ ...legacy, tds_enabled: true, tds_rate: 5, tds_section: '194H', supply_type: 'EXPORT_LUT', round_mode: 'down', lut_number: 'L1' });
  assert.equal(r.tds_rate, 5);
  assert.equal(r.supply_type, 'EXPORT_LUT');
  assert.equal(r.round_mode, 'down');
  assert.equal(r.lut_number, 'L1');
});
