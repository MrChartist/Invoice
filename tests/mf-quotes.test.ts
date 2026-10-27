/** MF-B2 weight-based job quotes: price breaks with set-up amortised, scrap credit, quotation drafts, won hand-over. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings, clientMH } from './helpers/world.ts';
import { clearOverrides } from '../src/lib/period-lock.ts';
import { localDb } from '../src/lib/localDb.ts';
import { stockDb } from '../src/lib/inventory.ts';
import { loadQuotes, makeQuotations, markWon, quoteBreak, quoteBreaks, removeQuote, saveQuote, validateQuote } from '../src/lib/mfg/mf-quotes.ts';
import type { JobQuote } from '../src/types/mfg-r13.ts';

beforeEach(() => {
  resetStorage();
  clearOverrides();
  installSettings();
});

const flange: Omit<JobQuote, 'id' | 'status'> = {
  date: '2026-10-27', part: 'Flange 300', material: 'MS plate 20 mm', density: 7.85, blank: { kind: 'ring', od: 300, id: 160, t: 20 }, net_kg: 2.9,
  material_rate: 62, scrap_rate: 32, ops: [{ name: 'VMC', hours: 0.4, setup_h: 2, rate: 900 }], outside: [{ name: 'Zinc plating', basis: 'kg', rate: 18 }],
  packing: 5, freight: 0, overhead_pct: 10, margin_pct: 12, breaks: [100, 500],
};

test('a break: material on gross kg, set-up spread over the quantity, outside on net kg, scrap credit, overhead and margin', () => {
  const b = quoteBreak(flange, 100);
  assert.equal(b.material, 492.34); // 7.941 × 62
  assert.equal(b.conversion, 360);
  assert.equal(b.setup, 18); // 2 h × 900 ÷ 100
  assert.equal(b.outside, 52.2); // 2.9 × 18
  assert.equal(b.scrap_credit, 161.31); // 5.041 × 32
  const base = 492.342 + 360 + 18 + 52.2 + 5 - 161.312;
  assert.equal(b.cost, Math.round(base * 1.1 * 100) / 100);
  assert.equal(b.price, Math.round(base * 1.1 * 1.12 * 100) / 100);
  const [a, c] = quoteBreaks(flange);
  assert.ok(c.price < a.price, 'a bigger break carries less set-up per piece');
  assert.ok(Math.abs(a.price - c.price - (18 - 3.6) * 1.1 * 1.12) < 0.02);
});

test('validation', () => {
  assert.match(validateQuote({ ...flange, breaks: [] }), /quantity breaks/);
  assert.match(validateQuote({ ...flange, breaks: [1, 2, 3, 4, 5] }), /1 to 4/);
  assert.match(validateQuote({ ...flange, ops: [{ name: '', hours: 1, rate: 1 }] }), /operation/);
  assert.equal(validateQuote(flange), '');
});

test('make quotation: one QUOTATION draft per break with the drawing / revision on the line; won → dated standard cost', () => {
  localDb.clients.upsert({ ...clientMH, id: 'c1' } as never);
  stockDb.saveItem({ id: 'fl', name: 'Flange 300', unit: 'NOS', hsn: '7307', tax_rate: 18, track_stock: true, opening_qty: 0, opening_rate: 0, reorder_level: 0 } as never);
  stockDb.saveItem({ id: 'ms', name: 'MS plate 20', unit: 'KG', track_stock: true, opening_qty: 0, opening_rate: 0, reorder_level: 0, standard_costs: [{ from: '2026-04-01', rate: 58 }] } as never);
  const q = saveQuote({ ...flange, client_id: 'c1', item_id: 'fl', rev: 'C' });
  const docs = makeQuotations(q.id, stockDb.items(), '1145-B');
  assert.equal(docs.length, 2);
  for (const d of docs) {
    assert.equal(d.doc_type, 'QUOTATION');
    assert.equal(d.client.name, clientMH.name);
    assert.equal(d.items[0].name, 'Flange 300');
    assert.deepEqual(Object.values(d.mf!.lines!)[0], { drawing: '1145-B', rev: 'C' });
    assert.equal(d.mf!.kind, 'drawing');
  }
  assert.deepEqual(docs.map((d) => d.items[0].quantity), [100, 500]);
  assert.equal(loadQuotes()[0].status, 'quoted');
  assert.deepEqual(loadQuotes()[0].quote_ids, docs.map((d) => d.id));
  markWon(q.id, 'ms');
  assert.equal(loadQuotes()[0].status, 'won');
  assert.deepEqual(stockDb.items().find((i) => i.id === 'ms')!.standard_costs, [{ from: '2026-04-01', rate: 58 }, { from: '2026-10-27', rate: 62 }]);
  removeQuote(q.id);
  assert.equal(loadQuotes().length, 0);
});
