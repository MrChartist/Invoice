/**
 * R20-A1 / U7: the Tally keys mode. Absent on a fresh device → off (F5 reloads), layout TallyPrime when switched on;
 * a device used before (What's new seen at an older version, Tally terms, report prefs) → on with the ERP 9 layout,
 * exactly today's keys. Decided once and stored. Then the engine's scope order and mode rules.
 */
import './helpers/shim.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadStorage, resetStorage, dumpStorage } from './helpers/shim.ts';

let n = 0;
/** A fresh copy of the stub (its mode is memoised per module instance). */
const fresh = async () => (await import(`../src/lib/keys/stub.ts?v=${n++}`)) as typeof import('../src/lib/keys/stub.ts');

test('fresh device: off, TallyPrime layout, decision stored', async () => {
  resetStorage();
  const s = await fresh();
  assert.equal(s.keysOn(), false);
  assert.equal(s.keysLayout(), 'prime');
  assert.equal(dumpStorage().mrchartist_tally_keys, 'off');
  s.setKeysMode('on');
  assert.equal((await fresh()).keysOn(), true, 'the switch persists');
});

test('existing device: on with the ERP 9 layout (no change for current users)', async () => {
  for (const seed of [{ mrchartist_whats_new_seen: '3.0.0' }, { mrchartist_tally_terms: '1' }, { mrchartist_report_prefs: '{}' }]) {
    resetStorage();
    loadStorage(seed);
    const s = await fresh();
    assert.equal(s.keysOn(), true, JSON.stringify(seed));
    assert.equal(s.keysLayout(), 'erp9');
  }
  resetStorage();
  loadStorage({ mrchartist_whats_new_seen: '3.0.0', mrchartist_tally_keys: 'off' });
  assert.equal((await fresh()).keysOn(), false, 'a stored choice wins');
});

test('subscribers hear a switch; the layout is a separate preference', async () => {
  resetStorage();
  const s = await fresh();
  let heard = 0;
  const off = s.subscribeKeys(() => heard++);
  s.setKeysMode('on:collapsed');
  s.setKeysLayout('erp9');
  off();
  s.setKeysMode('off');
  assert.equal(heard, 2);
  assert.equal(s.keysLayout(), 'erp9');
});

test('engine: mode off fires nothing but Gateway keys on /gateway; a screen handler beats the global route', async () => {
  resetStorage();
  loadStorage({ mrchartist_tally_keys: 'off' });
  (globalThis as { location?: unknown }).location = { pathname: '/' };
  (globalThis as { document?: unknown }).document = { querySelector: () => null };
  const stub = await import('../src/lib/keys/stub.ts');
  const { candidates } = await import('../src/lib/keys/engine.ts');
  const { registerKeyActions } = await import('../src/lib/keys/engine.ts');
  assert.equal(candidates('f5', null).length, 0, 'F5 reloads in simple mode');
  (globalThis as { location: { pathname: string } }).location.pathname = '/gateway';
  assert.equal(candidates('f5', null)[0]?.row.id, 'payment', 'the Gateway keeps its keys');
  (globalThis as { location: { pathname: string } }).location.pathname = '/books';
  stub.setKeysMode('on');
  stub.setKeysLayout('prime');
  assert.equal(candidates('alt+f5', null)[0]?.row.id, 'debitNote', 'Prime: Alt+F5 debit note');
  assert.equal(candidates('mod+f8', null)[0]?.row.id, 'salesOrder', 'Prime: Ctrl+F8 sales order');
  const typing = { tagName: 'INPUT', closest: () => null } as unknown as EventTarget;
  assert.equal(candidates('f8', typing).length, 0, 'never while typing');
  const off = registerKeyActions('voucher', { 'contra.voucher': () => true, 'dup.voucher': () => true });
  const offC = registerKeyActions('reportRow', { 'dup.row': () => true }); // R20-B: B is built; C is the unbuilt one
  const c = candidates('f4', null);
  assert.equal(c[0].row.id, 'contra', 'an ext row (handled by the Gateway itself) is not run by the engine');
  assert.deepEqual(candidates('alt+2', null).map((x) => x.row.id), ['dup.voucher'], 'rows of an unbuilt package (C) never fire, even with a handler');
  off();
  offC();
  stub.setKeysLayout('erp9');
  assert.equal(candidates('mod+f8', null)[0]?.row.id, 'creditNote', 'ERP 9: Ctrl+F8 credit note');
});
