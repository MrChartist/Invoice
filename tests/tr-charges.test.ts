/** TR-B2 bill charges: each basis, GST treatment, register totals, recompute, HSN quantity unchanged. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { addUsualHeads, chargeAmount, chargeBase, chargeRegister, loadHeads, registerCsv, registerSummary, removeHead, saveHead, withCharges, type GoodsLine } from '../src/lib/trade/tr-charges.ts';
import { wtQuantity } from '../src/lib/trade/tr-weight.ts';
import { buildGstr1 } from '../src/lib/gst-reports.ts';
import { calcInputFromRecord, calculateInvoice } from '../src/lib/invoice-calc.ts';
import { getTable } from '../src/lib/storage.ts';
import type { ChargeHead, LineWeight } from '../src/types/trade-r8.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';
import type { PurchaseRecord } from '../src/types/purchases.ts';

beforeEach(() => resetStorage());
const wt: LineWeight = { packages: 120, kind: 'BAG', gross: 6072, tare_per_package: 0.6, deduction: { basis: 'per_qtl', value: 1 }, gross_unit: 'KG' };
const goods: GoodsLine & { id: string } = { id: 'g1', name: 'Wheat', hsn: '1001', unit: 'QTL', quantity: wtQuantity(wt, 'QTL')!, rate: 2450, tax_rate: 5, wt };
const other: GoodsLine & { id: string } = { id: 'g2', name: 'Gunny', hsn: '6305', unit: 'NOS', quantity: 10, rate: 30, tax_rate: 12 };
const head = (p: Partial<ChargeHead>): ChargeHead => ({ id: p.name ?? 'h', name: 'h', side: 'both', basis: 'percent', rate: 0, gst: 'in_value', ...p });
const make = (c: ReturnType<typeof import('../src/lib/trade/tr-charges.ts').chargeLine>, prev?: GoodsLine & { id: string }) => ({ id: prev?.id ?? `c-${c.charge_head_id}`, ...c });

test('each basis: % of goods value, per bag, per quintal, per unit, fixed', () => {
  const b = chargeBase([goods, other]);
  assert.deepEqual([b.value, b.bags, b.qtl, b.qty, b.hsn, b.taxRate], [145_830, 120, 59.4, 69.4, '1001', 5]);
  assert.equal(chargeAmount({ basis: 'percent', rate: 1 }, b).amount, 1458.3);
  assert.equal(chargeAmount({ basis: 'per_package', rate: 4 }, b).amount, 480);
  assert.equal(chargeAmount({ basis: 'per_qtl', rate: 2.5 }, b).amount, 148.5);
  assert.equal(chargeAmount({ basis: 'per_unit', rate: 1 }, b).amount, 69.4);
  assert.equal(chargeAmount({ basis: 'fixed', rate: 50 }, b).amount, 50);
});

test('in-value line takes the HSN and rate of the highest-value goods line; own-rate; pure agent outside value', () => {
  const heads = [head({ name: 'Market fee', rate: 1 }), head({ name: 'Aadat', rate: 2.5, gst: 'own_rate', sac: '996111', gst_rate: 18 }), head({ name: 'Dharmada', basis: 'fixed', rate: 20, gst: 'outside' })];
  const lines = withCharges([goods, other], heads, new Set(heads.map((h) => h.id)), make);
  const [mf, aadat, dh] = lines.slice(2);
  assert.deepEqual([mf.hsn, mf.tax_rate, mf.rate, mf.charge_head_id], ['1001', 5, 1458.3, 'Market fee']);
  assert.deepEqual([aadat.hsn, aadat.tax_rate, aadat.rate], ['996111', 18, 3645.75]);
  assert.deepEqual([dh.hsn, dh.tax_rate, dh.rate], ['', 0, 20]);
  assert.match((dh as { description?: string }).description ?? '', /pure agent/);
  // The in-value charge is taxed with the goods (5% of 1,458.30 = 72.92 more GST).
  const rec = (items: unknown[]) => ({ items, gst_mode: 'CGST_SGST', discount_type: 'PERCENT', discount_rate: 0, tax_rate: 0, shipping: 0, other_charges: 0, round_off_enabled: false, amount_paid: 0 }) as unknown as InvoiceRecord;
  const a = calculateInvoice(calcInputFromRecord(rec([goods, other])));
  const c = calculateInvoice(calcInputFromRecord(rec([goods, other, mf])));
  assert.equal(Math.round((c.tax_amount - a.tax_amount) * 100) / 100, 72.92);
});

test('recompute after a quantity change keeps the line id; switched-off heads go; zero amounts are dropped', () => {
  const heads = [head({ name: 'Hamali', basis: 'per_package', rate: 4 }), head({ name: 'Blank' })];
  const first = withCharges([goods], heads, new Set(['Hamali', 'Blank']), make);
  assert.equal(first.length, 2, 'blank-rate head adds nothing');
  const bigger = withCharges([{ ...goods, wt: { ...wt, packages: 150 } }, first[1]], heads, new Set(['Hamali']), make);
  assert.deepEqual([bigger[1].id, bigger[1].rate], [first[1].id, 600]);
  assert.equal(withCharges(bigger, heads, new Set(), make).length, 1);
});

test('register (sale and purchase sides), payable to mandi, CSV; GSTR-1 HSN quantity unchanged by charge lines', () => {
  const heads = [saveHead({ name: 'Market fee', basis: 'percent', rate: 1, payable: true }), saveHead({ name: 'Hamali', basis: 'per_package', rate: 4, side: 'sale' })];
  const items = withCharges([{ ...goods, unit_factor: 100, type: 'Goods', amount: 0 } as never], heads, new Set(heads.map((h) => h.id)), (c, p: { id?: string } | undefined) => ({ id: p?.id ?? `c${c.charge_head_id}`, type: 'Goods', amount: c.rate, discount_percent: 0, ...c }) as never);
  const inv = { id: 's1', doc_type: 'INVOICE', status: 'Sent', invoice_number: 'INV/FY26-27/0001', issue_date: '2026-10-05', due_date: '2026-10-05', client: { name: 'Buyer' }, items, gst_mode: 'CGST_SGST', place_of_supply: '27', discount_type: 'PERCENT', discount_rate: 0, tax_rate: 0, shipping: 0, other_charges: 0, round_off_enabled: false, amount_paid: 0, currency: 'INR' } as unknown as InvoiceRecord;
  const bill: PurchaseRecord = { id: 'p1', kind: 'PURCHASE', vendor_name: 'Farmer', bill_number: 'F/1', date: '2026-10-03', category: 'Purchases', lines: [{ id: 'b1', name: 'Wheat', hsn: '1001', unit: 'QTL', quantity: 10, rate: 2300, tax_rate: 0 }, { id: 'b2', name: 'Market fee', hsn: '1001', unit: 'OTH', quantity: 1, rate: 230, tax_rate: 0, charge_head_id: heads[0].id }], taxable: 23230, cgst: 0, sgst: 0, igst: 0, itc_eligible: false, total: 23230, amount_paid: 0 };
  const rows = chargeRegister({ from: '2026-10-01', to: '2026-10-31' }, { invoices: [inv], purchases: [bill, { ...bill, id: 'p2', status: 'cancelled' }], heads });
  assert.deepEqual(rows.map((r) => [r.side, r.head, r.base, r.amount]), [['purchase', 'Market fee', 23000, 230], ['sale', 'Market fee', 145530, 1455.3], ['sale', 'Hamali', 120, 480]]);
  const sum = registerSummary(rows, heads);
  assert.equal(sum.payable, 1685.3, 'market fee both sides');
  assert.equal(sum.heads.length, 3);
  assert.match(registerCsv(rows, { from: '2026-10-01', to: '2026-10-31' }), /verify with your CA[\s\S]*Total.*2165\.30/);
  const hsn = buildGstr1([inv], { period: { kind: 'month', fyStart: 2026, month: 10 } }).gstr1.hsn;
  const wheat = hsn.filter((h) => h.hsn === '1001');
  assert.equal(wheat.length, 1, 'charge lines merge into the goods row');
  assert.equal(wheat[0].qty, 59.4);
  assert.equal(wheat[0].taxable, 145530 + 1455.3 + 480);
});

test('heads: blank rates by default, no duplicates, delete through the data layer (recycle bin)', () => {
  assert.equal(addUsualHeads(), 7);
  assert.equal(addUsualHeads(), 0);
  assert.ok(loadHeads().every((h) => h.rate === 0 && h.gst === 'in_value'));
  assert.ok(loadHeads().find((h) => h.name === 'Market fee')?.payable);
  assert.throws(() => saveHead({ name: 'hamali' }), /already exists/);
  removeHead(loadHeads()[0].id);
  assert.equal(loadHeads().length, 6);
  assert.equal(getTable<{ table?: string }>('recycle_bin').filter((r) => r.table === 'trade_charge_heads').length, 1);
});

test('R8-B sample data (Demo company only): the weighed wheat sale carries exactly the charge lines withCharges makes', async () => {
  const { demoExtras } = await import('../src/lib/demo/profiles.ts');
  const { buildDemoDataset } = await import('../src/lib/demo-data.ts');
  const ex = await demoExtras('trading', { today: '2026-10-07', base: buildDemoDataset('2026-10-07'), packs: ['commodity'] });
  const sale = ex.invoices!.find((i) => i.id === 'demo-commodity-1')!;
  const heads = ex.tables!.trade_charge_heads as unknown as ChargeHead[];
  const [goods, ...charges] = sale.items;
  assert.equal(goods.quantity, wtQuantity(goods.wt!, 'QTL'));
  const made = withCharges([goods], heads, new Set(heads.map((h) => h.id)), make).slice(1);
  assert.deepEqual(charges.map((c) => [c.charge_head_id, c.rate, c.hsn, c.tax_rate]), made.map((c) => [c.charge_head_id, c.rate, c.hsn, c.tax_rate]));
  assert.equal(sale.broker_id, 'demo-broker-1');
  assert.ok(ex.tables!.stock_items?.some((s) => (s as { sold_by_weight_bags?: boolean }).sold_by_weight_bags));
});
