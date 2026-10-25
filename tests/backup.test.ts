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
  // A PIN is set up (the auth record above), so the owner must be signed in: full backups are owner-only.
  Object.assign(globalThis, { sessionStorage: { getItem: (k: string) => (k === 'mrchartist_inv_session' ? '1' : null), setItem() {}, removeItem() {} } });
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

test('parseBackup refuses damaged record tables, bad settings and newer versions', async () => {
  const { LATEST_SCHEMA_VERSION } = await import('../src/lib/migrations.ts');
  const file = (data: Record<string, string>, version = 1) => JSON.stringify({ app: 'mrchartist-invoice', version, exportedAt: '', data });
  const ok = { mrchartist_inv_invoices: '[{"id":"a"}]', mrchartist_inv_settings: '{"profiles":[]}' };
  assert.equal(parseBackup(file(ok)).summary.invoices, 1);
  assert.throws(() => parseBackup(file({ mrchartist_inv_invoices: '{"id":"a"}' })), /"invoices" table .* not a list/);
  assert.throws(() => parseBackup(file({ mrchartist_inv_invoices: '[{"id":"a"},' })), /"invoices" table .* damaged/);
  assert.throws(() => parseBackup(file({ mrchartist_inv_clients: '[{"name":"no id"}]' })), /Row 1 of the "clients"/);
  assert.throws(() => parseBackup(file({ mrchartist_inv_audit_log: '[1,2]' })), /"audit_log"/);
  // Ledger tables (6.1–6.3) are validated too and carried whole.
  assert.throws(() => parseBackup(file({ ...ok, mrchartist_inv_vouchers: '[{"type":"JOURNAL"}]' })), /Row 1 of the "vouchers"/);
  assert.throws(() => parseBackup(file({ ...ok, mrchartist_inv_accounts: '{}' })), /"accounts" table .* not a list/);
  assert.throws(() => parseBackup(file({ ...ok, mrchartist_inv_fixed_assets: '[1]' })), /"fixed_assets"/);
  const ledger = { ...ok, mrchartist_inv_vouchers: '[{"id":"v1","type":"JOURNAL","lines":[]}]', mrchartist_inv_accounts: '[{"id":"u1"}]', mrchartist_inv_fixed_assets: '[{"id":"f1"}]' };
  assert.equal(parseBackup(file(ledger)).data.mrchartist_inv_vouchers, ledger.mrchartist_inv_vouchers);
  // IRN / Ack rows written by the bulk IRP import (6.24) are validated too.
  assert.throws(() => parseBackup(file({ mrchartist_inv_einvoice_meta: '{"invoice_id":"a"}' })), /"einvoice_meta" table .* not a list/);
  assert.equal(parseBackup(file({ ...ok, mrchartist_inv_einvoice_meta: '[{"invoice_id":"a","irn":"x"}]' })).data.mrchartist_inv_einvoice_meta, '[{"invoice_id":"a","irn":"x"}]');
  assert.throws(() => parseBackup(file({ mrchartist_inv_settings: '[]' })), /settings/);
  assert.throws(() => parseBackup(file(ok, 2)), /newer version/);
  assert.throws(
    () => parseBackup(file({ ...ok, mrchartist_inv_schema_version: String(LATEST_SCHEMA_VERSION + 1) })),
    /newer version/,
  );
  // Unknown and loosely-shaped keys still pass through untouched.
  assert.equal(parseBackup(file({ ...ok, mrchartist_inv_template: 'modern' })).data.mrchartist_inv_template, 'modern');
});
