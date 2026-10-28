/** CN-C2 bookings: cost sheet taxable vs pass-through, BKG numbering (Indian FY), the RERA Sec 13 10% warning, the
 * 194-IA hint threshold and ITA 2025 label, unit status moves, receipts as GST advances (none after CC / pass-through). */
import './helpers/shim.ts';
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { thawDate } from './helpers/shim.ts';
import { book, realtyWorld } from './helpers/realty.ts';
import { getTable } from '../src/lib/storage.ts';
import { loadAdvances } from '../src/lib/advances.ts';
import { localDb } from '../src/lib/localDb.ts';
import { agreementValue, bookingTds, deleteBooking, loadBookings, passThroughTotal, receivedFor, recordReceipt, setBookingStatus } from '../src/lib/construction/cn-bookings.ts';
import { loadUnits } from '../src/lib/construction/cn-units.ts';
import { preAgreementWarning, tds194ia } from '../src/lib/construction/cn-realty-tax.ts';
import { saveProject } from '../src/lib/construction/cn-realty-projects.ts';

afterEach(() => thawDate());

test('cost sheet: pass-through heads stay out of the agreement value', () => {
  const sheet = [
    { head: 'Basic', amount: 6000000, taxable: true, pass_through: false },
    { head: 'Car parking', amount: 300000, taxable: true, pass_through: false },
    { head: 'Stamp duty', amount: 400000, taxable: false, pass_through: true },
    { head: 'Corpus', amount: 100000, taxable: false, pass_through: true },
  ];
  assert.equal(agreementValue(sheet), 6300000);
  assert.equal(passThroughTotal(sheet), 500000);
});

test('booking: BKG/FY26-27/0001, class at booking, unit booked; delete frees it', () => {
  const w = realtyWorld();
  const b = book(w);
  assert.equal(b.number, 'BKG/FY26-27/0001');
  assert.equal(b.cls, 'realty_residential', '100 sq m / ₹75 lakh is not affordable');
  assert.equal(b.agreement_value, 7500000);
  assert.equal(loadUnits().find((u) => u.id === b.unit_id)?.status, 'booked');
  assert.throws(() => book(w), /available unit/, 'the same unit cannot be booked twice');
  deleteBooking(b.id);
  assert.equal(loadUnits().find((u) => u.id === b.unit_id)?.status, 'available');
  assert.equal(book(w).number, 'BKG/FY26-27/0002', 'a deleted number is never reused');
});

test('RERA Sec 13: more than 10% before a registered agreement warns (never blocks)', () => {
  assert.equal(preAgreementWarning(750000, 7500000, undefined, '2026-05-02'), false, 'exactly 10%');
  assert.equal(preAgreementWarning(750001, 7500000, undefined, '2026-05-02'), true);
  assert.equal(preAgreementWarning(900000, 7500000, '2026-05-01', '2026-05-02'), false, 'agreement registered');
  const w = realtyWorld();
  const b = book(w);
  const r1 = recordReceipt(b.id, { date: '2026-05-02', amount: 700000, method: 'Bank transfer' });
  assert.equal(r1.warn10, false);
  const r2 = recordReceipt(b.id, { date: '2026-05-03', amount: 200000, method: 'Bank transfer' });
  assert.equal(r2.warn10, true, '₹9 lakh of ₹75 lakh = 12% before the agreement');
  setBookingStatus(b.id, 'registered', '2026-05-10');
  assert.equal(recordReceipt(b.id, { date: '2026-05-11', amount: 100000, method: 'Cash' }).warn10, false);
  assert.equal(loadUnits().find((u) => u.id === b.unit_id)?.status, 'registered');
  assert.equal(loadBookings()[0].registered_on, '2026-05-10');
});

test('194-IA hint: ≥ ₹50 lakh (or stamp value); the 2025 Act label from 1 Apr 2026', () => {
  assert.equal(tds194ia(4999999, undefined, '2026-03-01').applies, false);
  assert.equal(tds194ia(4999999, 5000000, '2026-03-01').applies, true, 'stamp value counts');
  assert.deepEqual([tds194ia(5000000, 0, '2026-03-31').section, tds194ia(5000000, 0, '2026-03-31').rate], ['194-IA', 1]);
  assert.match(tds194ia(5000000, 0, '2026-04-01').section, /393\(1\).*3\(i\).*194-?IA/);
  assert.equal(bookingTds({ agreement_value: 7500000 }, '2026-06-01').applies, true);
});

test('receipts are advances tagged with the booking: GST at the class rate, none on pass-through or after CC', () => {
  const w = realtyWorld();
  const b = book(w);
  recordReceipt(b.id, { date: '2026-05-02', amount: 105000, method: 'Bank transfer', bankAccountId: 'rera' });
  recordReceipt(b.id, { date: '2026-05-02', amount: 400000, method: 'Bank transfer', passThrough: true });
  const [adv, pt] = loadAdvances();
  assert.equal(adv.booking_id, b.id);
  assert.equal(adv.tax_rate, 5);
  assert.equal(adv.tax.taxable, 100000, '₹1,05,000 incl. 5%');
  assert.equal(adv.place_of_supply, '27', 'the property State');
  assert.equal(pt.pass_through, true);
  assert.equal(pt.tax_rate, 0);
  assert.deepEqual(receivedFor(b.id, loadAdvances(), getTable('transactions'), localDb.invoices.getAll()), { consideration: 105000, passThrough: 400000 });
  saveProject({ ...w.project, cc_date: '2026-06-01' });
  recordReceipt(b.id, { date: '2026-06-02', amount: 50000, method: 'Cash' });
  assert.equal(loadAdvances()[2].tax_rate, 0, 'after the completion certificate: no GST');
  assert.throws(() => deleteBooking(b.id), /receipts or demands/);
});
