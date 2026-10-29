/**
 * PERF-3: row-level (chunked) storage of the `invoices` table in IndexedDB. The logical value read through
 * `readRaw` / `getTable` / backup / peek stays byte for byte the JSON of the whole table; only the physical
 * records change (`rows:<key>` head + `rows:<key>:<i>` chunks of 16 rows, from 128 rows on).
 */
import './helpers/shim.ts';
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadStorage, resetStorage } from './helpers/shim.ts';
import { fakeIdb, installFakeIdb } from './helpers/fake-idb.ts';
import {
  DB_PREFIX,
  SYNC_CHANNEL,
  appDataSize,
  collectAppData,
  disableVault,
  enableVault,
  flushStorage,
  getTable,
  initStorage,
  peekTable,
  readRaw,
  resetStorageBackend,
  setTable,
  storageFailure,
  subscribeStorageChanges,
  unlockStorage,
  writeRaw,
} from '../src/lib/storage.ts';
import { DATA_STORE, resetIdbConnection } from '../src/lib/idb-kv.ts';
import { VAULT_KEY, isSealed } from '../src/lib/vault.ts';
import { buildBackup, parseBackup, restoreBackup, wipeAppData } from '../src/lib/backup.ts';
import { peekCompany, peekCompliance } from '../src/lib/company-peek.ts';
import { localDb } from '../src/lib/localDb.ts';

const DB = 'mrchartist_inv_kv';
const INV = DB_PREFIX + 'invoices';
const HEAD = `rows:${INV}`;
const idbData = () => fakeIdb.store(DB, DATA_STORE);
const chunkKeys = () => [...idbData().keys()].filter((k) => k.startsWith(`${HEAD}:`));
const PASS = 'correct horse battery';

type Inv = { id: string; invoice_number: string; doc_type: string; status: string; total: number; amount_paid: number; balance_due: number; notes?: string; sender?: { logo?: string } };
const LOGO = 'data:image/png;base64,QUJD';
/** `n` invoices; with `logo` their sender snapshot carries an image (stored by asset reference). */
const make = (n: number, from = 0, logo = true): Inv[] =>
  Array.from({ length: n }, (_, k) => {
    const i = from + k;
    return { id: `inv${i}`, invoice_number: `INV/FY26-27/${String(i + 1).padStart(5, '0')}`, doc_type: 'INVOICE', status: 'Sent', total: 1000 + i, amount_paid: 0, balance_due: 1000 + i, notes: `note ${i} – ₹`, sender: logo ? { logo: LOGO } : {} };
  });

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
  return initStorage({ timeoutMs: 2000 });
}

/** Physical records that differ between two snapshots of the data store. */
function changedRecords(before: Map<string, unknown>): string[] {
  const now = idbData();
  const keys = new Set([...before.keys(), ...now.keys()]);
  return [...keys].filter((k) => before.get(k) !== now.get(k));
}

test('without IndexedDB (localStorage fallback) a big table stays one plain value', async () => {
  resetIdbConnection();
  const { uninstallFakeIdb } = await import('./helpers/fake-idb.ts');
  uninstallFakeIdb();
  assert.equal((await initStorage()).backend, 'local');
  setTable('invoices', make(200, 0, false));
  assert.equal(localStorage.getItem(INV), JSON.stringify(make(200, 0, false)));
  const all = getTable<Inv>('invoices');
  all[1] = { ...all[1], notes: 'x' };
  setTable('invoices', all);
  assert.equal(JSON.parse(localStorage.getItem(INV)!)[1].notes, 'x');
  installFakeIdb();
});

test('old layout -> chunks on the first save: atomic, byte-identical logical value, plain key removed', async () => {
  const rows = make(300, 0, false);
  loadStorage({ [INV]: JSON.stringify(rows) });
  await initStorage();
  assert.equal(typeof idbData().get(INV), 'string', 'moved in the old layout first');
  const legacyText = readRaw(INV);
  const all = getTable<Inv>('invoices');
  setTable('invoices', all); // unchanged rows: same logical value
  assert.equal(readRaw(INV), legacyText, 'logical text unchanged');
  await flushStorage();
  assert.equal(idbData().has(INV), false, 'the plain copy went in the same transaction');
  assert.equal(chunkKeys().length, Math.ceil(300 / 16));
  const head = JSON.parse(idbData().get(HEAD) as string);
  assert.equal(head.v, 1);
  assert.equal(head.n, 19);
  // The chunks rebuild the JSON of the whole table, byte for byte.
  const text = `[${Array.from({ length: head.n }, (_, i) => idbData().get(`${HEAD}:${i}`)).join(',')}]`;
  assert.equal(text, legacyText);
  await reboot();
  assert.equal(readRaw(INV), legacyText);
  assert.deepEqual(getTable('invoices'), rows);
});

test('an interrupted conversion changes nothing; the retry and a re-run are idempotent', async () => {
  const rows = make(200);
  loadStorage({ [INV]: JSON.stringify(rows) });
  await initStorage();
  const plain = idbData().get(INV);
  const next = getTable<Inv>('invoices');
  next[5] = { ...next[5], notes: 'edited' };
  setTable('invoices', next);
  fakeIdb.failNextWrite('UnknownError');
  await flushStorage();
  assert.ok(storageFailure(), 'the failure is reported');
  assert.equal(idbData().get(INV), plain, 'old layout untouched');
  assert.equal(idbData().has(HEAD), false);
  assert.equal(chunkKeys().length, 0, 'no half-written chunks');
  await flushStorage(); // the retry
  assert.equal(storageFailure(), null);
  assert.equal(idbData().has(INV), false);
  assert.equal(chunkKeys().length, 13);
  const expected = readRaw(INV);
  for (let i = 0; i < 2; i++) {
    await reboot();
    assert.equal(readRaw(INV), expected, `re-run ${i}`);
    setTable('invoices', getTable('invoices'));
    await flushStorage();
    assert.equal(chunkKeys().length, 13);
  }
  assert.equal(getTable<Inv>('invoices')[5].notes, 'edited');
});

test('a single save or payment rewrites one chunk, whatever the table size', async () => {
  await initStorage();
  const sizes: Record<number, { ms: number; recs: number }> = {};
  for (const n of [2000, 16000]) {
    resetStorageBackend();
    resetIdbConnection();
    fakeIdb.reset();
    installFakeIdb();
    resetStorage();
    await initStorage();
    setTable('invoices', make(n));
    await flushStorage();
    getTable('invoices');
    let best = Infinity;
    let recs = 0;
    for (let k = 0; k < 5; k++) {
      const before = new Map(idbData());
      const t0 = performance.now();
      const all = peekTable<Inv>('invoices').slice();
      const at = 37 + k * 101;
      all[at] = { ...all[at], notes: `changed ${k}` };
      setTable('invoices', all);
      await flushStorage();
      best = Math.min(best, performance.now() - t0);
      recs = Math.max(recs, changedRecords(before).length);
    }
    // One payment: the receipt row plus one invoice chunk.
    const before = new Map(idbData());
    localDb.payments.record({ invoiceId: 'inv1500', amount: 10, method: 'Cash' });
    await flushStorage();
    const changed = changedRecords(before).filter((k) => k.startsWith(`${HEAD}`) || k === INV);
    assert.deepEqual(changed, [`${HEAD}:${Math.floor(1500 / 16)}`], `payment at ${n}: one chunk`);
    assert.equal(peekTable<Inv>('invoices')[1500].amount_paid, 10);
    sizes[n] = { ms: best, recs };
    console.log(`# perf chunked save at ${n} invoices: ${best.toFixed(1)} ms, ${recs} record(s)`);
  }
  assert.equal(sizes[2000].recs, 1, 'an in-place edit writes one chunk');
  assert.equal(sizes[16000].recs, 1);
  // 8x the rows must not cost 8x: generous bound for a loaded machine.
  assert.ok(sizes[16000].ms < sizes[2000].ms * 4 + 40, `16k: ${sizes[16000].ms.toFixed(1)} ms vs 2k: ${sizes[2000].ms.toFixed(1)} ms`);
});

test('appending, deleting and re-ordering keep the chunks aligned (head moves only then)', async () => {
  await initStorage();
  setTable('invoices', make(200));
  await flushStorage();
  const head0 = idbData().get(HEAD);
  // Edit in place: head unchanged.
  const a = getTable<Inv>('invoices');
  a[3].notes = 'x';
  setTable('invoices', a);
  await flushStorage();
  assert.equal(idbData().get(HEAD), head0);
  // Append: head changes, last chunk grows.
  setTable('invoices', [...getTable<Inv>('invoices'), ...make(10, 200)]);
  await flushStorage();
  assert.notEqual(idbData().get(HEAD), head0);
  // Delete one in the middle, sort, and shrink chunks.
  setTable('invoices', getTable<Inv>('invoices').filter((r) => r.id !== 'inv50'));
  setTable('invoices', getTable<Inv>('invoices').reverse());
  setTable('invoices', getTable<Inv>('invoices').slice(0, 150));
  await flushStorage();
  const expected = readRaw(INV);
  assert.equal(chunkKeys().length, Math.ceil(150 / 16), 'no stale chunks left');
  await reboot();
  assert.equal(readRaw(INV), expected);
  assert.equal(getTable<Inv>('invoices').length, 150);
  assert.equal(getTable<Inv>('invoices')[0].id, 'inv209');
  // Below 128 rows the table goes back to the plain layout, chunks removed.
  setTable('invoices', getTable<Inv>('invoices').slice(0, 20));
  await flushStorage();
  assert.equal(typeof idbData().get(INV), 'string');
  assert.equal(idbData().has(HEAD), false);
  assert.equal(chunkKeys().length, 0);
});

test('writeRaw (restore / sync merge) stores the plain layout, which wins over any chunks', async () => {
  await initStorage();
  setTable('invoices', make(140));
  await flushStorage();
  writeRaw(INV, JSON.stringify(make(130, 1000)));
  await flushStorage();
  assert.equal(idbData().has(HEAD), false);
  assert.equal(chunkKeys().length, 0);
  // A plain value next to chunks (an older build's write) is the truth.
  setTable('invoices', make(140));
  await flushStorage();
  idbData().set(INV, JSON.stringify(make(2, 77)));
  await reboot();
  assert.deepEqual(getTable<Inv>('invoices').map((r) => r.id), ['inv77', 'inv78']);
  setTable('invoices', make(140));
  await flushStorage();
  assert.equal(chunkKeys().length, 9);
  assert.equal(idbData().has(INV), false);
});

test('a damaged chunk set keeps every row that is there; a misaligned one is rewritten whole', async () => {
  await initStorage();
  setTable('invoices', make(160));
  await flushStorage();
  idbData().delete(`${HEAD}:3`);
  await reboot();
  const ids = getTable<Inv>('invoices').map((r) => r.id);
  assert.equal(ids.length, 144, 'the other chunks are kept');
  assert.ok(!ids.includes('inv50'));
  setTable('invoices', getTable('invoices'));
  await flushStorage();
  assert.equal(chunkKeys().length, 9);
  // A chunk holding 17 rows: read as the plain text, then rewritten aligned.
  idbData().set(`${HEAD}:0`, `${idbData().get(`${HEAD}:0`)},${JSON.stringify(make(1, 999)[0])}`);
  await reboot();
  assert.equal(getTable('invoices').length, 145);
  const all = getTable<Inv>('invoices');
  all[0].notes = 'after repair';
  setTable('invoices', all);
  await flushStorage();
  await reboot();
  assert.equal(getTable<Inv>('invoices')[0].notes, 'after repair');
  assert.equal(getTable('invoices').length, 145);
});

test('backups round-trip in both directions between the layouts', async () => {
  // Backup taken from the old layout, restored and saved in the new one.
  loadStorage({ [INV]: JSON.stringify(make(150, 0, false)) });
  await initStorage();
  const oldFile = JSON.stringify(buildBackup());
  wipeAppData();
  await flushStorage();
  assert.equal([...idbData().keys()].some((k) => k.startsWith('rows:') || k === INV), false);
  restoreBackup(parseBackup(oldFile).data);
  await reboot();
  setTable('invoices', getTable('invoices'));
  await flushStorage();
  assert.ok(idbData().has(HEAD));
  // Backup taken from chunks: the same file content as from the plain layout.
  const newFile = JSON.stringify(buildBackup());
  const pick = (f: string) => parseBackup(f).data[INV];
  assert.equal(pick(newFile), pick(oldFile), 'the invoices value in a backup is identical');
  // Restored into a store with no chunks (an older build reads only the plain key).
  wipeAppData();
  await flushStorage();
  restoreBackup(parseBackup(newFile).data);
  await flushStorage();
  assert.equal(idbData().get(INV), pick(oldFile));
  await reboot();
  assert.deepEqual(getTable('invoices'), make(150, 0, false));
  assert.ok(appDataSize() >= collectAppData()[INV].length);
});

test('vault mode seals every chunk and the head; unlock and saves keep working', async () => {
  await initStorage();
  setTable('invoices', make(150));
  setTable('clients', [{ id: 'c1', name: 'Acme' }]);
  await flushStorage();
  const text = readRaw(INV);
  await enableVault(PASS);
  for (const [k, v] of idbData()) if (k !== VAULT_KEY && k !== '__meta__') assert.ok(typeof v === 'string' && isSealed(v), `${k} sealed`);
  assert.ok(![...idbData().values()].some((v) => typeof v === 'string' && v.includes('inv42')), 'no plaintext');
  assert.equal((await reboot()).backend, 'locked');
  assert.deepEqual((await unlockStorage(PASS)).unreadable, []);
  assert.equal(readRaw(INV), text);
  const before = new Map(idbData());
  const all = getTable<Inv>('invoices');
  all[20] = { ...all[20], notes: 'sealed edit' };
  setTable('invoices', all);
  await flushStorage();
  assert.ok(changedRecords(before).length <= 2, 'still one chunk (plus the head after a vault switch)');
  for (const k of chunkKeys()) assert.ok(isSealed(idbData().get(k) as string));
  await reboot();
  await unlockStorage(PASS);
  assert.equal(getTable<Inv>('invoices')[20].notes, 'sealed edit');
  // A chunk that does not decrypt makes the table unreadable (reported, left in place), never half read.
  idbData().set(`${HEAD}:2`, idbData().get(`${HEAD}:3`));
  await reboot();
  assert.deepEqual((await unlockStorage(PASS)).unreadable, [INV]);
  assert.deepEqual(getTable('invoices'), []);
});

test('turning vault mode off writes readable chunks back', async () => {
  await initStorage();
  setTable('invoices', make(150));
  await flushStorage();
  const text = readRaw(INV);
  await enableVault(PASS);
  await disableVault(PASS);
  assert.ok(!idbData().has(VAULT_KEY));
  for (const k of chunkKeys()) assert.ok(!isSealed(idbData().get(k) as string));
  await reboot();
  assert.equal(readRaw(INV), text);
});

test('another tab: its chunk writes are adopted; a rewrite under this tab forces a whole write', async () => {
  await initStorage();
  setTable('invoices', make(150));
  await flushStorage();
  const changes: string[] = [];
  const off = subscribeStorageChanges((k) => changes.push(k));
  // Tab B edits row 0 in place (chunk 0) and tells us.
  const c0 = JSON.parse(`[${idbData().get(`${HEAD}:0`)}]`) as Inv[];
  c0[0].notes = 'from tab B';
  idbData().set(`${HEAD}:0`, JSON.stringify(c0).slice(1, -1));
  const ch = new BroadcastChannel(SYNC_CHANNEL);
  ch.postMessage({ keys: [INV] });
  for (let i = 0; i < 50 && !changes.length; i++) await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(changes, [INV]);
  assert.equal(getTable<Inv>('invoices')[0].notes, 'from tab B');
  // Tab B then rewrites the whole table (new head); this tab, not told yet, saves an edit.
  idbData().set(HEAD, JSON.stringify({ v: 1, n: 10, g: 'other-tab' }));
  const all = getTable<Inv>('invoices');
  all[100] = { ...all[100], notes: 'from tab A' };
  setTable('invoices', all);
  await flushStorage();
  await flushStorage(); // the retry after the conflict
  assert.notEqual(JSON.parse(idbData().get(HEAD) as string).g, 'other-tab', 'written whole: last writer wins');
  const expected = readRaw(INV);
  await reboot();
  assert.equal(readRaw(INV), expected);
  assert.equal(getTable<Inv>('invoices')[100].notes, 'from tab A');
  off();
  ch.close();
});

test('erase removes every chunk record', async () => {
  await initStorage();
  setTable('invoices', make(150));
  await flushStorage();
  wipeAppData();
  await flushStorage();
  assert.equal([...idbData().keys()].filter((k) => k.startsWith('rows:') || k === INV).length, 0);
  await reboot();
  assert.deepEqual(getTable('invoices'), []);
});

/** Another company's database, built by hand. */
function otherDb(name: string, data: Record<string, unknown>, version = 4) {
  fakeIdb.dbs.set(name, { version, stores: new Map([['data', new Map(Object.entries(data))], ['kv', new Map()]]) });
}

test('peekCompliance / peekCompany read the old and the new layout, and skip what they cannot read', async () => {
  const rows = make(40);
  const chunks = [rows.slice(0, 16), rows.slice(16, 32), rows.slice(32)].map((c) => JSON.stringify(c).slice(1, -1));
  otherDb('old', { [INV]: JSON.stringify(rows) }, 3); // a company not opened since this build: v3, plain layout
  otherDb('new', { [HEAD]: JSON.stringify({ v: 1, n: 3, g: 'x' }), ...Object.fromEntries(chunks.map((c, i) => [`${HEAD}:${i}`, c])) });
  otherDb('newer', { [HEAD]: JSON.stringify({ v: 2, n: 3, g: 'x' }), ...Object.fromEntries(chunks.map((c, i) => [`${HEAD}:${i}`, c])) });
  otherDb('broken', { [HEAD]: JSON.stringify({ v: 1, n: 4, g: 'x' }), ...Object.fromEntries(chunks.map((c, i) => [`${HEAD}:${i}`, c])) });
  otherDb('sealed', { [HEAD]: 'mcv1:abc:def', [`${HEAD}:0`]: 'mcv1:a:b' });
  for (const name of ['old', 'new']) {
    const p = await peekCompliance(name);
    assert.equal(p?.locked, false, name);
    assert.deepEqual(p?.tables.invoices, rows, name);
    assert.equal((await peekCompany(name))?.invoices.length, 40, name);
  }
  for (const name of ['newer', 'broken']) {
    const p = await peekCompliance(name);
    assert.equal(p?.locked, false);
    assert.equal(p?.tables.invoices, undefined, `${name}: left out, never misread`);
  }
  assert.equal((await peekCompliance('sealed'))?.locked, true);
  assert.equal(fakeIdb.dbs.get('old')!.version, 3, 'never upgraded');
  assert.deepEqual([...fakeIdb.dbs.get('new')!.stores.get('data')!.keys()].sort(), [HEAD, `${HEAD}:0`, `${HEAD}:1`, `${HEAD}:2`], 'nothing written');
});
