/** MF-D5 Schedule III split: sums to the valuer total, default classes, WIP godown, memo only in the working, note unchanged without rows. */
import './helpers/shim.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { classOf, defaultClasses, inventorySplit, noteRows, wipStatement } from '../src/lib/mfg/mf-inventories.ts';
import { inventoryValuer } from '../src/lib/ledger/closing-stock.ts';
import { buildLedger, loadLedgerInput, loadStockValuer, saveBooksBegin } from '../src/lib/ledger/index.ts';
import { saveClosingStockConfig } from '../src/lib/ledger/closing-stock.ts';
import { buildAnnualPack } from '../src/lib/ledger/annual-pack.ts';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import type { StockPosition } from '../src/lib/inventory.ts';

const pos = (id: string, rows: [string, number, number][], extra = {}) => ({ item: { id, name: id, track_stock: true, ...extra }, ledger: rows.map(([date, balance, value]) => ({ date, balance, value, kind: 'purchase' })) }) as unknown as StockPosition;
const positions = [
  pos('steel', [['2026-01-10', 100, 6000], ['2026-04-10', 80, 4800]]),
  pos('bracket', [['2026-02-01', 10, 1500]]),
  pos('turnings', [['2026-02-01', 5, 125.5]]),
  pos('film', [['2026-02-01', 50, 250]], { mf_inv_class: 'packing' }),
  pos('pens', [['2026-02-01', 3, 30]]),
  pos('neg', [['2026-02-01', -2, -40]]),
];
const boms = [{ item_id: 'bracket', components: [{ item_id: 'steel' }, { item_id: 'film' }], outputs: [{ item_id: 'turnings', kind: 'scrap' }] }];

test('default classes from the BOM role; an explicit class wins', () => {
  const d = defaultClasses(positions.map((p) => p.item), boms);
  assert.deepEqual(['steel', 'bracket', 'turnings', 'pens', 'film'].map((id) => classOf(positions.find((p) => p.item.id === id)!.item, d)), ['raw', 'finished', 'scrap', 'traded', 'packing']);
});

test('the split sums to the valuer total; WIP-godown stock moves to WIP; heads in Schedule III order', () => {
  const d = defaultClasses(positions.map((p) => p.item), boms);
  const s = inventorySplit(positions, '2026-03-31', (i) => classOf(i, d), (id) => (id === 'steel' ? 25 : 0), 12345);
  assert.equal(s.total, inventoryValuer(positions).value('2026-03-31'));
  assert.deepEqual(s.rows.filter((r) => r.value).map((r) => [r.cls, r.value]), [['raw', 450000], ['wip', 150000], ['finished', 150000], ['traded', 3000], ['packing', 25000], ['scrap', 12550]]);
  assert.equal(s.rows[0].label, 'Raw materials');
  assert.equal(s.memoConversion, 12345, 'memo kept apart from the total');
  const s2 = inventorySplit(positions, '2026-04-30', (i) => classOf(i, d));
  assert.equal(s2.total, inventoryValuer(positions).value('2026-04-30'));
  assert.deepEqual(noteRows(s2, s).map((r) => r.label), ['Raw materials', 'Work-in-progress', 'Finished goods', 'Stock-in-trade (goods acquired for trading)', 'Others: packing materials', 'Others: scrap']);
});

test('inventory note: unchanged without rows; with rows the sub-heads, a balancing row and the balance-sheet total', () => {
  resetStorage();
  installSettings();
  saveBooksBegin('2025-04-01');
  saveClosingStockConfig({ mode: 'manual', entries: [{ date: '2026-03-31', value: 10_000_00 }] });
  const build = (rows?: { label: string; cur: number; prev: number }[]) => {
    const ledger = buildLedger(loadLedgerInput(undefined, '2026-04-30'));
    return buildAnnualPack({ ledger, stock: loadStockValuer(), fyStartYear: 2025, assets: [], vendors: [], invoices: [], company: { name: 'X' }, generatedOn: '2026-04-30', ...(rows ? { inventoryRows: rows } : {}) }).notes.find((n) => n.id === 'inventory')!.tables;
  };
  const plain = build();
  assert.deepEqual(plain[0].rows, [['Stock-in-trade / goods (at cost or net realisable value, whichever is lower)', 10_000_00, 0]]);
  assert.deepEqual(build([]), plain);
  assert.deepEqual(build([{ label: 'Raw materials', cur: 6_000_00, prev: 0 }, { label: 'Finished goods', cur: 3_000_00, prev: 0 }])[0].rows, [
    ['Raw materials', 6_000_00, 0], ['Finished goods', 3_000_00, 0], ['Other inventories (ledger balances / typed closing stock)', 1_000_00, 0], ['Total (at cost or net realisable value, whichever is lower)', 10_000_00, 0],
  ]);
});

test('year-end WIP statement: open orders only, material held at average cost plus memo conversion', () => {
  const orders = [{ id: 'o1', number: 'WO/1', item_id: 'bracket', status: 'in_progress' }, { id: 'o2', number: 'WO/2', item_id: 'bracket', status: 'closed' }];
  const prog = () => ({ issued: new Map([['steel', 20]]), returned: new Map([['steel', 2]]), held: new Map([['steel', 8]]), output: 5 });
  const s = wipStatement(orders, prog, () => 6000, (id) => id, (id) => (id === 'o1' ? 50000 : 0));
  assert.deepEqual(s.rows.map((r) => [r.number, r.issued, r.wipMaterial, r.memoConversion, r.total]), [['WO/1', 108000, 48000, 50000, 98000]]);
});
