import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBackup } from '../src/lib/backup.ts';

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
