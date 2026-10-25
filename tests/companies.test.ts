/**
 * 6.20 separate companies: one IndexedDB database per company, same keys inside.
 */
import './helpers/shim.ts';
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { fakeIdb, installFakeIdb } from './helpers/fake-idb.ts';
import { DB_PREFIX, flushStorage, getTable, initStorage, resetStorageBackend, setTable } from '../src/lib/storage.ts';
import { DATA_STORE, resetIdbConnection } from '../src/lib/idb-kv.ts';
import { COMPANY_REGISTRY_KEY, DEFAULT_COMPANY_ID, companyDbName, readRegistry, writeRegistry } from '../src/lib/company-registry.ts';
import { createCompany, deleteCompany, eraseOtherCompanies, renameCompany } from '../src/lib/companies.ts';
import { buildBackup } from '../src/lib/backup.ts';

const K = (t: string) => DB_PREFIX + t;

beforeEach(() => {
  resetStorageBackend();
  resetIdbConnection();
  fakeIdb.reset();
  installFakeIdb();
  resetStorage();
});

/** Reload into whichever company the registry marks active. */
async function reboot() {
  await flushStorage();
  resetStorageBackend();
  resetIdbConnection();
  return initStorage({ timeoutMs: 500 });
}
const open = (id: string) => writeRegistry({ ...readRegistry(), active: id });

test('a device without a registry is the main company in the original database', async () => {
  assert.deepEqual(readRegistry(), { active: DEFAULT_COMPANY_ID, list: [{ id: DEFAULT_COMPANY_ID, name: 'Main business', created: '' }] });
  assert.equal(companyDbName(DEFAULT_COMPANY_ID), 'mrchartist_inv_kv');
  await initStorage({ timeoutMs: 500 });
  setTable('clients', [{ id: 'c1' }]);
  await flushStorage();
  assert.ok(fakeIdb.store('mrchartist_inv_kv', DATA_STORE).has(K('clients')));
});

test('companies keep separate data under the same keys', async () => {
  await initStorage({ timeoutMs: 500 });
  setTable('clients', [{ id: 'main-client' }]);
  const b = createCompany('Second Shop LLP', new Date(2026, 9, 1));
  assert.match(companyDbName(b.id), /^mrchartist_inv_kv__[a-z0-9-]+$/);

  open(b.id);
  assert.equal((await reboot()).backend, 'idb');
  assert.deepEqual(getTable('clients'), [], 'the new company starts empty');
  setTable('clients', [{ id: 'b-client' }]);

  open(DEFAULT_COMPANY_ID);
  await reboot();
  assert.deepEqual(getTable<{ id: string }>('clients').map((c) => c.id), ['main-client']);
  open(b.id);
  await reboot();
  assert.deepEqual(getTable<{ id: string }>('clients').map((c) => c.id), ['b-client']);
  assert.ok(!buildBackup().data[COMPANY_REGISTRY_KEY], 'the registry is device-local, never in a backup');
});

test('localStorage copies are never imported into an extra company', async () => {
  const b = createCompanyAfterBoot('Other Co');
  localStorage.setItem(K('clients'), JSON.stringify([{ id: 'stale-main' }]));
  open(await b);
  await reboot();
  assert.deepEqual(getTable('clients'), []);
  assert.equal(localStorage.getItem(K('clients')), JSON.stringify([{ id: 'stale-main' }]), 'left for the main company');
});

async function createCompanyAfterBoot(name: string): Promise<string> {
  await initStorage({ timeoutMs: 500 });
  return createCompany(name).id;
}

test('names are unique and validated; rename', async () => {
  await initStorage({ timeoutMs: 500 });
  const a = createCompany('Alpha Traders');
  assert.throws(() => createCompany('  alpha   traders '), /already exists/);
  assert.throws(() => createCompany('   '), /name/);
  renameCompany(a.id, 'Alpha Traders Pvt Ltd');
  assert.equal(readRegistry().list.find((c) => c.id === a.id)?.name, 'Alpha Traders Pvt Ltd');
});

test('delete: not the main or the open company; removes the database', async () => {
  await initStorage({ timeoutMs: 500 });
  const b = createCompany('Temp Co');
  open(b.id);
  await reboot();
  setTable('clients', [{ id: 'x' }]);
  await flushStorage();
  await assert.rejects(deleteCompany(b.id), /Switch to another company/);
  await assert.rejects(deleteCompany(DEFAULT_COMPANY_ID), /main company/);
  open(DEFAULT_COMPANY_ID);
  await reboot();
  assert.equal(await deleteCompany(b.id), true);
  assert.equal(fakeIdb.dbs.has(companyDbName(b.id)), false);
  assert.ok(!readRegistry().list.some((c) => c.id === b.id));
});

test('forgot-PIN reset erases the other companies too', async () => {
  await initStorage({ timeoutMs: 500 });
  const b = createCompany('B Co');
  open(b.id);
  await reboot();
  setTable('clients', [{ id: 'b' }]);
  open(DEFAULT_COMPANY_ID);
  await reboot();
  const reg = readRegistry();
  localStorage.removeItem(COMPANY_REGISTRY_KEY); // what resetAllData does
  await eraseOtherCompanies(reg);
  assert.equal(fakeIdb.dbs.has(companyDbName(b.id)), false);
  assert.equal(fakeIdb.dbs.has('mrchartist_inv_kv'), true, 'the open company is wiped by the reset itself');
});
