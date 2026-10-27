/**
 * R15-A2 (PERF-3): the audit appends of one synchronous task are written to storage ONCE, with the same rows, order
 * and hash chain as one-by-one appends; reads of the log key flush first; a raw overwrite of the key drops the batch.
 */
import './helpers/shim.ts';
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { AUDIT_TABLE, audit } from '../src/lib/audit.ts';
import { verifyAuditChain } from '../src/lib/audit-chain.ts';
import { DB_PREFIX, getTable, readRaw, writeRaw } from '../src/lib/storage.ts';
import { localDb } from '../src/lib/localDb.ts';
import { createViaStore, installSettings } from './helpers/world.ts';
import type { AuditEntry } from '../src/types/audit.ts';

beforeEach(() => {
  audit.flush();
  resetStorage();
});

const KEY = DB_PREFIX + AUDIT_TABLE;
/** Count raw writes of the audit key while `fn` runs (and its microtask flush). */
async function countWrites(fn: () => void): Promise<number> {
  const ls = globalThis.localStorage;
  const real = ls.setItem.bind(ls);
  let n = 0;
  ls.setItem = (k: string, v: string) => {
    if (k === KEY) n++;
    real(k, v);
  };
  try {
    fn();
    await Promise.resolve(); // the batch's microtask
    await new Promise((r) => setTimeout(r, 0));
  } finally {
    ls.setItem = real;
  }
  return n;
}
const rec = (summary: string) => audit.record({ entity: 'invoice', entity_id: 'i1', action: 'update', summary });
const rawRows = (): AuditEntry[] => JSON.parse(globalThis.localStorage.getItem(KEY) ?? '[]');

test('13 events in one task → one write of the audit table, in a microtask', async () => {
  const writes = await countWrites(() => {
    for (let i = 0; i < 13; i++) assert.ok(rec(`event ${i}`));
    assert.equal(globalThis.localStorage.getItem(KEY), null, 'nothing written synchronously');
  });
  assert.equal(writes, 1);
  assert.equal(rawRows().length, 13);
});

test('a real save (status, payments) writes the log once, and the chain verifies', async () => {
  installSettings();
  const inv = createViaStore({ date: '2026-05-04', lines: [{ qty: 2, rate: 1000 }], asDraft: true });
  await new Promise((r) => setTimeout(r, 0)); // the editor's deferred catalogue save
  audit.flush();
  const before = audit.count();
  const writes = await countWrites(() => {
    localDb.invoices.setStatus(inv.id, 'Sent');
    localDb.payments.record({ invoiceId: inv.id, amount: 500, method: 'UPI', date: '2026-05-05' });
    localDb.payments.record({ invoiceId: inv.id, amount: 300, method: 'Cash', date: '2026-05-06' });
  });
  const events = audit.count() - before;
  assert.ok(events >= 3, `several events recorded (${events})`);
  assert.equal(writes, 1);
  const r = verifyAuditChain(getTable<AuditEntry>(AUDIT_TABLE));
  assert.equal(r.ok, true, r.broken?.message);
});

test('order and chain are the same as one-by-one appends', async () => {
  rec('a');
  audit.flush();
  rec('b');
  rec('c');
  await Promise.resolve();
  rec('d');
  const rows = audit.rows();
  assert.deepEqual(rows.map((r) => r.summary), ['a', 'b', 'c', 'd']);
  for (let i = 1; i < rows.length; i++) assert.equal(rows[i].prev, rows[i - 1].hash);
  assert.equal(verifyAuditChain(rows).ok, true);
});

test('a crash between record and flush loses nothing already flushed', () => {
  rec('flushed 1');
  rec('flushed 2');
  audit.flush();
  rec('pending'); // the tab dies here: only the stored rows survive
  const survived = rawRows();
  assert.deepEqual(survived.map((r) => r.summary), ['flushed 1', 'flushed 2']);
  assert.equal(verifyAuditChain(survived).ok, true);
  audit.flush();
  assert.equal(rawRows().length, 3);
});

test('reading the key flushes; a raw overwrite of the key (restore, demo removal) drops the batch', () => {
  rec('kept');
  assert.match(readRaw(KEY) ?? '', /kept/, 'readRaw sees the batch');
  const before = readRaw(KEY)!;
  rec('overwritten');
  writeRaw(KEY, before);
  audit.flush();
  assert.deepEqual(rawRows().map((r) => r.summary), ['kept']);
});

