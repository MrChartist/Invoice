/** AG-A3 farmer purchase voucher: FPV numbering, weight → quantity, quality cuts, charges, Table 5, 194Q. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { getTable } from '../src/lib/storage.ts';
import { purchasesDb } from '../src/lib/purchases.ts';
import { buildGstReport, type ReportPeriod } from '../src/lib/gst-reports.ts';
import { readPurchase, readPurchaseLines } from '../src/lib/purchase-normalize.ts';
import { saveFarmer } from '../src/lib/agri/ag-farmers.ts';
import { qualityCut, saveQualityTable } from '../src/lib/agri/ag-quality.ts';
import { farmerVouchers, saveVoucher, voucherWorking, type VoucherInput } from '../src/lib/agri/ag-vouchers.ts';
import { prompt194q } from '../src/lib/agri/ag-tax.ts';
import type { QualityParam } from '../src/types/agri-r12.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

const MOIST: QualityParam = { key: 'moisture', norm_pct: 17, mode: 'weight', per_point_pct: 1, reject_above: 22 };
const input = (over: Partial<VoucherInput> = {}): VoucherInput => ({
  vendor: saveFarmer({ name: 'Ram', ag: {} }), date: '2026-10-20', item: { name: 'Paddy', hsn: '100610', unit: 'QTL' },
  wt: { packages: 52, kind: 'BAG', gross: 2640, tare_per_package: 0.5, deduction: { basis: 'per_qtl', value: 0 }, gross_unit: 'KG' },
  rate: 2300, params: [MOIST], readings: { moisture: 19 }, ...over,
});

test('the PRD story: 52 bags, 2,640 kg gross, 0.5 kg tare, moisture 19% on a 17% norm → 2% cut', () => {
  const w = voucherWorking(input());
  assert.equal(w.netKg, 2614);
  assert.deepEqual([w.quality.cut_kg, w.quality.accepted_kg, w.qty], [52.28, 2561.72, 25.617]);
  assert.equal(w.goods, Math.round(25.617 * 2300 * 100) / 100);
  assert.match(w.declaration, /^Purchased from an agriculturist/);
});

test('price-mode cut, the reject line and a cap', () => {
  const r = qualityCut([{ key: 'foreign', norm_pct: 2, mode: 'price', per_point_pct: 1.5, max_pct: 3 }, { ...MOIST }], { foreign: 5, moisture: 23 }, 1000, 20);
  assert.equal(r.rows[0].cut_pct, 3, 'capped');
  assert.equal(r.cut_kg, 60);
  assert.equal(r.cut_rs, Math.round(940 * 20 * 0.03 * 100) / 100, 'price cut on the accepted weight');
  assert.equal(r.reject, true);
  assert.throws(() => saveVoucher(input({ readings: { moisture: 23 } })), /reject/);
});

test('save: FPV numbers survive a delete; net accepted weight is the line quantity; stock reads it; recovered charges less', () => {
  const a = saveVoucher(input());
  assert.equal(a.bill_number, 'FPV/FY26-27/0001');
  assert.equal(readPurchaseLines(a)[0].quantity, 25.617);
  assert.equal(a.lines[0].wt?.packages, 52, 'the R8 weighing stays on the line');
  purchasesDb.remove(a.id);
  const b = saveVoucher(input({ charges: [{ name: 'Hamali', amount: 104, by: 'farmer' }, { name: 'Market fee', amount: 1178, by: 'us' }] }));
  assert.equal(b.bill_number, 'FPV/FY26-27/0002', 'a deleted number is never reused');
  assert.equal(b.total, Math.round((25.617 * 2300 - 104) * 100) / 100, 'recovered charge less; ours a memo');
  assert.deepEqual(b.ag?.voucher?.charges?.map((c) => c.by), ['farmer', 'us']);
  assert.equal(farmerVouchers(getTable('purchases')).length, 1);
  assert.equal(readPurchase(b)!.tax, 0);
});

test('GSTR-3B Table 5 shows the voucher value as exempt inward', () => {
  const b = saveVoucher(input());
  const OCT: ReportPeriod = { kind: 'month', fyStart: 2026, month: 10 };
  assert.equal(buildGstReport([], getTable('purchases'), { period: OCT, filerStateCode: '27' }).gstr3b.inwardExempt.intra, b.taxable);
});

test('194Q prompt only when our turnover test passes and the FY purchases cross the threshold', () => {
  assert.equal(prompt194q('2026-10-20', 6_000_000, {}), '', 'turnover not entered');
  assert.equal(prompt194q('2026-10-20', 6_000_000, { '25-26': 50_000_000 }), '', 'turnover below 10 crore');
  assert.equal(prompt194q('2026-10-20', 4_000_000, { '25-26': 200_000_000 }), '');
  assert.match(prompt194q('2026-10-20', 6_000_000, { '25-26': 200_000_000 }), /194Q/);
});

test('quality tables: no presets, one per commodity', () => {
  saveQualityTable({ commodity: 'Paddy', params: [MOIST] });
  assert.throws(() => saveQualityTable({ commodity: 'paddy', params: [MOIST] }), /already/);
  assert.throws(() => saveQualityTable({ commodity: 'Wheat', params: [] }), /parameter/);
});
