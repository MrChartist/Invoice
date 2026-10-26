/** TR-C4 bank stock statement (drawing power) and HSN-wise stock. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { DEFAULT_TERMS, drawingPower, loadBankStatementSettings, saveBankTerms, termsOf } from '../src/lib/trade/tr-stock-statement.ts';
import { hsnStock, hsnStockTotal } from '../src/lib/trade/tr-hsn-stock.ts';
import { creditorsForGoods, loadHsnStock, loadStockStatementInput } from '../src/lib/trade/tr-stock-live.ts';
import { stockDb, computeStock, liveInputs } from '../src/lib/inventory.ts';
import { loadStockValuer } from '../src/lib/ledger/index.ts';
import { setTable } from '../src/lib/storage.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

const base = { asOf: '2026-09-30', groups: [], consignment: 0, terms: DEFAULT_TERMS, outstanding: 0 };

test('drawing power: (stock − creditors) × 75% + debtors ≤ 90 days × 60%; older debtors excluded; limit caps', () => {
  const s = drawingPower({ ...base, stockTotal: 1_000_000, creditors: 200_000, debtors: [{ age: 30, amount: 300_000 }, { age: 90, amount: 100_000 }, { age: 91, amount: 50_000 }, { age: 10, amount: -5_000 }] });
  assert.equal(s.netStock, 800_000);
  assert.equal(s.dpStock, 600_000);
  assert.equal(s.debtorsIn, 400_000);
  assert.equal(s.debtorsOut, 50_000);
  assert.equal(s.dpDebtors, 240_000);
  assert.equal(s.dp, 840_000);
  assert.equal(s.available, 840_000);
  const capped = drawingPower({ ...base, stockTotal: 1_000_000, creditors: 200_000, debtors: [], terms: { ...DEFAULT_TERMS, limit: 500_000 }, outstanding: 450_000 });
  assert.equal(capped.available, 50_000);
  assert.equal(drawingPower({ ...base, stockTotal: 100, creditors: 500, debtors: [] }).netStock, 0, 'creditors above stock: no negative stock');
  assert.deepEqual(termsOf({ stock_margin: 150 as never, age_days: -1 }), { stock_margin: 25, debtor_margin: 40, age_days: 90 });
});

test('terms are saved per bank account (settings.manage)', () => {
  saveBankTerms('acc1', { stock_margin: 30, debtor_margin: 50, age_days: 120, limit: 2_500_000 });
  assert.deepEqual(loadBankStatementSettings().by_account?.acc1, { stock_margin: 30, debtor_margin: 50, age_days: 120, limit: 2_500_000 });
});

test('stock total equals the Books closing stock; consignment lots are not in it; HSN totals equal the stock summary', () => {
  stockDb.saveItem({ id: 'i1', name: 'Mustard oil 1L', hsn: '1514', unit: 'NOS', track_stock: true, opening_qty: 100, opening_rate: 150 } as never);
  stockDb.saveItem({ id: 'i2', name: 'Wheat bag', hsn: '1001', unit: 'BAG', track_stock: true, opening_qty: 20, opening_rate: 1200 } as never);
  setTable('arrivals', [{ id: 'a1', number: 'ARR/FY26-27/1', date: '2026-09-01', principal_id: 'v', principal_name: 'Farmer', lot_no: 'L', item_name: 'Wheat bag', unit: 'BAG', packages: 10, qty: 10, godown_id: 'g', status: 'open' }]);
  const input = loadStockStatementInput('2026-09-30', '', DEFAULT_TERMS);
  const valuer = loadStockValuer();
  const books = valuer ? valuer.value('2026-09-30') / 100 : computeStock({ ...liveInputs(), asOf: '2026-09-30' }).reduce((t, p) => t + p.value, 0);
  assert.equal(input.stockTotal, 39_000);
  assert.equal(Math.round(books), 39_000);
  assert.equal(input.groups.reduce((t, g) => t + g.value, 0), 39_000);
  assert.equal(input.consignment, 0, 'no lot value without sales; never added to stock');
  assert.equal(creditorsForGoods('2026-09-30'), 0);
  const hsn = loadHsnStock('2026-09-30');
  assert.equal(hsnStockTotal(hsn.rows), 39_000);
  assert.deepEqual(hsn.rows.map((r) => [r.hsn, r.qty]), [['1001', 20], ['1514', 100]]);
});

test('hsnStock: per godown share of value, zero rows dropped, grouped by HSN × godown × unit', () => {
  const rows = hsnStock([
    { hsn: '1001', unit: 'qtl', qty: 10, value: 25_000, byGodown: { main: 6, g2: 4 } },
    { hsn: '1001', unit: 'QTL', qty: 5, value: 12_500 },
    { hsn: '1514', unit: 'NOS', qty: 0, value: 0 },
  ]);
  assert.deepEqual(rows, [
    { hsn: '1001', godown: 'g2', unit: 'QTL', qty: 4, value: 10_000 },
    { hsn: '1001', godown: 'main', unit: 'QTL', qty: 11, value: 27_500 },
  ]);
});
