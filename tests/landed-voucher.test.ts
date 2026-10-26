/**
 * R4-A5 landed-cost voucher: by value / qty / weight / equal over two bills (paisa drift to the largest line), FIFO
 * restatement and weighted average, double-use refusal, alternate units, a GRN target (unbilled and billed), delete
 * restores the costs, and the period lock on the earliest target date.
 */
import './helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { freezeDate, resetStorage, thawDate } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { blankStockItem, loadPositions, saveSettings, stockDb } from '../src/lib/inventory.ts';
import { getTable, setTable } from '../src/lib/storage.ts';
import { localDb } from '../src/lib/localDb.ts';
import { clearOverrides, isPeriodLockedError } from '../src/lib/period-lock.ts';
import { allocateLandedAmounts, allocateLandedCost } from '../src/lib/landed-cost.ts';
import { allocationRows, chargeCandidates, landedVouchersDb, targetLines } from '../src/lib/landed-voucher.ts';
import type { LandedMethod } from '../src/types/production-r4.ts';
import type { ReceiptNote } from '../src/types/purchases.ts';

beforeEach(() => {
  resetStorage();
  clearOverrides();
  installSettings();
  freezeDate('2026-05-10T10:00:00');
});
afterEach(() => thawDate());

const bill = (id: string, date: string, lines: object[], extra: object = {}) => ({ id, kind: 'PURCHASE', bill_number: id.toUpperCase(), vendor_name: 'Steel Co', date, status: 'Unpaid', total: 0, taxable: 0, lines, ...extra });

function world() {
  stockDb.saveItem(blankStockItem({ id: 'steel', name: 'Steel rod', unit: 'KG', net_weight: 1 }));
  stockDb.saveItem(blankStockItem({ id: 'bolt', name: 'Bolt', unit: 'NOS', net_weight: 0.01, alt_units: [{ unit: 'BOX', factor: 100 }] }));
  setTable('purchases', [
    bill('b1', '2026-04-05', [{ id: 'b1a', name: 'Steel rod', item_id: 'steel', quantity: 100, rate: 50 }, { id: 'b1b', name: 'Bolt', item_id: 'bolt', quantity: 2, rate: 500, unit: 'BOX', unit_factor: 100 }]),
    bill('b2', '2026-04-08', [{ id: 'b2a', name: 'Steel rod', quantity: 50, rate: 60 }]),
    bill('f1', '2026-04-15', [{ id: 'f1a', name: 'Freight inward', quantity: 1, rate: 900 }], { vendor_name: 'Fast Logistics' }),
  ]);
}
const ctx = () => ({ purchases: getTable('purchases'), receipts: getTable<ReceiptNote>('receipt_notes'), items: stockDb.items() });
const targets = [{ kind: 'bill' as const, id: 'b1' }, { kind: 'bill' as const, id: 'b2' }];
const freight = { id: 'c1', source: { kind: 'bill' as const, id: 'f1', line_id: 'f1a' }, label: 'F1 · Freight inward', amount: 900 };

test('the four bases over two bills; amounts add up exactly, drift to the largest line', () => {
  world();
  const lines = targetLines(targets, getTable('purchases'), [], stockDb.items());
  assert.deepEqual(lines.map((l) => l.lineId), ['b1a', 'b1b', 'b2a']);
  const by = (method: LandedMethod) => allocationRows({ method, charges: [freight] }, lines).map((r) => r.amount);
  assert.deepEqual(by('value'), [500, 100, 300]);
  assert.deepEqual(by('qty'), [257.14, 514.29, 128.57]);
  assert.deepEqual(by('weight'), [592.11, 11.84, 296.05]);
  assert.deepEqual(by('equal'), [300, 300, 300]);
  for (const m of ['value', 'qty', 'weight', 'equal'] as const) assert.equal(Math.round(by(m).reduce((s, x) => s + x, 0) * 100), 90000, m);
  // Drift: ₹100 by equal over 3 lines → 33.34 / 33.33 / 33.33 (the largest-weight line takes the paisa).
  assert.deepEqual(allocateLandedAmounts([{ quantity: 1, unitCost: 1 }, { quantity: 1, unitCost: 1 }, { quantity: 1, unitCost: 1 }], [{ label: 'x', amount: 100 }], 'equal'), [33.34, 33.33, 33.33]);
  // The per-unit function keeps its old signature and falls back to quantity when nothing can be weighed.
  assert.deepEqual(allocateLandedCost([{ quantity: 2, unitCost: 0 }, { quantity: 2, unitCost: 0 }], [{ label: 'x', amount: 10 }], 'weight'), [2.5, 2.5]);
  // Alternate units: 2 BOX = 200 NOS at ₹5 + ₹100 / 200 = ₹5.50 per NOS.
  const bolt = allocationRows({ method: 'value', charges: [freight] }, lines)[1];
  assert.deepEqual([bolt.qty_base, bolt.unit_before, bolt.unit_after], [200, 5, 5.5]);
});

test('the stock engine restates FIFO layers and the weighted average from the receipt date; delete restores', () => {
  world();
  const before = loadPositions().find((p) => p.item.id === 'steel')!;
  assert.equal(before.value, 8000);
  const v = landedVouchersDb.save({ date: '2026-04-20', method: 'value', charges: [freight], targets }, ctx());
  assert.equal(v.number, 'LCV/FY26-27/0001');
  assert.equal(v.allocation_snapshot.length, 3);
  const pos = () => new Map(loadPositions().map((p) => [p.item.id, p]));
  assert.equal(pos().get('steel')!.value, 8800, '100 × 55 + 50 × 66');
  assert.equal(pos().get('bolt')!.avgCost, 5.5);
  // FIFO: 120 kg sold after both receipts → 100 × 55 + 20 × 66.
  saveSettings({ method: 'FIFO', includeChallans: false });
  stockDb.addMove({ id: 's1', item_id: 'steel', date: '2026-04-25', qty: -120, rate: 80, kind: 'sale' });
  const steel = pos().get('steel')!;
  assert.equal(steel.value, 30 * 66);
  landedVouchersDb.remove(v.id, ctx());
  assert.equal(pos().get('steel')!.value, 30 * 60, 'deleting the voucher restores the bill cost');
  assert.deepEqual(getTable('purchases').map((p) => Object.keys(p as object).includes('__landed_extra')), [false, false, false], 'stored bills never change');
});

test('a charge line is spread once; non-stock lines are the candidates; a memo already on the bill is refused', () => {
  world();
  const cands = chargeCandidates(getTable('purchases'), stockDb.items(), []);
  assert.deepEqual(cands.map((c) => [c.source.id, c.source.line_id, c.amount]), [['f1', 'f1a', 900]]);
  landedVouchersDb.save({ date: '2026-04-20', method: 'qty', charges: [freight], targets }, ctx());
  assert.throws(() => landedVouchersDb.save({ date: '2026-04-21', method: 'value', charges: [freight], targets: [{ kind: 'bill', id: 'b2' }] }, ctx()), /already spread by landed-cost voucher LCV\/FY26-27\/0001/);
  assert.equal(chargeCandidates(getTable('purchases'), stockDb.items(), landedVouchersDb.all())[0].usedBy, 'LCV/FY26-27/0001');
  const rows = getTable<Record<string, unknown>>('purchases').map((p) => (p.id === 'b2' ? { ...p, landed_costs: [{ label: 'Octroi', amount: 50 }] } : p));
  setTable('purchases', rows);
  assert.throws(() => landedVouchersDb.save({ date: '2026-04-21', method: 'value', charges: [{ id: 'm', source: { kind: 'memo' }, label: 'Octroi', amount: 50 }], targets: [{ kind: 'bill', id: 'b2' }] }, ctx()), /already spread on bill B2/);
});

test('GRN targets: an unbilled GRN is valued with the charge; once billed the bill line carries it', () => {
  world();
  setTable('receipt_notes', [{ id: 'g1', kind: 'GRN', number: 'GRN/FY26-27/0001', date: '2026-04-10', vendor_name: 'Steel Co', lines: [{ id: 'g1a', name: 'Steel rod', item_id: 'steel', quantity: 10, rate: 40, tax_rate: 18 }] }]);
  landedVouchersDb.save({ date: '2026-04-20', method: 'value', charges: [{ id: 'm', source: { kind: 'memo' }, label: 'CHA', amount: 100 }], targets: [{ kind: 'grn', id: 'g1' }] }, ctx());
  const steel = () => loadPositions().find((p) => p.item.id === 'steel')!;
  assert.equal(steel().value, 8000 + 500, 'GRN 10 × (40 + 10)');
  setTable('purchases', [...getTable('purchases'), bill('b3', '2026-04-22', [{ id: 'b3a', name: 'Steel rod', item_id: 'steel', quantity: 10, rate: 42, grn_line_id: 'g1a' }])]);
  assert.equal(steel().value, 8000 + 520, 'billed at ₹42 + the ₹10 charge per kg');
});

test('period lock applies on the voucher date and on the earliest target date', () => {
  world();
  localDb.settings.save({ ...localDb.settings.get(), lock_until: '2026-04-06' });
  assert.throws(() => landedVouchersDb.save({ date: '2026-04-20', method: 'value', charges: [freight], targets }, ctx()), (e: unknown) => isPeriodLockedError(e));
  const v = landedVouchersDb.save({ date: '2026-04-20', method: 'value', charges: [freight], targets: [{ kind: 'bill', id: 'b2' }] }, ctx());
  assert.equal(v.allocation_snapshot[0].amount, 900);
});
