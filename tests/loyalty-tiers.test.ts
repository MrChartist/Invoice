/**
 * R4-B2 loyalty tiers and points expiry: tier boundaries on the rolling 365-day window, multiplier rounding, FIFO expiry
 * with partial redemption, a mid-year tier change (old bills keep old tiers), the liability report and regression
 * equality with the single-rate ledger when no tiers / expiry are set.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addMonths, appendTierSet, multiplyPoints, nextExpiry, nextTier, rollingSpend, runLots, tierFor, tiersOn, type LoyaltyTier } from '../src/lib/retail/loyalty-tiers.ts';
import { loyaltyLiability, pointsBalance, pointsLedger, type LoyaltyProgram } from '../src/lib/loyalty.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';

const TIERS: LoyaltyTier[] = [
  { id: 's', name: 'Silver', min_spend_12m: 10000, multiplier: 1.5 },
  { id: 'g', name: 'Gold', min_spend_12m: 50000, multiplier: 2 },
];
const BASE: LoyaltyProgram = { enabled: true, rules: [{ from: '2000-01-01', points_per_100: 1, point_value: 0.5 }], min_redeem: 0 };

let n = 0;
const bill = (date: string, taxable: number, extra: Partial<InvoiceRecord> = {}): InvoiceRecord => ({
  id: `i${++n}`, invoice_number: `INV/${String(n).padStart(4, '0')}`, doc_type: 'INVOICE', status: 'Sent', issue_date: date,
  client: { name: 'Asha' }, taxable_value: taxable, currency: 'INR', ...extra,
} as unknown as InvoiceRecord);

test('tier boundaries on the rolling 365-day window (the bill itself excluded)', () => {
  const spend = [{ date: '2025-06-01', amount: 6000 }, { date: '2026-01-10', amount: 4000 }, { date: '2026-03-01', amount: -500 }];
  assert.equal(rollingSpend(spend, '2026-05-31'), 9500);
  assert.equal(tierFor(TIERS, 9500), undefined);
  assert.equal(tierFor(TIERS, 10000)?.name, 'Silver', 'boundary is inclusive');
  assert.equal(tierFor(TIERS, 50000)?.name, 'Gold');
  assert.equal(rollingSpend(spend, '2026-06-01'), 9500, 'still inside on the 365th day');
  assert.equal(rollingSpend(spend, '2026-06-02'), 3500, '2025-06-01 drops out after 365 days');
  assert.equal(rollingSpend(spend, '2026-01-10'), 6000, 'a bill does not count towards its own tier');
  assert.deepEqual(nextTier(TIERS, 9500), { tier: TIERS[0], need: 500 });
  assert.equal(nextTier(TIERS, 60000), undefined);
});

test('multiplier rounds down; negative (credit note) keeps its sign', () => {
  assert.equal(multiplyPoints(7, 1.5), 10);
  assert.equal(multiplyPoints(-7, 1.5), -10);
  assert.equal(multiplyPoints(3, 0), 3, 'a zero multiplier means base points');
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2026-11-15', 12), '2027-11-15');
});

test('FIFO expiry with partial redemption: oldest lot used first, the rest lapses on its date', () => {
  const ev = [
    { date: '2026-01-10', ref: 'A', earned: 100, redeemed: 0 },
    { date: '2026-03-10', ref: 'B', earned: 50, redeemed: 0 },
    { date: '2026-04-01', ref: 'C', earned: 0, redeemed: 70 },
  ];
  const { rows, lots } = runLots(ev, 6, '2026-09-30');
  const expired = rows.filter((r) => r.kind === 'expired');
  assert.deepEqual(expired.map((r) => [r.date, r.expired]), [['2026-07-10', 30], ['2026-09-10', 50]]);
  assert.equal(lots.length, 0);
  assert.equal(rows.find((r) => r.ref === 'A')!.expires_on, '2026-07-10');
  // Before the first expiry only the redemption has happened.
  const mid = runLots(ev, 6, '2026-07-09');
  assert.equal(mid.rows.filter((r) => r.kind === 'expired').length, 0);
  assert.deepEqual(nextExpiry(mid.lots, '2026-07-09'), { date: '2026-07-10', points: 30 });
  // A debit larger than the open lots is covered by the next earning first.
  const deficit = runLots([{ date: '2026-01-01', ref: 'x', earned: 0, redeemed: 20 }, { date: '2026-02-01', ref: 'y', earned: 50, redeemed: 0 }], 3, '2026-06-01');
  assert.deepEqual(deficit.rows.filter((r) => r.kind === 'expired').map((r) => r.expired), [30]);
});

test('ledger with tiers and expiry: tier multiplier per bill date, expired rows, balances', () => {
  n = 0;
  const program: LoyaltyProgram = { ...BASE, tiers: [{ from: '2000-01-01', tiers: TIERS }], expiry_months: 12 };
  const invs = [
    bill('2025-05-01', 12000), // base 120, no tier (no earlier spend)
    bill('2025-08-01', 1000), // spend before = 12000 → Silver: 10 × 1.5 = 15
    bill('2026-05-02', 1000), // window from 2025-05-02: only 1000 → no tier: 10
    bill('2026-06-01', 200, { loyalty_redeem: { points: 40, value: 20 } }), // redeems 40 (from the 2025-08 lot after expiry of the first)
  ];
  const l = pointsLedger('asha', invs, [], program, '2026-12-31');
  assert.deepEqual(l.filter((r) => r.kind !== 'expired').map((r) => [r.ref, r.earned, r.tier ?? '']), [
    ['INV/0001', 120, ''], ['INV/0002', 15, 'Silver'], ['INV/0003', 10, ''], ['INV/0004', 2, ''],
  ]);
  // 2026-05-01: 120 lapse. 2026-06-01: redeem 40 from the 2025-08 lot (15) then 2026-05 lot (10) → deficit 15 covered by INV/0004's 2.
  assert.deepEqual(l.filter((r) => r.kind === 'expired').map((r) => [r.date, r.expired]), [['2026-05-01', 120]]);
  assert.equal(l[l.length - 1].balance, 120 + 15 + 10 + 2 - 40 - 120);
});

test('a tier change mid-year: older bills keep the tiers of their date', () => {
  n = 0;
  const tiers = appendTierSet([{ from: '2000-01-01', tiers: TIERS }], '2026-07-01', [{ id: 's', name: 'Silver', min_spend_12m: 10000, multiplier: 3 }]);
  assert.equal(tiersOn(tiers, '2026-06-30')[0].multiplier, 1.5);
  assert.equal(tiersOn(tiers, '2026-07-01')[0].multiplier, 3);
  const program: LoyaltyProgram = { ...BASE, tiers };
  const invs = [bill('2026-01-01', 20000), bill('2026-06-15', 1000), bill('2026-07-15', 1000)];
  const l = pointsLedger('Asha', invs, [], program, '2026-12-31');
  assert.deepEqual(l.map((r) => r.earned), [200, 15, 30]);
});

test('regression: without tiers and expiry every balance equals the single-rate ledger', () => {
  n = 0;
  const invs = [
    bill('2024-01-01', 5000), bill('2025-02-01', 999), bill('2025-03-01', 300, { doc_type: 'CREDIT_NOTE' } as Partial<InvoiceRecord>),
    bill('2025-04-01', 2000, { loyalty_redeem: { points: 30, value: 15 } }), bill('2025-05-01', 700, { status: 'Cancelled' } as Partial<InvoiceRecord>),
  ];
  const adj = [{ id: 'a1', party: 'asha', name: 'Asha', date: '2025-06-01', points: -5, note: 'fix' }];
  // 50 + 9 − 3 + 20 − 30 − 5 = 41, independent of the "as of" day.
  assert.equal(pointsBalance('Asha', invs, adj, BASE), 41);
  assert.equal(pointsBalance('Asha', invs, adj, BASE, undefined, '2099-01-01'), 41);
  const l = pointsLedger('Asha', invs, adj, BASE);
  assert.deepEqual(l.map((r) => r.balance), [50, 59, 56, 46, 41]);
  assert.ok(l.every((r) => !r.expired && r.kind !== 'expired'));
});

test('liability: outstanding points × point value and what lapses this month', () => {
  n = 0;
  const program: LoyaltyProgram = { ...BASE, expiry_months: 12 };
  const invs = [bill('2025-10-20', 10000), bill('2026-02-01', 4000), bill('2026-03-01', 2000, { client: { name: 'Ravi' } } as Partial<InvoiceRecord>)];
  const l = loyaltyLiability(invs, [], program, '2026-10-05');
  assert.equal(l.customers, 2);
  assert.equal(l.points, 100 + 40 + 20);
  assert.equal(l.value, 80);
  assert.equal(l.expiringPoints, 100, 'the 2025-10-20 lot lapses on 2026-10-20');
  assert.equal(l.expiringValue, 50);
});
