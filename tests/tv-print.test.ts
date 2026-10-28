/** R15-B4 travel paper: header rows and sentence from the snapshot only; ticket sub-line; old invoices print unchanged. */
import './helpers/shim.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tvPaper } from '../src/lib/travel/tv-print.ts';
import { trackingText, tvLineText } from '../src/components/templates/paper-helpers.ts';

const tv = { trip: { id: 't', code: '2611-001', kind: 'trip' as const, destination: 'Goa', start: '2026-11-10', end: '2026-11-15', lead: 'Ravi Mehta', pax: 4 }, regime: 'to5' as const, decl: 'Tour operator service — … Verify with your CA.', lines: { l1: { tkt: { pax: 'MEHTA/RAVI MR', airline: '6E', ticket_no: '0581234567890', pnr: 'ABC123', sector: 'BOM-GOI' } } } };

test('rows and sentence come from the snapshot only', () => {
  const p = tvPaper(tv);
  assert.deepEqual(p.rows, [['Trip file', '2611-001'], ['Destination', 'Goa'], ['Dates', '10/11/2026 – 15/11/2026'], ['Lead passenger', 'Ravi Mehta'], ['Passengers', '4']]);
  assert.equal(p.decl, tv.decl);
  assert.equal(tvPaper({ trip: { code: 'E1', kind: 'event' } }).rows[0][0], 'Event file');
  assert.equal(tvLineText({ id: 'l1' }, tv), 'MEHTA/RAVI MR · 6E · Tkt 0581234567890 · PNR ABC123 · BOM-GOI');
  assert.equal(trackingText({ id: 'l1' } as never, undefined, undefined, undefined, tv), 'MEHTA/RAVI MR · 6E · Tkt 0581234567890 · PNR ABC123 · BOM-GOI');
});

test('old invoices print exactly as before', () => {
  assert.equal(tvLineText({ id: 'l1' }, undefined), '');
  assert.equal(trackingText({ id: 'l1', batch_no: 'B1' } as never), 'Batch B1');
  assert.equal(trackingText({ id: 'l1', batch_no: 'B1' } as never, undefined, undefined, undefined, undefined), 'Batch B1');
  const empty = tvPaper({});
  assert.deepEqual([empty.rows, empty.decl], [[], ''], 'an empty snapshot prints no block (TravelBlock returns null)');
});
