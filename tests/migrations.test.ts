import './helpers/shim.ts';
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import {
  LATEST_SCHEMA_VERSION,
  MIGRATIONS,
  SCHEMA_VERSION_KEY,
  getSchemaVersion,
  runMigrations,
  type Migration,
} from '../src/lib/migrations.ts';
import { localDb } from '../src/lib/localDb.ts';

beforeEach(() => resetStorage());

test('a fresh install is stamped with the latest version and runs nothing', () => {
  const r = runMigrations();
  assert.deepEqual(r, { status: 'fresh', version: LATEST_SCHEMA_VERSION });
  assert.equal(getSchemaVersion(), LATEST_SCHEMA_VERSION);
  assert.equal(runMigrations().status, 'current');
});

test('existing data without a version runs every migration in order, once', () => {
  localStorage.setItem('mrchartist_inv_invoices', '[{"id":"a"}]');
  const order: number[] = [];
  const ms: Migration[] = [
    { version: 2, name: 'b', up: () => order.push(2) },
    { version: 1, name: 'a', up: () => order.push(1) },
  ];
  const r = runMigrations(ms);
  assert.equal(r.status, 'migrated');
  assert.deepEqual(order, [1, 2]);
  assert.equal(getSchemaVersion(), 2);
  runMigrations(ms);
  assert.deepEqual(order, [1, 2], 'already-applied migrations never run again');
});

test('a failing migration rolls every key back and keeps the last good version', () => {
  localStorage.setItem('mrchartist_inv_invoices', '[{"id":"a"}]');
  localStorage.setItem(SCHEMA_VERSION_KEY, '1');
  const ms: Migration[] = [
    { version: 1, name: 'done', up: () => {} },
    {
      version: 2,
      name: 'boom',
      up: () => {
        localStorage.setItem('mrchartist_inv_invoices', '[]');
        localStorage.setItem('mrchartist_inv_new_table', '[1]');
        throw new Error('nope');
      },
    },
  ];
  const r = runMigrations(ms);
  assert.equal(r.status, 'failed');
  assert.equal(localStorage.getItem('mrchartist_inv_invoices'), '[{"id":"a"}]');
  assert.equal(localStorage.getItem('mrchartist_inv_new_table'), null);
  assert.equal(getSchemaVersion(), 1);
});

test('data from a newer app version is left untouched', () => {
  localStorage.setItem(SCHEMA_VERSION_KEY, String(LATEST_SCHEMA_VERSION + 5));
  localStorage.setItem('mrchartist_inv_settings', '{"companyName":"X"}');
  assert.equal(runMigrations().status, 'newer');
  assert.equal(localStorage.getItem('mrchartist_inv_settings'), '{"companyName":"X"}');
});

test('v1: legacy flat settings are persisted as a profile, and reads agree', () => {
  localStorage.setItem('mrchartist_inv_settings', JSON.stringify({ companyName: 'Old Co', companyGstin: '27AAAAA0000A1Z5', invoicePrefix: 'OLD' }));
  runMigrations(MIGRATIONS);
  const raw = JSON.parse(localStorage.getItem('mrchartist_inv_settings')!);
  assert.equal(raw.profiles.length, 1);
  assert.equal(raw.profiles[0].companyName, 'Old Co');
  assert.equal(raw.activeProfileId, raw.profiles[0].id);
  assert.equal(raw.invoicePrefix, 'OLD');
  const s = localDb.settings.get();
  assert.equal(s.profiles[0].companyName, 'Old Co');
  assert.equal(s.onboarded, true);
  // Idempotent on the new shape.
  const before = localStorage.getItem('mrchartist_inv_settings');
  MIGRATIONS[0].up();
  assert.equal(localStorage.getItem('mrchartist_inv_settings'), before);
});
