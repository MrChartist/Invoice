/** AG-B5 household milk cards: month grid, defaults, skips, invoice totals, one bill per card per month. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { billCard, billMonth, cardQty, cardTotals, copyCards, deleteCard, loadCards, monthDays, saveCard } from '../src/lib/agri/ag-milk-cards.ts';

let asha = '';
beforeEach(() => {
  resetStorage();
  installSettings();
  asha = localDb.clients.upsert({ name: 'Asha' });
});
const card = (over = {}) => saveCard({ client_id: asha, client_name: 'Asha', month: '2026-10', milk: 'buffalo', rate: 64, default_qty: 1, days: {}, ...over });

test('month grid: default fills, typed days override, 0 skips', () => {
  assert.equal(monthDays('2026-10'), 31);
  assert.equal(monthDays('2028-02'), 29);
  const c = card({ days: { 3: 0, 4: 0, 10: 1.5, 40: 9 } });
  assert.equal(cardQty(c, 1), 1);
  assert.equal(cardQty(c, 3), 0);
  assert.equal(cardQty(c, 10), 1.5);
  assert.equal(c.days['40'], undefined, 'days outside the month are dropped');
  assert.deepEqual(cardTotals(c), { days: 29, litres: 29.5, amount: 1888 });
});

test('bill month: one bill of supply per card with "31 days · 29.5 L"; re-billing refused; billed card read-only', () => {
  const c = card({ days: { 3: 0, 4: 0, 10: 1.5 } });
  const inv = billCard(c.id, '2026-11-01');
  assert.equal(inv.doc_type, 'BILL_OF_SUPPLY');
  assert.equal(inv.total, 1888);
  assert.equal(inv.items[0].quantity, 29.5);
  assert.equal(inv.ag?.lines?.[inv.items[0].id]?.text, '29 days · 29.5 L');
  assert.throws(() => billCard(c.id, '2026-11-01'), /already billed/);
  assert.throws(() => saveCard({ ...loadCards()[0], default_qty: 2 }), /billed/);
  assert.throws(() => deleteCard(c.id), /billed/);
  assert.throws(() => card(), /already has a card/);
  const r = billMonth('2026-10', '2026-11-01');
  assert.equal(r.bills.length, 0, 'nothing left to bill');
});

test('copy last month; empty cards are skipped by Bill month', () => {
  card();
  const ravi = localDb.clients.upsert({ name: 'Ravi' });
  saveCard({ client_id: ravi, client_name: 'Ravi', month: '2026-10', milk: 'cow', rate: 56, default_qty: 0, days: {} });
  assert.equal(copyCards('2026-10', '2026-11'), 2);
  assert.equal(copyCards('2026-10', '2026-11'), 0, 'existing cards kept');
  const r = billMonth('2026-11', '2026-12-01');
  assert.equal(r.bills.length, 1);
  assert.equal(r.bills[0].total, 64 * 30);
  assert.match(r.skipped[0], /Ravi: No milk/);
});
