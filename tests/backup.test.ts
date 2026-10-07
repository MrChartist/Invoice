import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseBackup,
  buildEncryptedBackup,
  decryptBackup,
  isEncryptedBackup,
  EncryptedBackupError,
  backupFilename,
  markBackupDone,
  getLastBackup,
  daysSinceBackup,
} from '../src/lib/backup.ts';

const store = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: {
    get length() { return store.size; },
    key: (i: number) => [...store.keys()][i] ?? null,
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  },
});

test('parseBackup: accepts the wrapped format and counts rows', () => {
  const file = {
    app: 'mrchartist-invoice',
    version: 1,
    exportedAt: '2026-04-01T00:00:00Z',
    data: {
      mrchartist_inv_invoices: JSON.stringify([{ id: 1 }, { id: 2 }]),
      mrchartist_inv_clients: JSON.stringify([{ id: 1 }]),
    },
  };
  const { summary } = parseBackup(JSON.stringify(file));
  assert.deepEqual(summary, { invoices: 2, clients: 1, keys: 2 });
});

test('parseBackup: accepts the legacy flat format', () => {
  const { data } = parseBackup(JSON.stringify({ mrchartist_inv_template: '"classic_orange"' }));
  assert.equal(data.mrchartist_inv_template, '"classic_orange"');
});

test('parseBackup: drops keys outside the app namespace and the PIN session', () => {
  const { data } = parseBackup(
    JSON.stringify({
      mrchartist_inv_invoices: '[]',
      theme: 'dark',
      mrchartist_inv_auth: '{"name":"x","pin":"1234"}',
      other_site_key: 'x',
    }),
  );
  assert.deepEqual(Object.keys(data), ['mrchartist_inv_invoices']);
});

test('parseBackup: rejects junk with a readable message', () => {
  assert.throws(() => parseBackup('not json'), /not valid JSON/);
  assert.throws(() => parseBackup('[]'), /does not look like/);
  assert.throws(() => parseBackup('{"theme":"dark"}'), /No invoice data/);
});

test('parseBackup: also drops device-local security keys', () => {
  const { data } = parseBackup(
    JSON.stringify({
      mrchartist_inv_invoices: '[]',
      mrchartist_inv_auth_guard: '{}',
      mrchartist_inv_idle_min: '5',
      mrchartist_inv_last_backup: '2026-01-01T00:00:00Z',
    }),
  );
  assert.deepEqual(Object.keys(data), ['mrchartist_inv_invoices']);
});

test('markBackupDone stores an ISO timestamp readable via getLastBackup/daysSinceBackup', () => {
  store.clear();
  assert.equal(getLastBackup(), null);
  assert.equal(daysSinceBackup(), null);
  markBackupDone(new Date('2026-04-01T10:00:00Z'));
  assert.equal(getLastBackup(), '2026-04-01T10:00:00.000Z');
  assert.equal(daysSinceBackup(new Date('2026-04-04T09:00:00Z')), 2);
});

test('encrypted backup: round-trips, hides content, and never carries device-local keys', async () => {
  store.clear();
  store.set('mrchartist_inv_invoices', JSON.stringify([{ id: 1, client: 'Secret Client' }]));
  store.set('mrchartist_inv_auth', '{"name":"x","hash":"h"}');
  store.set('mrchartist_inv_auth_guard', '{}');
  store.set('mrchartist_inv_last_backup', '2026-01-01T00:00:00Z');
  const text = await buildEncryptedBackup('a long passphrase');
  assert.ok(isEncryptedBackup(text));
  assert.ok(!text.includes('Secret Client'));
  const { data, summary } = await decryptBackup(text, 'a long passphrase');
  assert.deepEqual(Object.keys(data), ['mrchartist_inv_invoices']);
  assert.equal(summary.invoices, 1);
});

test('encrypted backup: wrong and too-short passphrases are rejected clearly', async () => {
  store.clear();
  store.set('mrchartist_inv_invoices', '[]');
  const text = await buildEncryptedBackup('a long passphrase');
  await assert.rejects(decryptBackup(text, 'not the passphrase'), /Wrong passphrase/);
  await assert.rejects(buildEncryptedBackup('short'), /at least 8/);
});

test('encrypted backup: parseBackup flags it, tampering is detected, plaintext is not encrypted', async () => {
  store.clear();
  store.set('mrchartist_inv_invoices', '[]');
  const text = await buildEncryptedBackup('a long passphrase');
  assert.throws(() => parseBackup(text), EncryptedBackupError);
  const doc = JSON.parse(text);
  doc.envelope.ct = doc.envelope.ct.slice(0, -6) + 'AAAAAA';
  await assert.rejects(decryptBackup(JSON.stringify(doc), 'a long passphrase'), /modified/);
  assert.equal(isEncryptedBackup('{"mrchartist_inv_invoices":"[]"}'), false);
  assert.equal(isEncryptedBackup('nope'), false);
  await assert.rejects(decryptBackup('{"a":1}', 'x'), /not an encrypted/);
  assert.match(backupFilename(new Date('2026-04-01T00:00:00Z'), true), /2026-04-01\.encrypted\.json$/);
});
