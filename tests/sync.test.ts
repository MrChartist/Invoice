/**
 * 5.7 folder sync: two simulated devices (their storage swapped in and out of the shared localStorage
 * shim) exchanging encrypted files through an in-memory folder handle.
 */
import './helpers/shim.ts';
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { dumpStorage, loadStorage, resetStorage } from './helpers/shim.ts';
import { FakeDir } from './helpers/fake-dir.ts';
import { DB_PREFIX, SINGLETON_KEYS, getTable, readRaw, removeRaw, setJson, setTable } from '../src/lib/storage.ts';
import { localDb } from '../src/lib/localDb.ts';
import { verifyAuditChain } from '../src/lib/audit-chain.ts';
import { AUDIT_TABLE } from '../src/lib/audit.ts';
import { buildBackup, parseBackup, restoreBackup } from '../src/lib/backup.ts';
import { attachmentKey, putAttachment } from '../src/lib/attachments.ts';
import { SYNC_DEVICE_KEY, issuingProfile, setCompanySyncPrefs } from '../src/lib/sync-device.ts';
import { createOrJoinGroup, deviceFileName, openGroup, SYNC_ROOT, type SyncKey } from '../src/lib/sync-files.ts';
import {
  SYNC_STATE_KEY,
  compareVV,
  hashStr,
  loadConflicts,
  loadDeviceLogs,
  loadState,
  mergeDeviceLog,
  resolveConflict,
  runSync,
  sharedSeries,
  type RowConflict,
  type SyncReport,
} from '../src/lib/sync-engine.ts';
import type { AuditEntry } from '../src/types/audit.ts';

const GROUP = 'acme-books';
const PASS = 'correct horse battery';
const ITER = 210_000;

interface Device {
  id: string;
  name: string;
  data: Record<string, string>;
}

const A: Device = { id: 'aaaaaaaa-0000-4000-8000-000000000001', name: 'Office PC', data: {} };
const B: Device = { id: 'bbbbbbbb-0000-4000-8000-000000000002', name: 'Laptop', data: {} };
let root: FakeDir;
let key: SyncKey;

/** Run `fn` with `dev`'s storage loaded, then keep what it left behind. */
async function on<T>(dev: Device, fn: () => T | Promise<T>): Promise<T> {
  resetStorage();
  loadStorage(dev.data);
  try {
    return await fn();
  } finally {
    dev.data = dumpStorage();
  }
}

const sync = (dev: Device, extra: { attempts?: number } = {}): Promise<SyncReport> =>
  on(dev, () => runSync({ root, group: GROUP, key, device: { id: dev.id, name: dev.name }, retryDelayMs: 0, attempts: extra.attempts ?? 2 }));

beforeEach(async () => {
  resetStorage();
  A.data = {};
  B.data = {};
  root = new FakeDir('Google Drive');
  const dirs = await openGroup(root, GROUP, true);
  key = (await createOrJoinGroup(dirs, GROUP, PASS, { iter: ITER })).key;
});

const client = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, name, email: '', address: '', city: 'Pune', zip: '', ...extra });
const clients = () => getTable<{ id: string; name: string; city?: string }>('clients');
const byId = (id: string) => clients().find((c) => c.id === id);

/* ── Pure helpers ───────────────────────────────────────────────── */

test('version vectors: dominance, equality and concurrency', () => {
  assert.equal(compareVV({ a: 2, b: 1 }, { a: 1, b: 1 }), 'gt');
  assert.equal(compareVV({ a: 1 }, { a: 1, b: 3 }), 'lt');
  assert.equal(compareVV({ a: 1, b: 2 }, { b: 2, a: 1 }), 'eq');
  assert.equal(compareVV({ a: 2 }, { b: 1 }), 'cc');
  assert.notEqual(hashStr('{"a":1}'), hashStr('{"a":2}'));
  assert.equal(hashStr('x'.repeat(5000)), hashStr('x'.repeat(5000)));
});

/* ── Propagation ────────────────────────────────────────────────── */

test('adds, edits and deletes travel both ways; a second idle sync writes nothing', async () => {
  await on(A, () => setTable('clients', [client('c1', 'Acme Traders'), client('c2', 'Beta Stores'), client('c3', 'Gamma Ltd')]));
  const r1 = await sync(A);
  assert.ok(r1.ok && r1.wrote, 'A wrote its file');
  const r2 = await sync(B);
  assert.equal(r2.added, 3);
  await on(B, () => assert.deepEqual(clients().map((c) => c.id), ['c1', 'c2', 'c3']));

  await on(B, () => {
    setTable('clients', clients().filter((c) => c.id !== 'c3').map((c) => (c.id === 'c1' ? { ...c, city: 'Mumbai' } : c)).concat([client('c4', 'Delta Co')]));
  });
  await sync(B);
  const r3 = await sync(A);
  assert.deepEqual([r3.added, r3.updated, r3.deleted, r3.conflicts], [1, 1, 1, 0]);
  await on(A, () => {
    assert.equal(byId('c1')?.city, 'Mumbai');
    assert.equal(byId('c3'), undefined, 'deleted on B → deleted on A');
    assert.ok(byId('c4'));
  });

  const idle = await sync(A);
  assert.equal(idle.wrote, false, 'nothing changed: the file is not rewritten');
  const idleB = await sync(B);
  assert.equal(idleB.added + idleB.updated + idleB.deleted, 0);
});

test('a tombstone is not undone by the other device and never resurrects the row', async () => {
  await on(A, () => setTable('clients', [client('c1', 'Acme'), client('c2', 'Beta')]));
  await sync(A);
  await sync(B);
  await on(A, () => localDb.clients.remove('c2'));
  await sync(A);
  await sync(B);
  await sync(A);
  await sync(B);
  for (const d of [A, B]) await on(d, () => assert.deepEqual(clients().map((c) => c.id), ['c1']));
  // B re-creating a row with the same id later is a newer change and wins.
  await on(B, () => setTable('clients', [...clients(), client('c2', 'Beta again')]));
  await sync(B);
  await sync(A);
  await on(A, () => assert.equal(byId('c2')?.name, 'Beta again'));
});

/* ── Conflicts ──────────────────────────────────────────────────── */

test('concurrent edits keep both: each side keeps its own and lists the other; resolving converges everywhere', async () => {
  await on(A, () => setTable('clients', [client('c1', 'Acme')]));
  await sync(A);
  await sync(B);
  await on(A, () => setTable('clients', [client('c1', 'Acme', { city: 'Delhi' })]));
  await on(B, () => setTable('clients', [client('c1', 'Acme', { city: 'Chennai' })]));
  await sync(A);
  const rb = await sync(B);
  assert.equal(rb.conflicts, 1);
  await on(B, () => {
    assert.equal(byId('c1')?.city, 'Chennai', 'B keeps its own version');
    const [c] = loadConflicts();
    assert.equal(c.kind, 'row');
    assert.equal((c as RowConflict).remote.value && ((c as RowConflict).remote.value as { city: string }).city, 'Delhi');
  });
  await sync(A);
  await on(A, () => {
    assert.equal(byId('c1')?.city, 'Delhi', 'A keeps its own version');
    assert.equal(loadConflicts().length, 1);
  });

  // Repeated syncs do not pile up duplicates of the same conflict.
  await sync(B);
  await sync(A);
  await on(A, () => assert.equal(loadConflicts().length, 1));

  // A picks B's version: it becomes the newest everywhere and B's own listing clears itself.
  await on(A, async () => {
    const c = loadConflicts()[0];
    assert.deepEqual(await resolveConflict(c.id, 'theirs', { id: A.id, name: A.name }), { ok: true });
    assert.equal(byId('c1')?.city, 'Chennai');
    assert.equal(loadConflicts().length, 0);
  });
  await sync(A);
  await sync(B);
  await on(B, () => {
    assert.equal(byId('c1')?.city, 'Chennai');
    assert.equal(loadConflicts().length, 0, 'resolved on A → cleared on B');
  });
});

test('edit on one side and delete on the other at the same time is a conflict, not a silent delete', async () => {
  await on(A, () => setTable('clients', [client('c1', 'Acme')]));
  await sync(A);
  await sync(B);
  await on(A, () => localDb.clients.remove('c1'));
  await on(B, () => setTable('clients', [client('c1', 'Acme', { city: 'Goa' })]));
  await sync(A);
  await sync(B);
  await on(B, () => {
    assert.equal(byId('c1')?.city, 'Goa', 'the edit is kept');
    const c = loadConflicts()[0] as RowConflict;
    assert.equal(c.remote.value, null, 'the remote side is the deletion');
  });
  await sync(A);
  await on(A, () => {
    assert.equal(byId('c1'), undefined, 'A keeps its deletion');
    const c = loadConflicts()[0] as RowConflict;
    assert.equal((c.remote.value as { city: string }).city, 'Goa', 'and lists the edit to restore');
  });
});

test('two devices issuing the same invoice number: both kept and flagged, never renumbered', async () => {
  const inv = (id: string, client: string) => ({ id, invoice_number: 'INV/FY26-27/0001', doc_type: 'INVOICE', issue_date: '2026-06-01', status: 'Sent', total: 100, client: { name: client } });
  await on(A, () => setTable('invoices', [inv('ia', 'Acme')]));
  await on(B, () => setTable('invoices', [inv('ib', 'Beta')]));
  await sync(A);
  await sync(B);
  await on(B, async () => {
    const all = getTable<{ id: string; invoice_number: string }>('invoices');
    assert.deepEqual(all.map((i) => [i.id, i.invoice_number]), [['ib', 'INV/FY26-27/0001'], ['ia', 'INV/FY26-27/0001']]);
    const dup = loadConflicts().find((c) => c.kind === 'duplicate');
    assert.ok(dup && dup.kind === 'duplicate' && dup.ids.join() === 'ia,ib');
    assert.deepEqual(sharedSeries(loadState(), B.id).map((w) => w.series), ['INV/FY26-27']);
    assert.deepEqual(await resolveConflict(dup.id, 'ack', { id: B.id, name: B.name }), { ok: true });
  });
  await sync(B);
  await on(B, () => assert.equal(loadConflicts().length, 0, 'acknowledged pairs are not flagged again'));
});

test('singletons: last writer by Lamport time wins on both devices; the other version is listed and can be restored', async () => {
  await on(A, () => setJson(SINGLETON_KEYS.template, 'classic_orange'));
  await sync(A);
  await sync(B);
  await on(A, () => setJson(SINGLETON_KEYS.template, 'minimal_blue'));
  await on(B, () => setJson(SINGLETON_KEYS.template, 'gst_green'));
  await sync(A);
  await sync(B);
  await sync(A);
  const a = await on(A, () => readRaw(SINGLETON_KEYS.template));
  const b = await on(B, () => readRaw(SINGLETON_KEYS.template));
  assert.equal(a, b, 'both devices converge on one value');
  const loser = a === '"minimal_blue"' ? '"gst_green"' : '"minimal_blue"';
  await on(A, async () => {
    const c = loadConflicts().find((x) => x.kind === 'single') as RowConflict;
    assert.ok(c, 'A lists the other version');
    const mine = c.local.value === loser ? 'mine' : 'theirs';
    assert.equal(c[mine === 'mine' ? 'local' : 'remote'].value, loser);
    await resolveConflict(c.id, mine, { id: A.id, name: A.name });
    assert.equal(readRaw(SINGLETON_KEYS.template), loser);
  });
  await sync(A);
  await sync(B);
  await on(B, () => {
    assert.equal(readRaw(SINGLETON_KEYS.template), loser, 'the restored version wins everywhere');
    assert.equal(loadConflicts().filter((c) => c.kind === 'single').length, 0);
  });
});

/* ── Audit log ──────────────────────────────────────────────────── */

test('audit logs: each device keeps its own chain; other devices’ logs are stored per device and verify', async () => {
  await on(A, () => {
    localDb.clients.upsert({ name: 'Acme' });
    localDb.clients.upsert({ name: 'Beta' });
  });
  await on(B, () => localDb.clients.upsert({ name: 'Gamma' }));
  await sync(A);
  await sync(B);
  await on(B, () => localDb.clients.upsert({ name: 'Delta' }));
  await sync(B);
  await sync(A);
  for (const [dev, other] of [[A, B], [B, A]] as const) {
    await on(dev, () => {
      const own = getTable<AuditEntry>(AUDIT_TABLE);
      assert.ok(verifyAuditChain(own).ok, `${dev.name}: own chain verifies after merging`);
      assert.ok(own.some((r) => r.entity_id === 'sync'), 'the merge itself is logged');
      const theirs = loadDeviceLogs()[other.id];
      assert.ok(theirs && theirs.rows.length >= 1, `${dev.name} holds ${other.name}'s log`);
      assert.ok(verifyAuditChain(theirs.rows).ok, `${other.name}'s chain verifies on ${dev.name}`);
      assert.ok(!own.some((r) => theirs.rows.some((x) => x.id === r.id)), 'chains are not interleaved');
    });
  }
  // mergeDeviceLog: overlap by id extends; a disjoint newer log replaces.
  const r = (id: string) => ({ id }) as AuditEntry;
  assert.deepEqual(mergeDeviceLog([r('1'), r('2')], [r('2'), r('3')]).map((x) => x.id), ['1', '2', '3']);
  assert.deepEqual(mergeDeviceLog([r('1')], [r('7'), r('8')]).map((x) => x.id), ['7', '8']);
});

/* ── Encryption and damaged files ───────────────────────────────── */

test('files in the folder are always encrypted: no business data in plain text', async () => {
  await on(A, () => {
    setTable('clients', [client('c1', 'Acme Secret Traders', { gstin: '27AABCU9603R1ZX', email: 'owner@acme.example' })]);
    setTable('invoices', [{ id: 'i1', invoice_number: 'SECRET/FY26-27/0042', issue_date: '2026-06-01', total: 98765.43, client: { name: 'Acme Secret Traders' } }]);
    putAttachment({ bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 10, 37, 37, 69, 79, 70, 10, 0]), name: 'bill.pdf' });
  });
  await sync(A);
  const files = root.allFiles();
  assert.ok(files.some(([p]) => p.endsWith(deviceFileName(A.id))), 'device file written');
  assert.ok(files.some(([p]) => p.includes('/blobs/') && p.endsWith('.mcblob')), 'attachment written as a blob');
  for (const [path, text] of files) {
    for (const secret of ['Acme', 'SECRET', '98765', 'owner@acme', '27AABCU9603R1ZX', 'Office PC', 'clients', 'invoice_number', 'JVBERi']) {
      assert.ok(!text.includes(secret), `${path} leaks ${secret}`);
    }
  }
});

test('a half-synced or damaged file is retried, then skipped without changing anything', async () => {
  await on(B, () => setTable('clients', [client('c1', 'Acme')]));
  await sync(B);
  const devices = root.at(SYNC_ROOT, GROUP, 'devices');
  const name = deviceFileName(B.id);
  const full = devices.files.get(name)!;

  // Mid-write on the first read, complete on the retry.
  devices.nextReads.set(name, [full.slice(0, Math.floor(full.length / 2))]);
  const ok = await sync(A);
  assert.ok(ok.ok && ok.unreadable.length === 0 && ok.added === 1, 'picked up after the retry');

  // Permanently damaged: reported, nothing applied, no throw.
  await on(B, () => setTable('clients', [client('c1', 'Acme'), client('c2', 'Beta')]));
  await sync(B);
  const good = devices.files.get(name)!;
  devices.files.set(name, good.slice(0, good.length - 40));
  const bad = await sync(A);
  assert.equal(bad.unreadable.length, 1);
  assert.equal(bad.added, 0);
  await on(A, () => assert.deepEqual(clients().map((c) => c.id), ['c1']));
  // A tampered ciphertext (valid JSON) fails the auth tag the same way.
  const env = JSON.parse(good);
  env.envelope.ct = env.envelope.ct.replace(/^.{8}/, 'AAAAAAAA');
  devices.files.set(name, JSON.stringify(env));
  assert.equal((await sync(A)).unreadable.length, 1);
  // Another device's file renamed to B's name does not decrypt (bound to the device id).
  devices.files.set(name, devices.files.get(deviceFileName(A.id))!.replace(A.id, B.id));
  assert.equal((await sync(A)).unreadable.length, 1);
  devices.files.set(name, good);
  assert.equal((await sync(A)).added, 1, 'fine again once the file is complete');
});

test('wrong passphrase cannot join; the right one can', async () => {
  const dirs = await openGroup(root, GROUP, false);
  await assert.rejects(createOrJoinGroup(dirs, GROUP, 'wrong passphrase!'), /does not open/);
  const joined = await createOrJoinGroup(dirs, GROUP, PASS);
  assert.equal(joined.created, false);
});

/* ── Period lock ────────────────────────────────────────────────── */

test('a synced change into a locked period is held as a conflict; applying needs the override and is audited', async () => {
  const inv = { id: 'i1', invoice_number: 'INV/FY25-26/0001', issue_date: '2026-02-10', status: 'Sent', total: 100, client: { name: 'Acme' } };
  await on(A, () => setTable('invoices', [inv]));
  await sync(A);
  await sync(B);
  await on(A, () => setJson(SINGLETON_KEYS.settings, { lock_until: '2026-03-31' }));
  await on(B, () => setTable('invoices', [{ ...inv, total: 999 }]));
  await sync(B);
  // settings carry the lock date: A's lock wins (it is A's own newer change)
  const r = await sync(A);
  assert.equal(r.updated, 0);
  await on(A, async () => {
    assert.equal(getTable<{ total: number }>('invoices')[0].total, 100, 'locked document untouched');
    const c = loadConflicts().find((x) => x.kind === 'row') as RowConflict;
    assert.equal(c.reason, 'locked');
    assert.equal((await resolveConflict(c.id, 'theirs', { id: A.id, name: A.name })).ok, false, 'needs the PIN override');
    assert.equal((await resolveConflict(c.id, 'theirs', { id: A.id, name: A.name }, { override: true })).ok, true);
    assert.equal(getTable<{ total: number }>('invoices')[0].total, 999);
    assert.ok(getTable<AuditEntry>(AUDIT_TABLE).some((e) => e.action === 'override' && e.entity_id === 'sync'));
  });
});

test('declining a locked-period change keeps the books and does not ask again', async () => {
  const inv = { id: 'i1', invoice_number: 'INV/FY25-26/0001', issue_date: '2026-02-10', status: 'Sent', total: 100 };
  await on(A, () => {
    setJson(SINGLETON_KEYS.settings, { lock_until: '2026-03-31' });
    setTable('invoices', [inv]);
  });
  await sync(A);
  await sync(B);
  await on(B, () => setTable('invoices', [{ ...inv, total: 5 }]));
  await sync(B);
  await sync(A);
  await on(A, async () => {
    const c = loadConflicts()[0];
    assert.equal((await resolveConflict(c.id, 'mine', { id: A.id, name: A.name })).ok, true);
  });
  await sync(A);
  await on(A, () => {
    assert.equal(loadConflicts().length, 0);
    assert.equal(getTable<{ total: number }>('invoices')[0].total, 100);
  });
});

/* ── Lost sync state, restore, attachments, exclusions ──────────── */

test('a device that lost its sync state (restore / erase) never has its new edits silently overwritten', async () => {
  await on(A, () => setTable('clients', [client('c1', 'Acme')]));
  await sync(A);
  await sync(B);
  await on(B, () => setTable('clients', [client('c1', 'Acme', { city: 'Agra' })]));
  await sync(B);
  await sync(A);
  // A restores an old backup (sync state is not in backups and the restore removes it), then edits.
  await on(A, () => {
    const backup = buildBackup();
    assert.ok(!(SYNC_STATE_KEY in backup.data), 'sync state never goes into a backup');
    assert.ok(!(SYNC_DEVICE_KEY in backup.data), 'the device id never goes into a backup');
    restoreBackup({ ...backup.data, [`${DB_PREFIX}clients`]: JSON.stringify([client('c1', 'Acme', { city: 'Kochi' })]) });
    assert.equal(readRaw(SYNC_STATE_KEY), null, 'restore removed the sync state');
  });
  await sync(A);
  await on(A, () => {
    assert.equal(byId('c1')?.city, 'Kochi', 'the restored edit is kept');
    assert.equal(loadConflicts().length, 1, "B's version is listed, not lost");
  });
});

test('attachment files follow the records that use them', async () => {
  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 10, 1, 2, 3, 4, 5, 6, 7]);
  let attId = '';
  await on(A, () => {
    const ref = putAttachment({ bytes: pdf, name: 'receipt.pdf' });
    attId = ref.id;
    setTable('purchases', [{ id: 'p1', vendor_name: 'V', date: '2026-06-01', total: 10, attachments: [ref] }]);
  });
  const ra = await sync(A);
  assert.equal(ra.blobsOut, 1);
  const rb = await sync(B);
  assert.equal(rb.blobsIn, 1);
  await on(B, () => assert.ok(readRaw(attachmentKey(attId))?.includes('application/pdf')));
  assert.equal((await sync(A)).blobsOut, 0, 'uploaded once');
});

test('the editor draft, schema version and device-local keys never travel', async () => {
  await on(A, () => {
    setJson(SINGLETON_KEYS.draft, { invoice_number: 'draft-on-A' });
    setJson(`${DB_PREFIX}export_prefs`, { a: 1 });
    setTable('clients', [client('c1', 'Acme')]);
  });
  await sync(A);
  await sync(B);
  await on(B, () => {
    assert.equal(readRaw(SINGLETON_KEYS.draft), null);
    assert.equal(readRaw(`${DB_PREFIX}export_prefs`), null);
    assert.ok(byId('c1'));
  });
});

test('a file from a device on another app version is skipped with a clear note', async () => {
  await on(B, () => {
    setJson(`${DB_PREFIX}schema_version`, 99);
    setTable('clients', [client('c1', 'Acme')]);
  });
  await sync(B);
  const r = await sync(A);
  assert.equal(r.unreadable.length, 1);
  assert.match(r.unreadable[0].message, /newer version/);
  await on(A, () => assert.equal(clients().length, 0));
});

/* ── Performance ────────────────────────────────────────────────── */

test('5,000 invoices + 5,000 clients: first sync, merge on the other device and an idle sync stay fast', async () => {
  const N = 5000;
  const rows = Array.from({ length: N }, (_, i) => ({
    id: `inv${i}`, invoice_number: `INV/FY26-27/${String(i + 1).padStart(4, '0')}`, issue_date: '2026-06-01', status: 'Sent', total: i,
    client: { name: `Client ${i % 400}` }, items: [{ id: `l${i}`, name: `Item ${i % 60}`, quantity: 2, rate: 10, tax_rate: 18 }],
  }));
  await on(A, () => {
    setTable('invoices', rows);
    setTable('clients', Array.from({ length: N }, (_, i) => client(`c${i}`, `Client ${i}`)));
  });
  const time = async (label: string, cap: number, fn: () => Promise<SyncReport>) => {
    const t0 = performance.now();
    const r = await fn();
    const ms = performance.now() - t0;
    console.log(`# perf sync ${label}: ${ms.toFixed(0)} ms`);
    assert.ok(ms < cap, `${label} took ${ms.toFixed(0)} ms (cap ${cap})`);
    return r;
  };
  await time('first sync (10,000 rows)', 15000, () => sync(A));
  const rb = await time('merge into the other device', 15000, () => sync(B));
  assert.equal(rb.added, 2 * N);
  await on(B, () => setTable('clients', getTable<{ id: string; name: string }>('clients').map((c, i) => (i === 7 ? { ...c, name: 'Edited' } : c))));
  await sync(B);
  const ra = await time('incremental sync with one change', 10000, () => sync(A));
  assert.equal(ra.updated, 1);
  const idle = await time('idle sync', 10000, () => sync(A));
  assert.equal(idle.wrote, false);
  await on(A, () => removeRaw(`${DB_PREFIX}clients`));
});

/* ── Lock date, legacy data, backups, issuing profile ───────────── */

test('another device moving the period lock earlier is held for the PIN, never applied silently', async () => {
  await on(A, () => setJson(SINGLETON_KEYS.settings, { lock_until: '2026-03-31' }));
  await sync(A);
  await sync(B);
  await on(B, () => setJson(SINGLETON_KEYS.settings, { lock_until: '' }));
  await sync(B);
  await sync(A);
  await on(A, async () => {
    assert.equal(JSON.parse(readRaw(SINGLETON_KEYS.settings)!).lock_until, '2026-03-31');
    const c = loadConflicts()[0] as RowConflict;
    assert.equal(c.kind, 'single');
    assert.equal(c.reason, 'locked');
    assert.equal((await resolveConflict(c.id, 'theirs', { id: A.id, name: A.name })).ok, false);
    assert.equal((await resolveConflict(c.id, 'theirs', { id: A.id, name: A.name }, { override: true })).ok, true);
    assert.equal(JSON.parse(readRaw(SINGLETON_KEYS.settings)!).lock_until, '');
  });
});

test('legacy rows that a restore would refuse (no id) do not block syncing', async () => {
  await on(A, () => setTable('items_catalog', [{ name: 'Old item without id', rate: 10 }]));
  await sync(A);
  const r = await sync(B);
  assert.ok(r.ok, r.message);
  await on(B, () => assert.equal(getTable<{ name: string }>('items_catalog')[0]?.name, 'Old item without id'));
});

test('backups never carry or restore sync bookkeeping', async () => {
  await on(A, () => setTable('clients', [client('c1', 'Acme')]));
  await sync(A);
  await on(A, () => {
    const file = buildBackup();
    for (const k of ['sync_state', 'sync_conflicts', 'sync_audit', 'sync_device']) assert.ok(!(DB_PREFIX + k in file.data), `${k} left out`);
    const doctored = { ...file, data: { ...file.data, [SYNC_STATE_KEY]: '{"v":1}' } };
    assert.ok(!(SYNC_STATE_KEY in parseBackup(JSON.stringify(doctored)).data), 'ignored on restore');
  });
});

test('a device can issue as its own profile (own number prefix) once sync is on', () => {
  const profiles = [{ id: 'p1', invoicePrefix: 'OFF' }, { id: 'p2', invoicePrefix: 'LAP' }];
  assert.equal(issuingProfile(profiles, profiles[0])?.id, 'p1', 'sync off: the active profile');
  setCompanySyncPrefs({ enabled: true, profile_id: 'p2' });
  assert.equal(issuingProfile(profiles, profiles[0])?.id, 'p2');
  setCompanySyncPrefs({ profile_id: 'gone' });
  assert.equal(issuingProfile(profiles, profiles[0])?.id, 'p1', 'a removed profile falls back');
  assert.ok(readRaw(SYNC_DEVICE_KEY), 'stored device-locally');
});
