/** PS-A2 conflict checks: name folding, PAN / GSTIN exact (PAN inside a GSTIN), closed matters searched, waiver by the owner, 5,000 parties fast. */
import './helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings, gstin } from './helpers/world.ts';
import { setActorProvider } from '../src/lib/access.ts';
import { candidates, conflictWarnings, foldName, loadChecks, overlap, saveCheck, searchConflicts } from '../src/lib/prof/ps-conflicts.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});
afterEach(() => setActorProvider(null));

const G = gstin('07AABCS1234A1Z');

test('folding: case, punctuation, M/s, Pvt Ltd / Private Limited / LLP / & Co', () => {
  assert.equal(foldName('M/s. Shree Traders Pvt. Ltd.'), 'shree traders');
  assert.equal(foldName('SHREE TRADERS PRIVATE LIMITED'), 'shree traders');
  assert.equal(foldName('Shree Traders & Co'), 'shree traders');
  assert.equal(foldName('Mehta Partners LLP'), 'mehta partners');
  assert.equal(overlap(['a', 'b', 'c', 'd', 'e'], ['a', 'b', 'c', 'd']), 0.8);
});

test('hits in clients, vendors and every matter party (closed too); PAN / GSTIN exact; best first', () => {
  const list = candidates({
    clients: [{ id: 'c1', name: 'Shree Traders Pvt Ltd', gstin: G }],
    vendors: [{ id: 'v1', name: 'Shree Trading Co' }],
    matters: [{ id: 'm1', name: 'Old matter', ps: { code: 'OLD/001', kind: 'matter', opened: '2024-01-01', closed: '2024-12-31', parties: [{ name: 'M/s Shree Traders', role: 'opposite' }, { name: 'Ramesh Gupta', role: 'witness', pan: 'ABCPG1234K' }] } }],
  });
  const hits = searchConflicts(['Shree Traders'], list);
  assert.deepEqual(hits.map((h) => `${h.source}:${h.score}`).sort(), ['client:1', 'party:1']);
  assert.equal(hits.find((h) => h.source === 'party')?.matter_code, 'OLD/001');
  assert.deepEqual(searchConflicts(['AABCS1234A'], list).map((h) => h.ref_id), ['c1'], 'a PAN finds the GSTIN that holds it');
  assert.deepEqual(searchConflicts([G], list).map((h) => h.ref_id), ['c1']);
  assert.deepEqual(searchConflicts(['abcpg1234k'], list).map((h) => h.name), ['Ramesh Gupta']);
  assert.deepEqual(searchConflicts(['Gupta Ramesh Kumar'], list), [], 'overlap below 0.8');
});

test('record clear / conflict; a waiver needs the owner and a reason; an unwaived conflict warns later', () => {
  assert.throws(() => saveCheck({ date: '2026-05-01', terms: [' '], hits: [], result: 'clear' }), /at least one/);
  saveCheck({ date: '2026-05-01', terms: ['Shree Traders'], hits: [], result: 'conflict' });
  assert.throws(() => saveCheck({ date: '2026-05-02', terms: ['X'], hits: [], result: 'waived' }), /reason/);
  setActorProvider(() => ({ id: 'u2', name: 'Clerk', role: 'clerk' }));
  assert.throws(() => saveCheck({ date: '2026-05-02', terms: ['X'], hits: [], result: 'waived', reason: 'ok' }));
  setActorProvider(null);
  saveCheck({ date: '2026-05-02', terms: ['Y'], hits: [], result: 'waived', reason: 'unrelated', consent_note: 'letter' });
  assert.equal(loadChecks().length, 2);
  assert.equal(conflictWarnings(['M/s Shree Traders Pvt Ltd'], loadChecks()).length, 1);
  assert.equal(conflictWarnings(['Y'], loadChecks()).length, 0, 'waived does not warn');
});

test('5,000 parties searched in well under 50 ms', () => {
  const matters = Array.from({ length: 1000 }, (_, i) => ({ id: `m${i}`, name: `M${i}`, ps: { code: `C/${i}`, kind: 'matter' as const, opened: '2025-01-01', parties: Array.from({ length: 5 }, (_, j) => ({ name: `Party ${i} ${j} Enterprises`, role: 'opposite' as const })) } }));
  const list = candidates({ clients: [], vendors: [], matters });
  const t0 = performance.now();
  const hits = searchConflicts(['Party 500 3 Enterprises', 'AAAAA0000A'], list);
  const ms = performance.now() - t0;
  assert.equal(hits[0].matter_code, 'C/500');
  assert.ok(ms < 50, `${ms.toFixed(1)} ms`);
});
