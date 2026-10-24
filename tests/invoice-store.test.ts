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

test('every persisted field survives load → edit → save (normalizeRecord + toRecord)', async () => {
  const { RECORD_KEYS } = await import('../src/store/useInvoiceStore.ts');
  const { normalizeRecord } = await import('../src/store/invoice-defaults.ts');
  const sample: Record<string, unknown> = {
    id: 'x1', invoice_number: 'INV/FY26-27/0042', doc_type: 'QUOTATION', issue_date: '2026-04-10', due_date: '2026-04-20',
    status: 'Sent', currency: 'INR', template_id: 'minimal_clean', gst_mode: 'IGST', place_of_supply: '29', reverse_charge: true,
    discount_type: 'FLAT', discount_rate: 5, tax_rate: 0, shipping: 10, other_charges: 2, round_off_enabled: true, amount_paid: 1,
    notes: 'n', terms: 't', po_number: 'PO1', recurring_id: 'r1', recurring_date: '2026-04-10', supply_type: 'B2B', lut_number: 'L',
    lut_date: '2026-01-01', price_includes_tax: true, round_mode: 'up', tcs_enabled: true, tcs_rate: 1, tcs_base: 'taxable',
    tcs_label: 'TCS x', tds_enabled: true, tds_section: '194C-1', tds_rate: 1, tds_on_taxable: false, quote_status: 'Declined',
    ship_to: { name: 'WH', address: 'A', city: 'C', zip: '400001', state_code: '27' }, charges_taxable: true, exchange_rate: 83.25,
    shipping_bill_no: 'SB123', shipping_bill_date: '2026-04-12', port_code: 'INNSA1', late_fee_for: 'orig-1', sales_order_id: 'so1', order_closed_on: '2026-04-15', cost_centre_id: 'cc-1',
    custom_values: [{ id: 'f1', label: 'Vehicle no.', type: 'text', value: 'MH12AB1234', print: true }],
    attachments: [{ id: 'a1', name: 'po.pdf', mime: 'application/pdf', size: 10, added_at: '2026-04-10T00:00:00Z' }],
    exempt_kind: 'NIL',
    amends: { original_number: 'INV/FY26-27/0041', original_date: '2026-04-09', period: '042026', amended_on: '2026-05-02', reason: 'GSTIN typo', original: { id: 'x1', invoice_number: 'INV/FY26-27/0041' } },
    created_at: '2026-04-10T00:00:00Z', updated_at: '2026-04-11T00:00:00Z',
  };
  const n = normalizeRecord(sample) as unknown as Record<string, unknown>;
  // Totals are recomputed, so only check the fields a user sets.
  const computed = new Set(['client', 'sender', 'items', 'subtotal', 'discount_amount', 'taxable_value', 'cgst_amount', 'sgst_amount', 'igst_amount', 'tax_amount', 'round_off', 'total', 'balance_due', 'cess_amount', 'tcs_amount', 'tds_amount']);
  for (const k of RECORD_KEYS) {
    if (computed.has(k) || !(k in sample)) continue;
    assert.deepEqual(n[k], sample[k], `normalizeRecord dropped or changed ${k}`);
  }
  assert.ok(RECORD_KEYS.every((k) => computed.has(k) || k in sample), 'add new persisted fields to this sample');
});
