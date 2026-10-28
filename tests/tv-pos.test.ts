/**
 * R15-D2 / D3 place of supply: Indian client by Sec 12(2) (registered → GSTIN State; else address), hotel hint in the
 * agent regime, inbound foreign tourist → POS India / not an export, outbound foreign tourist → exempt offer, events by
 * Sec 12(7)(a), the R14 Sec 2(6) check reused for a trip marked as export, the foreign DMC hint.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { dmcHint, eventPos, isForeign, travelPos, tripExportCheck } from '../src/lib/travel/tv-pos.ts';

const trip = (o: object = {}) => ({ kind: 'trip' as const, scope: 'domestic' as const, regime: 'to5' as const, ...o });

test('Indian client: registered → GSTIN State; unregistered → address on record; hotel hint for the agent regime', () => {
  assert.deepEqual([travelPos(trip(), { gstin: '27ABCDE1234F1Z5', state_code: '29' }).state, travelPos(trip(), { gstin: '27ABCDE1234F1Z5' }).key], ['27', 'reg']);
  const u = travelPos(trip(), { state_code: '08' });
  assert.deepEqual([u.key, u.state], ['addr', '08']);
  assert.match(u.note, /Sec 12\(2\)/);
  assert.equal(travelPos(trip({ regime: 'agent' }), { state_code: '08' }, ['hotel']).hotel, true);
  assert.equal(travelPos(trip(), {}).key, 'unknown');
});

test('foreign tourist: inbound → POS India, not an export; outbound → exempt regime offered', () => {
  const f = { tv: { foreign_tourist: true } };
  assert.ok(isForeign(f) && isForeign({ state_code: '96' }) && isForeign({ ps: { country: 'AE' } }) && !isForeign({ ps: { country: 'India' } }));
  const i = travelPos(trip({ scope: 'inbound' }), f);
  assert.equal(i.key, 'inbound');
  assert.match(i.note, /not an export.*13\(3\)\(b\)/);
  const o = travelPos(trip({ scope: 'outbound' }), f);
  assert.deepEqual([o.key, o.exempt], ['outside', true]);
  assert.equal(travelPos(trip({ scope: 'outbound', regime: 'exempt_outside' }), f).exempt, false);
});

test('events: registered → client State; unregistered → venue State; abroad → client location', () => {
  assert.deepEqual([eventPos({ gstin: '07ABCDE1234F1Z5' }, '08').state, eventPos({ gstin: '07ABCDE1234F1Z5' }, '08').key], ['07', 'event_reg']);
  const v = eventPos({ state_code: '27' }, '08');
  assert.deepEqual([v.key, v.state], ['event_venue', '08']);
  assert.match(v.note, /12\(7\)\(a\)/);
  assert.deepEqual([eventPos({ state_code: '27' }, '96').key, eventPos({ state_code: '27' }, '96').state], ['event_abroad', '27']);
  assert.equal(travelPos({ kind: 'event', scope: 'domestic', regime: 'to18', event: { state: '08' } }, {}).state, '08');
});

test('a trip invoice marked as export runs the R14 Sec 2(6) check: inbound fails (performed in India)', () => {
  assert.equal(tripExportCheck({ supply_type: 'B2B' } as never, null, 'inbound'), null);
  const inv = { id: 'i', issue_date: '2026-05-01', supply_type: 'EXPORT_LUT', place_of_supply: '96', currency: 'USD', sender: { stateCode: '27' } };
  const c = tripExportCheck(inv as never, { ps: { country: 'US' } }, 'inbound');
  assert.equal(c?.verdict, 'not');
  assert.notEqual(tripExportCheck(inv as never, { ps: { country: 'US' } }, 'outbound')?.verdict, 'not');
});

test('foreign DMC bill on an outbound trip: the no-import-RCM hint only', () => {
  assert.equal(dmcHint({ tv: { kind: 'dmc' } }, 'outbound'), true);
  assert.equal(dmcHint({ state_code: '96' }, 'outbound'), true);
  assert.equal(dmcHint({ tv: { kind: 'dmc' } }, 'domestic'), false);
  assert.equal(dmcHint({ gstin: '27ABCDE1234F1Z5', tv: { kind: 'dmc' } }, 'outbound'), false);
});
