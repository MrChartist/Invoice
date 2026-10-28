/**
 * PENDING #19 (AG-B2): the milk analyser profile row in the POS device settings — shown with the dairy pack, saved with
 * the counter settings to the same device-local key Dairy → Collection uses; no dairy string area is pulled in.
 */
import './helpers/shim.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ANALYSER_KEY, loadAnalyser, saveAnalyser } from '../src/lib/agri/ag-analyser.ts';

const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');

test('the POS device settings carry the analyser row behind the dairy pack', () => {
  const rs = src('components/pos-retail/RetailSettings.tsx');
  assert.match(rs, /\{dairy && \(\s*<div data-pos-analyser>/);
  assert.match(rs, /if \(dairy\) saveAnalyser\(analyser\)/);
  assert.ok(!/agri-r12b/.test(rs), 'the dairy strings stay in the dairy desk chunk');
  assert.match(src('pages/Pos.tsx'), /dairy=\{isPackOn\(settings, 'dairy'\)\}/);
});

test('the profile saved there is the one Dairy → Collection reads', () => {
  saveAnalyser({ preset: 'kv', sep: ';', order: ['snf', 'fat'], div: 10, baud: 4800 });
  assert.ok(localStorage.getItem(ANALYSER_KEY));
  assert.deepEqual(loadAnalyser(), { preset: 'kv', sep: ';', order: ['snf', 'fat'], div: 10, baud: 4800 });
});
