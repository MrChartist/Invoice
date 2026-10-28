/** CN-C5 cancellations: inside the Sec 34 window a credit note reverses the demand; after it the refund is net of the GST
 * paid (Circular 188 note); forfeiture as a journal draft; open advances refunded with refund vouchers; unit freed. */
import './helpers/shim.ts';
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { thawDate } from './helpers/shim.ts';
import { book, realtyWorld } from './helpers/realty.ts';
import { localDb } from '../src/lib/localDb.ts';
import { getTable } from '../src/lib/storage.ts';
import { loadAdvances } from '../src/lib/advances.ts';
import { loadVouchers } from '../src/lib/ledger/vouchers.ts';
import { certifyStage } from '../src/lib/construction/cn-plans.ts';
import { raiseDemands } from '../src/lib/construction/cn-demands.ts';
import { loadBookings, recordReceipt } from '../src/lib/construction/cn-bookings.ts';
import { loadUnits } from '../src/lib/construction/cn-units.ts';
import { cancelBooking, proposal, sec34Limit } from '../src/lib/construction/cn-cancellations.ts';
import { cancellationHtml } from '../src/lib/construction/cn-allotment-print.ts';
import { saveConstructionSettings } from '../src/lib/construction/cn-settings.ts';

afterEach(() => thawDate());

function world(today: string) {
  const w = realtyWorld(today);
  saveConstructionSettings({ realty: { forfeit_pct: 2 } });
  const b = book(w);
  recordReceipt(b.id, { date: '2026-05-02', amount: 1500000, method: 'Bank transfer' });
  raiseDemands(certifyStage({ project_id: w.project.id, tower_id: w.tower.id, stage_id: w.plan.stages[2].id, stage_label: 'Plinth', certified_on: '2026-06-01', by: 'Architect' }).id, '2026-06-01');
  return { w, b };
}

test('Sec 34 limit: 30 November after the FY of the document', () => {
  assert.equal(sec34Limit('2026-06-01'), '2027-11-30');
  assert.equal(sec34Limit('2027-03-31'), '2027-11-30');
  assert.equal(sec34Limit('2027-04-01'), '2028-11-30');
});

test('within the window: credit note on the demand, refund = received − forfeiture; open advance refunded (RFV), rest pending', () => {
  const { b } = world('2026-10-27');
  const p = proposal(loadBookings()[0], '2026-10-27', { advances: loadAdvances(), payments: getTable('transactions'), invoices: localDb.invoices.getAll(), forfeitPct: 2 });
  assert.deepEqual([p.received, p.forfeiture, p.taxRetained, p.refund, p.path, p.within.length], [1500000, 150000, 0, 1350000, 'credit_note', 1]);
  const c = cancelBooking(b.id, '2026-10-27', 'Buyer request').cancellation!;
  assert.equal(c.credit_note_ids?.length, 1);
  const cn = localDb.invoices.getById(c.credit_note_ids![0])!;
  assert.equal(cn.doc_type, 'CREDIT_NOTE');
  assert.equal(cn.total, 1181250, 'the whole demand is reversed');
  assert.deepEqual(c.refund_numbers, ['RFV/FY26-27/0001']);
  assert.equal(loadAdvances()[0].refunds![0].amount, 318750, 'the unadjusted part of the advance');
  assert.equal(c.refund_pending, 1031250, 'adjusted money is paid from Payments');
  const j = loadVouchers().find((v) => v.id === c.journal_id)!;
  assert.equal(j.variant, 'OPTIONAL', 'forfeiture is a draft journal');
  assert.equal(j.lines[1].cr, 15000000);
  assert.equal(loadUnits().find((u) => u.id === b.unit_id)?.status, 'available', 'unit freed');
  assert.equal(loadBookings()[0].status, 'cancelled');
  assert.doesNotMatch(cancellationHtml(loadBookings()[0], 'Builder'), /Circular 188/);
});

test('after the window: no credit note; refund net of the GST paid, with the Circular 188 note', () => {
  const { b } = world('2028-01-10');
  const c = cancelBooking(b.id, '2028-01-10', 'Buyer request').cancellation!;
  assert.deepEqual([c.path, c.tax_retained, c.refund, c.credit_note_ids], ['refund_net', 56250, 1293750, undefined]);
  assert.ok(!localDb.invoices.getAll().some((i) => i.doc_type === 'CREDIT_NOTE'));
  assert.match(cancellationHtml(loadBookings()[0], 'Builder'), /Circular 188\/20\/2022-GST/);
  assert.throws(() => cancelBooking(b.id, '2028-01-10', 'again'), /not found/);
});
