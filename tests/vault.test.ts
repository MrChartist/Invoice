/**
 * 5.8 vault mode: the IndexedDB store encrypted at rest under a passphrase-wrapped key.
 * Runs against the in-memory IndexedDB (tests/helpers/fake-idb.ts).
 */
import './helpers/shim.ts';
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { fakeIdb, installFakeIdb } from './helpers/fake-idb.ts';
import {
  DB_PREFIX,
  changeVaultPassphrase,
  disableVault,
  enableVault,
  eraseLockedDevice,
  flushStorage,
  forgetVault,
  getTable,
  initStorage,
  readRaw,
  resetStorageBackend,
  setTable,
  storageFailure,
  unlockStorage,
  vaultEnabled,
  writeRaw,
} from '../src/lib/storage.ts';
import { DATA_STORE, KV_STORE, resetIdbConnection } from '../src/lib/idb-kv.ts';
import { VAULT_KEY, VaultError, createVault, isSealed, rewrapVault, seal, unseal, unwrapDek } from '../src/lib/vault.ts';
import { getSafetySnapshot, saveSafetySnapshot, wipeAppData } from '../src/lib/backup.ts';

const DB = 'mrchartist_inv_kv';
const K = (t: string) => DB_PREFIX + t;
const idbData = () => fakeIdb.store(DB, DATA_STORE);
const PASS = 'correct horse battery';

beforeEach(() => {
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

async function seeded() {
  assert.equal((await initStorage({ timeoutMs: 500 })).backend, 'idb');
  setTable('invoices', [{ id: 'i1', invoice_number: 'INV/FY26-27/0001', client: { name: 'Acme Secret Traders' }, total: 118 }]);
  setTable('clients', [{ id: 'c1', name: 'Acme Secret Traders', gstin: '27ABCDE1234F1Z5' }]);
  await flushStorage();
}

const rawValues = () => [...idbData()].filter(([k]) => k.startsWith(DB_PREFIX)).map(([, v]) => v as string);

test('crypto: seal binds the key name, wrong passphrase is refused, re-wrap keeps the data key', async () => {
  const { record, key } = await createVault(PASS);
  const sealed = await seal(key, K('clients'), 'hello');
  assert.ok(isSealed(sealed));
  assert.equal(await unseal(key, K('clients'), sealed), 'hello');
  await assert.rejects(unseal(key, K('invoices'), sealed), /could not be decrypted/, 'a value moved to another key does not open');
  await assert.rejects(unwrapDek(record, 'wrong passphrase!'), (e: unknown) => e instanceof VaultError && e.code === 'wrong-passphrase');
  const next = await rewrapVault(record, PASS, 'another long passphrase');
  assert.equal(next.id, record.id);
  assert.notEqual(next.wrapped, record.wrapped);
  const again = await unwrapDek(next, 'another long passphrase');
  assert.equal(await unseal(again, K('clients'), sealed), 'hello', 'same data key after a passphrase change');
  await assert.rejects(createVault('short'), (e: unknown) => e instanceof VaultError && e.code === 'weak-passphrase');
});

test('enable: nothing readable left in IndexedDB; reboot is locked until the passphrase', async () => {
  await seeded();
  await enableVault(PASS);
  assert.equal(vaultEnabled(), true);
  const raw = rawValues();
  assert.ok(raw.length >= 2 && raw.every((v) => isSealed(v)), 'every data value is sealed');
  assert.ok(!raw.some((v) => v.includes('Acme')), 'no plaintext party name in IndexedDB');
  assert.ok(idbData().has(VAULT_KEY));
  assert.equal(getTable<{ name: string }>('clients')[0].name, 'Acme Secret Traders', 'this tab keeps working');

  const init = await reboot();
  assert.equal(init.backend, 'locked');
  assert.deepEqual(getTable('clients'), [], 'nothing is readable while locked');
  await assert.rejects(unlockStorage('not the passphrase'), (e: unknown) => e instanceof VaultError && e.code === 'wrong-passphrase');
  const res = await unlockStorage(PASS);
  assert.deepEqual(res.unreadable, []);
  assert.equal(getTable<{ name: string }>('clients')[0].name, 'Acme Secret Traders');
  assert.equal(getTable<{ id: string }>('invoices')[0].id, 'i1');
});

test('writes after unlock are sealed; plaintext written by a keyless tab is taken and re-sealed', async () => {
  await seeded();
  await enableVault(PASS);
  setTable('vendors', [{ id: 'v1', name: 'Hidden Vendor' }]);
  await flushStorage();
  assert.ok(isSealed(idbData().get(K('vendors')) as string));
  assert.ok(!rawValues().some((v) => v.includes('Hidden Vendor')));

  idbData().set(K('items_catalog'), JSON.stringify([{ id: 'x', name: 'Plain Item' }])); // e.g. a tab without the key
  assert.equal((await reboot()).backend, 'locked');
  await unlockStorage(PASS);
  assert.equal(getTable<{ name: string }>('items_catalog')[0].name, 'Plain Item');
  await flushStorage();
  assert.ok(isSealed(idbData().get(K('items_catalog')) as string), 're-sealed on the next flush');
});

test('a tampered value is reported, not fatal, and left in place', async () => {
  await seeded();
  await enableVault(PASS);
  const v = idbData().get(K('clients')) as string;
  idbData().set(K('clients'), v.slice(0, -4) + (v.endsWith('AAAA') ? 'BBBB' : 'AAAA'));
  await reboot();
  const res = await unlockStorage(PASS);
  assert.deepEqual(res.unreadable, [K('clients')]);
  assert.equal(getTable<{ id: string }>('invoices')[0].id, 'i1', 'the rest opens');
  assert.ok(idbData().has(K('clients')), 'the damaged value is not deleted');
});

test('change passphrase: only the record changes; disable writes everything back readable', async () => {
  await seeded();
  await enableVault(PASS);
  const sealedBefore = idbData().get(K('clients'));
  await assert.rejects(changeVaultPassphrase('wrong passphrase!', 'new long passphrase'), /Wrong passphrase/);
  await changeVaultPassphrase(PASS, 'new long passphrase');
  assert.equal(idbData().get(K('clients')), sealedBefore, 'data not re-encrypted');
  await reboot();
  await assert.rejects(unlockStorage(PASS), /Wrong passphrase/);
  await unlockStorage('new long passphrase');

  await assert.rejects(disableVault(PASS), /Wrong passphrase/);
  assert.equal(vaultEnabled(), true, 'a wrong passphrase changes nothing');
  await disableVault('new long passphrase');
  assert.equal(vaultEnabled(), false);
  assert.ok(!idbData().has(VAULT_KEY));
  assert.ok(rawValues().every((v) => !isSealed(v)));
  assert.equal((await reboot()).backend, 'idb', 'no passphrase needed any more');
  assert.equal(getTable<{ name: string }>('clients')[0].name, 'Acme Secret Traders');
});

test('a tab whose vault was removed elsewhere refuses to write sealed values', async () => {
  await seeded();
  await enableVault(PASS);
  idbData().delete(VAULT_KEY); // another tab turned vault mode off (or erased)
  writeRaw(K('notes_probe'), 'secret');
  await flushStorage();
  assert.match(storageFailure()?.message ?? '', /changed in another tab/);
  assert.ok(!idbData().has(K('notes_probe')), 'nothing written that could not be read back');
});

test('restore undo copy is sealed in vault mode and still opens', async () => {
  await seeded();
  await enableVault(PASS);
  assert.equal(await saveSafetySnapshot('wipe'), true);
  const stored = fakeIdb.store(DB, KV_STORE).get('safety-snapshot') as { data?: unknown; sealed?: string };
  assert.equal(stored.data, undefined);
  assert.ok(stored.sealed && isSealed(stored.sealed) && !stored.sealed.includes('Acme'));
  const snap = await getSafetySnapshot();
  assert.ok(snap?.data[K('clients')]?.includes('Acme Secret Traders'));
});

test('erase drops the vault so the next boot starts fresh; forgot-passphrase erases a locked device', async () => {
  await seeded();
  await enableVault(PASS);
  await forgetVault();
  wipeAppData();
  await flushStorage();
  assert.ok(!idbData().has(VAULT_KEY));
  assert.equal(rawValues().length, 0, 'data deleted');
  assert.equal((await reboot()).backend, 'idb');

  setTable('clients', [{ id: 'c2', name: 'Again' }]);
  await flushStorage();
  await enableVault(PASS);
  localStorage.setItem(K('auth'), '{"hash":"x"}');
  assert.equal((await reboot()).backend, 'locked');
  await eraseLockedDevice();
  assert.equal(idbData().size, 0);
  assert.equal(localStorage.getItem(K('auth')), null);
  assert.equal((await reboot()).backend, 'idb');
  assert.equal(readRaw(K('clients')), null);
});
