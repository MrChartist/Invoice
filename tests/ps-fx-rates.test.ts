/** R14 PS-C4: rate cards in a foreign currency — currency resolution and conversion on the bill date; closing-rate memo. */
import './helpers/shim.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { atClosing, cardCurrency, convertRate, entryConversions, inrPerUnit } from '../src/lib/prof/ps-fx-rates.ts';
import type { CurrencyRate } from '../src/lib/currency-rates.ts';

const rows: CurrencyRate[] = [
  { id: '1', currency: 'USD', date: '2026-10-30', rate: 84, source: 'RBI' },
  { id: '2', currency: 'USD', date: '2026-10-31', rate: 84, source: 'RBI' },
  { id: '3', currency: 'EUR', date: '2026-10-31', rate: 91, source: 'RBI' },
  { id: '4', currency: 'USD', date: '2027-03-31', rate: 86, source: 'RBI' },
];

test('card currency: ps.currency, INR when absent or invalid', () => {
  assert.equal(cardCurrency({ ps: { currency: 'usd' } }), 'USD');
  assert.equal(cardCurrency({}), 'INR');
  assert.equal(cardCurrency({ ps: { currency: 'dollars' } }), 'INR');
  assert.equal(cardCurrency(null), 'INR');
});

test('USD 55/h on a USD bill stays; into INR at the master rate of the bill date; into EUR via INR', () => {
  assert.deepEqual(convertRate(55, 'USD', 'USD', '2026-10-31', rows), { rate: 55, from: 'USD', to: 'USD' });
  assert.deepEqual(convertRate(55, 'USD', 'INR', '2026-10-31', rows), { rate: 4620, from: 'USD', to: 'INR', inr: 4620, refDate: '2026-10-31' });
  const eur = convertRate(55, 'USD', 'EUR', '2026-10-31', rows);
  assert.equal(eur.rate, Math.round((55 * 84 * 10000) / 91) / 10000);
  // INR card into a USD bill; the latest rate on or before the day is used.
  assert.equal(convertRate(4200, 'INR', 'USD', '2026-11-02', rows).rate, 50);
  assert.equal(convertRate(1, 'GBP', 'INR', '2026-10-31', rows).missing, true);
  assert.equal(inrPerUnit('USD', '2026-01-01', rows), null);
});

test('year-end memo: foreign WIP at the closing rate (PS37)', () => {
  assert.equal(atClosing(1000, 'USD', '2027-03-31', rows), 86000);
  assert.equal(atClosing(1000, 'INR', '2027-03-31', rows), 1000);
  assert.equal(atClosing(1000, 'JPY', '2027-03-31', rows), null);
});

test('pre-bill: entries on a USD work-type card billed in INR are converted; same-currency and INR cards are left out', () => {
  const wt = [{ id: 'dev', ps: { currency: 'USD' } }, { id: 'local' }];
  const out = entryConversions([{ id: 'a', hourly_rate: 55, work_type_id: 'dev' }, { id: 'b', hourly_rate: 2000, work_type_id: 'local' }, { id: 'c', hourly_rate: 2000 }], wt, 'INR', '2026-10-31', rows);
  assert.deepEqual(out.map((c) => [c.id, c.from, c.rate, c.original, c.refDate]), [['a', 'USD', 4620, 55, '2026-10-31']]);
  assert.deepEqual(entryConversions([{ id: 'a', hourly_rate: 55, work_type_id: 'dev' }], wt, 'USD', '2026-10-31', rows), []);
  assert.equal(entryConversions([{ id: 'b', hourly_rate: 4200, work_type_id: 'local' }], wt, 'USD', '2026-11-02', rows)[0].rate, 50);
});
