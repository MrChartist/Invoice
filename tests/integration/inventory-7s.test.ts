/**
 * 7S through storage: production plans (PP/FY numbering, series high-water mark, period lock, roles, audit,
 * backup), serial-tracked manufacturing and job work saved through the data layer (stock checks on save, removal
 * refused when a later entry used a produced serial), the live branch closing-stock valuer, and selling price lists
 * applied by the invoice editor (customer price levels keep precedence).
 */
import '../helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { dumpStorage, freezeDate, resetStorage, thawDate } from '../helpers/shim.ts';
import { SELLER, installSettings } from '../helpers/world.ts';
import { localDb } from '../../src/lib/localDb.ts';
import { DB_PREFIX, KEYS, setTable } from '../../src/lib/storage.ts';
import { blankStockItem, loadPositions, stockDb } from '../../src/lib/inventory.ts';
import { computeTracking, liveTrackingInputs } from '../../src/lib/stock-tracking.ts';
import { manufacturingDb } from '../../src/lib/manufacturing.ts';
import { productionPlansDb } from '../../src/lib/mrp.ts';
import { ensureJobWorkerGodown, materialInDb, materialOutDb } from '../../src/lib/job-work.ts';
import { godownsDb, transfersDb } from '../../src/lib/godowns.ts';
import { branchesDb, UNASSIGNED } from '../../src/lib/branch.ts';
import { loadBranchStockValuer } from '../../src/lib/ledger/branch-stock.ts';
import { loadStockValuer } from '../../src/lib/ledger/index.ts';
import { clearOverrides, isPeriodLockedError } from '../../src/lib/period-lock.ts';
import { setActorProvider, type Role } from '../../src/lib/access.ts';
import { audit } from '../../src/lib/audit.ts';
import { applyBackup, buildBackup, parseBackup, wipeAppData } from '../../src/lib/backup.ts';
import { DEVICE_LOCAL_KEYS } from '../../src/lib/auth.ts';
import { priceLevelsDb } from '../../src/lib/pricing.ts';
import { useInvoiceStore } from '../../src/store/useInvoiceStore.ts';
import { pickCatalogItem } from '../../src/components/creator/pricing-actions.ts';

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

test('production plans: PP/FY numbering, never re-issued, period lock, roles, audit, backup', () => {
  stockDb.saveItem(blankStockItem({ id: 'chair', name: 'Chair' }));
  const items = stockDb.items();
  const a = productionPlansDb.save({ date: '2026-05-10', lines: [{ id: 'l', item_id: 'chair', qty: 10 }] }, items);
  assert.equal(a.number, 'PP/FY26-27/0001');
  const b = productionPlansDb.save({ date: '2026-03-20', lines: [{ id: 'l', item_id: 'chair', qty: 2 }] }, items);
  assert.equal(b.number, 'PP/FY25-26/0001', 'Indian FY of the plan date');
  productionPlansDb.remove(a.id);
  assert.equal(productionPlansDb.nextNumber('2026-05-11'), 'PP/FY26-27/0002', 'a deleted latest number is not issued again');
  assert.ok(audit.all().some((r) => r.entity === 'manufacturing' && r.doc_number === 'PP/FY26-27/0001' && /production plan/.test(r.summary)));
  localDb.settings.save({ ...localDb.settings.get(), lock_until: '2026-03-31' });
  assert.throws(() => productionPlansDb.remove(b.id), (e: unknown) => isPeriodLockedError(e));
  as('viewer');
  assert.throws(() => productionPlansDb.save({ date: '2026-05-10', lines: [{ id: 'l', item_id: 'chair', qty: 1 }] }, items), /Viewer/);
  assert.throws(() => setTable('production_plans', [{ id: 'x' }]), /Viewer\) cannot/);
  as(null);
  const keep = (snap: Record<string, string>) =>
    Object.fromEntries(Object.entries(snap).filter(([k]) => k.startsWith(DB_PREFIX) && !DEVICE_LOCAL_KEYS.includes(k) && k !== `${DB_PREFIX}audit_log`));
  const before = keep(dumpStorage());
  assert.ok(before[`${DB_PREFIX}production_plans`]);
  const file = JSON.stringify(buildBackup(new Date('2026-05-10T10:00:00Z')));
  wipeAppData();
  applyBackup(parseBackup(file).data);
  assert.deepEqual(keep(dumpStorage()), before);
});

function serialSetup() {
  stockDb.saveItem(blankStockItem({ id: 'board', name: 'Main board', track_serials: true, opening_qty: 3, opening_rate: 1000, opening_serials: ['B1', 'B2', 'B3'] }));
  stockDb.saveItem(blankStockItem({ id: 'phone', name: 'Phone', track_serials: true }));
}

test('serial manufacturing through storage: checks on save, removal refused once a produced serial is used', () => {
  serialSetup();
  const items = stockDb.items();
  const save = (date: string, board: string, phone: string) => manufacturingDb.save({
    date, item_id: 'phone', qty: 1, serials: [phone], components: [{ id: 'c', item_id: 'board', qty: 1, serials: [board] }], outputs: [], costs: [],
  }, items, liveTrackingInputs());
  const a = save('2026-05-10', 'B1', 'P1');
  assert.equal(a.number, 'MFG/FY26-27/0001');
  assert.throws(() => save('2026-05-11', 'B1', 'P2'), /B1 is not in stock/);
  assert.throws(() => save('2026-05-11', 'B2', 'P1'), /P1 is already in stock/);
  // Editing the same voucher keeps its own serials valid (its saved copy is left out of the check).
  manufacturingDb.save({ ...a, narration: 'edited' }, items, liveTrackingInputs());
  // A stock journal-like second voucher consumes P1 to make something else: the first can no longer be deleted.
  stockDb.saveItem(blankStockItem({ id: 'kit', name: 'Kit' }));
  manufacturingDb.save({ date: '2026-05-12', item_id: 'kit', qty: 1, components: [{ id: 'k', item_id: 'phone', qty: 1, serials: ['P1'] }], outputs: [], costs: [] }, stockDb.items(), liveTrackingInputs());
  assert.throws(() => manufacturingDb.remove(a.id), /P1/);
  const t = computeTracking(liveTrackingInputs());
  assert.equal(t.get('phone')!.serials.find((s) => s.serial === 'P1')?.inStock, false);
  assert.equal(loadPositions().find((p) => p.item.id === 'kit')!.value, 1000);
});

test('serial job work through storage: send B1/B2, refuse a serial not there, receive B1 back', () => {
  serialSetup();
  const items = stockDb.items();
  const g = ensureJobWorkerGodown({ name: 'Acme' });
  const out = materialOutDb.save({ date: '2026-05-01', party_name: 'Acme', job_worker_godown: g.id, lines: [{ id: 'l', item_id: 'board', qty: 2, serials: ['B1', 'B2'], rate: 1000 }] }, items, godownsDb.list());
  assert.throws(() => materialOutDb.save({ date: '2026-05-02', party_name: 'Acme', job_worker_godown: g.id, lines: [{ id: 'l', item_id: 'board', qty: 1, serials: ['B1'] }] }, items, godownsDb.list()), /B1 is not in that godown/);
  assert.throws(() => materialInDb.save({ date: '2026-05-05', party_name: 'Acme', job_worker_godown: g.id, consumed: [], received: [{ id: 'r', item_id: 'board', qty: 1, kind: 'returned', serials: ['B3'] }] }, items), /B3 is not in that godown/);
  const back = materialInDb.save({ date: '2026-05-05', party_name: 'Acme', job_worker_godown: g.id, consumed: [], received: [{ id: 'r', item_id: 'board', qty: 1, kind: 'returned', serials: ['B1'] }] }, items);
  const t = computeTracking(liveTrackingInputs()).get('board')!;
  assert.deepEqual([t.serials.find((s) => s.serial === 'B1')?.godown, t.serials.find((s) => s.serial === 'B2')?.godown], ['main', g.id]);
  assert.ok(out.number.startsWith('JWC/') && back.number.startsWith('JWR/'));
});

test('live branch closing stock: the Pune branch carries the goods in its godown; the parts add up', () => {
  stockDb.saveItem(blankStockItem({ id: 'a', name: 'A', opening_qty: 10, opening_rate: 100 }));
  const pune = godownsDb.save({ name: 'Pune' });
  branchesDb.save({ name: 'Mumbai', godown_id: 'main' });
  const pb = branchesDb.save({ name: 'Pune', godown_id: pune.id });
  transfersDb.save({ date: '2026-05-01', from_godown: 'main', to_godown: pune.id, lines: [{ id: 'l', item_id: 'a', qty: 3 }] });
  const company = loadStockValuer()!;
  const puneStock = loadBranchStockValuer(pb.id)!;
  assert.equal(puneStock.value('2026-05-31'), 30000);
  const mum = loadBranchStockValuer(branchesDb.all().find((b) => b.name === 'Mumbai')!.id)!;
  assert.equal(mum.value('2026-05-31') + puneStock.value('2026-05-31') + loadBranchStockValuer(UNASSIGNED)!.value('2026-05-31'), company.value('2026-05-31'));
  assert.equal(loadBranchStockValuer(''), undefined);
});

test('editor: a selling price list in force sets the rate on pick; a customer level own rate still wins', () => {
  setTable(KEYS.items, [{ id: 'soap', name: 'Neem Soap', type: 'Product', hsn: '3401', unit: 'PCS', quantity: 1, rate: 40, tax_rate: 18, amount: 0 }]);
  stockDb.saveItem(blankStockItem({ id: 's', name: 'Neem Soap', hsn: '3401', selling_prices: [{ from: '2026-04-01', rate: 45 }, { from: '2026-06-01', rate: 48 }] }));
  const st = () => useInvoiceStore.getState();
  st().newDraft('INVOICE');
  st().setSender(SELLER);
  st().patch({ issue_date: '2026-05-10' });
  pickCatalogItem(st().items[0].id, localDb.items.getAll()[0]);
  assert.deepEqual([st().items[0].rate, st().items[0].price_basis], [45, 'Price list']);
  st().patch({ issue_date: '2026-06-15' });
  pickCatalogItem(st().items[0].id, localDb.items.getAll()[0]);
  assert.equal(st().items[0].rate, 48);
  // A level with its own rate for the item keeps precedence; a % level applies to the list rate.
  const own = priceLevelsDb.save({ id: '', name: 'Dealer', rates: { soap: 35 } });
  const cid = localDb.clients.upsert({ name: 'Dealer Co', email: '', address: '', city: '', zip: '', state_code: '27', price_level: own.id });
  st().setClient({ ...localDb.clients.getById(cid)!, id: cid });
  pickCatalogItem(st().items[0].id, localDb.items.getAll()[0]);
  assert.deepEqual([st().items[0].rate, st().items[0].price_basis], [35, 'Dealer']);
  const pct = priceLevelsDb.save({ id: '', name: 'Retail −10%', percent_off: 10 });
  localDb.clients.upsert({ ...localDb.clients.getById(cid)!, id: cid, price_level: pct.id });
  st().setClient({ ...localDb.clients.getById(cid)!, id: cid });
  pickCatalogItem(st().items[0].id, localDb.items.getAll()[0]);
  assert.deepEqual([st().items[0].rate, st().items[0].price_basis], [43.2, 'Retail −10%']);
  // Credit notes re-state an earlier price: no list rate.
  st().newDraft('CREDIT_NOTE');
  pickCatalogItem(st().items[0].id, localDb.items.getAll()[0]);
  assert.deepEqual([st().items[0].rate, st().items[0].price_basis], [40, undefined]);
});
