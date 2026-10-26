/** R7-B5 OTA bookings and payouts: TCS_52 vs Sec 9(5), 194-O, a 3-booking payout that nets to zero, the TCS credit row. */
import './helpers/shim.ts';
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { booking, setupHotel } from './helpers/hotel.ts';
import { gstin } from './helpers/world.ts';
import { saveReservation } from '../src/lib/hotel/reservations.ts';
import { checkIn } from '../src/lib/hotel/checkin.ts';
import { hotelDb } from '../src/lib/hotel/hotel-store.ts';
import { runNight } from '../src/lib/hotel/night-audit.ts';
import { stayFolios } from '../src/lib/hotel/folio.ts';
import { saveCheckout } from '../src/lib/hotel/checkout-save.ts';
import { NOTE_9_5, otaTags, otaTcs, rate194o } from '../src/lib/hotel/ota.ts';
import { payoutCandidates, payoutPlan, postPayout } from '../src/lib/hotel/ota-payout.ts';
import { expectedTcs } from '../src/lib/marketplace/tcs-credit.ts';
import { draftsDb } from '../src/lib/purchase-drafts.ts';
import { movedNoCash } from '../src/lib/no-cash.ts';
import { setActorProvider } from '../src/lib/access.ts';
import { localDb } from '../src/lib/localDb.ts';

afterEach(() => setActorProvider(null));
const OTA_GSTIN = gstin('27AABCM5678D1C');
const ota = { name: 'Booking.com', gstin: OTA_GSTIN, ref: 'BK1', collect: 'ota_collect' as const };

function otaStay(room: string, guest: string, type = 'dlx') {
  const { res } = saveReservation(booking('2026-10-20', '2026-10-21', { room_type_id: type }, { source: 'ota', ota, guest: { name: guest } }));
  const { line } = checkIn({ resId: res.id, lineId: res.lines[0].id, roomId: room, guests: [{ name: guest, nationality: 'IN' }], at: new Date('2026-10-20T13:00:00') });
  return { res, line };
}

test('registered hotel → TCS_52 and taxed, 194-O on OTA-collect; unregistered → PAY_9_5, zero tax, the 9(5) note', () => {
  setupHotel('2026-10-20');
  const { res, line } = otaStay('r101', 'Asha Rao');
  runNight('2026-10-20');
  const [inv] = saveCheckout({ windows: [{ folioId: stayFolios(hotelDb.folios(), res.id)[0].id }], checkout: { resId: res.id, lineId: line.id } });
  assert.deepEqual([inv.eco_gstin, inv.eco_section, inv.tax_amount, inv.tds_section, inv.tds_rate, inv.tds_amount], [OTA_GSTIN, 'TCS_52', 175, '194O', 0.1, 3.5]);
  assert.equal(otaTcs(inv), 17.5, '0.5% of ₹3,500');
  const unreg = otaTags({ source: 'ota', ota }, { companyGstin: '' }, '2026-10-20');
  assert.equal(unreg.eco_section, 'PAY_9_5');
  setupHotel('2026-10-20');
  const s = localDb.settings.get();
  localDb.settings.save({ ...s, profiles: s.profiles.map((p) => ({ ...p, companyGstin: '' })) });
  const b = otaStay('r101', 'Ravi Kumar');
  runNight('2026-10-20');
  const [u] = saveCheckout({ windows: [{ folioId: stayFolios(hotelDb.folios(), b.res.id)[0].id }], checkout: { resId: b.res.id, lineId: b.line.id } });
  assert.deepEqual([u.eco_section, u.tax_amount, u.total, u.doc_type], ['PAY_9_5', 0, 3500, 'INVOICE']);
  assert.match(u.notes, new RegExp(NOTE_9_5.replace(/[().]/g, '\\$&')));
  assert.equal(otaTcs(u), 0);
});

test('194-O at 0.1% from 1 Oct 2024 (existing rows)', () => {
  assert.equal(rate194o('2024-09-30'), 1);
  assert.equal(rate194o('2024-10-01'), 0.1);
});

test('a payout of 3 bookings nets to zero: receipts, withheld clearing rows, commission draft, TCS seen by the credit view', async () => {
  setupHotel('2026-10-20');
  const stays = [otaStay('r101', 'A One'), otaStay('r102', 'B Two'), otaStay('r201', 'C Three', 'ste')];
  runNight('2026-10-20');
  for (const s of stays) saveCheckout({ windows: [{ folioId: stayFolios(hotelDb.folios(), s.res.id)[0].id }], checkout: { resId: s.res.id, lineId: s.line.id }, day: '2026-10-21' });
  const c = payoutCandidates('Booking.com');
  assert.equal(c.length, 3);
  const rows = c.map((x) => ({ invoiceId: x.inv.id, commission: round(x.inv.taxable_value * 0.15), gst: round(x.inv.taxable_value * 0.15 * 0.18), tcs: x.tcs }));
  const { nets, gap } = payoutPlan(rows, (id) => c.find((x) => x.inv.id === id)!.due, 0);
  const amount = round(nets.reduce((s, n) => s + n, 0));
  assert.equal(gap, -amount);
  await assert.rejects(postPayout({ ota: 'Booking.com', gstin: OTA_GSTIN, date: '2026-11-05', amount: amount - 1, method: 'Bank transfer', rows }), /differs .* ₹-1\.00/);
  assert.equal(localDb.payments.getAll().length, 0, 'refused: nothing written');
  await postPayout({ ota: 'Booking.com', gstin: OTA_GSTIN, date: '2026-11-05', amount, method: 'Bank transfer', ref: 'PO-9', rows });
  assert.ok(localDb.invoices.getAll().every((i) => i.balance_due === 0 && i.status === 'Paid'), 'every booking shows paid');
  const pays = localDb.payments.getAll();
  assert.equal(round(pays.filter((p) => !movedNoCash(p)).reduce((s, p) => s + p.amount, 0)), amount, 'only the net is cash / bank');
  assert.equal(pays.filter(movedNoCash).length, 3);
  const [exp] = expectedTcs(localDb.invoices.getAll());
  assert.deepEqual([exp.gstin, exp.month, round(exp.heads.cgst + exp.heads.sgst)], [OTA_GSTIN, '2026-10', round(rows.reduce((s, r) => s + r.tcs, 0))], 'the R5-A5 credit view expects the TCS withheld');
  const [bill] = draftsDb.all();
  assert.deepEqual([bill.vendor_name, bill.lines[0].hsn, bill.tds_section, bill.taxable], ['Booking.com', '998552', undefined, round(rows.reduce((s, r) => s + r.commission, 0))]);
  assert.equal(payoutCandidates().length, 0);
});

const round = (n: number) => Math.round(n * 100) / 100;
