/**
 * R20-C: the report keys' pure helpers — filter (Ctrl+F), totals of shown rows (Ctrl+F12), ticks / hidden rows
 * (Space, Ctrl+Alt+I, Ctrl+R, Ctrl+U, Alt+U), period stepping (+ / −), the default saved view, and the rows held
 * back until package B lands.
 */
import './helpers/shim.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NO_TOOLS, addSel, emptyFilter, filterRows, hideRows, invertSel, shownRows, stepPeriod, stepShown, toggleSel, toolsActive,
  totalsOf, unhideAll, unhideLast, type RowFact,
} from '../src/lib/keys/report-actions.ts';
import { defaultView, loadViews, saveView, setDefaultView } from '../src/lib/report-views.ts';
import { BUILT, HELD, KEY_ROWS, isBuilt } from '../src/lib/keys/registry.ts';
import { sheetRows } from '../src/lib/keys/cheat.ts';

const rows: RowFact[] = [
  { text: 'Acme Traders INV/1', date: '2026-04-02', narr: 'April rent', amt: 1_500_000 },
  { text: 'Bharat Steel', date: '2026-04-10', narr: 'steel', amt: -250_000 },
  { text: 'Cash sale', date: '2026-05-01', amt: 50_000 },
];

test('filterRows: amount range, dates, party / narration text, Dr / Cr side', () => {
  assert.deepEqual(filterRows(rows, { min: 1_000_000 }), [0], 'amount ≥ 10,000');
  assert.deepEqual(filterRows(rows, { min: 100_000, max: 2_000_000 }), [0, 1], 'amount compares without its sign');
  assert.deepEqual(filterRows(rows, { from: '2026-04-05', to: '2026-04-30' }), [1]);
  assert.deepEqual(filterRows(rows, { text: 'bharat' }), [1], 'case-insensitive');
  assert.deepEqual(filterRows(rows, { narr: 'RENT' }), [0]);
  assert.deepEqual(filterRows(rows, { side: 'cr' }), [1]);
  assert.deepEqual(filterRows(rows, { side: 'dr', text: 'a' }), [0, 2]);
  assert.deepEqual(filterRows([{ text: 'x', amt: 1 }], { from: '2026-01-01' }), [], 'a date filter leaves out rows without a date');
  assert.ok(emptyFilter({ text: '' }) && !emptyFilter({ min: 0 }));
});

test('totalsOf: Dr, Cr and net of the shown rows; a parent with a shown child is not counted twice', () => {
  assert.deepEqual(totalsOf(rows, [0, 1, 2]), { count: 3, dr: 1_550_000, cr: 250_000, net: 1_300_000 });
  const tree: RowFact[] = [
    { text: 'Current assets', amt: 900, depth: 0 },
    { text: 'Cash', amt: 400, depth: 1 },
    { text: 'Bank', amt: 500, depth: 1 },
    { text: 'Capital', amt: -900, depth: 0 },
  ];
  assert.deepEqual(totalsOf(tree, [0, 1, 2, 3]), { count: 4, dr: 900, cr: 900, net: 0 });
  assert.equal(totalsOf(tree, [0, 3]).dr, 900, 'a collapsed parent counts');
  assert.equal(totalsOf(tree, [0, 2, 3]).dr, 500, 'with one child shown, only the child counts');
});

test('ticks and hidden rows: Space, extend, invert, Ctrl+R, Ctrl+U, Alt+U', () => {
  let t = toggleSel(NO_TOOLS, 1);
  assert.deepEqual(t.sel, [1]);
  assert.deepEqual(toggleSel(t, 1).sel, [], 'Space again unticks');
  t = addSel(t, [1, 2]);
  assert.deepEqual(t.sel, [1, 2]);
  assert.deepEqual(invertSel(t, [0, 1, 2, 3]).sel, [0, 3]);
  t = hideRows(t, 0);
  assert.deepEqual(t.hid, [[1, 2]], 'ticked rows hide together');
  assert.deepEqual(t.sel, []);
  t = hideRows(t, 4);
  assert.deepEqual(shownRows(6, t), [0, 3, 5]);
  assert.deepEqual(unhideLast(t).hid, [[1, 2]], 'Ctrl+U restores the last');
  assert.deepEqual(unhideAll(t).hid, [], 'Alt+U restores all');
  assert.ok(toolsActive(t) && !toolsActive(NO_TOOLS));
  assert.deepEqual(shownRows(4, { ...NO_TOOLS, filter: { min: 1 }, match: [1, 3] }), [1, 3], 'the filter keeps its rows');
  assert.equal(stepShown([0, 3, 5], 0, 1), 3, '↓ skips hidden rows');
  assert.equal(stepShown([0, 3, 5], 5, -1), 3);
  assert.equal(stepShown([0, 3, 5], 5, 1), 5, 'stays on the last row');
});

test('stepPeriod: month, quarter and FY by the preset; whole-month and day ranges', () => {
  assert.deepEqual(stepPeriod('this_month', { start: '2026-10-01', end: '2026-10-31' }, 1), { start: '2026-11-01', end: '2026-11-30' });
  assert.deepEqual(stepPeriod('mtd', { start: '2026-03-01', end: '2026-03-15' }, -1), { start: '2026-02-01', end: '2026-02-28' });
  assert.deepEqual(stepPeriod('this_quarter', { start: '2026-10-01', end: '2026-12-31' }, 1), { start: '2027-01-01', end: '2027-03-31' });
  assert.deepEqual(stepPeriod('this_fy', { start: '2026-04-01', end: '2027-03-31' }, -1), { start: '2025-04-01', end: '2026-03-31' }, 'Indian FY');
  assert.deepEqual(stepPeriod('custom', { start: '2026-04-01', end: '2026-05-31' }, 1), { start: '2026-06-01', end: '2026-07-31' }, 'two whole months');
  assert.deepEqual(stepPeriod('custom', { start: '2026-03-30', end: '2026-04-05' }, 1), { start: '2026-04-06', end: '2026-04-12' }, 'seven days');
});

test('saved views: one default per screen + tab, toggled off again; the flag survives a reload', () => {
  localStorage.clear();
  saveView({ name: 'TB big', route: '/books', tab: 'tb', preset: 'this_fy' }, new Date(2026, 9, 1));
  saveView({ name: 'TB small', route: '/books', tab: 'tb', preset: 'this_month' }, new Date(2026, 9, 2));
  const [a, b] = loadViews();
  setDefaultView(a.id);
  assert.equal(defaultView('/books', 'tb')?.id, a.id);
  setDefaultView(b.id);
  assert.equal(defaultView('/books', 'tb')?.id, b.id, 'the other loses the flag');
  assert.equal(loadViews().filter((v) => v.default).length, 1);
  setDefaultView(b.id);
  assert.equal(defaultView('/books', 'tb'), undefined, 'again = off');
  assert.equal(defaultView('/books', 'pnl'), undefined);
});

test('C is built; report-row delete / cancel and the cut rows stay hidden; Alt+2 duplicate is live', () => {
  assert.ok(BUILT.has('C'));
  for (const id of ['delete.row', 'cancel.row', 'basis']) {
    assert.ok(HELD.has(id), id);
    assert.ok(!sheetRows(null).some((r) => r.id === id), `${id} not in the cheat sheet`);
  }
  for (const id of ['filter', 'select', 'hide', 'unhide', 'views', 'saveView', 'stepNext', 'printReport', 'export', 'insert', 'dup.row']) {
    assert.ok(isBuilt(KEY_ROWS.find((r) => r.id === id)!), `${id} built`);
  }
  assert.ok(!KEY_ROWS.some((r) => r.pkg === 'C' && r.scope === 'global'), 'C claims no global key (stub unchanged)');
});
