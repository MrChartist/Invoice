/** R15-B3 ITC block: bills of a 5 % trip are tagged (except another operator's package); overrides listed; GST guard. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { setTable } from '../src/lib/storage.ts';
import { itcOverrides, tripTag, tvExceptions } from '../src/lib/travel/tv-itc.ts';

beforeEach(() => resetStorage());
const trip = (regime: 'to5' | 'to18') => ({ id: 't', tv: { code: '2611-001', kind: 'trip' as const, scope: 'domestic' as const, regime, status: 'confirmed' as const, pax: [] } });

test('tag: a 5 % trip marks the ITC block, except a package bought from another tour operator', () => {
  assert.deepEqual(tripTag(trip('to5'), { id: 'b', component: 'hotel' }), { trip_id: 't', booking_id: 'b', regime: 'to5' });
  assert.deepEqual(tripTag(trip('to5'), { id: 'p', component: 'package' }), { trip_id: 't', booking_id: 'p' });
  assert.deepEqual(tripTag(trip('to18')), { trip_id: 't' });
});

test('overrides: bills of 5 % trips that still claim ITC, in the period, with the reason', () => {
  const bill = { id: 'p', bill_number: 'H/9', date: '2026-11-11', taxable: 42000, cgst: 1050, sgst: 1050, igst: 0, total: 44100, itc_eligible: true, tv: { trip_id: 't', regime: 'to5', itc_reason: 'Commercial hotel, CA advised' } };
  assert.deepEqual(itcOverrides([bill, { ...bill, id: 'q', itc_eligible: false }, { ...bill, id: 'r', tv: { trip_id: 't' } }], '2026-11-01', '2026-11-30').map((o) => [o.id, o.tax, o.reason]), [['p', 2100, 'Commercial hotel, CA advised']]);
  assert.deepEqual(itcOverrides([bill], '2026-12-01', '2026-12-31'), []);
});

test('GST guard: rate mix on a travel invoice; ITC claimed on the trip of a 5 % invoice', () => {
  const inv = { id: 'i', tv: { regime: 'to5', trip: { id: 't', code: '2611-001' } }, items: [{ tax_rate: 5, quantity: 1, rate: 60000 }, { tax_rate: 18, quantity: 1, rate: 1000 }] } as never;
  assert.deepEqual(tvExceptions(inv).map((e) => e.code), ['TV_MIX']);
  setTable('purchases', [{ id: 'p', bill_number: 'H/9', date: '2026-11-11', taxable: 1000, cgst: 25, sgst: 25, igst: 0, total: 1050, itc_eligible: true, tv: { trip_id: 't', regime: 'to5' } }]);
  assert.deepEqual(tvExceptions(inv).map((e) => [e.code, e.vars]), [['TV_MIX', {}], ['TV_ITC_5', { trip: '2611-001' }]]);
  assert.deepEqual(tvExceptions({ id: 'j', items: [] } as never), [], 'no snapshot, no check');
});
