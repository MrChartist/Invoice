/**
 * R15-D3 events: budget roll-up (approved / booked / billed / paid, over budget, a component without a head), the
 * client's receipts and open advances, the event cleaning, the Sec 12(7)(a) POS by registration and venue State (see
 * tv-pos), and vendor TDS hints by component and date (manpower → contractor limb only from 2026-04-01).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanEvent, eventBudget, eventMoney, eventRule, vendorTdsHint } from '../src/lib/travel/tv-events.ts';
import { EVENT_RULES } from '../src/lib/travel-rules.ts';

const bk = (id: string, component: string, cost: number, o: object = {}) => ({ id, trip_id: 't', component, start: '2026-11-20', cost, sell: 0, status: 'confirmed', created_at: '', ...o }) as never;

test('budget roll-up: approved vs booked vs billed vs paid; over-budget heads; unbudgeted component; cancelled left out', () => {
  const ev = { budget: [{ head: 'venue', approved: 500000 }, { head: 'decor', approved: 200000 }, { head: 'catering', approved: 600000 }] };
  const bills = [{ id: 'p1', date: '2026-11-21', bill_number: 'D1', vendor_name: 'Decor Co', total: 260000, amount_paid: 100000, tv: { trip_id: 't', booking_id: 'b2' } }];
  const s = eventBudget(ev, [bk('b1', 'venue', 450000), bk('b2', 'decor', 240000), bk('b3', 'manpower', 60000), bk('b4', 'catering', 900000, { status: 'cancelled' })], bills);
  const by = Object.fromEntries(s.rows.map((r) => [r.head, r]));
  assert.deepEqual([by.decor.booked, by.decor.billed, by.decor.paid, by.decor.over], [240000, 260000, 100000, true]);
  assert.equal(by.venue.over, false);
  assert.deepEqual([by.manpower.approved, by.manpower.over], [0, true]);
  assert.deepEqual([by.catering.booked, by.catering.over], [0, false]);
  assert.deepEqual(s.over.sort(), ['decor', 'manpower']);
  assert.equal(s.approved, 1300000);
});

test('client side: invoiced and received on live invoices of the event, open advances of the client', () => {
  const inv = [
    { id: 'i1', cost_centre_id: 't', status: 'Sent', total: 500000, amount_paid: 200000 },
    { id: 'i2', cost_centre_id: 't', status: 'Draft', total: 900000, amount_paid: 0 },
    { id: 'i3', cost_centre_id: 'x', status: 'Sent', total: 1, amount_paid: 1 },
  ];
  const adv = [{ id: 'a1', number: 'ADV/1', date: '2026-10-01', amount: 300000, client: { id: 'c1', name: 'Rao' } }, { id: 'a2', number: 'ADV/2', date: '2026-10-01', amount: 5, client: { id: 'c2', name: 'X' } }];
  assert.deepEqual(eventMoney('t', 'c1', inv as never, [], adv as never), { invoiced: 500000, received: 200000, advances: 300000 });
});

test('event particulars are cleaned', () => {
  assert.deepEqual(cleanEvent({ venue: ' Rambagh ', state: '08', date_from: '2026-11-20', date_to: 'bad', guests: 400.4, budget: [{ head: 'decor', approved: -5 }, { head: 'decor', approved: 9 }, { head: ' ', approved: 1 }] }), { venue: 'Rambagh', state: '08', date_from: '2026-11-20', guests: 400, budget: [{ head: 'decor', approved: 0 }] });
});

test('vendor TDS hints by component and date', () => {
  assert.deepEqual(vendorTdsHint('decor', '2026-01-10'), { limb: 'contractor', label: '194C' });
  assert.match(vendorTdsHint('catering', '2026-05-01')!.label, /Sl\. 6\(i\)/);
  assert.match(vendorTdsHint('artist', '2026-05-01')!.label, /Sl\. 6\(iii\)/);
  assert.equal(vendorTdsHint('artist', '2025-05-01')!.label, '194J');
  assert.equal(vendorTdsHint('manpower', '2026-03-31'), null);
  assert.equal(vendorTdsHint('manpower', '2026-04-01')?.limb, 'contractor');
  assert.equal(vendorTdsHint('visa', '2026-04-01'), null);
});

test('event fee rule: SAC 998596 at 18 %, unverified', () => {
  assert.deepEqual(eventRule('2026-05-01'), { sac: '998596', rate: 18 });
  assert.ok(EVENT_RULES.every((r) => r.verified === false));
});
