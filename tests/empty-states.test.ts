/** R6-B3: the "is this screen empty?" predicates behind the first-step empty states. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { booksEmpty, distributionEmpty, exportsState, practiceEmpty, reconcileEmpty, reportsEmpty } from '../src/lib/empty-states.ts';

const FY = { start: '2026-04-01', end: '2027-03-31' };
const none = { voucherDates: [], manualVouchers: [], openings: [], ledgerOpenings: 0, openingBills: 0 };

test('Books: empty with no voucher in the period and no openings; any of them fills it', () => {
  assert.equal(booksEmpty(none, FY), true);
  assert.equal(booksEmpty({ ...none, voucherDates: ['2026-05-02'] }, FY), false);
  assert.equal(booksEmpty({ ...none, voucherDates: ['2026-03-31'] }, FY), true, 'a voucher of last year does not fill this one');
  assert.equal(booksEmpty({ ...none, manualVouchers: [{ date: '2026-12-01' }] }, FY), false);
  assert.equal(booksEmpty({ ...none, openings: [{ amount: 5000 }] }, FY), false);
  assert.equal(booksEmpty({ ...none, openings: [{ amount: 0 }] }, FY), true, 'a zero opening is no opening');
  assert.equal(booksEmpty({ ...none, ledgerOpenings: 1 }, FY), false);
  assert.equal(booksEmpty({ ...none, openingBills: 2 }, FY), false);
});

test('Reports: empty when no sales document is dated in the period (bare dates, both ends included)', () => {
  assert.equal(reportsEmpty([], FY), true);
  assert.equal(reportsEmpty(['2026-04-01'], FY), false);
  assert.equal(reportsEmpty(['2027-03-31T23:00:00.000Z'], FY), false);
  assert.equal(reportsEmpty(['2027-04-01'], FY), true);
});

test('Exports: ok with a live document or a bill in range; drafts count only when included', () => {
  assert.equal(exportsState([], []), 'empty');
  assert.equal(exportsState([{ status: 'Sent', issue_date: '2026-05-01' }], []), 'ok');
  assert.equal(exportsState([{ status: 'Draft', issue_date: '2026-05-01' }], []), 'drafts-only');
  assert.equal(exportsState([{ status: 'Draft', issue_date: '2026-05-01' }], [], {}, true), 'ok');
  assert.equal(exportsState([], [{ date: '2026-06-01' }]), 'ok');
  assert.equal(exportsState([{ status: 'Sent', issue_date: '2025-05-01' }], [], FY), 'empty', 'outside the range');
  assert.equal(exportsState([{ status: 'Sent', issue_date: '2026-05-01' }], [], { start: '2026-04-01' }), 'ok', 'open-ended range');
});

test('Practice, Distribution, Reconcile: counts', () => {
  assert.equal(practiceEmpty(0), true);
  assert.equal(practiceEmpty(1), true);
  assert.equal(practiceEmpty(2), false);
  assert.equal(distributionEmpty(0, 0, 0), true);
  assert.equal(distributionEmpty(0, 1, 0), false);
  assert.equal(reconcileEmpty(0), true);
  assert.equal(reconcileEmpty(3), false);
});
