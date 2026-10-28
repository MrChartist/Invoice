/**
 * QA round 19: Round 16 seams (R16-B / C / D) walked at the data layer. Each test fails on the code before its fix.
 *
 * U7 a re-issue whose fare difference is negative credits EXACTLY that difference (the credit note rounded the derived
 *    quantity to 2 decimals: ₹800 on a ₹5,350 fare became ₹802.50), and the note stays out of GSTR-1 values like the
 *    pure-agent fare line it credits.
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { clientMH, installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { saveTrip } from '../src/lib/travel/tv-trips.ts';
import { saveBooking } from '../src/lib/travel/tv-bookings.ts';
import { billTickets } from '../src/lib/travel/tv-air.ts';
import { reissueTicket } from '../src/lib/travel/tv-reissue.ts';
import { creditableLines, readLinks } from '../src/lib/documents.ts';
import { buildGstReport } from '../src/lib/gst-reports.ts';
import type { TvTicket } from '../src/types/travel-r15.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
  localDb.clients.upsert(clientMH);
});

const tk = (no: string): TvTicket => ({ pax: 'MEHTA/RAVI', airline: '6E', ticket_no: no, pnr: 'ABC123', sector: 'DEL-BOM', class: 'economy', basic: 4200, taxes: 940, airline_gst: 210 });

test('U7: a negative re-issue difference credits exactly that amount; the note is a pure-agent credit (no GSTR-1 value)', () => {
  const t = saveTrip({ name: 'Mumbai trip', client_id: 'c-mh', tv: { code: '2610-001', kind: 'trip', scope: 'domestic', start: '2026-10-05', regime: 'agent', status: 'confirmed', pax: [] } });
  const bk = saveBooking({ trip_id: t.id, component: 'air', start: '2026-10-05', cost: 5350, sell: 5350, status: 'confirmed', ref: 'ABC123' });
  const inv = billTickets(bk.id, [tk('0581234567890')], { method: 'deemed', fee: 0, date: '2026-10-05' });
  localDb.invoices.setStatus(inv.id, 'Sent');
  const r = reissueTicket(bk.id, { old_no: '0581234567890', new_no: '0581234567899', diff: -800, penalty: 0, fee: 0, date: '2026-10-12' });
  const cn = r.credit!;
  assert.equal(cn.total, 800, `credit total ${cn.total}`);
  assert.equal(cn.items[0].amount, 800);
  // The fare line still has the rest creditable (by quantity), never more than the line.
  const fare = localDb.invoices.getById(inv.id)!;
  const st = creditableLines(fare, readLinks(), localDb.invoices.getAll()).find((s) => s.item.id === cn.items[0].id)!;
  assert.ok(Math.abs(st.remainingQty * st.item.rate - (5350 - 800)) < 0.01, `remaining value ${st.remainingQty * st.item.rate}`);
  // GSTR-1: a pure-agent (Rule 33) credit has no taxable value to report.
  const g = buildGstReport(localDb.invoices.getAll(), [], { period: { kind: 'fy', fyStart: 2026 }, gstin: '27AAPFU0939F1ZV' });
  const noteRows = [...g.gstr1.cdnr, ...g.gstr1.cdnur, ...g.gstr1.b2b].filter((x) => JSON.stringify(x).includes(cn.invoice_number));
  assert.ok(noteRows.every((x) => !(x as { taxable?: number }).taxable), `CDN rows carry no taxable value: ${JSON.stringify(noteRows)}`);
});
