import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSlots, prefixOffsets, rowSizes, visibleRange, type Slot } from '../src/lib/virtual-window.ts';

const keys = (n: number) => Array.from({ length: n }, (_, i) => `k${i}`);
const total = (slots: Slot[], sizes: number[]) =>
  slots.reduce((s, x) => s + (x.kind === 'gap' ? x.height : sizes[x.index]), 0);

test('rowSizes: measured heights win, unmeasured rows use their mean, else the estimate', () => {
  assert.deepEqual(rowSizes(keys(3), new Map(), 50), [50, 50, 50]);
  assert.deepEqual(rowSizes(keys(3), new Map([['k0', 40], ['k2', 60]]), 99), [40, 50, 60]);
});

test('prefixOffsets: running tops plus total', () => {
  assert.deepEqual(prefixOffsets([10, 20, 30]), [0, 10, 30, 60]);
  assert.deepEqual(prefixOffsets([]), [0]);
});

test('visibleRange: rows in view plus overscan, clamped to the list', () => {
  const offs = prefixOffsets(new Array(100).fill(10)); // 1000 px
  assert.deepEqual(visibleRange(offs, 0, 50, 0), { start: 0, end: 5 });
  assert.deepEqual(visibleRange(offs, 95, 150, 2), { start: 7, end: 17 });
  assert.deepEqual(visibleRange(offs, -500, 30, 3), { start: 0, end: 6 }); // list below the fold top
  assert.deepEqual(visibleRange(offs, 990, 2000, 1), { start: 98, end: 100 });
  assert.deepEqual(visibleRange(offs, 5000, 6000, 2), { start: 97, end: 100 }); // scrolled past the end
  assert.deepEqual(visibleRange(prefixOffsets([]), 0, 100, 5), { start: 0, end: 0 });
});

test('visibleRange: variable heights', () => {
  const offs = prefixOffsets([100, 10, 10, 10, 300, 10]);
  assert.deepEqual(visibleRange(offs, 105, 125, 0), { start: 1, end: 4 });
  assert.deepEqual(visibleRange(offs, 200, 400, 0), { start: 4, end: 5 });
});

test('buildSlots: gaps stand in for unmounted rows and keep the total height', () => {
  const sizes = new Array(50).fill(20);
  const offs = prefixOffsets(sizes);
  const slots = buildSlots(offs, { start: 10, end: 15 });
  assert.equal(slots[0].kind, 'gap');
  assert.equal((slots[0] as { height: number }).height, 200);
  assert.deepEqual(slots.filter((s) => s.kind === 'row').map((s) => (s as { index: number }).index), [10, 11, 12, 13, 14]);
  assert.equal(total(slots, sizes), 1000);
  assert.deepEqual(buildSlots(offs, { start: 0, end: 50 }).every((s) => s.kind === 'row'), true);
});

test('buildSlots: the focused row stays mounted outside the window, in document order', () => {
  const sizes = new Array(50).fill(20);
  const offs = prefixOffsets(sizes);
  for (const pinned of [2, 40, 12]) {
    const slots = buildSlots(offs, { start: 10, end: 15 }, pinned);
    const rows = slots.filter((s) => s.kind === 'row').map((s) => (s as { index: number }).index);
    assert.ok(rows.includes(pinned));
    assert.deepEqual(rows, [...rows].sort((a, b) => a - b));
    assert.equal(new Set(rows).size, rows.length);
    assert.equal(total(slots, sizes), 1000);
    const gapKeys = slots.filter((s) => s.kind === 'gap').map((s) => (s as { key: string }).key);
    assert.equal(new Set(gapKeys).size, gapKeys.length);
  }
});

test('buildSlots: a stale range (list shrank) is clamped', () => {
  const offs = prefixOffsets(new Array(5).fill(10));
  const slots = buildSlots(offs, { start: 3, end: 40 }, 99);
  assert.deepEqual(slots.map((s) => s.kind), ['gap', 'row', 'row']);
});
