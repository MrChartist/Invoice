/**
 * R15-C1 air tickets: Rule 32(3) deemed value (5 % domestic / 10 % international of the basic fare) or the actual fee,
 * fares as pure-agent lines (GSTR-1 shows only the service value, no nil row; e-Invoice keeps them in OthChrg), the
 * fee-above-deemed warning, a domestic + international mix, the airline's GST by date, and the booking's draft.
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { clientMH, installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { airlineGst, deemedValue, fareOf, mergeTickets, validateTicket } from '../src/lib/travel/tv-air-value.ts';
import { billTickets } from '../src/lib/travel/tv-air.ts';
import { saveTrip } from '../src/lib/travel/tv-trips.ts';
import { isBilled, liveLines, loadBookings, saveBooking } from '../src/lib/travel/tv-bookings.ts';
import { buildGstReport } from '../src/lib/gst-reports.ts';
import { preflightEInvoice } from '../src/lib/einvoice-validate.ts';
import { isPureAgentLine } from '../src/lib/trade/pure-agent.ts';
import { tvPaper } from '../src/lib/travel/tv-print.ts';
import { tvLineText } from '../src/components/templates/paper-helpers.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';
import type { TvTicket } from '../src/types/travel-r15.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
  localDb.clients.upsert(clientMH);
});

const dom = (over: Partial<TvTicket> = {}): TvTicket => ({ pax: 'MEHTA/RAVI', airline: '6E', ticket_no: '0581234567890', pnr: 'ABC123', sector: 'DEL-BOM', class: 'economy', basic: 4200, taxes: 940, airline_gst: 210, ...over });

test('deemed 5 % / 10 % of the basic fare; international + domestic on one invoice', () => {
  assert.equal(deemedValue([dom(), dom()], '2026-10-05'), 420);
  assert.equal(deemedValue([dom({ intl: true, basic: 30000 })], '2026-10-05'), 3000);
  assert.equal(deemedValue([dom(), dom({ intl: true, basic: 30000 })], '2026-10-05'), 3210);
  assert.equal(fareOf(dom()), 5350);
  assert.equal(validateTicket(dom({ ticket_no: '123' })), 'Ticket no. 123: 13 digits.');
  assert.equal(validateTicket(dom({ basic: 0 })), 'Enter the basic fare of every ticket.');
});

test('lines: one pure-agent fare line per ticket, one service line; adding again re-makes the service line', () => {
  const a = mergeTickets([], undefined, [dom(), dom()], { method: 'deemed', fee: 600, date: '2026-10-05' });
  assert.equal(a.items.length, 3);
  assert.ok(a.items.slice(0, 2).every((l) => isPureAgentLine(l) && l.tax_rate === 0 && l.rate === 5350));
  assert.deepEqual([a.items[2].rate, a.items[2].tax_rate, a.items[2].hsn], [420, 18, '998551']);
  assert.equal(a.warn, true, 'fee ₹600 above the deemed ₹420: warn, keep the deemed value');
  assert.match(a.tv.air!.note!, /Rule 32\(3\)/);
  const b = mergeTickets(a.items, a.tv, [dom({ intl: true, basic: 10000, ticket_no: '' })], { method: 'deemed', fee: 0, date: '2026-10-05' });
  assert.equal(b.items.length, 4, 'the old service line is replaced');
  assert.equal(b.items[3].rate, 1420);
  const c = mergeTickets([], undefined, [dom()], { method: 'actual', fee: 300, date: '2026-10-05' });
  assert.deepEqual([c.items[1].rate, c.items[1].name, c.warn], [300, 'Service fee — air tickets', false]);
  assert.match(tvLineText({ id: c.items[0].id }, c.tv), /Tkt 0581234567890 · PNR ABC123 · DEL-BOM · Basic 4200.00 \+ taxes 940.00 \+ airline GST 210.00/);
  assert.match(tvPaper(a.tv).decl, /₹420\.00/);
});

test('airline GST passed through by date: other classes 12 % before 22 Sep 2025, 18 % after; economy 5 %', () => {
  assert.equal(airlineGst(dom({ class: 'other', basic: 10000 }), '2025-09-21'), 1200);
  assert.equal(airlineGst(dom({ class: 'other', basic: 10000 }), '2025-09-22'), 1800);
  assert.equal(airlineGst(dom({ basic: 10000 }), '2025-09-22'), 500);
});

test('the booking draft: GSTR-1 shows only the deemed value (no nil row), e-Invoice keeps the fares in OthChrg', () => {
  const t = saveTrip({ name: 'Mumbai trip', client_id: 'c-mh', tv: { code: '2610-001', kind: 'trip', scope: 'domestic', start: '2026-10-05', regime: 'agent', status: 'confirmed', pax: [] } });
  const bk = saveBooking({ trip_id: t.id, component: 'air', start: '2026-10-05', cost: 10700, sell: 10700, status: 'confirmed', ref: 'ABC123' });
  const inv = billTickets(bk.id, [dom(), dom({ ticket_no: '0581234567891' })], { method: 'deemed', fee: 600, date: '2026-10-05' });
  assert.equal(inv.status, 'Draft');
  assert.equal(inv.tv?.regime, 'agent');
  assert.equal(inv.taxable_value, 10700 + 420);
  assert.equal(inv.tax_amount, 75.6);
  const b = loadBookings(t.id)[0];
  assert.equal(b.tkt?.length, 2);
  assert.ok(isBilled(b, liveLines(localDb.invoices.getAll())));
  assert.throws(() => billTickets(bk.id, [dom()], { method: 'deemed', fee: 0 }), /billed already/);
  localDb.invoices.setStatus(inv.id, 'Sent');
  const rec = localDb.invoices.getById(inv.id) as InvoiceRecord;
  const r = buildGstReport([rec], [], { period: { kind: 'month', fyStart: 2026, month: 10 } });
  assert.deepEqual(r.gstr1.nil, []);
  assert.deepEqual(r.gstr1.hsn.map((h: { hsn: string; taxable: number }) => [h.hsn, h.taxable]), [['998551', 420]]);
  const e = preflightEInvoice(rec, { now: new Date('2026-10-06') });
  assert.equal(e.payload!.ItemList.length, 1);
  assert.equal(e.payload!.ValDtls.AssVal, 420);
  assert.equal(e.payload!.ValDtls.OthChrg, 10700);
});
