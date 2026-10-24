/**
 * Phase 4.2: data tables in IndexedDB behind a synchronous in-memory cache.
 * Runs against a minimal in-memory IndexedDB (tests/helpers/fake-idb.ts).
 */
import './helpers/shim.ts';
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { dumpStorage, loadStorage, resetStorage } from './helpers/shim.ts';
import { fakeIdb, installFakeIdb, uninstallFakeIdb } from './helpers/fake-idb.ts';
import {
  DB_PREFIX,
  STORAGE_BACKEND_KEY,
  StorageWriteError,
  collectAppData,
  flushStorage,
  getTable,
  initStorage,
  readRaw,
  removeRaw,
  resetStorageBackend,
  setTable,
  storageBackend,
  storageFailure,
  subscribeStorageChanges,
  subscribeStorageFailure,
  writeRaw,
} from '../src/lib/storage.ts';
import { DATA_STORE, idbGet, idbSet, resetIdbConnection } from '../src/lib/idb-kv.ts';
import { buildBackup, parseBackup, restoreBackup, wipeAppData } from '../src/lib/backup.ts';
import { MIGRATIONS, getSchemaVersion, runMigrations, type Migration } from '../src/lib/migrations.ts';
import { measureStorage } from '../src/lib/storage-health.ts';
import { resetAllData, AUTH_KEY } from '../src/lib/auth.ts';

const DB = 'mrchartist_inv_kv';
const K = (t: string) => DB_PREFIX + t;
const idbData = () => fakeIdb.store(DB, DATA_STORE);
const tick = () => new Promise((r) => setTimeout(r, 5));

beforeEach(async () => {
  resetStorageBackend();
  resetIdbConnection();
  fakeIdb.reset();
  installFakeIdb();
  resetStorage();
});

/** Simulate a page reload: drop the in-memory cache and connection, keep IndexedDB + localStorage. */
async function reboot() {
  await flushStorage();
  resetStorageBackend();
  resetIdbConnection();
  return initStorage({ timeoutMs: 500 });
}

const LEGACY = {
  [K('invoices')]: JSON.stringify([{ id: 'i1', total: 100 }]),
  [K('clients')]: JSON.stringify([{ id: 'c1', name: 'Acme' }]),
  [K('settings')]: JSON.stringify({ profiles: [], activeProfileId: '' }),
  [K('schema_version')]: '2',
  [AUTH_KEY]: '{"hash":"x"}',
  [K('last_backup')]: '2026-01-01T00:00:00.000Z',
  theme: 'dark',
};

test('without IndexedDB the app stays on plain localStorage, exactly as before', async () => {
  uninstallFakeIdb();
  loadStorage(LEGACY);
  const r = await initStorage();
  assert.equal(r.backend, 'local');
  assert.equal(storageBackend(), 'local');
  setTable('clients', [{ id: 'c2' }]);
  assert.equal(localStorage.getItem(K('clients')), '[{"id":"c2"}]');
});

test('first boot moves every data key into IndexedDB, verifies, then removes the localStorage copy', async () => {
  loadStorage(LEGACY);
  const r = await initStorage();
  assert.deepEqual(r, { backend: 'idb', moved: 4 });
  // Data keys moved, byte for byte.
  for (const k of [K('invoices'), K('clients'), K('settings'), K('schema_version')]) {
    assert.equal(idbData().get(k), LEGACY[k], k);
    assert.equal(localStorage.getItem(k), null, `${k} left localStorage`);
    assert.equal(readRaw(k), LEGACY[k]);
  }
  // Device-local keys and theme never move.
  assert.equal(localStorage.getItem(AUTH_KEY), LEGACY[AUTH_KEY]);
  assert.equal(localStorage.getItem(K('last_backup')), LEGACY[K('last_backup')]);
  assert.equal(localStorage.getItem('theme'), 'dark');
  assert.equal(idbData().has(AUTH_KEY), false);
  assert.equal(localStorage.getItem(STORAGE_BACKEND_KEY), 'idb');
  assert.deepEqual(getTable('clients'), [{ id: 'c1', name: 'Acme' }]);
});

test('reads and writes stay synchronous; writes reach IndexedDB in one batch, never localStorage', async () => {
  await initStorage();
  setTable('clients', [{ id: 'a' }]);
  setTable('clients', [{ id: 'a' }, { id: 'b' }]);
  writeRaw(K('template'), '"modern"');
  assert.deepEqual(getTable('clients'), [{ id: 'a' }, { id: 'b' }], 'readable immediately');
  assert.equal(idbData().get(K('clients')), undefined, 'not yet committed');
  await flushStorage();
  assert.equal(idbData().get(K('clients')), '[{"id":"a"},{"id":"b"}]');
  assert.equal(idbData().get(K('template')), '"modern"');
  assert.equal(localStorage.getItem(K('clients')), null);
  removeRaw(K('template'));
  assert.equal(readRaw(K('template')), null);
  await flushStorage();
  assert.equal(idbData().has(K('template')), false);
});

test('writes are flushed automatically on the next task', async () => {
  await initStorage();
  setTable('vendors', [{ id: 'v' }]);
  await tick();
  await tick();
  assert.equal(idbData().get(K('vendors')), '[{"id":"v"}]');
});

test('a reload serves the data from IndexedDB', async () => {
  loadStorage(LEGACY);
  await initStorage();
  setTable('clients', [{ id: 'new' }]);
  const r = await reboot();
  assert.deepEqual(r, { backend: 'idb', moved: 0 });
  assert.deepEqual(getTable('clients'), [{ id: 'new' }]);
  assert.deepEqual(getTable('invoices'), [{ id: 'i1', total: 100 }]);
});

test('a copy that does not verify leaves localStorage untouched and the session on localStorage; the next boot retries', async () => {
  loadStorage(LEGACY);
  const before = dumpStorage();
  fakeIdb.corruptNextRead(); // the empty initial read has nothing to flip; the verification read does
  const r = await initStorage();
  assert.equal(r.backend, 'local');
  assert.deepEqual(dumpStorage(), before, 'localStorage untouched');
  assert.equal(readRaw(K('clients')), LEGACY[K('clients')], 'still served from localStorage');
  const again = await reboot();
  assert.equal(again.backend, 'idb');
  assert.equal(readRaw(K('clients')), LEGACY[K('clients')]);
  assert.equal(localStorage.getItem(K('clients')), null);
});

test('a copy refused for lack of space leaves localStorage untouched', async () => {
  loadStorage(LEGACY);
  const before = dumpStorage();
  fakeIdb.failNextWrite('QuotaExceededError');
  const r = await initStorage();
  assert.equal(r.backend, 'local');
  assert.deepEqual(dumpStorage(), before);
  assert.equal(idbData().size, 0, 'the failed transaction wrote nothing');
});

test('IndexedDB that never answers: plain localStorage before the move, a blocking error after it', async () => {
  loadStorage(LEGACY);
  fakeIdb.hang = true;
  assert.equal((await initStorage({ timeoutMs: 30 })).backend, 'local');
  assert.equal(readRaw(K('clients')), LEGACY[K('clients')]);

  fakeIdb.hang = false;
  await reboot();
  assert.equal(storageBackend(), 'idb');
  resetStorageBackend();
  resetIdbConnection();
  fakeIdb.hang = true;
  const r = await initStorage({ timeoutMs: 30 });
  assert.equal(r.backend, 'unavailable', 'never start on an empty localStorage once the data has moved');
});

test('after the move, a stale localStorage copy (an outdated tab) never overwrites IndexedDB; unknown keys are imported', async () => {
  loadStorage(LEGACY);
  await initStorage();
  setTable('invoices', [{ id: 'i1' }, { id: 'i2' }]);
  await flushStorage();
  // An old build in another tab writes to localStorage.
  localStorage.setItem(K('invoices'), '[{"id":"stale"}]');
  localStorage.setItem(K('gstr1_turnover'), '{"gt":"5"}');
  await reboot();
  assert.deepEqual(getTable('invoices'), [{ id: 'i1' }, { id: 'i2' }]);
  assert.equal(readRaw(K('gstr1_turnover')), '{"gt":"5"}');
  assert.equal(localStorage.getItem(K('invoices')), null, 'stale copy dropped');
  assert.equal(localStorage.getItem(K('gstr1_turnover')), null, 'imported key moved');
});

test('localStorage cleared on its own: IndexedDB data is kept', async () => {
  loadStorage(LEGACY);
  await initStorage();
  resetStorage(); // marker and device keys gone, IndexedDB intact
  const r = await reboot();
  assert.equal(r.backend, 'idb');
  assert.deepEqual(getTable('clients'), [{ id: 'c1', name: 'Acme' }]);
});

test('a background write refused for lack of space is reported, blocks growth, and clears once a write succeeds', async () => {
  await initStorage();
  setTable('clients', [{ id: 'a' }, { id: 'b' }]);
  await flushStorage();
  let calls = 0;
  const off = subscribeStorageFailure(() => calls++);
  fakeIdb.failNextWrite('QuotaExceededError');
  setTable('clients', [{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
  await flushStorage();
  const failure = storageFailure();
  assert.ok(failure instanceof StorageWriteError && failure.quotaExceeded);
  assert.equal(calls, 1);
  assert.match(failure.message, /storage is full/i);
  // Growing writes now fail synchronously, like localStorage did.
  assert.throws(() => setTable('clients', [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]), StorageWriteError);
  // Shrinking writes go through, and retry the pending ones.
  setTable('clients', [{ id: 'a' }]);
  await flushStorage();
  assert.equal(storageFailure(), null);
  assert.equal(calls, 2);
  assert.equal(idbData().get(K('clients')), '[{"id":"a"}]');
  off();
});

test('a failed flush keeps the change in memory and retries it with the next write', async () => {
  await initStorage();
  fakeIdb.failNextWrite('UnknownError');
  setTable('vendors', [{ id: 'v1' }]);
  await flushStorage();
  assert.ok(storageFailure());
  assert.deepEqual(getTable('vendors'), [{ id: 'v1' }]);
  writeRaw(K('template'), '"x"');
  await flushStorage();
  assert.equal(idbData().get(K('vendors')), '[{"id":"v1"}]');
  assert.equal(storageFailure(), null);
});

test('cross-tab: a committed write is announced on the BroadcastChannel', async () => {
  await initStorage();
  const ch = new BroadcastChannel('mrchartist_inv_sync');
  const got = new Promise<unknown>((resolve) => (ch.onmessage = (e) => resolve(e.data)));
  setTable('clients', [{ id: 'x' }]);
  await flushStorage();
  assert.deepEqual(await got, { keys: [K('clients')] });
  ch.close();
});

test('cross-tab: another tab\'s announcement refreshes the cache, except keys with unsaved local changes', async () => {
  await initStorage();
  setTable('clients', [{ id: 'mine' }]);
  setTable('vendors', [{ id: 'v-old' }]);
  await flushStorage();
  // Another tab commits both tables...
  idbData().set(K('clients'), '[{"id":"theirs"}]');
  idbData().set(K('vendors'), '[{"id":"v-new"}]');
  // ...while this tab has an unsaved change to clients.
  setTable('clients', [{ id: 'mine-newer' }]);
  const seen: string[] = [];
  const off = subscribeStorageChanges((k) => seen.push(k));
  const ch = new BroadcastChannel('mrchartist_inv_sync');
  ch.postMessage({ keys: [K('clients'), K('vendors'), AUTH_KEY] });
  for (let i = 0; i < 50 && seen.length < 2; i++) await tick();
  assert.deepEqual(getTable('vendors'), [{ id: 'v-new' }]);
  assert.deepEqual(getTable('clients'), [{ id: 'mine-newer' }], 'local unsaved write wins');
  assert.deepEqual(seen.sort(), [K('clients'), K('vendors')], 'device-local keys are not data');
  off();
  ch.close();
});

test('backup, wipe and restore work from the cache', async () => {
  loadStorage(LEGACY);
  await initStorage();
  setTable('invoices', [{ id: 'i1', sender: { logo: 'data:image/png;base64,AAAA' } }]);
  const data = collectAppData();
  assert.equal(data[K('clients')], LEGACY[K('clients')]);
  assert.equal(data[AUTH_KEY], LEGACY[AUTH_KEY], 'device-local keys still listed (backup drops them)');
  localStorage.setItem(K('vendors'), '[{"id":"stale"}]');
  assert.equal(collectAppData()[K('vendors')], undefined, 'stale localStorage data is not app data');
  const file = JSON.stringify(buildBackup());
  assert.ok(!file.includes(AUTH_KEY));
  wipeAppData();
  assert.deepEqual(getTable('invoices'), []);
  await flushStorage();
  assert.equal(idbData().has(K('invoices')), false, 'the wipe reached IndexedDB');
  restoreBackup(parseBackup(file).data);
  await reboot();
  assert.deepEqual(getTable('invoices'), [{ id: 'i1', sender: { logo: 'data:image/png;base64,AAAA' } }]);
  assert.equal(readRaw(AUTH_KEY), LEGACY[AUTH_KEY]);
});

test('storage health measures the cache', async () => {
  loadStorage(LEGACY);
  await initStorage();
  const m = measureStorage();
  assert.ok(m.tables.some((t) => t.key === K('invoices')));
  assert.ok(m.usedChars > LEGACY[K('invoices')].length);
});

test('migrations run on the cache and roll back inside it', async () => {
  loadStorage({ [K('schema_version')]: '1', [K('invoices')]: JSON.stringify([{ id: 'a', sender: { logo: 'data:image/png;base64,QQ==' } }]) });
  await initStorage();
  const boom: Migration = { version: 4, name: 'boom', up: () => { throw new Error('x'); } };
  const r = runMigrations([...MIGRATIONS, boom]);
  assert.equal(r.status, 'failed');
  assert.equal(getSchemaVersion(), 3);
  assert.match(readRaw(K('invoices'))!, /asset:/);
  await reboot();
  assert.equal(getSchemaVersion(), 3, 'committed to IndexedDB');
  assert.deepEqual(getTable('invoices'), [{ id: 'a', sender: { logo: 'data:image/png;base64,QQ==' } }]);
});

test('forgot-PIN reset erases the cache and IndexedDB, not just localStorage', async () => {
  loadStorage(LEGACY);
  await initStorage();
  assert.equal(resetAllData('DELETE ALL MY DATA'), true);
  assert.deepEqual(getTable('invoices'), []);
  await reboot();
  assert.deepEqual(getTable('invoices'), []);
  assert.deepEqual(getTable('clients'), []);
  assert.equal(localStorage.getItem(AUTH_KEY), null);
});

test('idb-kv shares one connection and reopens after the browser closes it', async () => {
  await idbSet('a', 1);
  await idbSet('b', { x: 2 });
  assert.equal(await idbGet('a'), 1);
  assert.deepEqual(await idbGet('b'), { x: 2 });
  await initStorage();
  setTable('clients', []);
  await flushStorage();
  assert.equal(fakeIdb.opens, 1, 'kv helpers and the data cache share one connection');
  fakeIdb.fireVersionChange(); // another tab upgrades: we close and step aside
  assert.equal(await idbGet('a'), 1);
  assert.equal(fakeIdb.opens, 2, 're-opened once');
});
