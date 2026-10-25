/**
 * Phase 7 manufacturing & stock vouchers through storage: BOM → Manufacturing Journal → live stock,
 * FY numbering, period lock, roles (books.edit / master.edit + table guard), audit, backup
 * round-trip, and the double-entry ledger / trial balance unchanged and balanced.
 */
import '../helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { dumpStorage, freezeDate, resetStorage, thawDate } from '../helpers/shim.ts';
import { installSettings } from '../helpers/world.ts';
import { localDb } from '../../src/lib/localDb.ts';
import { DB_PREFIX, setTable } from '../../src/lib/storage.ts';
import { blankStockItem, loadPositions, stockDb } from '../../src/lib/inventory.ts';
import { liveTrackingInputs } from '../../src/lib/stock-tracking.ts';
import { bomsDb, explodeBom, manufacturingDb, physicalStockDb, stockJournalsDb } from '../../src/lib/manufacturing.ts';
import { clearOverrides, isPeriodLockedError } from '../../src/lib/period-lock.ts';
import { setActorProvider, type Role } from '../../src/lib/access.ts';
import { audit } from '../../src/lib/audit.ts';
import { applyBackup, buildBackup, parseBackup, validateBackupData, wipeAppData } from '../../src/lib/backup.ts';
import { loadBooksData } from '../../src/lib/books.ts';
import { DEVICE_LOCAL_KEYS } from '../../src/lib/auth.ts';

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
  stockDb.saveItem(blankStockItem({ id: 'screw', name: 'Screw', opening_qty: 1000, opening_rate: 1 }));
  stockDb.saveItem(blankStockItem({ id: 'chair', name: 'Chair' }));
  const items = stockDb.items();
  const bom = bomsDb.save({ item_id: 'chair', name: 'Standard', batch_qty: 1, components: [{ id: 'c1', item_id: 'wood', qty: 4 }, { id: 'c2', item_id: 'screw', qty: 20 }] }, items);
  return { items, bom };
}

function make(date: string, qty: number) {
  const { items, bom } = { items: stockDb.items(), bom: bomsDb.forItem('chair')[0] };
  const exp = explodeBom(bom, qty);
  return manufacturingDb.save({
    date, item_id: 'chair', bom_id: bom.id, qty, components: exp.components.map(({ base: _b, scrap: _s, ...l }) => { void _b; void _s; return l; }),
    outputs: [], costs: [{ id: 'k', label: 'Labour', mode: 'amount', value: 100 }],
  }, items, liveTrackingInputs());
}

test('BOM → manufacture 2 units: finished +2, components reduced, cost snapshot, audited', () => {
  const { bom } = setup();
  assert.equal(bom.is_default, true, 'the first BOM of an item becomes its default');
  const v = make('2026-05-10', 2);
  assert.equal(v.number, 'MFG/FY26-27/0001');
  assert.deepEqual(v.cost_snapshot, { components: 440, additional: 100, deductions: 0, finished: 540, unit: 270 });
  const by = new Map(loadPositions().map((p) => [p.item.id, p]));
  assert.deepEqual([by.get('chair')!.qty, by.get('chair')!.value], [2, 540]);
  assert.equal(by.get('wood')!.qty, 92);
  assert.equal(by.get('screw')!.qty, 960);
  const rows = audit.all();
  assert.ok(rows.some((r) => r.entity === 'bom' && r.action === 'create'));
  assert.ok(rows.some((r) => r.entity === 'manufacturing' && r.doc_number === 'MFG/FY26-27/0001'));
  // Deleting the voucher reverses its stock effect.
  manufacturingDb.remove(v.id);
  assert.equal(loadPositions().find((p) => p.item.id === 'chair')!.qty, 0);
  // Series high-water mark (as for STR / PO): a deleted latest number is never issued again.
  assert.equal(manufacturingDb.nextNumber('2026-05-12'), 'MFG/FY26-27/0002');
  assert.equal(make('2026-05-12', 1).number, 'MFG/FY26-27/0002');
});

test('numbering across the financial year and the period lock', () => {
  setup();
  const a = make('2026-03-30', 1);
  const b = make('2026-04-02', 1);
  assert.deepEqual([a.number, b.number], ['MFG/FY25-26/0001', 'MFG/FY26-27/0001']);
  localDb.settings.save({ ...localDb.settings.get(), lock_until: '2026-03-31' });
  assert.throws(() => make('2026-03-31', 1), (e: unknown) => isPeriodLockedError(e));
  assert.throws(() => manufacturingDb.remove(a.id), (e: unknown) => isPeriodLockedError(e));
  const items = stockDb.items();
  assert.throws(() => physicalStockDb.save({ date: '2026-03-15', lines: [{ id: 'l', item_id: 'screw', counted: 1 }] }, items, liveTrackingInputs()), (e: unknown) => isPeriodLockedError(e));
  assert.equal(make('2026-04-03', 1).number, 'MFG/FY26-27/0002');
});

test('roles: viewer cannot post vouchers or edit BOMs; clerk can; the table guard covers every new table', () => {
  setup();
  as('viewer');
  assert.throws(() => make('2026-05-10', 1), /Viewer/);
  assert.throws(() => bomsDb.save({ item_id: 'chair', name: 'Alt', batch_qty: 1, components: [{ id: 'c', item_id: 'wood', qty: 1 }] }, stockDb.items()), /Viewer/);
  for (const t of ['boms', 'manufacturing_vouchers', 'stock_journals', 'physical_stock']) {
    assert.throws(() => setTable(t, [{ id: 'x' }]), /Viewer\) cannot/, t);
  }
  as('clerk');
  assert.equal(make('2026-05-10', 1).number, 'MFG/FY26-27/0001');
});

test('physical stock and stock journal through storage', () => {
  setup();
  stockDb.saveItem(blankStockItem({ id: 'pack', name: 'Screw pack (10)' }));
  const items = stockDb.items();
  const j = stockJournalsDb.save({ date: '2026-05-05', consume: [{ id: 'a', item_id: 'screw', qty: 100 }], produce: [{ id: 'b', item_id: 'pack', qty: 10 }], costs: [] }, items, liveTrackingInputs());
  assert.equal(j.number, 'SJ/FY26-27/0001');
  assert.equal(j.cost_snapshot?.finished, 100);
  const ph = physicalStockDb.save({ date: '2026-05-09', lines: [{ id: 'l', item_id: 'screw', counted: 880 }] }, items, liveTrackingInputs());
  assert.equal(ph.number, 'PHY/FY26-27/0001');
  assert.deepEqual([ph.lines[0].book_qty, ph.lines[0].diff], [900, -20]);
  assert.equal(loadPositions().find((p) => p.item.id === 'screw')!.qty, 880);
});

test('new tables survive backup → wipe → restore; damaged rows are refused', () => {
  setup();
  make('2026-05-10', 2);
  physicalStockDb.save({ date: '2026-05-10', lines: [{ id: 'l', item_id: 'wood', counted: 90 }] }, stockDb.items(), liveTrackingInputs());
  const keep = (snap: Record<string, string>) =>
    Object.fromEntries(Object.entries(snap).filter(([k]) => k.startsWith(DB_PREFIX) && !DEVICE_LOCAL_KEYS.includes(k) && k !== `${DB_PREFIX}audit_log`));
  const before = keep(dumpStorage());
  for (const t of ['boms', 'manufacturing_vouchers', 'physical_stock']) assert.ok(before[DB_PREFIX + t], `fixture populates ${t}`);
  const file = JSON.stringify(buildBackup(new Date('2026-05-10T10:00:00Z')));
  wipeAppData();
  applyBackup(parseBackup(file).data);
  assert.deepEqual(keep(dumpStorage()), before);
  assert.equal(loadPositions().find((p) => p.item.id === 'chair')!.qty, 2);
  assert.throws(() => validateBackupData({ [`${DB_PREFIX}manufacturing_vouchers`]: '[{"date":"2026-05-01"}]' }), /manufacturing_vouchers/);
});

test('manufacturing never posts to the double-entry ledger; the trial balance stays balanced', async () => {
  setup();
  const { buildLedger, trialBalance } = await import('../../src/lib/ledger/index.ts');
  const ledger = () => buildLedger({ ...loadBooksData(), userAccounts: [], manual: [], assets: [], today: '2026-06-30' });
  const before = ledger();
  make('2026-05-10', 2);
  stockJournalsDb.save({ date: '2026-05-11', consume: [{ id: 'a', item_id: 'screw', qty: 10 }], produce: [{ id: 'b', item_id: 'wood', qty: 1 }], costs: [] }, stockDb.items(), liveTrackingInputs());
  physicalStockDb.save({ date: '2026-05-12', lines: [{ id: 'l', item_id: 'screw', counted: 900 }] }, stockDb.items(), liveTrackingInputs());
  const after = ledger();
  assert.deepEqual(after.vouchers, before.vouchers);
  const tb = trialBalance(after, { start: '2026-04-01', end: '2027-03-31' });
  assert.equal(tb.totals.debit, tb.totals.credit);
  assert.equal(tb.totals.closingDr, tb.totals.closingCr);
});

test('a godown used by a voucher or BOM cannot be deleted', async () => {
  const { godownReferences } = await import('../../src/lib/godowns.ts');
  assert.deepEqual(godownReferences('g2', { boms: [{ components: [{ godown_id: 'g2' }] }] }), ['bills of materials']);
  assert.deepEqual(godownReferences('g2', { stockVouchers: [{ godown_id: 'g2' }] }), ['manufacturing / stock journals or physical stock counts']);
  assert.deepEqual(godownReferences('g2', { stockVouchers: [{ lines: [{ godown_id: 'g3' }] }] }), []);
});
