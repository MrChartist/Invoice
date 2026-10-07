import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateInvoice, type CalcInput } from '../src/lib/invoice-calc.ts';
import type { InvoiceItem } from '../src/types/invoice.ts';

function item(over: Partial<InvoiceItem>): InvoiceItem {
  return { id: 'x', name: 'n', type: 'Service', quantity: 1, rate: 0, amount: 0, tax_rate: 0, ...over };
}
function input(items: InvoiceItem[], over: Partial<CalcInput> = {}): CalcInput {
  return {
    items, gst_mode: 'IGST', discount_type: 'PERCENT', discount_rate: 0, tax_rate: 0,
    shipping: 0, other_charges: 0, round_off_enabled: false, amount_paid: 0, ...over,
  };
}

/* ── Legacy golden records: these totals must NEVER change ─────────── */
test('legacy golden A: 2 x 500 @18% CGST+SGST, round-off on', () => {
  const t = calculateInvoice(input([item({ quantity: 2, rate: 500, tax_rate: 18 })], { gst_mode: 'CGST_SGST', round_off_enabled: true }));
  assert.equal(t.taxable_value, 1000);
  assert.equal(t.cgst_amount, 90);
  assert.equal(t.sgst_amount, 90);
  assert.equal(t.total, 1180);
  assert.equal(t.balance_due, 1180);
  assert.equal(t.cess_amount + t.tcs_amount + t.tds_amount, 0);
});

test('legacy golden B: SINGLE tax 12% on 3 x 333.33, round-off on', () => {
  const t = calculateInvoice(input([item({ quantity: 3, rate: 333.33, tax_rate: 12 })], { gst_mode: 'SINGLE', round_off_enabled: true }));
  assert.equal(t.subtotal, 999.99);
  assert.equal(t.tax_amount, 120);
  assert.equal(t.total, 1120);
  assert.equal(t.round_off, 0.01);
});

test('legacy golden C: 10% invoice discount over two slabs, IGST', () => {
  const items = [item({ id: 'a', rate: 1000, tax_rate: 18 }), item({ id: 'b', rate: 500, tax_rate: 5 })];
  const off = calculateInvoice(input(items, { discount_rate: 10 }));
  assert.equal(off.discount_amount, 150);
  assert.equal(off.taxable_value, 1350);
  assert.equal(off.tax_amount, 184.5);
  assert.equal(off.total, 1534.5);
  const on = calculateInvoice(input(items, { discount_rate: 10, round_off_enabled: true, amount_paid: 500 }));
  assert.equal(on.total, 1535);
  assert.equal(on.round_off, 0.5);
  assert.equal(on.balance_due, 1035);
});

/* ── Tax-inclusive pricing ─────────────────────────────────────────── */
test('inclusive: 118 @18% -> taxable 100, tax 18', () => {
  const t = calculateInvoice(input([item({ rate: 118, tax_rate: 18 })], { price_includes_tax: true }));
  assert.equal(t.taxable_value, 100);
  assert.equal(t.tax_amount, 18);
  assert.equal(t.total, 118);
});

test('inclusive: 1000 @18% reconciles to the paise', () => {
  const t = calculateInvoice(input([item({ rate: 1000, tax_rate: 18 })], { price_includes_tax: true, gst_mode: 'CGST_SGST' }));
  assert.equal(t.taxable_value, 847.46);
  assert.equal(t.tax_amount, 152.54);
  assert.equal(t.cgst_amount, 76.27);
  assert.equal(t.sgst_amount, 76.27);
  assert.equal(t.total, 1000);
});

test('inclusive with cess: 1400 @28% + 12% cess -> 1000 / 280 / 120', () => {
  const t = calculateInvoice(input([item({ rate: 1400, tax_rate: 28, cess_rate: 12 })], { price_includes_tax: true }));
  assert.equal(t.taxable_value, 1000);
  assert.equal(t.igst_amount, 280);
  assert.equal(t.cess_amount, 120);
  assert.equal(t.total, 1400);
});

test('inclusive with invoice discount still totals to discounted amount', () => {
  const t = calculateInvoice(input([item({ rate: 1180, tax_rate: 18 })], { price_includes_tax: true, discount_type: 'AMOUNT', discount_rate: 118 }));
  assert.equal(t.taxable_value, 900);
  assert.equal(t.tax_amount, 162);
  assert.equal(t.total, 1062);
});

/* ── Cess ──────────────────────────────────────────────────────────── */
test('cess stacks on GST: 1000 @28% + 12% = 280 + 120', () => {
  const t = calculateInvoice(input([item({ rate: 1000, tax_rate: 28, cess_rate: 12 })]));
  assert.equal(t.cess_amount, 120);
  assert.equal(t.tax_amount, 280);
  assert.equal(t.total, 1400);
  assert.equal(t.lines[0].total, 1400);
});

test('fixed cess per unit: 10 x 100 @28% + 12% + 5/unit', () => {
  const t = calculateInvoice(input([item({ quantity: 10, rate: 100, tax_rate: 28, cess_rate: 12, cess_per_unit: 5 })], { gst_mode: 'CGST_SGST' }));
  assert.equal(t.cess_amount, 170);
  assert.equal(t.cgst_amount, 140);
  assert.equal(t.sgst_amount, 140);
  assert.equal(t.total, 1450);
});

test('no cess when GST mode is NONE', () => {
  const t = calculateInvoice(input([item({ rate: 1000, cess_rate: 12 })], { gst_mode: 'NONE' }));
  assert.equal(t.cess_amount, 0);
  assert.equal(t.total, 1000);
});

/* ── TCS ───────────────────────────────────────────────────────────── */
test('TCS 1% on invoice value vs taxable value', () => {
  const items = [item({ rate: 1000, tax_rate: 18 })];
  const onTotal = calculateInvoice(input(items, { tcs_enabled: true, tcs_rate: 1, tcs_base: 'total' }));
  assert.equal(onTotal.tcs_amount, 11.8);
  assert.equal(onTotal.total, 1191.8);
  const onTaxable = calculateInvoice(input(items, { tcs_enabled: true, tcs_rate: 1, tcs_base: 'taxable' }));
  assert.equal(onTaxable.tcs_amount, 10);
  assert.equal(onTaxable.total, 1190);
});

test('TCS is included before round-off', () => {
  const t = calculateInvoice(input([item({ rate: 1000, tax_rate: 18 })], { tcs_enabled: true, tcs_rate: 1, round_off_enabled: true }));
  assert.equal(t.total, 1192);
  assert.equal(t.round_off, 0.2);
});

test('TCS disabled ignores rate', () => {
  const t = calculateInvoice(input([item({ rate: 1000 })], { tcs_enabled: false, tcs_rate: 5 }));
  assert.equal(t.tcs_amount, 0);
});

/* ── TDS ───────────────────────────────────────────────────────────── */
test('TDS 10% on taxable value; total unchanged; balance reduced', () => {
  const t = calculateInvoice(input([item({ rate: 10000, tax_rate: 18 })], { tds_enabled: true, tds_rate: 10, amount_paid: 5000 }));
  assert.equal(t.total, 11800);
  assert.equal(t.tds_amount, 1000);
  assert.equal(t.payable, 10800);
  assert.equal(t.balance_due, 5800);
});

test('TDS on total (toggle off) and default-on-taxable when flag absent', () => {
  const items = [item({ rate: 10000, tax_rate: 18 })];
  assert.equal(calculateInvoice(input(items, { tds_enabled: true, tds_rate: 10, tds_on_taxable: false })).tds_amount, 1180);
  assert.equal(calculateInvoice(input(items, { tds_enabled: true, tds_rate: 10 })).tds_amount, 1000);
});

test('TDS 194C 2% and 194H 5% on 25,000', () => {
  const items = [item({ rate: 25000, tax_rate: 18 })];
  assert.equal(calculateInvoice(input(items, { tds_enabled: true, tds_rate: 2 })).tds_amount, 500);
  assert.equal(calculateInvoice(input(items, { tds_enabled: true, tds_rate: 5 })).tds_amount, 1250);
});

/* ── Supply types ──────────────────────────────────────────────────── */
test('export under LUT and SEZ without payment: zero tax', () => {
  for (const supply_type of ['EXPORT_LUT', 'SEZ_WITHOUT_PAYMENT'] as const) {
    const t = calculateInvoice(input([item({ rate: 1000, tax_rate: 18, cess_rate: 12 })], { supply_type }));
    assert.equal(t.tax_amount, 0);
    assert.equal(t.cess_amount, 0);
    assert.equal(t.total, 1000);
  }
});

test('SEZ/export with payment forces IGST even if mode was CGST_SGST', () => {
  const t = calculateInvoice(input([item({ rate: 1000, tax_rate: 18 })], { supply_type: 'SEZ_WITH_PAYMENT', gst_mode: 'CGST_SGST' }));
  assert.equal(t.igst_amount, 180);
  assert.equal(t.cgst_amount, 0);
  assert.equal(t.total, 1180);
});

test('deemed export and B2B are taxed normally', () => {
  for (const supply_type of ['DEEMED_EXPORT', 'B2B', 'B2C'] as const) {
    assert.equal(calculateInvoice(input([item({ rate: 1000, tax_rate: 18 })], { supply_type })).total, 1180);
  }
});

test('zero-rated inclusive pricing does not back out tax', () => {
  const t = calculateInvoice(input([item({ rate: 1180, tax_rate: 18 })], { supply_type: 'EXPORT_LUT', price_includes_tax: true }));
  assert.equal(t.taxable_value, 1180);
  assert.equal(t.total, 1180);
});

/* ── Rounding modes ────────────────────────────────────────────────── */
test('rounding modes', () => {
  const run = (rate: number, round_mode: CalcInput['round_mode']) =>
    calculateInvoice(input([item({ rate })], { round_mode }));
  assert.equal(run(1000.4, 'nearest').total, 1000);
  assert.equal(run(1000.4, 'nearest').round_off, -0.4);
  assert.equal(run(1000.4, 'up').total, 1001);
  assert.equal(run(1000.4, 'up').round_off, 0.6);
  assert.equal(run(1000.6, 'down').total, 1000);
  assert.equal(run(1000.6, 'down').round_off, -0.6);
  assert.equal(run(1000.6, 'none').total, 1000.6);
  assert.equal(run(1000.6, 'none').round_off, 0);
});

test('round_mode overrides round_off_enabled; absent mode falls back to it', () => {
  const items = [item({ rate: 1000.4 })];
  assert.equal(calculateInvoice(input(items, { round_off_enabled: false, round_mode: 'up' })).total, 1001);
  assert.equal(calculateInvoice(input(items, { round_off_enabled: true, round_mode: 'none' })).total, 1000.4);
  assert.equal(calculateInvoice(input(items, { round_off_enabled: true })).total, 1000);
});

/* ── Everything together ───────────────────────────────────────────── */
test('combined: cess + TCS + TDS + part payment', () => {
  // taxable 10000, GST 28% = 2800, cess 12% = 1200 -> 14000; TCS 0.1% of 14000 = 14 -> 14014
  // TDS 2% of taxable = 200 -> payable 13814; paid 4000 -> balance 9814
  const t = calculateInvoice(input([item({ rate: 10000, tax_rate: 28, cess_rate: 12 })], {
    tcs_enabled: true, tcs_rate: 0.1, tds_enabled: true, tds_rate: 2, amount_paid: 4000,
  }));
  assert.equal(t.total, 14014);
  assert.equal(t.tds_amount, 200);
  assert.equal(t.payable, 13814);
  assert.equal(t.balance_due, 9814);
});
