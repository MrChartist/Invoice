/**
 * 5.7 folder sync with vault mode (5.8) on the receiving device: merged data, the sync bookkeeping and the
 * other devices' audit logs reach IndexedDB only sealed; nothing readable is written outside the vault store.
 */
import './helpers/shim.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { fakeIdb, installFakeIdb, uninstallFakeIdb } from './helpers/fake-idb.ts';
import { FakeDir } from './helpers/fake-dir.ts';
import { DB_PREFIX, SYNC_META_KEYS, enableVault, flushStorage, getTable, initStorage, resetStorageBackend, setTable, unlockStorage } from '../src/lib/storage.ts';
import { DATA_STORE, KV_STORE, resetIdbConnection } from '../src/lib/idb-kv.ts';
import { VAULT_KEY, isSealed } from '../src/lib/vault.ts';
import { localDb } from '../src/lib/localDb.ts';
import { createOrJoinGroup, openGroup } from '../src/lib/sync-files.ts';
import { loadConflicts, loadDeviceLogs, runSync } from '../src/lib/sync-engine.ts';

const GROUP = 'vault-books';
const PASS = 'vault passphrase 1';

test('vault on: synced rows are decrypted only in memory and stored sealed', async () => {
  const root = new FakeDir('Dropbox');
  const { key } = await createOrJoinGroup(await openGroup(root, GROUP, true), GROUP, 'sync passphrase', { iter: 210_000 });
  const B = { id: 'bbbbbbbb-0000-4000-8000-00000000000b', name: 'Laptop' };
  const A = { id: 'aaaaaaaa-0000-4000-8000-00000000000a', name: 'Office' };

  // Device B (plain localStorage backend) publishes a client and an audited change.
  resetStorageBackend();
  resetStorage();
  localDb.clients.upsert({ id: 'c1', name: 'Acme Secret Traders', gstin: '27AABCU9603R1ZX' } as never);
  await runSync({ root, group: GROUP, key, device: B, retryDelayMs: 0 });

  // Device A: IndexedDB + vault mode.
  resetStorageBackend();
  resetIdbConnection();
  fakeIdb.reset();
  installFakeIdb();
  resetStorage();
  try {
    assert.equal((await initStorage({ timeoutMs: 500 })).backend, 'idb');
    setTable('clients', [{ id: 'c1', name: 'Acme Secret Traders (A)', gstin: '27AABCU9603R1ZX' }]);
    await enableVault(PASS);
    const r = await runSync({ root, group: GROUP, key, device: A, retryDelayMs: 0 });
    assert.ok(r.ok, r.message);
    assert.equal(r.conflicts, 1, 'both edited c1: listed, A keeps its own');
    await flushStorage();

    const data = fakeIdb.store('mrchartist_inv_kv', DATA_STORE);
    for (const k of SYNC_META_KEYS) assert.ok(isSealed(data.get(k) as string), `${k} is sealed at rest`);
    for (const [k, v] of data) {
      if (k === VAULT_KEY || k === '__meta__') continue;
      assert.ok(typeof v === 'string' && isSealed(v), `${String(k)} is sealed`);
      assert.ok(!String(v).includes('Acme'), `${String(k)} holds no plaintext`);
    }
    for (const [, v] of fakeIdb.store('mrchartist_inv_kv', KV_STORE)) assert.ok(!JSON.stringify(v ?? '').includes('Acme'), 'nothing readable in the kv store');
    for (const [p, t] of root.allFiles()) assert.ok(!t.includes('Acme'), `${p} holds no plaintext`);

    // After a reboot everything (including the conflict's remote copy and B's audit log) opens with the passphrase.
    await flushStorage();
    resetStorageBackend();
    resetIdbConnection();
    assert.equal((await initStorage({ timeoutMs: 500 })).backend, 'locked');
    await unlockStorage(PASS);
    assert.equal(getTable<{ name: string }>('clients')[0].name, 'Acme Secret Traders (A)');
    const c = loadConflicts()[0];
    assert.ok(c && c.kind === 'row' && (c.remote.value as { name: string }).name === 'Acme Secret Traders');
    assert.ok(loadDeviceLogs()[B.id]?.rows.length);
    assert.ok(!(`${DB_PREFIX}sync_device` in Object.fromEntries(data)), 'device identity stays in localStorage');
  } finally {
    resetStorageBackend();
    resetIdbConnection();
    uninstallFakeIdb();
  }
});
