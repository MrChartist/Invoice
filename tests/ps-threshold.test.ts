/** R14 PS-C5: registration threshold card — turnover parts, special-category limit, warnings, FY boundary (local days). */
import './helpers/shim.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inTimeZones, ZONES } from './helpers/shim.ts';
import { fyOf, thresholdCard } from '../src/lib/prof/ps-threshold.ts';
import { REGISTRATION_THRESHOLD_RULES } from '../src/lib/prof-rules.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';

const doc = (id: string, issue_date: string, taxable_value: number, over: Partial<InvoiceRecord> = {}): Partial<InvoiceRecord> =>
  ({ id, doc_type: 'INVOICE', status: 'Sent', issue_date, taxable_value, total: taxable_value, currency: 'INR', place_of_supply: '27', ...over });

test('exports count at INR value; credit notes reduce; drafts, quotes and other FYs do not', () => {
  const docs = [
    doc('a', '2026-04-01', 800000),
    doc('b', '2026-06-10', 5000, { currency: 'USD', exchange_rate: 84, supply_type: 'EXPORT_LUT', place_of_supply: '96' }), // ₹4.2 lakh
    doc('cn', '2026-07-01', 20000, { doc_type: 'CREDIT_NOTE' }),
    doc('d', '2026-07-02', 900000, { status: 'Draft' }),
    doc('q', '2026-07-02', 900000, { doc_type: 'QUOTATION' }),
    doc('old', '2026-03-31', 1500000),
    doc('bos', '2026-08-01', 220000, { doc_type: 'BILL_OF_SUPPLY' }),
  ];
  const c = thresholdCard(docs, '2026-10-27', '27');
  assert.deepEqual([c.start, c.end, c.turnover, c.exports, c.limit, c.pct, c.level], ['2026-04-01', '2027-03-31', 1420000, 420000, 2000000, 71, 'ok']);
});

test('special-category States: ₹10 lakh; warnings at 80 % and 100 % with the crossing day', () => {
  const docs = [doc('a', '2026-05-01', 850000), doc('b', '2026-09-01', 200000)];
  const mz = thresholdCard(docs, '2026-10-27', '15');
  assert.deepEqual([mz.limit, mz.level, mz.crossedOn], [1000000, 'over', '2026-09-01']);
  assert.equal(thresholdCard([doc('a', '2026-05-01', 1650000)], '2026-10-27', '27').level, 'warn');
  assert.equal(thresholdCard([doc('a', '2026-05-01', 1590000)], '2026-10-27', '27').level, 'ok');
  assert.ok(REGISTRATION_THRESHOLD_RULES.every((r) => r.from && r.source && typeof r.verified === 'boolean'));
});

test('FY boundary is a local day in every time zone', () => {
  inTimeZones(ZONES, () => {
    assert.deepEqual(fyOf('2027-03-31'), { start: '2026-04-01', end: '2027-03-31' });
    assert.deepEqual(fyOf('2027-04-01'), { start: '2027-04-01', end: '2028-03-31' });
    assert.equal(thresholdCard([doc('a', '2027-03-31', 100), doc('b', '2027-04-01', 7)], '2027-04-01').turnover, 7);
  });
});
