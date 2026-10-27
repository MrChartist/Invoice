/** AG-B2 milk analyser frames: presets, field order, separators, partial frames, fixed-point units, profile cleaning. */
import './helpers/shim.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanAnalyser, DEFAULT_ANALYSER, parseAnalyserFrame } from '../src/lib/agri/ag-analyser.ts';

test('generic CSV preset: field order fat, SNF, CLR, water', () => {
  assert.deepEqual(parseAnalyserFrame('6.9,9.1,30,0.0'), { fat: 6.9, snf: 9.1, clr: 30, water_pct: 0 });
  assert.deepEqual(parseAnalyserFrame('4.5,8.6'), { fat: 4.5, snf: 8.6 });
});

test('custom order, separator and skipped fields', () => {
  const p = cleanAnalyser({ preset: 'csv', sep: ';', order: ['skip', 'snf', 'fat'] });
  assert.deepEqual(parseAnalyserFrame('ID42;8.7;4.1', p), { fat: 4.1, snf: 8.7 });
  const sp = cleanAnalyser({ sep: ' ', order: ['fat', 'snf'] });
  assert.deepEqual(parseAnalyserFrame('5.2   8.9', sp), { fat: 5.2, snf: 8.9 });
});

test('key=value preset in any order and case', () => {
  const p = cleanAnalyser({ preset: 'kv' });
  assert.deepEqual(parseAnalyserFrame('SNF=8.6 FAT=4.5 CLR=28 W=1.5', p), { fat: 4.5, snf: 8.6, clr: 28, water_pct: 1.5 });
  assert.deepEqual(parseAnalyserFrame('fat:6.0,snf:9.0', p), { fat: 6, snf: 9 });
});

test('partial or unreadable frames give null; out-of-range values are refused', () => {
  assert.equal(parseAnalyserFrame('6.9'), null);
  assert.equal(parseAnalyserFrame(''), null);
  assert.equal(parseAnalyserFrame('READY'), null);
  assert.equal(parseAnalyserFrame('69,91'), null, 'fat 69% is not milk');
  assert.equal(parseAnalyserFrame('FAT=4.5', cleanAnalyser({ preset: 'kv' })), null);
});

test('fixed-point units: div 10 reads "069" as 6.9', () => {
  assert.deepEqual(parseAnalyserFrame('069,091', cleanAnalyser({ div: 10 })), { fat: 6.9, snf: 9.1 });
});

test('profile cleaning keeps fat and SNF in the order and known bauds', () => {
  assert.deepEqual(cleanAnalyser(null), DEFAULT_ANALYSER);
  assert.deepEqual(cleanAnalyser({ order: ['clr'] }).order, DEFAULT_ANALYSER.order);
  assert.equal(cleanAnalyser({ baud: 1234 }).baud, 9600);
  assert.equal(cleanAnalyser({ baud: 2400, div: 7 }).baud, 2400);
  assert.equal(cleanAnalyser({ div: 7 }).div, 1);
});
