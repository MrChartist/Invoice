/**
 * Security review regressions that need IndexedDB (tests/helpers/fake-idb.ts): vault damaged boot (L5),
 * vault switches owner-only (L6), vault + plain backups (L4), folder sync owner-only (M3).
 */
import './helpers/shim.ts';
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { fakeIdb, installFakeIdb } from './helpers/fake-idb.ts';
import { FakeDir } from './helpers/fake-dir.ts';
import { DB_PREFIX, changeVaultPassphrase, disableVault, enableVault, flushStorage, initStorage, resetStorageBackend, setTable } from '../src/lib/storage.ts';
import { DATA_STORE, idbSet, resetIdbConnection } from '../src/lib/idb-kv.ts';
import { VAULT_KEY, isSealed } from '../src/lib/vault.ts';
import { AccessDeniedError, setActorProvider } from '../src/lib/access.ts';
import { exportPlainBackup } from '../src/lib/backup.ts';
import { backupPayload, downloadBackupNow, setBackupPassphrase } from '../src/lib/auto-backup.ts';
import { setCompanySyncPrefs } from '../src/lib/sync-device.ts';

// Folder sync / folder backups are feature-detected through window.showDirectoryPicker.
Object.assign(globalThis, { window: { showDirectoryPicker: async () => new FakeDir('Picked'), dispatchEvent: () => true } });
const sync = await import('../src/lib/sync-folder.ts');

const PASS = 'correct horse battery';
const idbData = () => fakeIdb.store('mrchartist_inv_kv', DATA_STORE);
const viewer = () => ({ id: 'u2', name: 'Viewer', role: 'viewer' as const });
const clerk = () => ({ id: 'u3', name: 'Clerk', role: 'clerk' as const });

beforeEach(() => {
  setActorProvider(null);
  resetStorageBackend();
  resetIdbConnection();
  fakeIdb.reset();
  installFakeIdb();
  resetStorage();
});

async function reboot() {
  await flushStorage();
  resetStorageBackend();
  resetIdbConnection();
  return initStorage({ timeoutMs: 500 });
}

test('L5: sealed data without a vault record refuses to boot (vault damaged), and nothing plain is written', async () => {
  assert.equal((await initStorage({ timeoutMs: 500 })).backend, 'idb');
  setTable('clients', [{ id: 'c1', name: 'Acme Secret Traders' }]);
  await enableVault(PASS);
  await flushStorage();
  idbData().delete(VAULT_KEY); // record lost / deleted
  const before = new Map(idbData());
  const init = await reboot();
  assert.equal(init.backend, 'unavailable');
  assert.equal(init.backend === 'unavailable' && init.vaultDamaged, true);
  await flushStorage();
  for (const [k, v] of idbData()) {
    if (typeof k === 'string' && k.startsWith(DB_PREFIX)) {
      assert.ok(isSealed(v as string), `${k} still sealed`);
      assert.equal(v, before.get(k), `${k} untouched`);
    }
  }
});

test('L5: turning the vault off leaves no sealed orphans behind, so the next boot is normal', async () => {
  assert.equal((await initStorage({ timeoutMs: 500 })).backend, 'idb');
  setTable('clients', [{ id: 'c1', name: 'Acme' }]);
  await enableVault(PASS);
  await disableVault(PASS);
  assert.equal((await reboot()).backend, 'idb');
});

test('L6: vault on / off / new passphrase are owner-only', async () => {
  assert.equal((await initStorage({ timeoutMs: 500 })).backend, 'idb');
  setActorProvider(clerk);
  await assert.rejects(() => enableVault(PASS), AccessDeniedError);
  setActorProvider(null);
  await enableVault(PASS);
  setActorProvider(viewer);
  await assert.rejects(() => changeVaultPassphrase(PASS, 'another passphrase'), AccessDeniedError);
  await assert.rejects(() => disableVault(PASS), AccessDeniedError);
});

test('L4: vault on → plain backups are refused; an encrypted one (backup passphrase) works', async () => {
  assert.equal((await initStorage({ timeoutMs: 500 })).backend, 'idb');
  setTable('clients', [{ id: 'c1', name: 'Acme Secret Traders' }]);
  await enableVault(PASS);
  assert.throws(() => exportPlainBackup(), /Vault mode is on/);
  await assert.rejects(() => backupPayload(new Date(), null, { scheduled: true }), /Vault mode is on/);
  const dl = await downloadBackupNow();
  assert.equal((dl as { reason?: string }).reason, 'encryption');
  assert.deepEqual(await setBackupPassphrase('backup passphrase 1'), { ok: true });
  const { getBackupKey } = await import('../src/lib/auto-backup.ts');
  const enc = await backupPayload(new Date(), await getBackupKey(), { scheduled: true });
  assert.ok(enc.filename.includes('.encrypted') && !enc.text.includes('Acme'));
});

test('M3: connecting, re-entering the passphrase, disconnecting and "Sync now" are owner-only', async () => {
  for (const who of [viewer, clerk]) {
    setActorProvider(who);
    const r = await sync.connectSync({ handle: new FakeDir('Usb'), group: 'evil-group', passphrase: 'viewer-chosen-pass' });
    assert.equal(r.ok, false);
    assert.match((r as { message: string }).message, /cannot change settings/);
    assert.equal(await sync.getSyncConfig(), null, 'nothing remembered');
    assert.equal((await sync.reenterPassphrase('whatever pass')).ok, false);
    await assert.rejects(() => sync.disconnectSync(), AccessDeniedError);
    assert.equal((await sync.runSyncNow({ interactive: true })).reason, 'denied');
  }
});

test('M3: automatic runs refuse a connection that was not made by the owner; legacy ones need the owner once', async () => {
  setCompanySyncPrefs({ enabled: true, group: 'g1' });
  await idbSet('sync-dir-handle', new FakeDir('Usb'));
  await idbSet('sync-config', { group: 'g1', folder: 'Usb', connected_at: '2026-01-01T00:00:00Z', connected_by: { id: 'u2', name: 'Viewer', role: 'viewer' } });
  setActorProvider(null); // even the owner's tab: the connection itself is not trusted
  assert.equal((await sync.runSyncNow()).reason, 'denied');
  // A connection from before `connected_by` existed: a viewer's automatic run is refused …
  await idbSet('sync-config', { group: 'g1', folder: 'Usb', connected_at: '2026-01-01T00:00:00Z' });
  setActorProvider(viewer);
  assert.equal((await sync.runSyncNow()).reason, 'denied');
  assert.equal((await sync.getSyncConfig())?.connected_by, undefined);
  // … the owner's run vouches for it (it then fails later here only for lack of a stored key).
  setActorProvider(null);
  assert.notEqual((await sync.runSyncNow()).reason, 'denied');
  assert.equal((await sync.getSyncConfig())?.connected_by?.role, 'owner');
});
