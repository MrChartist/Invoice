import './helpers/shim.ts';
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { resetStorage } from './helpers/shim.ts';
import { sha256 } from '../src/lib/sha256.ts';
import { AUDIT_GENESIS, AUDIT_TABLE, audit, canonical, rowHash } from '../src/lib/audit.ts';
import { describeChain, verifyAuditChain } from '../src/lib/audit-chain.ts';
import { MIGRATIONS, SCHEMA_VERSION_KEY, runMigrations } from '../src/lib/migrations.ts';
import { applyBackup, restoreBackup } from '../src/lib/backup.ts';
import { DB_PREFIX, getTable, setTable } from '../src/lib/storage.ts';
import type { AuditEntry } from '../src/types/audit.ts';

beforeEach(() => resetStorage());

const rec = (summary: string, extra: Partial<AuditEntry> = {}) =>
  audit.record({ entity: 'invoice', entity_id: 'i1', action: 'update', summary, ...extra });
const stored = () => getTable<AuditEntry>(AUDIT_TABLE);
const legacyRow = (n: number): AuditEntry => ({
  id: `old${n}`, at: `2025-01-0${(n % 9) + 1}T10:00:00.000Z`, entity: 'client', entity_id: 'c', action: 'create', summary: `legacy ${n}`,
});
const verify = (rows = stored(), notedHead?: string) => verifyAuditChain(rows, { notedHead });

/* ── SHA-256 ─────────────────────────────────────────────────── */

test('sha256 matches the NIST / FIPS 180-4 vectors', () => {
  assert.equal(sha256(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(
    sha256('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
  );
  assert.equal(sha256('a'.repeat(1_000_000)), 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
});

test('sha256 agrees with node:crypto on UTF-8 text and every padding boundary', () => {
  const samples = ['₹1,180.00 → ₹1,280.00', 'हिंदी चालान', '😀', ...[55, 56, 63, 64, 65, 119, 120].map((n) => 'x'.repeat(n))];
  for (const s of samples) assert.equal(sha256(s), createHash('sha256').update(s, 'utf8').digest('hex'), JSON.stringify(s));
});

test('canonical form: key order does not matter, undefined members are dropped, hash is excluded', () => {
  assert.equal(canonical({ b: 1, a: [1, { d: null, c: 'x' }], u: undefined }), '{"a":[1,{"c":"x","d":null}],"b":1}');
  const row = { id: 'r', at: 't', entity: 'system', entity_id: 'x', action: 'update', summary: 's', prev: AUDIT_GENESIS } as AuditEntry;
  assert.equal(rowHash(row), rowHash({ ...row, hash: 'anything' }));
  assert.notEqual(rowHash(row), rowHash({ ...row, summary: 's ' }));
});

/* ── Build & verify ──────────────────────────────────────────── */

test('every new row links to the previous one; a clean chain verifies', () => {
  rec('one');
  rec('two', { changes: [{ field: 'Total', from: '₹1', to: '₹2' }] });
  rec('three');
  const rows = stored();
  assert.equal(rows[0].prev, AUDIT_GENESIS);
  assert.equal(rows[1].prev, rows[0].hash);
  assert.equal(rows[2].prev, rows[1].hash);
  rows.forEach((r) => assert.equal(r.hash, rowHash(r)));
  const r = verify();
  assert.equal(r.ok, true);
  assert.equal(r.chained, 3);
  assert.equal(r.head, rows[2].hash);
  assert.equal(audit.head(), rows[2].hash);
  assert.match(describeChain(r), /All 3 sealed entries check out/);
  assert.equal(verify([]).ok, true);
});

test('tamper: an edited row is reported as edited at its index', () => {
  for (const s of ['a', 'b', 'c', 'd']) rec(s);
  const rows = stored();
  rows[1] = { ...rows[1], summary: 'Edited INV/0001: Total ₹1 → ₹999' };
  const r = verify(rows);
  assert.equal(r.ok, false);
  assert.deepEqual([r.broken?.index, r.broken?.reason], [1, 'edited']);
});

test('tamper: an edit with a recomputed hash is caught by the next link', () => {
  for (const s of ['a', 'b', 'c']) rec(s);
  const rows = stored();
  const forged = { ...rows[1], summary: 'forged' };
  forged.hash = rowHash(forged);
  rows[1] = forged;
  const r = verify(rows);
  assert.deepEqual([r.broken?.index, r.broken?.reason], [2, 'deleted']);
});

test('tamper: a deleted row in the middle', () => {
  for (const s of ['a', 'b', 'c', 'd']) rec(s);
  const rows = stored();
  rows.splice(2, 1);
  const r = verify(rows);
  assert.deepEqual([r.broken?.index, r.broken?.reason], [2, 'deleted']);
});

test('tamper: swapped rows are reported as reordered', () => {
  for (const s of ['a', 'b', 'c', 'd']) rec(s);
  const rows = stored();
  [rows[1], rows[2]] = [rows[2], rows[1]];
  const r = verify(rows);
  assert.deepEqual([r.broken?.index, r.broken?.reason], [1, 'reordered']);
});

test('tamper: oldest rows removed without an anchor are reported as truncated', () => {
  for (const s of ['a', 'b', 'c', 'd']) rec(s);
  const r = verify(stored().slice(2));
  assert.deepEqual([r.broken?.index, r.broken?.reason], [0, 'truncated']);
});

test('tamper: newest rows removed are caught against a noted head', () => {
  for (const s of ['a', 'b', 'c']) rec(s);
  const noted = audit.head()!;
  rec('d');
  assert.deepEqual(verify(stored(), noted).noted, { status: 'present', index: 2, newer: 1 });
  assert.equal(verify(stored(), noted.toUpperCase()).ok, true, 'case and spaces in the noted hash are tolerated');
  const cut = stored().slice(0, 2);
  assert.equal(verify(cut).ok, true, 'without an outside anchor, cutting the newest rows cannot be seen');
  const r = verify(cut, noted);
  assert.equal(r.ok, false);
  assert.equal(r.broken?.reason, 'truncated');
  assert.deepEqual(r.noted, { status: 'missing' });
});

test('tamper: a row added without a seal, and a seal stripped from a row', () => {
  rec('a');
  rec('b');
  const added = [...stored(), legacyRow(1)];
  assert.equal(verify(added).broken?.reason, 'edited');
  const stripped = stored();
  delete stripped[0].hash;
  const r = verify(stripped);
  assert.deepEqual([r.broken?.index, r.broken?.reason], [0, 'edited']);
});

/* ── Legacy rows & migration ─────────────────────────────────── */

test('legacy rows: the next record seals them with a chain_start anchor; edits to them are detected', () => {
  setTable(AUDIT_TABLE, [legacyRow(1), legacyRow(2), legacyRow(3)]);
  assert.equal(verify().ok, true, 'an all-legacy log is not "tampered"');
  assert.match(describeChain(verify()), /before the integrity chain/);
  rec('first chained');
  const rows = stored();
  assert.deepEqual(rows.map((r) => r.action), ['create', 'create', 'create', 'chain_start', 'update']);
  assert.equal(rows[3].prev, AUDIT_GENESIS);
  assert.equal(rows[3].seal?.legacy?.count, 3);
  const r = verify();
  assert.equal(r.ok, true);
  assert.equal(r.legacy, 3);
  assert.equal(r.chained, 2);

  const edited = stored();
  edited[1] = { ...edited[1], summary: 'changed' };
  assert.equal(verify(edited).broken?.reason, 'edited');
  const deleted = stored();
  deleted.splice(0, 1);
  assert.deepEqual([verify(deleted).broken?.index, verify(deleted).broken?.reason], [0, 'deleted']);
});

test('rows written by an older app version after the chain started are sealed by a second chain_start', () => {
  rec('a');
  setTable(AUDIT_TABLE, [...stored(), legacyRow(1), legacyRow(2)]);
  rec('b');
  const rows = stored();
  assert.deepEqual(rows.map((r) => r.action), ['update', 'create', 'create', 'chain_start', 'update']);
  assert.equal(rows[3].prev, rows[0].hash);
  assert.equal(verify().ok, true);
});

test('migration 2 seals legacy rows once and is idempotent', () => {
  const m2 = MIGRATIONS.find((m) => m.version === 2)!;
  setTable(AUDIT_TABLE, [legacyRow(1), legacyRow(2)]);
  localStorage.setItem(SCHEMA_VERSION_KEY, '1');
  assert.equal(runMigrations().status, 'migrated');
  const once = localStorage.getItem(DB_PREFIX + AUDIT_TABLE);
  assert.equal(stored().length, 3);
  assert.equal(stored()[2].action, 'chain_start');
  m2.up();
  m2.up();
  assert.equal(localStorage.getItem(DB_PREFIX + AUDIT_TABLE), once, 'running it again changes nothing');
  assert.equal(verify().ok, true);
  resetStorage();
  m2.up();
  assert.equal(localStorage.getItem(DB_PREFIX + AUDIT_TABLE), null, 'no log: nothing written');
});

/* ── Truncation anchors ──────────────────────────────────────── */

test('storage full: the oldest half goes, a truncate anchor records it, and verification says so', () => {
  for (let n = 0; n < 20; n++) rec(`row ${n}`);
  audit.flush(); // R15-A2: appends are written once per task
  const ls = globalThis.localStorage;
  const realSet = ls.setItem.bind(ls);
  let refused = false;
  ls.setItem = (k: string, v: string) => {
    // Refuse the first full-size write only, like a quota that frees up after shedding rows.
    if (k.endsWith(AUDIT_TABLE) && !refused) {
      refused = true;
      throw new DOMException('full', 'QuotaExceededError');
    }
    realSet(k, v);
  };
  try {
    assert.ok(rec('the one that did not fit'));
    audit.flush();
  } finally {
    ls.setItem = realSet;
  }
  const rows = stored();
  assert.equal(rows.length, 10 + 1, '21 rows → the newest 10 kept, plus the anchor');
  const anchor = rows[rows.length - 1];
  assert.equal(anchor.action, 'truncate');
  assert.equal(anchor.seal?.reason, 'storage');
  assert.equal(anchor.seal?.dropped, 11);
  assert.match(anchor.summary, /storage full/);
  assert.equal(rows[rows.length - 2].summary, 'the one that did not fit');
  const r = verify();
  assert.equal(r.ok, true, r.broken?.message);
  assert.equal(r.trimmed?.reason, 'storage');
  assert.match(describeChain(r), /older entries were removed \(storage full\)/);

  // Removing more of the oldest rows than the anchor records is still caught.
  assert.equal(verify(rows.slice(1)).broken?.reason, 'truncated');
});

test('truncation that cuts into the legacy segment re-seals the legacy rows that remain', () => {
  setTable(AUDIT_TABLE, Array.from({ length: 6 }, (_, n) => legacyRow(n)));
  rec('chained');
  audit.flush();
  const ls = globalThis.localStorage;
  const realSet = ls.setItem.bind(ls);
  let refused = false;
  ls.setItem = (k: string, v: string) => {
    if (k.endsWith(AUDIT_TABLE) && !refused) {
      refused = true;
      throw new DOMException('full', 'QuotaExceededError');
    }
    realSet(k, v);
  };
  try {
    rec('next');
    audit.flush();
  } finally {
    ls.setItem = realSet;
  }
  const rows = stored();
  const anchor = rows[rows.length - 1];
  assert.equal(anchor.action, 'truncate');
  assert.ok(anchor.seal?.legacy && anchor.seal.legacy.count > 0);
  assert.equal(verify().ok, true, verify().broken?.message);
  const edited = stored();
  edited[0] = { ...edited[0], summary: 'changed' };
  assert.equal(verify(edited).broken?.reason, 'edited');
});

/* ── Restore ─────────────────────────────────────────────────── */

test('restore: the backup log comes back verifiable and a marker links it, recording both heads', () => {
  rec('backup a');
  rec('backup b');
  audit.flush();
  const backupLog = localStorage.getItem(DB_PREFIX + AUDIT_TABLE)!;
  const backupHead = audit.head();
  resetStorage();
  rec('device x');
  const deviceHead = audit.head();

  restoreBackup({ [DB_PREFIX + AUDIT_TABLE]: backupLog, [DB_PREFIX + 'invoices']: '[]' });
  const rows = stored();
  assert.deepEqual(rows.map((r) => r.summary.slice(0, 8)), ['backup a', 'backup b', 'Data res']);
  const marker = rows[2];
  assert.equal(marker.action, 'restore');
  assert.equal(marker.prev, backupHead, 'marker links onto the restored segment');
  assert.equal(marker.seal?.restored_head, backupHead);
  assert.equal(marker.seal?.restored_rows, 2);
  assert.equal(marker.seal?.replaced_head, deviceHead);
  assert.equal(marker.seal?.replaced_rows, 1);
  const r = verify();
  assert.equal(r.ok, true);
  assert.equal(r.restores, 1);
  // A head noted on the device before the restore is reported as replaced, not as tampering.
  assert.deepEqual(verify(rows, deviceHead!).noted, { status: 'replaced', at: marker.at });
  assert.equal(verify(rows, deviceHead!).ok, true);
});

test('restore of a backup without a log keeps this device log and continues its chain', () => {
  rec('device a');
  const head = audit.head();
  applyBackup({ [DB_PREFIX + 'invoices']: '[]' });
  const rows = stored();
  assert.equal(rows.length, 2);
  assert.equal(rows[1].prev, head);
  assert.equal(rows[1].seal?.restored_head, null);
  assert.equal(rows[1].seal?.replaced_head, undefined, 'nothing was replaced');
  assert.equal(verify().ok, true);
});

test('restore of a pre-4.5 backup: its legacy log is sealed before the marker', () => {
  const old = JSON.stringify([legacyRow(1), legacyRow(2)]);
  restoreBackup({ [DB_PREFIX + AUDIT_TABLE]: old });
  const rows = stored();
  assert.deepEqual(rows.map((r) => r.action), ['create', 'create', 'chain_start', 'restore']);
  assert.equal(rows[3].seal?.restored_head, null);
  assert.equal(verify().ok, true);
});
