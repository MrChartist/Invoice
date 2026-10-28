/**
 * R16-C1 commission income: "Bill commission" on a booking makes a draft invoice to the principal (airline / hotel /
 * insurer) at 18 % with the principal's SAC, 194H expected through the R14-D receivable path (threshold by the
 * principal's FY total), an insurer's invoice under outward reverse charge with 194D; billed derived from `comm_ref`;
 * the commission reaches the TDS receivable register once issued.
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { BUYER_KA, clientMH, installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { vendorsDb } from '../src/lib/vendors.ts';
import { saveTrip } from '../src/lib/travel/tv-trips.ts';
import { liveLines, loadBookings, saveBooking } from '../src/lib/travel/tv-bookings.ts';
import { billCommission, commBilled, principalOf } from '../src/lib/travel/tv-commission.ts';
import { buildTdsRegister } from '../src/lib/tds-register.ts';
import { isOutwardRcm } from '../src/lib/rcm.ts';
import { sectionText } from '../src/lib/ita2025.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
  localDb.clients.upsert(clientMH);
});

const trip = () => saveTrip({ name: 'Delhi trip', client_id: 'c-mh', tv: { code: '2610-001', kind: 'trip', scope: 'domestic', start: '2026-10-05', regime: 'agent', status: 'confirmed', pax: [] } });

test('airline commission ₹1,200: invoice to the airline at 18 % (SAC 998551); 194H below the FY threshold; billed once', () => {
  const v = vendorsDb.save({ name: 'IndiGo', gstin: BUYER_KA, state_code: '29', tv: { kind: 'airline' } });
  const t = trip();
  const bk = saveBooking({ trip_id: t.id, component: 'air', vendor_id: v.id, start: '2026-10-05', cost: 10000, sell: 10500, commission: 1200, status: 'confirmed', ref: 'PNR1' });
  const { invoice, tds } = billCommission(bk.id, '2026-10-05');
  assert.equal(invoice.status, 'Draft');
  assert.equal(invoice.client.name, 'IndiGo');
  assert.deepEqual([invoice.items[0].hsn, invoice.items[0].tax_rate, invoice.taxable_value, invoice.igst_amount], ['998551', 18, 1200, 216]);
  assert.equal(invoice.cost_centre_id, t.id);
  assert.deepEqual([tds?.code, tds?.rate, tds?.applies, tds?.threshold], ['194H', 2, false, 20000]);
  assert.ok(!invoice.tds_enabled);
  assert.ok(commBilled(loadBookings()[0], liveLines(localDb.invoices.getAll())));
  assert.throws(() => billCommission(bk.id, '2026-10-05'), /billed already/);
});

test('above the FY threshold: 194H 2 % on the commission before GST, in the TDS receivable register once issued', () => {
  const v = vendorsDb.save({ name: 'Taj Hotels', tv: { kind: 'hotel' } });
  const t = trip();
  const bk = saveBooking({ trip_id: t.id, component: 'hotel', vendor_id: v.id, start: '2026-10-05', cost: 200000, sell: 210000, commission: 25000, status: 'confirmed' });
  const { invoice, tds } = billCommission(bk.id, '2026-10-05');
  assert.deepEqual([invoice.items[0].hsn, invoice.tds_section, invoice.tds_rate, invoice.tds_amount, tds?.applies], ['998552', '194H', 2, 500, true]);
  assert.match(sectionText('194H', '2026-10-05'), /393/);
  localDb.invoices.setStatus(invoice.id, 'Sent');
  const reg = buildTdsRegister({ invoices: localDb.invoices.getAll(), certificates: [] }, { today: '2026-12-01' });
  assert.equal(reg.quarters.flatMap((q) => q.rows).reduce((s, r) => s + r.tdsExpected, 0), 500);
});

test('insurer: SAC 997161, outward reverse charge, 194D (2 % above ₹20,000 from 2025-04-01); principal picks', () => {
  const v = vendorsDb.save({ name: 'Star Health Insurance' });
  const t = trip();
  const bk = saveBooking({ trip_id: t.id, component: 'insurance', vendor_id: v.id, start: '2026-10-05', cost: 0, sell: 0, commission: 30000, status: 'confirmed' });
  const { invoice, tds } = billCommission(bk.id, '2026-10-05');
  assert.equal(invoice.items[0].hsn, '997161');
  assert.ok(isOutwardRcm(invoice));
  assert.equal(invoice.total, 30000, 'the GST is payable by the insurer, outside the total');
  assert.deepEqual([tds?.code, tds?.rate, tds?.applies, invoice.tds_amount], ['194D', 2, true, 600]);
  assert.equal(principalOf({ component: 'package' }, { tv: { kind: 'bedbank' } }), 'hotel');
  assert.equal(principalOf({ component: 'visa' }), 'other');
  const none = saveBooking({ trip_id: t.id, component: 'hotel', start: '2026-10-05', cost: 1, sell: 1, commission: 10, status: 'confirmed' });
  assert.throws(() => billCommission(none.id), /principal/);
});

test('R16-C4 demo rows (Demo company only): an event with a budget and three vendors, a Dubai package with 2 % TCS, a BSP statement', async () => {
  const { buildDemoDataset } = await import('../src/lib/demo-data.ts');
  const { demoExtras } = await import('../src/lib/demo/profiles.ts');
  const base = buildDemoDataset('2026-10-28');
  const x = await demoExtras('services', { today: '2026-10-28', base, packs: ['travel', 'events'], businessType: 'services' });
  const ev = (x.tables?.cost_centres ?? []).find((c) => c.id === 'demo-event-1') as unknown as { tv: { event: { budget: unknown[] } } };
  assert.equal(ev.tv.event.budget.length, 3);
  const evb = (x.tables?.travel_bookings ?? []) as unknown as { trip_id: string; vendor_id?: string }[];
  assert.equal(new Set(evb.filter((b) => b.trip_id === 'demo-event-1').map((b) => b.vendor_id).filter(Boolean)).size, 3);
  const inv = x.invoices!.find((i) => i.id === 'demo-tv-inv-1')!;
  assert.ok(inv.issue_date > '2026-04-01');
  assert.deepEqual([inv.tcs_rate, inv.tcs_amount, inv.total], [2, 3150, 160650]);
  const st = (x.tables?.supplier_statements ?? [])[0] as unknown as { rows: { status: string; flag?: string }[] };
  assert.deepEqual(st.rows.map((r) => r.flag ?? r.status), ['matched', 'matched', 'adm', 'refund']);
});
