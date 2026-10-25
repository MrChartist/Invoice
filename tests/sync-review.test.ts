/**
 * 5.7 folder sync — regression tests for the independent review (one per finding).
 * Same harness as tests/sync.test.ts: devices are storage snapshots swapped in and out of the shim.
 */
import './helpers/shim.ts';
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { dumpStorage, loadStorage, resetStorage } from './helpers/shim.ts';
import { FakeDir } from './helpers/fake-dir.ts';
import { DB_PREFIX, SINGLETON_KEYS, getTable, readRaw, removeRaw, setJson, setTable, writeRaw } from '../src/lib/storage.ts';
import { buildBackup, restoreBackup } from '../src/lib/backup.ts';
import { localDb } from '../src/lib/localDb.ts';
import { AUDIT_TABLE, audit } from '../src/lib/audit.ts';
import * as R from '../src/lib/recurring.ts';
import { makeDraft } from '../src/store/invoice-defaults.ts';
import {
  SYNC_DEVICE_KEY,
  afterFirstSync,
  companiesUsingGroup,
  companyDevice,
  markSyncedThisSession,
  setCompanySyncPrefs,
  subscribeSyncPrefs,
} from '../src/lib/sync-device.ts';
import { createOrJoinGroup, deviceFileName, openGroup, openText, sealText, SYNC_ROOT, type SyncKey } from '../src/lib/sync-files.ts';
import {
  SYNC_STATE_KEY,
  hashStr,
  loadConflicts,
  loadDeviceLogs,
  loadState,
  parseRemoteFile,
  resolveConflict,
  runSync,
  type RowConflict,
  type SyncReport,
} from '../src/lib/sync-engine.ts';
import type { AuditEntry } from '../src/types/audit.ts';

const GROUP = 'acme-books';
interface Device {
  id: string;
  name: string;
  data: Record<string, string>;
}
const A: Device = { id: 'aaaaaaaa-0000-4000-8000-000000000001', name: 'Office PC', data: {} };
const B: Device = { id: 'bbbbbbbb-0000-4000-8000-000000000002', name: 'Laptop', data: {} };
const C: Device = { id: 'cccccccc-0000-4000-8000-000000000003', name: 'Home', data: {} };
let root: FakeDir;
let key: SyncKey;

async function on<T>(dev: Device, fn: () => T | Promise<T>): Promise<T> {
  resetStorage();
  loadStorage(dev.data);
  try {
    return await fn();
  } finally {
    dev.data = dumpStorage();
  }
}
const sync = (dev: Device): Promise<SyncReport> =>
  on(dev, () => runSync({ root, group: GROUP, key, device: { id: dev.id, name: dev.name }, retryDelayMs: 0, attempts: 1 }));
const me = (d: Device) => ({ id: d.id, name: d.name });

beforeEach(async () => {
  resetStorage();
  for (const d of [A, B, C]) d.data = {};
  root = new FakeDir('Drive');
  key = (await createOrJoinGroup(await openGroup(root, GROUP, true), GROUP, 'correct horse battery', { iter: 210_000 })).key;
});

const client = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, name, email: '', address: '', city: 'Pune', zip: '', ...extra });
const clients = () => getTable<{ id: string; name: string; city?: string; email?: string }>('clients');
const byId = (id: string) => clients().find((c) => c.id === id);
const devicesDir = () => root.at(SYNC_ROOT, GROUP, 'devices');

/* ── 1. Stale resolutions ───────────────────────────────────────── */

test('1a: a local edit made after the conflict was listed is never reverted by "Keep mine"', async () => {
  await on(A, () => setTable('clients', [client('c1', 'Acme')]));
  await sync(A);
  await sync(B);
  await on(A, () => setTable('clients', [client('c1', 'Acme', { city: 'Delhi' })]));
  await on(B, () => setTable('clients', [client('c1', 'Acme', { city: 'Chennai' })]));
  await sync(B);
  await sync(A);
  await on(A, async () => {
    setTable('clients', [client('c1', 'Acme', { city: 'Delhi', email: 'new@acme.in' })]);
    const c = loadConflicts()[0];
    const r1 = await resolveConflict(c.id, 'mine', me(A));
    assert.equal(r1.ok, false);
    assert.equal(r1.stale, true, 'refused: changed since listed');
    assert.equal(byId('c1')?.email, 'new@acme.in', 'nothing written');
    const refreshed = loadConflicts()[0] as RowConflict;
    assert.equal((refreshed.local.value as { email: string }).email, 'new@acme.in', 'the listing now shows the current version');
    assert.equal((await resolveConflict(c.id, 'mine', me(A))).ok, true);
    assert.equal(byId('c1')?.email, 'new@acme.in', 'the newer edit is what is kept');
  });
});

test('1b: a newer remote singleton applied while listed refreshes the listing ("Use theirs" never brings back the older one)', async () => {
  const T = DB_PREFIX + 'time_prefs';
  await on(A, () => setJson(T, { v: 'base' }));
  await sync(A);
  await sync(B);
  await on(A, () => setJson(T, { v: 'A1' }));
  await on(B, () => {
    setTable('clients', [client('x', 'x'), client('y', 'y')]);
    setJson(T, { v: 'B1' });
  });
  await sync(A);
  await sync(B);
  await sync(A);
  await on(B, () => setJson(T, { v: 'B2-later' }));
  await sync(B);
  await sync(A);
  await on(A, async () => {
    assert.equal(readRaw(T), '{"v":"B2-later"}');
    const c = loadConflicts()[0] as RowConflict;
    assert.equal(c.remote.value, '{"v":"B2-later"}', 'listing points at the current version');
    assert.equal((await resolveConflict(c.id, 'theirs', me(A))).ok, true);
    assert.equal(readRaw(T), '{"v":"B2-later"}');
  });
  await sync(A);
  await sync(B);
  await on(B, () => {
    assert.equal(readRaw(T), '{"v":"B2-later"}');
    assert.equal(loadConflicts().length, 0, "B's own listing clears once A's choice arrives");
  });
});

test('1c: three devices: a newer version arriving from a third device refreshes the listing before anything is chosen', async () => {
  await on(A, () => setTable('clients', [client('c1', 'Acme')]));
  await sync(A);
  await sync(B);
  await sync(C);
  await on(A, () => setTable('clients', [client('c1', 'Acme', { city: 'A-city' })]));
  await on(B, () => setTable('clients', [client('c1', 'Acme', { city: 'B-city' })]));
  await sync(B);
  await sync(A); // A lists B's version
  await sync(C); // C takes B's version (dominates its base) …
  await on(C, () => setTable('clients', [client('c1', 'Acme', { city: 'C-city' })])); // … and edits it
  await sync(C);
  await sync(A);
  await on(A, async () => {
    // C first took A's version (sorted first), listed B's, then edited: its edit covers A's, so A applies it
    // and the listing's current side now points at C's version, never back at A's older one.
    assert.equal(byId('c1')?.city, 'C-city');
    const c = loadConflicts()[0] as RowConflict;
    assert.equal((c.local.value as { city: string }).city, 'C-city', 'listing shows the current version');
    assert.equal((c.remote.value as { city: string }).city, 'B-city');
    assert.equal((await resolveConflict(c.id, 'mine', me(A))).ok, true);
    assert.equal(byId('c1')?.city, 'C-city', '"Keep mine" keeps the current version, not the one first listed');
  });
});

/* ── 2. Counter floor after a restore / erase ───────────────────── */

test('2a: restore while a peer file is unreadable: post-restore edits still win (device-local high-water counter)', async () => {
  await on(A, () => setTable('clients', [client('c1', 'Acme')]));
  for (let i = 0; i < 20; i++) {
    await on(A, () => setTable('clients', [client('c1', 'Acme', { n: i })]));
    await sync(A);
  }
  await sync(B);
  await on(A, () => restoreBackup(buildBackup().data));
  const good = devicesDir().files.get(deviceFileName(B.id))!;
  devicesDir().files.set(deviceFileName(B.id), good.slice(0, 50));
  await sync(A);
  await on(A, () => setTable('clients', [client('c1', 'Acme', { city: 'EDITED-AFTER-RESTORE' })]));
  await sync(A);
  devicesDir().files.set(deviceFileName(B.id), good);
  await sync(B);
  await sync(A);
  for (const d of [A, B]) await on(d, () => assert.equal(byId('c1')?.city, 'EDITED-AFTER-RESTORE', `${d.name} keeps the new edit`));
});

test('2b: the floor also comes from the own file; with no floor at all the run refuses instead of guessing', async () => {
  await on(A, () => setTable('clients', [client('c1', 'Acme')]));
  for (let i = 0; i < 5; i++) {
    await on(A, () => setTable('clients', [client('c1', 'Acme', { n: i })]));
    await sync(A);
  }
  const clockBefore = await on(A, () => loadState().clock);
  // Lose the sync state AND the device-local high-water mark.
  await on(A, () => {
    removeRaw(SYNC_STATE_KEY);
    removeRaw(SYNC_DEVICE_KEY);
  });
  await sync(A);
  await on(A, () => assert.ok(loadState().clock > clockBefore, 'counter restarts above the own file’s'));
  // Now the own file is unreadable too.
  await on(A, () => {
    removeRaw(SYNC_STATE_KEY);
    removeRaw(SYNC_DEVICE_KEY);
  });
  const own = devicesDir().files.get(deviceFileName(A.id))!;
  devicesDir().files.set(deviceFileName(A.id), own.slice(0, 30));
  const r = await sync(A);
  assert.equal(r.ok, false);
  assert.match(r.message ?? '', /cannot safely number/);
  devicesDir().files.set(deviceFileName(A.id), own);
});

/* ── 3. Recurring invoices on several devices ───────────────────── */

function schedule() {
  const draft = makeDraft({ settings: localDb.settings.get(), sender: null });
  draft.client = { ...draft.client, name: 'Acme Traders' };
  draft.items = [{ id: 'i1', name: 'Retainer {month}', type: 'Service', quantity: 1, rate: 1000, tax_rate: 0, amount: 1000 }];
  draft.gst_mode = 'NONE';
  const s = R.createSchedule({ name: 'Retainer', template: R.templateFromInvoice(draft), frequency: 'monthly', due_in_days: 10, mode: 'issue', start_date: '2026-06-01' });
  return { ...s, id: 'sched-1' };
}

test('3: the same occurrence generated on two devices collapses into one document (deterministic id)', async () => {
  const s = schedule();
  await on(A, () => R.recurringDb.save(s));
  await sync(A);
  await sync(B);
  await on(A, () => R.generateInvoiceFromSchedule(s, '2026-06-01'));
  await on(B, () => R.generateInvoiceFromSchedule(s, '2026-06-01'));
  await sync(A);
  await sync(B);
  await sync(A);
  for (const d of [A, B]) {
    await on(d, () => {
      const gen = getTable<{ id: string; recurring_id?: string }>('invoices').filter((i) => i.recurring_id === 'sched-1');
      assert.equal(gen.length, 1, `${d.name}: one invoice for the occurrence`);
      assert.equal(gen[0].id, R.recurringDocId('sched-1', '2026-06-01'));
      assert.ok(!loadConflicts().some((c) => c.kind === 'duplicate'), 'no duplicate number');
    });
  }
});

test('3b: with sync on, the recurring runner waits for the first sync of the session', async () => {
  setCompanySyncPrefs({ enabled: true });
  let done = false;
  const p = afterFirstSync(10_000).then(() => (done = true));
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(done, false);
  markSyncedThisSession();
  await p;
  assert.equal(done, true);
});

/* ── 4. Period lock on every write ──────────────────────────────── */

test('4a: "Use theirs" on a concurrent edit inside the locked period needs the override and is audited', async () => {
  const inv = { id: 'i1', invoice_number: 'INV/FY25-26/0001', issue_date: '2026-02-10', status: 'Sent', total: 100 };
  await on(A, () => setTable('invoices', [inv]));
  await sync(A);
  await sync(B);
  await on(A, () => setTable('invoices', [{ ...inv, total: 150 }]));
  await on(B, () => setTable('invoices', [{ ...inv, total: 999 }]));
  await on(A, () => setJson(SINGLETON_KEYS.settings, { lock_until: '2026-03-31' }));
  await sync(B);
  await sync(A);
  await on(A, async () => {
    const c = loadConflicts().find((x) => x.kind === 'row') as RowConflict;
    assert.equal(c.locked, true, 'flagged for the PIN');
    const r = await resolveConflict(c.id, 'theirs', me(A));
    assert.equal(r.ok, false);
    assert.equal(r.needsOverride, true);
    assert.equal(getTable<{ total: number }>('invoices')[0].total, 150);
    assert.equal((await resolveConflict(c.id, 'theirs', me(A), { override: true })).ok, true);
    assert.equal(getTable<{ total: number }>('invoices')[0].total, 999);
    assert.ok(getTable<AuditEntry>(AUDIT_TABLE).some((e) => e.action === 'override' && e.entity_id === 'sync'));
  });
});

test('4b: a settings version that removes the lock, listed as the LWW loser, cannot be switched to without the override', async () => {
  await on(A, () => setJson(SINGLETON_KEYS.settings, { lock_until: '2026-03-31', a: 1 }));
  await sync(A);
  await sync(B);
  await on(B, () => setJson(SINGLETON_KEYS.settings, { lock_until: '' }));
  await on(A, () => {
    setJson(SINGLETON_KEYS.settings, { lock_until: '2026-03-31', a: 2 });
    setTable('clients', [client('x', 'x')]);
  });
  await sync(B);
  await sync(A);
  await on(A, async () => {
    const c = loadConflicts()[0] as RowConflict;
    assert.ok(c && c.locked, `listed with the lock flag (${c?.reason})`);
    const pick = c.local.value === readRaw(SINGLETON_KEYS.settings) ? 'theirs' : 'mine';
    const r = await resolveConflict(c.id, pick, me(A));
    assert.equal(r.needsOverride, true);
    assert.equal(JSON.parse(readRaw(SINGLETON_KEYS.settings)!).lock_until, '2026-03-31');
  });
});

test('4c: fixed assets acquired inside the locked period are protected too', async () => {
  const fa = { id: 'fa1', name: 'Laptop', acquired_on: '2026-01-10', cost: 100000 };
  await on(A, () => {
    setJson(SINGLETON_KEYS.settings, { lock_until: '2026-03-31' });
    setTable('fixed_assets', [fa]);
  });
  await sync(A);
  await sync(B);
  await on(B, () => setTable('fixed_assets', [{ ...fa, cost: 1 }]));
  await sync(B);
  await sync(A);
  await on(A, () => {
    assert.equal(getTable<{ cost: number }>('fixed_assets')[0].cost, 100000);
    assert.equal((loadConflicts()[0] as RowConflict).reason, 'locked');
  });
});

/* ── 5. Two companies on one device ─────────────────────────────── */

test('5: each company gets its own device id, and a second company cannot join a group already in use here', () => {
  const a = companyDevice('default');
  const b = companyDevice('second-co');
  assert.notEqual(a.id, b.id);
  assert.equal(companyDevice('default').id, a.id, 'stable');
  setCompanySyncPrefs({ enabled: true, group: GROUP }, 'default');
  assert.deepEqual(companiesUsingGroup(GROUP, 'second-co'), ['default']);
  assert.deepEqual(companiesUsingGroup('other-group', 'second-co'), []);
});

/* ── 7. Idle runs ───────────────────────────────────────────────── */

test('7: an idle run with 10,000 invoices only hashes: no merge, no state rewrite, no file write', async () => {
  const items = Array.from({ length: 8 }, (_, j) => ({ id: `l${j}`, name: `Line ${j}`, hsn: '998311', quantity: 1, rate: 1000 + j, tax_rate: 18 }));
  const invs = Array.from({ length: 10000 }, (_, i) => ({ id: `inv${i}`, invoice_number: `INV/FY25-26/${String(i + 1).padStart(5, '0')}`, issue_date: '2026-05-01', client: { name: `Client ${i}` }, items, total: 12345 }));
  await on(B, () => setTable('invoices', invs));
  await sync(B);
  await sync(A);
  await sync(B);
  await sync(A);
  const stateText = await on(A, () => readRaw(SYNC_STATE_KEY));
  const t0 = performance.now();
  const r = await sync(A);
  const ms = performance.now() - t0;
  console.log(`# perf idle sync, 10,000 invoices: ${ms.toFixed(0)} ms`);
  assert.equal(r.idle, true);
  assert.equal(r.wrote, false);
  assert.ok(ms < 1500, `idle run took ${ms.toFixed(0)} ms`);
  await on(A, () => assert.equal(readRaw(SYNC_STATE_KEY), stateText, 'state not rewritten'));
  // A local edit is still noticed.
  await on(A, () => setTable('clients', [client('c1', 'New')]));
  const r2 = await sync(A);
  assert.equal(r2.idle, undefined);
  assert.equal(r2.wrote, true);
});

/* ── 8. Prototype-named row ids ─────────────────────────────────── */

test('8: row ids named after Object.prototype members sync like any other', async () => {
  await on(B, () => setTable('items_catalog', [{ id: 'constructor', name: 'Widget', rate: 1 }, { id: 'toString', name: 'Gadget', rate: 2 }, { id: 'hasOwnProperty', name: 'G3', rate: 3 }]));
  await sync(B);
  const r = await sync(A);
  assert.ok(r.ok, r.message);
  assert.equal(r.added, 3);
  await on(A, () => setTable('items_catalog', getTable<{ id: string; rate: number }>('items_catalog').map((i) => ({ ...i, rate: i.rate + 10 }))));
  await sync(A);
  const rb = await sync(B);
  assert.ok(rb.ok);
  assert.equal(rb.updated, 3);
});

/* ── 9. Replayed older file ─────────────────────────────────────── */

test('9: a replayed older device file is skipped and flagged; the stored audit copy is not truncated', async () => {
  await on(B, () => {
    setTable('clients', [client('c1', 'Acme')]);
    audit.record({ entity: 'system', entity_id: 'x', action: 'update', summary: 'one' });
  });
  await sync(B);
  await sync(A);
  const old = devicesDir().files.get(deviceFileName(B.id))!;
  for (let i = 0; i < 3; i++) {
    await on(B, () => {
      setTable('clients', [client('c1', 'Acme', { n: i })]);
      audit.record({ entity: 'system', entity_id: 'x', action: 'update', summary: `n${i}` });
    });
    await sync(B);
    await sync(A);
  }
  const before = await on(A, () => loadDeviceLogs()[B.id].rows.length);
  devicesDir().files.set(deviceFileName(B.id), old);
  const r = await sync(A);
  assert.equal(r.unreadable.length, 1);
  assert.match(r.unreadable[0].message, /older than one already read/);
  await on(A, () => {
    assert.equal(loadDeviceLogs()[B.id].rows.length, before);
    assert.equal(loadState().peers[B.id].status, 'stale');
  });
  // Still skipped on the next run (the baseline clock is kept).
  assert.equal((await sync(A)).unreadable.length, 1);
});

/* ── 10. Validation limits ──────────────────────────────────────── */

test('10: vv_max must hold non-negative safe integers; decompression is capped', async () => {
  const base = { app: 'mrchartist-invoice-sync', kind: 'state', v: 1, device: { id: B.id, name: 'x' }, group: GROUP, schema: 3, clock: 1, written_at: '', keys: {}, audit: [], blobs: [] };
  for (const vv of [{ a: -1 }, { a: 1.5 }, { a: Number.MAX_SAFE_INTEGER + 2 }, { a: '3' }]) {
    assert.throws(() => parseRemoteFile(JSON.stringify({ ...base, vv_max: vv }), B.id, GROUP), /vv_max/);
  }
  assert.ok(parseRemoteFile(JSON.stringify({ ...base, vv_max: { a: 3 } }), B.id, GROUP));
  const env = await sealText(key, '0'.repeat(200_000), ['x']);
  assert.equal(env.z, 'gzip');
  await assert.rejects(openText(key, env, ['x'], 10_000), /larger than this app accepts/);
  assert.equal((await openText(key, env, ['x'])).length, 200_000);
});

/* ── 11. One bad peer does not stop the rest ────────────────────── */

test('11: a peer whose data cannot be applied is left out; the others apply and this device still writes its file', async () => {
  await on(B, () => writeRaw(`${DB_PREFIX}invoices`, JSON.stringify([{ id: 'bad', invoice_number: 'X/FY26-27/0001', sender: { companyName: 'B', logo: 'asset:missing-image' } }])));
  await sync(B);
  await on(C, () => setTable('clients', [client('c9', 'From C')]));
  await sync(C);
  await on(A, () => setTable('clients', [client('a1', 'From A')]));
  const r = await sync(A);
  assert.equal(r.wrote, true, "A's own file is written");
  assert.equal(r.unreadable.length, 1);
  assert.equal(r.unreadable[0].device, B.id);
  assert.match(r.unreadable[0].message, /could not be applied/);
  await on(A, () => {
    assert.ok(byId('c9'), "C's change applied");
    assert.equal(getTable('invoices').length, 0, "nothing from B's damaged data");
  });
  assert.ok(await on(C, async () => (await sync(C), byId('a1'))), "A's change reaches C");
});

/* ── 12. Switching sync on starts the runner ────────────────────── */

test('12: the enable switch notifies subscribers (SyncRunner restarts its timer without a reload)', () => {
  let calls = 0;
  const off = subscribeSyncPrefs(() => calls++);
  setCompanySyncPrefs({ enabled: true });
  setCompanySyncPrefs({ enabled: false });
  off();
  setCompanySyncPrefs({ enabled: true });
  assert.equal(calls, 2);
});

/* ── 13. Bill payment roll-ups in a locked period ───────────────── */

test('13: an amount_paid-only change to a bill in the locked period syncs (the payment row carries its own date)', async () => {
  const bill = { id: 'p1', vendor_name: 'V', bill_number: 'B1', date: '2026-02-01', total: 1000, amount_paid: 0 };
  await on(A, () => {
    setJson(SINGLETON_KEYS.settings, { lock_until: '2026-03-31' });
    setTable('purchases', [bill]);
  });
  await sync(A);
  await sync(B);
  await on(B, () => {
    setTable('purchases', [{ ...bill, amount_paid: 400, updated_at: '2026-06-01T00:00:00Z' }]);
    setTable('purchase_payments', [{ id: 'pp1', purchase_id: 'p1', amount: 400, date: '2026-06-01', method: 'UPI' }]);
  });
  await sync(B);
  const r = await sync(A);
  assert.equal(r.conflicts, 0);
  await on(A, () => {
    assert.equal(getTable<{ amount_paid: number }>('purchases')[0].amount_paid, 400);
    assert.equal(getTable('purchase_payments').length, 1);
  });
  // Any other field change to the locked bill is still held.
  await on(B, () => setTable('purchases', [{ ...bill, amount_paid: 400, total: 5 }]));
  await sync(B);
  await sync(A);
  await on(A, () => assert.equal((loadConflicts()[0] as RowConflict)?.reason, 'locked'));
  assert.ok(hashStr('x'));
});
