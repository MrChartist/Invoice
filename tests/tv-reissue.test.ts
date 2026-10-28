/**
 * R16-C2 ticket re-issue: fare difference and change penalty as pure-agent lines, our re-issue fee at 18 % (SAC of the
 * C1 airline row), the new ticket's particulars on the draft, the old ticket marked `reissued_by` with its line kept on
 * the old invoice; a negative difference → a credit note on the old fare line, no draft when nothing else is billed.
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { clientMH, installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { saveTrip } from '../src/lib/travel/tv-trips.ts';
import { loadBookings, saveBooking } from '../src/lib/travel/tv-bookings.ts';
import { billTickets } from '../src/lib/travel/tv-air.ts';
import { reissueLines, reissueTicket } from '../src/lib/travel/tv-reissue.ts';
import { isPureAgentLine } from '../src/lib/trade/pure-agent.ts';
import { tvLineText } from '../src/components/templates/paper-helpers.ts';
import type { TvTicket } from '../src/types/travel-r15.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
  localDb.clients.upsert(clientMH);
});

const tk = (no: string): TvTicket => ({ pax: 'MEHTA/RAVI', airline: '6E', ticket_no: no, pnr: 'ABC123', sector: 'DEL-BOM', class: 'economy', basic: 4200, taxes: 940, airline_gst: 210 });
const setup = (no = '0581234567890') => {
  const t = saveTrip({ name: 'Mumbai trip', client_id: 'c-mh', tv: { code: '2610-001', kind: 'trip', scope: 'domestic', start: '2026-10-05', regime: 'agent', status: 'confirmed', pax: [] } });
  const bk = saveBooking({ trip_id: t.id, component: 'air', start: '2026-10-05', cost: 5350, sell: 5350, status: 'confirmed', ref: 'ABC123' });
  const inv = billTickets(bk.id, [tk(no)], { method: 'deemed', fee: 0, date: '2026-10-05' });
  return { bk, inv };
};

test('re-issue: ₹800 difference + ₹1,500 penalty at actual, ₹300 fee at 18 %; old ticket marked, old line kept', () => {
  const { bk, inv } = setup();
  const r = reissueTicket(bk.id, { old_no: '0581234567890', new_no: '058 1234567899', diff: 800, penalty: 1500, fee: 300, date: '2026-10-12' });
  const d = r.draft!;
  assert.equal(r.credit, null);
  assert.equal(d.status, 'Draft');
  assert.deepEqual(d.items.map((l) => [l.rate, l.tax_rate, isPureAgentLine(l)]), [[800, 0, true], [1500, 0, true], [300, 18, false]]);
  assert.equal(d.items[2].hsn, '998551');
  assert.equal(d.tax_amount, 54);
  assert.equal(d.tv?.regime, 'agent');
  assert.match(tvLineText({ id: d.items[0].id }, d.tv), /Tkt 0581234567899 · PNR ABC123 · DEL-BOM$/);
  assert.equal(d.tv?.lines?.[d.items[0].id]?.tkt?.reissue_of, '0581234567890');
  const b = loadBookings()[0];
  assert.deepEqual(b.tkt?.map((t) => [t.ticket_no, t.reissued_by ?? '']), [['0581234567890', '0581234567899'], ['0581234567899', '']]);
  assert.equal(localDb.invoices.getById(inv.id)!.items.length, inv.items.length, 'the old invoice keeps its line');
  assert.throws(() => reissueTicket(bk.id, { old_no: '0581234567890', new_no: '0581234567898', diff: 0, penalty: 0, fee: 300, date: '2026-10-12' }), /re-issued already/);
  assert.throws(() => reissueTicket(bk.id, { old_no: '0581234567899', new_no: '12', diff: 0, penalty: 0, fee: 300, date: '2026-10-12' }), /13 digits/);
});

test('a negative difference credits the old fare line (issued invoice); nothing else → no draft', () => {
  const { bk, inv } = setup();
  assert.throws(() => reissueTicket(bk.id, { old_no: '0581234567890', new_no: '0581234567899', diff: -535, penalty: 0, fee: 0, date: '2026-10-12' }), /Issue the invoice/);
  localDb.invoices.setStatus(inv.id, 'Sent');
  const r = reissueTicket(bk.id, { old_no: '0581234567890', new_no: '0581234567899', diff: -535, penalty: 0, fee: 0, date: '2026-10-12' });
  assert.equal(r.draft, null);
  assert.equal(r.credit?.doc_type, 'CREDIT_NOTE');
  assert.equal(r.credit?.total, 535);
  assert.equal(r.credit?.issue_date, '2026-10-12');
  assert.equal(reissueLines(tk('1'), { old_no: '1', new_no: '2', diff: -1, penalty: 0, fee: 0, date: '2026-10-12' }).items.length, 0);
});
