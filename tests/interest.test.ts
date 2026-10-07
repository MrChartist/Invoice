import './helpers/shim.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage, inTimeZones, ZONES } from './helpers/shim.ts';
import {
  DEFAULT_LATE_FEE,
  LATE_FEE_KEY,
  buildInterestItem,
  clearProfileLateFee,
  computeInterest,
  describeBasis,
  getLateFeeConfig,
  hasProfileLateFee,
  interestInputFor,
  saveLateFeeConfig,
  sanitizeLateFee,
  type InterestInput,
  type LateFeeConfig,
} from '../src/lib/interest.ts';
import type { DocLink } from '../src/lib/documents.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';

const ANNUAL: LateFeeConfig = { enabled: true, mode: 'annual', rate: 18, grace_days: 0 };

function inv(over: Partial<InterestInput> = {}): InterestInput {
  return { doc_type: 'TAX_INVOICE', status: 'Sent', due_date: '2026-09-01', total: 10000, ...over };
}

test('defaults: off, no rate assumed', () => {
  resetStorage();
  assert.deepEqual(getLateFeeConfig(), DEFAULT_LATE_FEE);
  assert.equal(DEFAULT_LATE_FEE.enabled, false);
  assert.equal(DEFAULT_LATE_FEE.rate, 0);
  const r = computeInterest(inv(), DEFAULT_LATE_FEE, '2026-10-01');
  assert.equal(r.eligible, false);
  assert.equal(r.reason, 'disabled');
  assert.equal(r.amount, 0);
  // enabled but no rate typed -> still nothing
  assert.equal(computeInterest(inv(), { ...DEFAULT_LATE_FEE, enabled: true }, '2026-10-01').reason, 'no_rate');
});

test('annual simple interest: 10,000 @ 18% for 30 days = 147.95', () => {
  const r = computeInterest(inv(), ANNUAL, '2026-10-01');
  assert.equal(r.eligible, true);
  assert.equal(r.days_late, 30);
  assert.equal(r.chargeable_days, 30);
  assert.equal(r.amount, 147.95);
  assert.equal(r.segments.length, 1);
  assert.equal(r.segments[0].from, '2026-09-02');
  assert.equal(r.segments[0].to, '2026-10-01');
  assert.equal(r.accrues_from, '2026-09-01');
  assert.equal(r.settled, false);
  assert.equal(r.outstanding, 10000);
});

test('not yet due, or due today: zero, but still eligible', () => {
  assert.equal(computeInterest(inv(), ANNUAL, '2026-09-01').amount, 0);
  assert.equal(computeInterest(inv(), ANNUAL, '2026-08-01').amount, 0);
  assert.equal(computeInterest(inv(), ANNUAL, '2026-08-01').days_late, 0);
  assert.equal(computeInterest(inv(), ANNUAL, '2026-09-02').amount, 4.93);
});

test('grace days are interest-free, not back-dated', () => {
  const r = computeInterest(inv(), { ...ANNUAL, grace_days: 7 }, '2026-10-01');
  assert.equal(r.chargeable_days, 23);
  assert.equal(r.days_late, 30);
  assert.equal(r.amount, 113.42);
  assert.equal(computeInterest(inv(), { ...ANNUAL, grace_days: 7 }, '2026-09-08').amount, 0);
  assert.equal(computeInterest(inv(), { ...ANNUAL, grace_days: 7 }, '2026-09-09').amount, 4.93);
});

test('monthly flat: 2% a month, pro-rated on a 30-day month', () => {
  const m: LateFeeConfig = { enabled: true, mode: 'monthly_flat', rate: 2, grace_days: 0 };
  assert.equal(computeInterest(inv(), m, '2026-10-01').amount, 200);
  assert.equal(computeInterest(inv(), m, '2026-09-16').amount, 100);
});

test('part payments: each interval is charged on its own balance', () => {
  const r = computeInterest(
    inv({ payments: [{ date: '2026-09-11', amount: 4000 }] }),
    ANNUAL,
    '2026-10-01',
  );
  assert.equal(r.segments.length, 2);
  // 10 days on 10,000 (2 Sep..11 Sep, the payment day still counts), then 20 days on 6,000
  assert.deepEqual(
    r.segments.map((s) => [s.from, s.to, s.days, s.balance]),
    [
      ['2026-09-02', '2026-09-11', 10, 10000],
      ['2026-09-12', '2026-10-01', 20, 6000],
    ],
  );
  assert.deepEqual(r.segments.map((s) => s.amount), [49.32, 59.18]);
  assert.equal(r.amount, 108.5);
  assert.equal(r.outstanding, 6000);
  assert.equal(r.settled, false);
  // rows always add up to the total
  assert.equal(Math.round(r.segments.reduce((s, x) => s + x.amount, 0) * 100) / 100, r.amount);
});

test('settled invoices stop at the payment date, whatever "today" is', () => {
  const paid = inv({ status: 'Paid', payments: [{ date: '2026-09-06', amount: 10000 }] });
  const a = computeInterest(paid, ANNUAL, '2026-09-20');
  const b = computeInterest(paid, ANNUAL, '2027-03-01');
  assert.equal(a.amount, b.amount);
  assert.equal(a.amount, 24.66); // 5 days late
  assert.equal(a.days_late, 5);
  assert.equal(a.settled, true);
  assert.equal(a.settled_on, '2026-09-06');
  assert.equal(a.outstanding, 0);
  // paid on or before the due date: nothing
  const early = computeInterest(inv({ status: 'Paid', payments: [{ date: '2026-08-30', amount: 10000 }] }), ANNUAL, '2026-12-01');
  assert.equal(early.amount, 0);
  assert.equal(early.days_late, 0);
  assert.equal(early.settled, true);
});

test('payment dated after the as-of day is not applied yet', () => {
  const r = computeInterest(inv({ payments: [{ date: '2026-10-20', amount: 10000 }] }), ANNUAL, '2026-10-01');
  assert.equal(r.amount, 147.95);
  assert.equal(r.settled, false);
});

test('credit notes reduce the balance from their issue date', () => {
  const r = computeInterest(inv({ credits: [{ date: '2026-09-11', amount: 2000 }] }), ANNUAL, '2026-10-01');
  assert.deepEqual(r.segments.map((s) => s.balance), [10000, 8000]);
  assert.equal(r.outstanding, 8000);
  // credit that covers the whole invoice settles it
  const full = computeInterest(inv({ credits: [{ date: '2026-09-11', amount: 10000 }] }), ANNUAL, '2026-10-01');
  assert.equal(full.settled, true);
  assert.equal(full.amount, 49.32);
  // payment + credit together, over-payment is clamped (no negative interest)
  const over = computeInterest(
    inv({ payments: [{ date: '2026-09-06', amount: 9000 }], credits: [{ date: '2026-09-08', amount: 5000 }] }),
    ANNUAL,
    '2026-10-01',
  );
  assert.ok(over.amount > 0 && over.settled);
  assert.equal(over.outstanding, 0);
});

test('TDS withheld by the customer is not part of the interest base', () => {
  const r = computeInterest(inv({ tds_amount: 1000 }), ANNUAL, '2026-10-01');
  assert.equal(r.principal, 9000);
  assert.equal(r.amount, 133.15);
});

test('cap stops the total at a share of the principal', () => {
  const r = computeInterest(inv(), { ...ANNUAL, cap_percent: 1 }, '2026-10-01');
  assert.equal(r.amount, 100);
  assert.equal(r.capped, true);
  assert.equal(r.cap_amount, 100);
  const uncapped = computeInterest(inv(), { ...ANNUAL, cap_percent: 5 }, '2026-10-01');
  assert.equal(uncapped.capped, false);
  assert.equal(uncapped.amount, 147.95);
});

test('compounding is opt-in and only ever raises the figure', () => {
  const simple = computeInterest(inv(), ANNUAL, '2027-09-01');
  const comp = computeInterest(inv(), { ...ANNUAL, compounding: true }, '2027-09-01');
  assert.equal(simple.amount, 1800); // 365 days exactly = 18%
  assert.ok(comp.amount > simple.amount && comp.amount < 2000);
  const short = computeInterest(inv(), { ...ANNUAL, compounding: true }, '2026-09-02');
  assert.equal(short.amount, 4.93);
});

test('what is not an overdue sales invoice is never charged', () => {
  for (const [over, reason] of [
    [{ doc_type: 'QUOTATION' as const }, 'not_invoice'],
    [{ doc_type: 'CREDIT_NOTE' as const }, 'not_invoice'],
    [{ doc_type: 'DELIVERY_CHALLAN' as const }, 'not_invoice'],
    [{ status: 'Draft' as const }, 'draft_or_cancelled'],
    [{ status: 'Cancelled' as const }, 'draft_or_cancelled'],
    [{ due_date: '' }, 'no_due_date'],
    [{ total: 0 }, 'nothing_due'],
  ] as const) {
    const r = computeInterest(inv(over), ANNUAL, '2026-10-01');
    assert.equal(r.eligible, false, reason);
    assert.equal(r.reason, reason);
    assert.equal(r.amount, 0);
  }
});

test('result does not depend on the machine time zone', () => {
  inTimeZones(ZONES, (tz) => {
    const asOf = new Date(2026, 9, 1, 0, 30); // local midnight-ish
    const r = computeInterest(inv(), ANNUAL, asOf);
    assert.equal(r.amount, 147.95, tz);
    assert.equal(r.days_late, 30, tz);
  });
});

test('absurd dates cannot hang the loop', () => {
  const r = computeInterest(inv({ due_date: '1900-01-01' }), ANNUAL, '2026-10-01');
  assert.ok(r.chargeable_days <= 3660);
  assert.ok(Number.isFinite(r.amount));
});

test('config: round-trip, global vs profile override, clearing', () => {
  resetStorage();
  const saved = saveLateFeeConfig({ enabled: true, mode: 'monthly_flat', rate: 1.5, grace_days: 5, cap_percent: 10 });
  assert.deepEqual(saved, { enabled: true, mode: 'monthly_flat', rate: 1.5, grace_days: 5, cap_percent: 10 });
  assert.deepEqual(getLateFeeConfig(), saved);
  assert.deepEqual(getLateFeeConfig('p1'), saved); // inherits
  assert.equal(hasProfileLateFee('p1'), false);

  saveLateFeeConfig({ rate: 24, mode: 'annual' }, 'p1');
  assert.equal(hasProfileLateFee('p1'), true);
  assert.equal(getLateFeeConfig('p1').rate, 24);
  assert.equal(getLateFeeConfig('p1').grace_days, 5); // unspecified fields inherit
  assert.equal(getLateFeeConfig().rate, 1.5); // global untouched
  assert.equal(getLateFeeConfig('p2').rate, 1.5);

  // saving the global default keeps the overrides
  saveLateFeeConfig({ rate: 2 });
  assert.equal(getLateFeeConfig('p1').rate, 24);
  clearProfileLateFee('p1');
  assert.equal(getLateFeeConfig('p1').rate, 2);
  assert.ok(LATE_FEE_KEY.endsWith('_late_fee'));
});

test('config: garbage and hand-edited backups are coerced, never trusted', () => {
  const c = sanitizeLateFee({ enabled: 'yes', mode: 'weekly', rate: -5, grace_days: 'x', cap_percent: 0 });
  assert.deepEqual(c, DEFAULT_LATE_FEE);
  assert.equal(sanitizeLateFee({ rate: 1e9 }).rate, 100);
  assert.equal(sanitizeLateFee({ grace_days: 9999 }).grace_days, 365);
  assert.equal(sanitizeLateFee({ grace_days: 2.6 }).grace_days, 3);
  resetStorage();
  localStorage.setItem(LATE_FEE_KEY, '{not json');
  assert.deepEqual(getLateFeeConfig(), DEFAULT_LATE_FEE);
  localStorage.setItem(LATE_FEE_KEY, '[1,2]');
  assert.deepEqual(getLateFeeConfig(), DEFAULT_LATE_FEE);
});

test('interestInputFor pulls payments and non-cancelled credit notes of that invoice only', () => {
  const base = { doc_type: 'TAX_INVOICE', status: 'Sent', due_date: '2026-09-01', total: 10000 } as InvoiceRecord;
  const invoice = { ...base, id: 'a', invoice_number: 'INV/1' } as InvoiceRecord;
  const credit = { ...base, id: 'cn1', doc_type: 'CREDIT_NOTE', issue_date: '2026-09-11', total: 2000 } as InvoiceRecord;
  const cancelled = { ...credit, id: 'cn2', status: 'Cancelled' } as InvoiceRecord;
  const other = { ...credit, id: 'cn3' } as InvoiceRecord;
  const links: DocLink[] = [
    { id: 'l1', from_id: 'a', to_id: 'cn1', relation: 'credit_note', created_at: '' },
    { id: 'l2', from_id: 'a', to_id: 'cn2', relation: 'credit_note', created_at: '' },
    { id: 'l3', from_id: 'b', to_id: 'cn3', relation: 'credit_note', created_at: '' },
  ];
  const input = interestInputFor(
    invoice,
    [
      { invoice_id: 'a', amount: 1000, date: '2026-09-05' },
      { invoice_id: 'b', amount: 777, date: '2026-09-05' },
    ],
    links,
    [invoice, credit, cancelled, other],
  );
  assert.deepEqual(input.payments, [{ date: '2026-09-05', amount: 1000 }]);
  assert.deepEqual(input.credits, [{ date: '2026-09-11', amount: 2000 }]);
});

test('invoice line is built only on request, from a positive result, with no tax assumed', () => {
  const r = computeInterest(inv(), ANNUAL, '2026-10-01');
  const item = buildInterestItem(r, ANNUAL, 'INV/FY26-27/0004');
  assert.ok(item);
  assert.equal(item.rate, 147.95);
  assert.equal(item.amount, 147.95);
  assert.equal(item.quantity, 1);
  assert.equal(item.tax_rate, 0);
  assert.match(item.name, /INV\/FY26-27\/0004/);
  assert.match(item.description ?? '', /18% p\.a\./);
  assert.match(item.description ?? '', /as per agreed terms/);
  assert.equal(buildInterestItem(computeInterest(inv(), ANNUAL, '2026-08-01'), ANNUAL, 'X'), null);
  assert.equal(buildInterestItem(computeInterest(inv({ status: 'Draft' }), ANNUAL, '2026-10-01'), ANNUAL, 'X'), null);
  assert.equal(buildInterestItem(r, ANNUAL, 'X', { taxRate: 18 })?.tax_rate, 18);
});

test('describeBasis spells out every assumption', () => {
  assert.match(describeBasis(ANNUAL), /18% p\.a\., simple interest/);
  const full = describeBasis({ enabled: true, mode: 'monthly_flat', rate: 2, grace_days: 1, cap_percent: 10, compounding: true });
  assert.match(full, /2% per month/);
  assert.match(full, /1 grace day\b/);
  assert.match(full, /capped at 10%/);
  assert.match(full, /compounded/);
});
