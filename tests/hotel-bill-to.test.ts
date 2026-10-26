/** R7-B4 company / agent billing: routing default, TDS default from the table, agent commission bill (194H, ITC), ITA 2025 label. */
import './helpers/shim.ts';
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { booking, setupHotel } from './helpers/hotel.ts';
import { clientKA, clientMH } from './helpers/world.ts';
import { saveReservation } from '../src/lib/hotel/reservations.ts';
import { checkIn } from '../src/lib/hotel/checkin.ts';
import { hotelDb } from '../src/lib/hotel/hotel-store.ts';
import { runNight } from '../src/lib/hotel/night-audit.ts';
import { stayFolios } from '../src/lib/hotel/folio.ts';
import { billKind, setBillTo, tdsFor, tdsLabel } from '../src/lib/hotel/bill-to.ts';
import { defaultRouting } from '../src/lib/hotel/routing.ts';
import { saveCheckout } from '../src/lib/hotel/checkout-save.ts';
import { commissionBill, commissionDue, fullyLowBand, recordCommission } from '../src/lib/hotel/agent-commission.ts';
import { draftsDb } from '../src/lib/purchase-drafts.ts';
import { setActorProvider } from '../src/lib/access.ts';
import { localDb } from '../src/lib/localDb.ts';

afterEach(() => setActorProvider(null));

function companyStay(client: typeof clientMH = { ...clientMH, hotel: { tds_default: '194I-B' } }, kind: 'company' | 'agent' = 'company') {
  setupHotel('2026-10-20');
  localDb.clients.upsert(client);
  const { res } = saveReservation(booking('2026-10-20', '2026-10-22'));
  setBillTo(res.id, kind, client);
  const { line } = checkIn({ resId: res.id, lineId: res.lines[0].id, roomId: 'r101', guests: [{ name: 'Asha Rao', nationality: 'IN' }], at: new Date('2026-10-20T13:00:00') });
  runNight('2026-10-20');
  runNight('2026-10-21');
  return { res: hotelDb.reservation(res.id)!, line };
}

test('company bill-to: room + meal plan route to the company window by default', () => {
  const { res } = companyStay();
  assert.equal(billKind(res), 'company');
  assert.deepEqual(res.routing, defaultRouting({ bill_to: res.bill_to }));
  const [w1, w2] = stayFolios(hotelDb.folios(), res.id);
  assert.deepEqual([w1.lines.length, w2.lines.length, w2.payer.client_id], [0, 2, 'c-mh']);
});

test('the company invoice carries TDS 194I-B at 10% from the table, on credit with the client\'s terms', () => {
  const { res, line } = companyStay();
  const [w1, w2] = stayFolios(hotelDb.folios(), res.id);
  const [inv] = saveCheckout({ windows: [{ folioId: w1.id }, { folioId: w2.id }], checkout: { resId: res.id, lineId: line.id } });
  assert.deepEqual([inv.tds_section, inv.tds_rate, inv.tds_amount, inv.taxable_value], ['194I-B', 10, 700, 7000]);
  assert.equal(inv.due_date, '2026-11-05', '14 default due days');
  assert.equal(inv.balance_due, 7350 - 700);
  assert.equal(tdsFor({ hotel: { tds_default: 'none' } }, '2026-10-20'), null, 'D11: none by default');
  assert.equal(tdsFor({ hotel: { tds_default: '194C' } }, '2026-10-20')?.tds_section, '194C-2');
});

test('agent commission: purchase draft with 194H; ITC flagged ineligible when the hotel is fully low-band', () => {
  const agent = { ...clientKA, hotel: { commission_pct: 10 } };
  const { res, line } = companyStay(agent, 'agent');
  assert.deepEqual(commissionDue(res, agent), { pct: 10, base: 7000, amount: 700 });
  const [, w2] = stayFolios(hotelDb.folios(), res.id);
  saveCheckout({ windows: [{ folioId: w2.id }], checkout: { resId: res.id, lineId: line.id } });
  assert.equal(fullyLowBand(localDb.invoices.getAll(), '2026-10-22'), true);
  const d = recordCommission(res.id);
  assert.deepEqual([d.status, d.lines[0].hsn, d.tds_section, d.tds_rate, d.tds_amount, d.igst, d.itc_eligible], ['draft', '998552', '194H', 2, 14, 126, false]);
  assert.match(d.notes ?? '', /ITC not available/);
  assert.equal(draftsDb.all().length, 1);
  assert.equal(hotelDb.reservation(res.id)?.commission?.draft_id, d.id);
  assert.throws(() => recordCommission(res.id), /already recorded/);
  const ok = commissionBill({ vendor: { name: 'X' }, amount: 1000, date: '2024-09-30', home: '27', ref: 'R', lowBand: false, tds194h: true });
  assert.deepEqual([ok.tds_rate, ok.igst + ok.cgst + ok.sgst, ok.itc_eligible], [5, 0, false], 'unregistered agent: no GST; 194H 5% before 1 Oct 2024');
});

test('ITA 2025 label after 1 Apr 2026, the stored code before', () => {
  assert.equal(tdsLabel('194I-B', '2026-03-31'), '194I-B');
  assert.match(tdsLabel('194I-B', '2026-04-01'), /Sec 393\(1\).*194-I/);
  assert.match(tdsLabel('194H', '2026-10-20'), /Sec 393\(1\)/);
});
