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
  subscribeStorageChanges,
  unlockStorage,
  vaultEnabled,
  vaultSeal,
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

test('writes after unlock are sealed; plaintext planted in a vault store is refused, not loaded', async () => {
  await seeded();
  await enableVault(PASS);
  setTable('vendors', [{ id: 'v1', name: 'Hidden Vendor' }]);
  await flushStorage();
  assert.ok(isSealed(idbData().get(K('vendors')) as string));
  assert.ok(!rawValues().some((v) => v.includes('Hidden Vendor')));

  // Someone with access to the browser profile plants readable data (e.g. their own bank details).
  idbData().set(K('items_catalog'), JSON.stringify([{ id: 'x', name: 'Planted Item' }]));
  assert.equal((await reboot()).backend, 'locked');
  const res = await unlockStorage(PASS);
  assert.deepEqual(res.unreadable, [K('items_catalog')]);
  assert.deepEqual(getTable('items_catalog'), [], 'unencrypted values are not trusted');
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
  await forgetVault(); // Erase: the wipe cannot see a value that never decrypted, forgetVault removes it
  wipeAppData();
  await flushStorage();
  assert.equal(rawValues().length, 0, 'nothing sealed is left behind for the next boot');
});

test('unlock reads the store afresh: a tab left on the unlock screen sees later changes', async () => {
  await seeded();
  await enableVault(PASS);
  assert.equal((await reboot()).backend, 'locked'); // tab B sits on the unlock screen…
  // …while tab A (same data key) saves a new client and changes the passphrase.
  const rec = idbData().get(VAULT_KEY) as Parameters<typeof unwrapDek>[0];
  const dek = await unwrapDek(rec, PASS);
  idbData().set(K('clients'), await seal(dek, K('clients'), JSON.stringify([{ id: 'c1' }, { id: 'c2', name: 'Added in A' }])));
  idbData().set(VAULT_KEY, await rewrapVault(rec, PASS, 'changed in tab A'));
  await assert.rejects(unlockStorage(PASS), /Wrong passphrase/, 'the old passphrase no longer opens it');
  await unlockStorage('changed in tab A');
  assert.deepEqual(getTable<{ id: string }>('clients').map((c) => c.id), ['c1', 'c2'], 'not the boot-time snapshot');
});

test('vault turned off elsewhere while this tab was locked: it opens the readable store', async () => {
  await seeded();
  await enableVault(PASS);
  await reboot();
  idbData().delete(VAULT_KEY);
  idbData().set(K('clients'), JSON.stringify([{ id: 'c9', name: 'Readable' }]));
  idbData().delete(K('invoices'));
  await unlockStorage('anything at all');
  assert.equal(vaultEnabled(), false);
  assert.equal(getTable<{ id: string }>('clients')[0].id, 'c9');
});

test('a tab without the key refuses to write into a store that has a vault (no plaintext leak)', async () => {
  await seeded();
  const { record } = await createVault(PASS);
  idbData().set(VAULT_KEY, record); // another tab turned vault mode on
  writeRaw(K('vendors'), JSON.stringify([{ id: 'v1', name: 'Plain From B' }]));
  await flushStorage();
  assert.match(storageFailure()?.message ?? '', /changed in another tab/);
  assert.ok(!idbData().has(K('vendors')), 'nothing readable written into the vault store');
  assert.throws(() => writeRaw(K('vendors'), '[]'), /changed in another tab/, 'further writes are refused until reload');
});

test('the undo copy follows vault transitions (sealed on enable, readable again on disable)', async () => {
  await seeded();
  assert.equal(await saveSafetySnapshot('restore'), true);
  const kv = () => fakeIdb.store(DB, KV_STORE).get('safety-snapshot') as { data?: unknown; sealed?: string };
  assert.ok(kv().data, 'readable before vault mode');
  await enableVault(PASS);
  assert.equal(kv().data, undefined);
  assert.ok(kv().sealed && !kv().sealed!.includes('Acme'), 'sealed once the vault is on');
  await disableVault(PASS);
  assert.ok(kv().data && kv().sealed === undefined, 'readable again after turning it off');
  assert.ok((await getSafetySnapshot())?.data[K('clients')]?.includes('Acme'));
});

test('a damaged vault record is reported as damaged, not as a wrong passphrase', async () => {
  const { record } = await createVault(PASS);
  await assert.rejects(unwrapDek({ ...record, salt: '!!!!not base64!!!!' }, PASS), (e: unknown) => e instanceof VaultError && e.code === 'bad-record');
  await assert.rejects(unwrapDek({ ...record, id: '' }, PASS), (e: unknown) => e instanceof VaultError && e.code === 'bad-record');
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

test('QA12: a remote value still being decrypted never replaces this tab\'s newer write of the same key', async () => {
  await seeded();
  await enableVault(PASS);
  // Another tab commits an older clients list and announces it...
  idbData().set(K('clients'), await vaultSeal(K('clients'), '[{"id":"theirs"}]'));
  const subtle = globalThis.crypto.subtle;
  const real = subtle.decrypt;
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const inDecrypt = new Promise<void>((r) => (entered = r));
  Object.defineProperty(subtle, 'decrypt', {
    configurable: true,
    writable: true,
    value: async (...a: Parameters<SubtleCrypto['decrypt']>) => {
      entered();
      await gate;
      return real.apply(subtle, a);
    },
  });
  const seen: string[] = [];
  const off = subscribeStorageChanges((k) => seen.push(k));
  const ch = new BroadcastChannel('mrchartist_inv_sync');
  try {
    ch.postMessage({ keys: [K('clients')] });
    await inDecrypt;
    // ...while the slow decrypt runs, this tab writes and flushes a newer list.
    setTable('clients', [{ id: 'mine-newer' }]);
    await flushStorage();
    release();
    for (let i = 0; i < 100 && !seen.includes(K('clients')); i++) await new Promise((r) => setTimeout(r, 5));
    assert.ok(seen.includes(K('clients')), 'the remote change was processed');
    assert.deepEqual(getTable('clients'), [{ id: 'mine-newer' }], 'the older remote value is skipped');
  } finally {
    delete (subtle as unknown as { decrypt?: unknown }).decrypt;
    off();
    ch.close();
  }
  // A remote value written after this tab's write was sent is applied as before.
  idbData().set(K('clients'), await vaultSeal(K('clients'), '[{"id":"theirs-later"}]'));
  const seen2: string[] = [];
  const off2 = subscribeStorageChanges((k) => seen2.push(k));
  const ch2 = new BroadcastChannel('mrchartist_inv_sync');
  ch2.postMessage({ keys: [K('clients')] });
  for (let i = 0; i < 100 && !seen2.length; i++) await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(getTable('clients'), [{ id: 'theirs-later' }]);
  off2();
  ch2.close();
});
