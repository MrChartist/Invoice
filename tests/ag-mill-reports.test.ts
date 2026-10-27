/** AG-C5: monthly mill report sums equal batch sums; CMR paddy is excluded from the bank statement (memo); by-product realisation. */
import './helpers/shim.ts';
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { thawDate } from './helpers/shim.ts';
import { clientMH } from './helpers/world.ts';
import { millWorld, runBatch } from './helpers/mill.ts';
import { setTable } from '../src/lib/storage.ts';
import { computeStock, liveInputs, stockDb } from '../src/lib/inventory.ts';
import { manufacturingDb } from '../src/lib/manufacturing.ts';
import { productionOrdersDb } from '../src/lib/production/orders.ts';
import { principalDb } from '../src/lib/job-work.ts';
import { STOCK_STATEMENT_PRESETS } from '../src/lib/trade/tr-stock-statement.ts';
import { addPaddyLot, loadAgreements, saveAgreement } from '../src/lib/agri/ag-cmr.ts';
import { addFigures, batchYield, ZERO } from '../src/lib/agri/ag-yield.ts';
import { loadMillReportInput, loadMillStockStatement, millGroup, millMonths, millStockGroups, principalMemo, realisation } from '../src/lib/agri/ag-mill-reports.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';

afterEach(() => thawDate());

const sale = (id: string, date: string, items: { name: string; quantity: number; rate: number; discount_percent?: number }[], status = 'Unpaid'): InvoiceRecord =>
  ({ id, invoice_number: id, doc_type: 'TAX_INVOICE', status, issue_date: date, client: clientMH, items: items.map((l, i) => ({ id: `${id}-${i}`, type: 'product', tax_rate: 0, amount: 0, ...l })) }) as unknown as InvoiceRecord;

test('monthly sums equal batch sums; intake own / CMR / job; standard input-weighted; flagged batches counted', async () => {
  const { ids } = millWorld('2026-11-30');
  setTable('purchases', [
    { id: 'p1', kind: 'PURCHASE', vendor_name: 'Farmer', bill_number: 'FPV/1', date: '2026-10-03', lines: [{ id: 'l', name: 'Paddy', item_id: ids.paddy, unit: 'QTL', quantity: 120, rate: 2300, tax_rate: 0 }], taxable: 276000, total: 276000 },
    { id: 'p2', kind: 'PURCHASE', vendor_name: 'Farmer', bill_number: 'FPV/2', date: '2026-11-03', lines: [{ id: 'l', name: 'paddy', unit: 'KG', quantity: 5000, rate: 23, tax_rate: 0 }], taxable: 115000, total: 115000 },
    { id: 'p3', kind: 'EXPENSE', vendor_name: 'Diesel', bill_number: 'X', date: '2026-11-03', lines: [{ id: 'l', name: 'Paddy', unit: 'QTL', quantity: 999, rate: 1, tax_rate: 0 }], taxable: 999, total: 999 },
  ]);
  setTable('clients', [{ ...clientMH, id: 'c-ag', name: 'State Agency' }]);
  const a = saveAgreement({ agency_id: 'c-ag', season: 'Kharif 2026-27', kind: 'raw' }, '2026-10-27');
  addPaddyLot(a.id, { date: '2026-11-04', qty: 40 });
  principalDb.save({ date: '2026-11-05', kind: 'receipt', party_name: 'Harpal', lines: [{ id: 'x', name: 'Wheat', qty: 300, unit: 'KG' }] });
  runBatch('2026-10-10', 100, 64, { input_moisture: 14, output_moisture: 13 });
  runBatch('2026-11-10', 50, 30, { standard_outturn_pct: 68 });
  runBatch('2026-11-20', 80, 52);
  const input = await loadMillReportInput();
  const months = millMonths(input);
  assert.deepEqual(months.map((m) => m.month), ['2026-11', '2026-10']);
  const total = months.reduce((t, m) => addFigures(t, m), ZERO);
  const batches = productionOrdersDb.all().reduce((t, o) => addFigures(t, batchYield(o, manufacturingDb.all(), stockDb.items())), ZERO);
  assert.deepEqual(total, batches, 'Σ months = Σ batches');
  const [nov, oct] = months;
  assert.deepEqual([oct.input, oct.main, oct.outturnPct, oct.standard, oct.moistureLoss, oct.intakeOwn, oct.intakeCmr, oct.intakeJob], [10000, 6400, 68, 67, 114.943, 12000, 0, 0]);
  assert.deepEqual([nov.input, nov.intakeOwn, nov.intakeCmr, nov.intakeJob], [13000, 5000, 4000, 300], 'expense bills are not intake; the CMR lot is not job intake');
  // Batch 2 (50 → 30 + 2 broken = 64% vs 68%) is flagged; batch 3 has no meta (no standard) → not flagged.
  assert.equal(nov.flagged, 1);
  assert.equal(nov.standard, 68, 'only batches with a standard weigh in');
  assert.equal(loadAgreements().length, 1);
});

test('by-product realisation: issued sales of by-product items (value after discount ÷ qty); drafts and other months left out', () => {
  const { ids } = millWorld();
  runBatch('2026-10-10', 100, 64);
  const input = { items: stockDb.items() };
  const invoices = [
    sale('S1', '2026-10-12', [{ name: 'Rice bran', quantity: 5, rate: 1600 }, { name: 'Rice husk', quantity: 10, rate: 450, discount_percent: 10 }, { name: 'Rice', quantity: 10, rate: 3500 }]),
    sale('S2', '2026-10-20', [{ name: 'rice bran', quantity: 3, rate: 1400 }]),
    sale('S3', '2026-10-21', [{ name: 'Rice bran', quantity: 50, rate: 1 }], 'Draft'),
    sale('S4', '2026-11-01', [{ name: 'Rice bran', quantity: 50, rate: 1 }]),
  ];
  const r = realisation(invoices, input.items, new Set([ids.bran, ids.husk]), '2026-10');
  assert.deepEqual(r.map((x) => [x.name, x.qty, x.value, x.rate]), [['Rice bran', 8, 12200, 1525], ['Rice husk', 10, 4050, 405]]);
});

test('bank stock statement (mill preset): grouped paddy / rice / broken / bran / husk; CMR paddy never in stock, shown as a memo', async () => {
  const { ids } = millWorld();
  runBatch('2026-10-10', 100, 64);
  setTable('clients', [{ ...clientMH, id: 'c-ag', name: 'State Agency' }]);
  const a = saveAgreement({ agency_id: 'c-ag', season: 'Kharif 2026-27', kind: 'raw' }, '2026-10-27');
  addPaddyLot(a.id, { date: '2026-10-20', qty: 500 });
  const positions = computeStock({ ...liveInputs(), asOf: '2026-10-27' });
  const groups = millStockGroups(positions, (g) => g.toUpperCase());
  assert.deepEqual(groups.map((g) => g.name), ['PADDY', 'RICE', 'BROKEN', 'BRAN', 'HUSK'], 'preset order');
  const paddyQty = positions.find((p) => p.item.id === ids.paddy)?.qty;
  assert.equal(paddyQty, 900, 'our 1,000 qtl less 100 milled — the agency\'s 500 qtl are not stock');
  assert.deepEqual(principalMemo(principalDb.all()), { qtl: 500, value: 0 });
  const st = await loadMillStockStatement('2026-10-27', '', {} as never, (g) => g);
  assert.equal(st.principalQtl, 500);
  assert.equal(st.groups.reduce((t, g) => t + g.value, 0).toFixed(2), positions.reduce((t, p) => t + p.value, 0).toFixed(2));
  assert.deepEqual(STOCK_STATEMENT_PRESETS.mill.groups, ['paddy', 'rice', 'broken', 'bran', 'husk', 'packing', 'other']);
  assert.deepEqual(['Gunny bags', 'Wheat', 'Mustard oil cake', 'Diesel'].map((n) => millGroup({ name: n })), ['packing', 'paddy', 'bran', 'other']);
});
