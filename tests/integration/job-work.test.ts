/**
 * Phase 7M job work and Rejections In through storage: job worker godown, Material Out → Material In → live stock,
 * FY numbering with the series high-water mark, period lock, roles (books.edit + table guard), audit, backup
 * round-trip, delete guards, and the ledger unchanged.
 */
import '../helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { dumpStorage, freezeDate, resetStorage, thawDate } from '../helpers/shim.ts';
import { installSettings } from '../helpers/world.ts';
import { localDb } from '../../src/lib/localDb.ts';
import { DB_PREFIX, setTable } from '../../src/lib/storage.ts';
import { blankStockItem, loadPositions, stockDb } from '../../src/lib/inventory.ts';
import { computeTracking, liveTrackingInputs } from '../../src/lib/stock-tracking.ts';
import { godownsDb } from '../../src/lib/godowns.ts';
import {
  ensureJobWorkerGodown, jobWorkOrdersDb, liveChallanBalances, materialInDb, materialOutDb, principalDb,
} from '../../src/lib/job-work.ts';
import { rejectionsInDb } from '../../src/lib/rejections-in.ts';
import { clearOverrides, isPeriodLockedError } from '../../src/lib/period-lock.ts';
import { setActorProvider, type Role } from '../../src/lib/access.ts';
import { audit } from '../../src/lib/audit.ts';
import { applyBackup, buildBackup, parseBackup, validateBackupData, wipeAppData } from '../../src/lib/backup.ts';
import { DEVICE_LOCAL_KEYS } from '../../src/lib/auth.ts';
import { saveSettings, loadSettings } from '../../src/lib/inventory.ts';
import type { InvoiceRecord } from '../../src/types/invoice.ts';

const as = (role: Role | null) => setActorProvider(role ? () => ({ id: 'u', name: 'U', role }) : null);
const TABLES = ['job_work_orders', 'job_work_out', 'job_work_in', 'job_work_principal', 'rejections_in'];

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
  stockDb.saveItem(blankStockItem({ id: 'rod', name: 'Steel rod', unit: 'KG', opening_qty: 100, opening_rate: 50 }));
  stockDb.saveItem(blankStockItem({ id: 'shaft', name: 'Machined shaft' }));
  const g = ensureJobWorkerGodown({ vendor_id: 'v1', name: 'Acme' });
  return { g, items: stockDb.items() };
}

function sendOut(date = '2026-05-01', qty = 40) {
  const { g } = { g: ensureJobWorkerGodown({ vendor_id: 'v1', name: 'Acme' }) };
  return materialOutDb.save({ date, party_name: 'Acme', vendor_id: 'v1', job_worker_godown: g.id, lines: [{ id: 'l1', item_id: 'rod', qty, rate: 50 }] }, stockDb.items(), godownsDb.list());
}

function receive(date = '2026-05-08') {
  const g = ensureJobWorkerGodown({ vendor_id: 'v1', name: 'Acme' });
  return materialInDb.save({
    date, party_name: 'Acme', job_worker_godown: g.id, consumed: [{ id: 'c', item_id: 'rod', qty: 30 }],
    received: [{ id: 'r', item_id: 'shaft', qty: 10, kind: 'processed' }], charges: 500,
  }, stockDb.items());
}

test('job worker godown, Material Out → Material In: still our stock, consumed, produced, numbered, audited', () => {
  const { g } = setup();
  assert.equal(g.job_worker, true);
  assert.equal(ensureJobWorkerGodown({ vendor_id: 'v1', name: 'Acme Ltd' }).id, g.id, 'one godown per job worker');
  const o = sendOut();
  assert.equal(o.number, 'JWC/FY26-27/0001');
  assert.equal(loadPositions().find((p) => p.item.id === 'rod')!.qty, 100, 'still ours while at the job worker');
  assert.equal(computeTracking(liveTrackingInputs()).get('rod')!.byGodown[g.id], 40);
  const v = receive();
  assert.equal(v.number, 'JWR/FY26-27/0001');
  const pos = new Map(loadPositions().map((p) => [p.item.id, p]));
  assert.deepEqual([pos.get('rod')!.qty, pos.get('shaft')!.qty, pos.get('shaft')!.value], [70, 10, 2000]);
  assert.equal(liveChallanBalances('2026-05-10').lines[0].pending, 10);
  assert.ok(audit.all().some((r) => r.entity === 'job_work' && r.doc_number === 'JWC/FY26-27/0001'));
  // Delete guards: a challan with goods received against it, a godown in use, an order in use.
  assert.throws(() => materialOutDb.remove(o.id), /already come back/);
  assert.throws(() => godownsDb.remove(g.id, false), /Job work challans/);
  const ord = jobWorkOrdersDb.save({ date: '2026-05-01', direction: 'out', party_name: 'Acme', finished_item_id: 'shaft', finished_qty: 10 });
  assert.equal(ord.number, 'JWO/FY26-27/0001');
  materialOutDb.save({ ...o, order_id: ord.id }, stockDb.items(), godownsDb.list());
  assert.throws(() => jobWorkOrdersDb.remove(ord.id), /used by/);
  assert.throws(() => stockDb.deleteItem('shaft'), /job work/);
  // Receiving more than is pending is refused.
  assert.throws(() => materialInDb.save({ date: '2026-05-09', party_name: 'Acme', job_worker_godown: g.id, consumed: [], received: [{ id: 'r', item_id: 'rod', qty: 11, kind: 'returned' }] }, stockDb.items()), /more than is pending/);
  // A deleted latest number is never issued again.
  materialInDb.remove(v.id);
  assert.equal(materialInDb.nextNumber('2026-05-10'), 'JWR/FY26-27/0002');
});

test('numbering across the financial year and the period lock', () => {
  setup();
  const a = sendOut('2026-03-30', 10);
  const b = sendOut('2026-04-02', 10);
  assert.deepEqual([a.number, b.number], ['JWC/FY25-26/0001', 'JWC/FY26-27/0001']);
  localDb.settings.save({ ...localDb.settings.get(), lock_until: '2026-03-31' });
  assert.throws(() => sendOut('2026-03-31', 1), (e: unknown) => isPeriodLockedError(e));
  assert.throws(() => materialOutDb.remove(a.id), (e: unknown) => isPeriodLockedError(e));
  assert.throws(() => principalDb.save({ date: '2026-03-15', kind: 'receipt', party_name: 'Big Co', lines: [{ id: 'l', name: 'Fabric', qty: 1 }] }), (e: unknown) => isPeriodLockedError(e));
});

test('roles: viewer cannot post job work or rejections; clerk can; table guard covers every new table', () => {
  setup();
  as('viewer');
  assert.throws(() => sendOut(), /Viewer/);
  assert.throws(() => principalDb.save({ date: '2026-05-01', kind: 'receipt', party_name: 'Big Co', lines: [{ id: 'l', name: 'Fabric', qty: 1 }] }), /Viewer/);
  for (const t of TABLES) assert.throws(() => setTable(t, [{ id: 'x' }]), /Viewer\) cannot/, t);
  as('clerk');
  assert.equal(sendOut().number, 'JWC/FY26-27/0001');
});

test('principal register: receipt and return, more returned than received is refused', () => {
  const r = principalDb.save({ date: '2026-05-01', kind: 'receipt', party_name: 'Big Co', challan_no: 'BC/1', lines: [{ id: 'l', name: 'Fabric', qty: 100, unit: 'MTR' }] });
  assert.equal(r.number, 'JWP/FY26-27/0001');
  principalDb.save({ date: '2026-05-05', kind: 'return', party_name: 'Big Co', lines: [{ id: 'l', name: 'Fabric', qty: 60 }] });
  assert.throws(() => principalDb.save({ date: '2026-05-06', kind: 'return', party_name: 'Big Co', lines: [{ id: 'l', name: 'Fabric', qty: 41 }] }), /more is sent back/);
  assert.equal(loadPositions().length, 0, "the principal's goods are not our stock");
});

test('Rejections In through storage: stock back, challan balance, invoiced challan refused, numbering', () => {
  setup();
  saveSettings({ ...loadSettings(), includeChallans: true });
  const dc = localDb.invoices.save({
    id: 'dc1', doc_type: 'DELIVERY_CHALLAN', status: 'Sent', invoice_number: 'DC/FY26-27/0001', issue_date: '2026-05-02', due_date: '2026-05-02',
    client: { name: 'Kumar Traders' }, items: [{ id: 'L1', name: 'Steel rod', quantity: 20, rate: 80, unit: 'KG', amount: 1600 }],
  } as unknown as InvoiceRecord);
  assert.equal(loadPositions().find((p) => p.item.id === 'rod')!.qty, 80);
  const r = rejectionsInDb.save({ date: '2026-05-04', challan_id: dc.id, lines: [{ id: 'x', challan_line_id: 'L1', name: 'Steel rod', quantity: 5 }], reason: 'Bent' });
  assert.equal(r.number, 'RJI/FY26-27/0001');
  assert.equal(r.client_name, 'Kumar Traders');
  assert.equal(loadPositions().find((p) => p.item.id === 'rod')!.qty, 85);
  assert.throws(() => rejectionsInDb.save({ date: '2026-05-05', challan_id: dc.id, lines: [{ id: 'y', challan_line_id: 'L1', name: 'Steel rod', quantity: 16 }] }), /only 15/);
  assert.ok(audit.all().some((x) => x.entity === 'rejection_in' && x.doc_number === r.number));
  rejectionsInDb.remove(r.id);
  assert.equal(rejectionsInDb.nextNumber('2026-05-06'), 'RJI/FY26-27/0002');
});

test('new tables survive backup → wipe → restore; damaged rows are refused', () => {
  setup();
  sendOut();
  receive();
  jobWorkOrdersDb.save({ date: '2026-05-01', direction: 'in', party_name: 'Big Co' });
  principalDb.save({ date: '2026-05-01', kind: 'receipt', party_name: 'Big Co', lines: [{ id: 'l', name: 'Fabric', qty: 1 }] });
  const keep = (snap: Record<string, string>) =>
    Object.fromEntries(Object.entries(snap).filter(([k]) => k.startsWith(DB_PREFIX) && !DEVICE_LOCAL_KEYS.includes(k) && k !== `${DB_PREFIX}audit_log`));
  const before = keep(dumpStorage());
  for (const t of ['job_work_orders', 'job_work_out', 'job_work_in', 'job_work_principal']) assert.ok(before[DB_PREFIX + t], `fixture populates ${t}`);
  const file = JSON.stringify(buildBackup(new Date('2026-05-10T10:00:00Z')));
  wipeAppData();
  applyBackup(parseBackup(file).data);
  assert.deepEqual(keep(dumpStorage()), before);
  assert.equal(loadPositions().find((p) => p.item.id === 'shaft')!.qty, 10);
  for (const t of TABLES) assert.throws(() => validateBackupData({ [`${DB_PREFIX}${t}`]: '[{"date":"2026-05-01"}]' }), new RegExp(t));
});

test('job work never posts to the double-entry ledger', async () => {
  setup();
  const { buildLedger } = await import('../../src/lib/ledger/index.ts');
  const { loadBooksData } = await import('../../src/lib/books.ts');
  const ledger = () => buildLedger({ ...loadBooksData(), userAccounts: [], manual: [], assets: [], today: '2026-06-30' });
  const before = ledger();
  sendOut();
  receive();
  assert.deepEqual(ledger().vouchers, before.vouchers);
});
