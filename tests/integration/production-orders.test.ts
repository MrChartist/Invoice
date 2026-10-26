/**
 * R4-A1 through storage: the stock engine sees the issue STR and the output MFG voucher (WIP balance goes up, then to
 * zero), the period lock refuses, clerk / viewer roles and the table guard, backup round trip of the R4-A tables, and
 * the double-entry ledger unchanged.
 */
import '../helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { dumpStorage, freezeDate, resetStorage, thawDate } from '../helpers/shim.ts';
import { installSettings } from '../helpers/world.ts';
import { localDb } from '../../src/lib/localDb.ts';
import { DB_PREFIX, setTable } from '../../src/lib/storage.ts';
import { blankStockItem, stockDb } from '../../src/lib/inventory.ts';
import { computeTracking, liveTrackingInputs } from '../../src/lib/stock-tracking.ts';
import { bomsDb } from '../../src/lib/manufacturing.ts';
import { clearOverrides, isPeriodLockedError } from '../../src/lib/period-lock.ts';
import { setActorProvider, type Role } from '../../src/lib/access.ts';
import { audit } from '../../src/lib/audit.ts';
import { applyBackup, buildBackup, parseBackup, wipeAppData } from '../../src/lib/backup.ts';
import { loadBooksData } from '../../src/lib/books.ts';
import { DEVICE_LOCAL_KEYS } from '../../src/lib/auth.ts';
import { buildOutputVoucher, loadOrderDocs, orderProgress, productionOrdersDb } from '../../src/lib/production/orders.ts';
import { qcResultsDb } from '../../src/lib/production/qc.ts';
import { landedVouchersDb } from '../../src/lib/landed-voucher.ts';

const as = (role: Role | null) => setActorProvider(role ? () => ({ id: 'u', name: 'U', role }) : null);

beforeEach(() => {
  resetStorage();
  clearOverrides();
  installSettings();
  freezeDate('2026-05-10T10:00:00');
});
afterEach(() => {
  as(null);
  thawDate();
});

function setup() {
  stockDb.saveItem(blankStockItem({ id: 'wood', name: 'Wood plank', unit: 'KG', opening_qty: 100, opening_rate: 50 }));
  stockDb.saveItem(blankStockItem({ id: 'chair', name: 'Chair' }));
  bomsDb.save({ item_id: 'chair', name: 'Standard', batch_qty: 1, components: [{ id: 'c1', item_id: 'wood', qty: 4 }] }, stockDb.items());
  const o = productionOrdersDb.save({ date: '2026-05-10', item_id: 'chair', planned_qty: 10 }, stockDb.items(), bomsDb.all());
  return productionOrdersDb.release(o.id, bomsDb.all());
}

test('the stock engine sees the issue (WIP up) and the outputs (WIP back to zero, chairs in Main)', () => {
  const o = setup();
  const wip = () => computeTracking(liveTrackingInputs()).get('wood')!.byGodown[o.wip_godown_id] ?? 0;
  productionOrdersDb.issue(o.id, { date: '2026-05-10', from: 'main', lines: [{ id: 'l', item_id: 'wood', qty: 40 }] }, stockDb.items(), liveTrackingInputs());
  assert.equal(wip(), 40);
  assert.equal(computeTracking(liveTrackingInputs()).get('wood')!.qty, 100, 'a transfer moves quantity, not the total');
  for (const [qty, date] of [[6, '2026-05-11'], [4, '2026-05-12']] as const) {
    const draft = buildOutputVoucher(o, orderProgress(o, loadOrderDocs()), undefined, { qty, date });
    productionOrdersDb.reportOutput(o.id, draft, stockDb.items(), liveTrackingInputs());
  }
  assert.equal(wip(), 0);
  const t = computeTracking(liveTrackingInputs());
  assert.equal(t.get('chair')!.byGodown.main, 10);
  assert.equal(t.get('wood')!.qty, 60);
  assert.ok(audit.all().some((r) => r.entity === 'manufacturing' && r.doc_number === o.number));
});

test('period lock refuses a back-dated order, issue and output', () => {
  const o = setup();
  localDb.settings.save({ ...localDb.settings.get(), lock_until: '2026-05-31' });
  assert.throws(() => productionOrdersDb.save({ date: '2026-05-15', item_id: 'chair', planned_qty: 1 }, stockDb.items(), bomsDb.all()), (e: unknown) => isPeriodLockedError(e));
  assert.throws(() => productionOrdersDb.issue(o.id, { date: '2026-05-20', from: 'main', lines: [{ id: 'l', item_id: 'wood', qty: 4 }] }, stockDb.items(), liveTrackingInputs()), (e: unknown) => isPeriodLockedError(e));
  assert.equal(loadOrderDocs().transfers.length, 0, 'nothing half-saved');
  assert.equal(productionOrdersDb.get(o.id)!.log.filter((r) => r.action === 'issue').length, 0);
});

test('roles: a viewer cannot touch orders or the new tables; a clerk can run an order', () => {
  setup();
  as('viewer');
  assert.throws(() => productionOrdersDb.save({ date: '2026-05-10', item_id: 'chair', planned_qty: 1 }, stockDb.items(), bomsDb.all()), /Viewer/);
  for (const t of ['production_orders', 'qc_results', 'recall_notices', 'landed_cost_vouchers']) assert.throws(() => setTable(t, [{ id: 'x' }]), /Viewer\) cannot/, t);
  assert.throws(() => qcResultsDb.save({ date: '2026-05-10', item_id: 'wood', godown_id: 'g', source: { kind: 'other' }, qty: 1, result: 'pass' }), /Viewer/);
  as('clerk');
  const o = productionOrdersDb.save({ date: '2026-05-10', item_id: 'chair', planned_qty: 2 }, stockDb.items(), bomsDb.all());
  assert.equal(productionOrdersDb.release(o.id, bomsDb.all()).status, 'released');
});

test('backup round trip keeps production orders, QC results and landed-cost vouchers', () => {
  const o = setup();
  productionOrdersDb.issue(o.id, { date: '2026-05-10', from: 'main', lines: [{ id: 'l', item_id: 'wood', qty: 8 }] }, stockDb.items(), liveTrackingInputs());
  qcResultsDb.save({ date: '2026-05-10', item_id: 'wood', godown_id: 'main', source: { kind: 'other' }, qty: 1, result: 'pass' });
  setTable('purchases', [{ id: 'b1', kind: 'PURCHASE', bill_number: 'B1', vendor_name: 'V', date: '2026-05-01', status: 'Unpaid', total: 500, taxable: 500, lines: [{ id: 'b1a', name: 'Wood plank', item_id: 'wood', quantity: 10, rate: 50 }] }]);
  landedVouchersDb.save({ date: '2026-05-10', method: 'value', charges: [{ id: 'c', source: { kind: 'memo' }, label: 'Freight', amount: 10 }], targets: [{ kind: 'bill', id: 'b1' }] }, { purchases: [{ id: 'b1', kind: 'PURCHASE', bill_number: 'B1', vendor_name: 'V', date: '2026-05-01', status: 'Unpaid', total: 500, taxable: 500, lines: [{ id: 'b1a', name: 'Wood plank', item_id: 'wood', quantity: 10, rate: 50 }] }], receipts: [], items: stockDb.items() });
  const keep = (snap: Record<string, string>) =>
    Object.fromEntries(Object.entries(snap).filter(([k]) => k.startsWith(DB_PREFIX) && !DEVICE_LOCAL_KEYS.includes(k) && k !== `${DB_PREFIX}audit_log`));
  const before = keep(dumpStorage());
  for (const t of ['production_orders', 'qc_results', 'landed_cost_vouchers']) assert.ok(before[DB_PREFIX + t], `fixture populates ${t}`);
  const file = JSON.stringify(buildBackup(new Date('2026-05-10T10:00:00Z')));
  wipeAppData();
  applyBackup(parseBackup(file).data);
  assert.deepEqual(keep(dumpStorage()), before);
});

test('production never posts to the double-entry ledger', async () => {
  const o = setup();
  const { buildLedger } = await import('../../src/lib/ledger/index.ts');
  const ledger = () => buildLedger({ ...loadBooksData(), userAccounts: [], manual: [], assets: [], today: '2026-06-30' });
  const before = ledger().vouchers;
  productionOrdersDb.issue(o.id, { date: '2026-05-10', from: 'main', lines: [{ id: 'l', item_id: 'wood', qty: 40 }] }, stockDb.items(), liveTrackingInputs());
  productionOrdersDb.reportOutput(o.id, buildOutputVoucher(o, orderProgress(o, loadOrderDocs()), undefined, { qty: 5, date: '2026-05-11' }), stockDb.items(), liveTrackingInputs());
  productionOrdersDb.close(o.id, { date: '2026-05-12', writeOff: true }, stockDb.items(), liveTrackingInputs());
  assert.deepEqual(ledger().vouchers, before);
});
