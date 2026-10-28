/** R16-B5: deleting a conflict check — the row goes to the recycle bin; a viewer cannot; a waived check is the owner's. */
import './helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { getTable } from '../src/lib/storage.ts';
import { setActorProvider } from '../src/lib/access.ts';
import { deleteCheck, loadChecks, saveCheck } from '../src/lib/prof/ps-conflicts.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});
afterEach(() => setActorProvider(null));

const bin = () => getTable<{ table: string; row_id: string }>('recycle_bin').filter((b) => b.table === 'conflict_checks');

test('delete a check: gone from the list, kept in the recycle bin; an unknown id is refused', () => {
  const a = saveCheck({ date: '2026-10-01', terms: ['Shree Traders'], hits: [], result: 'clear' });
  const b = saveCheck({ date: '2026-10-02', terms: ['Mehta & Co'], hits: [], result: 'conflict' });
  deleteCheck(a.id);
  assert.deepEqual(loadChecks().map((c) => c.id), [b.id]);
  assert.deepEqual(bin().map((r) => r.row_id), [a.id]);
  assert.throws(() => deleteCheck(a.id), /not found/);
});

test('a viewer cannot delete; a clerk can delete a clear check but not the owner\'s waiver', () => {
  const c = saveCheck({ date: '2026-10-01', terms: ['Asha'], hits: [], result: 'clear' });
  const w = saveCheck({ date: '2026-10-01', terms: ['Bala'], hits: [], result: 'waived', reason: 'Consent on file' });
  setActorProvider(() => ({ id: 'v', name: 'Viewer', role: 'viewer' }));
  assert.throws(() => deleteCheck(c.id));
  setActorProvider(() => ({ id: 'k', name: 'Clerk', role: 'clerk' }));
  assert.throws(() => deleteCheck(w.id));
  deleteCheck(c.id);
  assert.deepEqual(loadChecks().map((x) => x.id), [w.id]);
});
