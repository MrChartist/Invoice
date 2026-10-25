/**
 * 6.21 follow-up: table-level role guard in storage.setTable (stock, catalogue, godowns, books …).
 */
import './helpers/shim.ts';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { asSystem, setActorProvider, type Role } from '../src/lib/access.ts';
import { getTable, setTable } from '../src/lib/storage.ts';
import { runMigrations } from '../src/lib/migrations.ts';

const as = (role: Role | null) => setActorProvider(role ? () => ({ id: 'u', name: 'U', role }) : null);

afterEach(() => {
  as(null);
  resetStorage();
});

test('viewer cannot write masters or books tables through any path', () => {
  as('viewer');
  for (const t of ['stock_items', 'stock_moves', 'items_catalog', 'godowns', 'stock_transfers', 'budgets', 'fixed_assets', 'purchase_orders']) {
    assert.throws(() => setTable(t, [{ id: 'x' }]), /Viewer\) cannot/, t);
    assert.deepEqual(getTable(t), [], `${t} unchanged`);
  }
});

test('clerk may edit masters and books; unlisted tables (audit, notifications, prefs) stay open to everyone', () => {
  as('clerk');
  setTable('stock_items', [{ id: 's1' }]);
  setTable('stock_transfers', [{ id: 't1' }]);
  as('viewer');
  setTable('notifications', [{ id: 'n1' }]);
  setTable('export_prefs', [{ id: 'p1' }]);
  assert.equal(getTable('notifications').length, 1);
});

test('asSystem lets the app write on the user’s behalf (sync merges, migrations), only inside the call', () => {
  as('viewer');
  asSystem(() => setTable('stock_items', [{ id: 'merged' }]));
  assert.equal(getTable<{ id: string }>('stock_items')[0].id, 'merged');
  assert.throws(() => setTable('stock_items', []), /cannot/, 'the bypass ends with the call');
  asSystem(() => setTable('clients', [{ id: 'c1' }])); // existing data, so the migration really runs
  const r = runMigrations([{ version: 1, name: 'touch stock', up: () => setTable('stock_items', [{ id: 'migrated' }]) }]);
  assert.equal(r.status, 'migrated', 'a migration under a viewer session still applies');
  assert.equal(getTable<{ id: string }>('stock_items')[0].id, 'migrated');
});

test('nobody signed in counts as owner (single-user installs unchanged)', () => {
  as(null);
  setTable('stock_items', [{ id: 'free' }]);
  assert.equal(getTable('stock_items').length, 1);
});
