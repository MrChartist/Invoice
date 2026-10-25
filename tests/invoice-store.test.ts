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
    pos: true,
    rcm_tax_excluded: true,
    goods_returned: false,
    eco_gstin: '07AAACZ1234A1C5', eco_section: 'PAY_9_5', challan_purpose: 'JOB_WORK',
    transport: { mode: 'ROAD', vehicle_no: 'MH12AB1234', transporter_name: 'Speedy', transporter_id: '27AAACS1234A1Z5', lr_no: 'LR1', lr_date: '2026-04-11', eway_bill_no: '321000123456', distance_km: 40 },
    approval: { state: 'pending', doc_id: 'full', requested_status: 'Sent', requested_by: 'Asha', requested_at: '2026-01-01T00:00:00.000Z' },
    branch_id: 'br1',
    loyalty_redeem: { points: 10, value: 5 },
    branch_transfer_id: 'str1',
    agent_id: 'ag1',
    offer: { scheme_id: 'sc1', label: 'Bill offer: 5% off on ₹1000+', value: 50 },
    rx: { patient: 'P', prescriber: 'Dr. Q' },
    party_balance_snapshot: { previous: 1250.5, bill: 999, paid: 100, as_of: '2026-04-10' },
    payment_schedule: [{ id: 'i1', label: 'Deposit', due_date: '2026-04-10', percent: 30 }, { id: 'i2', due_date: '2026-05-10', percent: 70 }],
    acceptance: { signer: 'Ravi', signed_at: '2026-04-11T05:30:00.000Z', method: 'counter', amount: 1, signature: 'data:image/png;base64,iVBORw0KGgo=' },
    amends: { original_number: 'INV/FY26-27/0041', original_date: '2026-04-09', period: '042026', amended_on: '2026-05-02', reason: 'GSTIN typo', original: { id: 'x1', invoice_number: 'INV/FY26-27/0041' } },
    created_at: '2026-04-10T00:00:00Z', updated_at: '2026-04-11T00:00:00Z',
    // R2-B
    milestones: [{ id: 'm1', name: 'Plinth', percent: 30, expected_date: '2026-05-01' }],
    progress_of: { source_id: 'q0', basis: 'percent', value: 30, stage: 1 },
    revision_of: 'q0', revision_no: 2,
    proposal_sections: [{ id: 's1', place: 'cover', title: 'Scope', body: 'Two floors' }],
    attention: { name: 'R. Iyer', role: 'Accounts' },
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

test('stock-tracking line fields survive load → edit → save; untracked lines gain none (6.6 / 6.10 / 6.11)', () => {
  const tracked = {
    id: 'l1', name: 'Phone X', type: 'product', quantity: 2, rate: 100, amount: 200, order_line_id: 'so-l1',
    batch_no: 'B7', batch_expiry: '2027-12-31', batch_mfg: '2026-01-01', serials: ['IMEI1', 'IMEI2'], warranty_months: 12, godown_id: 'g2',
  };
  const r = normalizeRecord({ ...legacy, gst_mode: 'IGST', items: [tracked, { id: 'l2', name: 'Plain', quantity: 1, rate: 5, amount: 5 }] });
  for (const k of Object.keys(tracked) as (keyof typeof tracked)[]) {
    assert.deepEqual((r.items[0] as unknown as Record<string, unknown>)[k], tracked[k], `line field ${k} survives`);
  }
  for (const k of ['batch_no', 'batch_expiry', 'batch_mfg', 'serials', 'warranty_months', 'godown_id']) {
    assert.ok(!(k in r.items[1]), `untracked line has no ${k}`);
  }
});

test('pricing line fields (6.9) survive load → edit → save; plain lines gain none', () => {
  const priced = { id: 'p1', name: 'Rice 5 kg', type: 'product', quantity: 10, rate: 300, amount: 3000, price_basis: 'Wholesale' };
  const free = { id: 'p2', name: 'Rice 5 kg', type: 'product', quantity: 1, rate: 0, amount: 0, scheme_id: 'sch1', free_of: 'p1' };
  const r = normalizeRecord({ ...legacy, gst_mode: 'IGST', items: [priced, free, { id: 'p3', name: 'Plain', quantity: 1, rate: 5, amount: 5 }] });
  assert.equal(r.items[0].price_basis, 'Wholesale');
  assert.equal(r.items[1].scheme_id, 'sch1');
  assert.equal(r.items[1].free_of, 'p1');
  for (const k of ['price_basis', 'scheme_id', 'free_of']) assert.ok(!(k in r.items[2]), `plain line has no ${k}`);
  assert.equal(normalizeRecord({ ...legacy, pos: true }).pos, true);
  assert.ok(!('pos' in normalizeRecord(legacy)), 'a non-POS record gains no pos flag');
});
