/** R7-B1 folio windows: routing by kind, split / transfer keep totals, void cap and owner PIN, open → invoiced. */
import './helpers/shim.ts';
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { setupHotel } from './helpers/hotel.ts';
import { clientMH } from './helpers/world.ts';
import { walkIn } from '../src/lib/hotel/checkin.ts';
import { hotelDb } from '../src/lib/hotel/hotel-store.ts';
import { runNight } from '../src/lib/hotel/night-audit.ts';
import { folioBalance, folioTotal } from '../src/lib/hotel/room-post.ts';
import { VoidPinRequired, openHouseFolio, postCharge, splitLine, stayFolios, transferLines, voidLine } from '../src/lib/hotel/folio.ts';
import { cleanRouting, defaultRouting } from '../src/lib/hotel/routing.ts';
import { setBillTo } from '../src/lib/hotel/bill-to.ts';
import { saveCheckout } from '../src/lib/hotel/checkout-save.ts';
import { setActorProvider } from '../src/lib/access.ts';
import { localDb } from '../src/lib/localDb.ts';

afterEach(() => setActorProvider(null));

function stay(arrival = '2026-10-20', departure = '2026-10-22', roomId = 'r101', over: Record<string, unknown> = {}) {
  return walkIn({ booking: { guest: { name: 'Asha Rao' }, arrival, departure, guarantee: 'none', lines: [{ room_type_id: 'dlx', rate_plan_id: 'ep', adults: 2, children: 0, extra_beds: 0, room_id: roomId }], ...over } as never, roomId, guests: [{ name: 'Asha Rao', nationality: 'IN' }], at: new Date(`${arrival}T13:00:00`) });
}
const total = () => Math.round(hotelDb.folios().reduce((s, f) => s + folioTotal(f), 0) * 100) / 100;

test('routing: company bill-to sends room kinds to window 2 and the rest to window 1; a user rule wins', () => {
  setupHotel('2026-10-20');
  localDb.clients.upsert(clientMH);
  const { res, line } = stay();
  setBillTo(res.id, 'company', clientMH);
  runNight('2026-10-20');
  postCharge({ resId: res.id, lineId: line.id }, { kind: 'laundry', desc: 'Laundry', qty: 2, rate: 150, tax_rate: 18 });
  const [w1, w2] = stayFolios(hotelDb.folios(), res.id);
  assert.deepEqual([w1.window, w1.lines.map((l) => l.kind)], [1, ['laundry']]);
  assert.deepEqual([w2.window, w2.payer.client_id, w2.lines.map((l) => l.kind)], [2, 'c-mh', ['room']]);
  setBillTo(res.id, 'company', clientMH, [{ kinds: ['laundry'], window: 3 }]);
  postCharge({ resId: res.id, lineId: line.id }, { kind: 'laundry', qty: 1, rate: 100 });
  assert.equal(stayFolios(hotelDb.folios(), res.id).find((f) => f.window === 3)?.lines[0].amount, 100);
  assert.deepEqual(defaultRouting({}), []);
  assert.deepEqual(cleanRouting([{ kinds: ['fnb', 'fnb'], window: 9 }, { kinds: ['fnb'], window: 2 }]), [{ kinds: ['fnb'], window: 4 }]);
});

test('split by amount and by quantity keeps the totals; transfer room-to-room keeps moved_from', () => {
  setupHotel('2026-10-20');
  const a = stay('2026-10-20', '2026-10-22', 'r101');
  const b = stay('2026-10-20', '2026-10-22', 'r102');
  runNight('2026-10-20');
  const f1 = postCharge({ resId: a.res.id, lineId: a.line.id }, { kind: 'minibar', qty: 4, rate: 50 });
  const before = total();
  const room = hotelDb.folios().find((f) => f.id === f1.id)!.lines.find((l) => l.kind === 'room')!;
  splitLine(f1.id, room.id, { amount: 1000 }, 2);
  const mini = hotelDb.folios().find((f) => f.id === f1.id)!.lines.find((l) => l.kind === 'minibar')!;
  splitLine(f1.id, mini.id, { qty: 1 }, 2);
  assert.equal(total(), before, 'split keeps the total');
  const w2 = stayFolios(hotelDb.folios(), a.res.id).find((f) => f.window === 2)!;
  assert.deepEqual(w2.lines.map((l) => [l.kind, l.amount, l.moved_from]), [['room', 1000, f1.name], ['minibar', 50, f1.name]]);
  assert.ok(w2.lines[0].key?.startsWith(`stay:${a.line.id}:2026-10-20:s`), 'the split part keeps the night key (audit stays idempotent)');
  const target = stayFolios(hotelDb.folios(), b.res.id)[0];
  transferLines(f1.id, [mini.id], { folioId: target.id });
  assert.equal(total(), before);
  assert.equal(hotelDb.folios().find((f) => f.id === target.id)!.lines.find((l) => l.id === mini.id)?.moved_from, f1.name);
  assert.throws(() => transferLines(f1.id, ['nope'], { window: 2 }), /Only open/);
});

test('void: reason needed, room nights only as rate correction / complimentary, clerk cap needs the owner PIN; voided lines leave the balance', () => {
  setupHotel('2026-10-20');
  const { res, line } = stay();
  runNight('2026-10-20');
  const f = postCharge({ resId: res.id, lineId: line.id }, { kind: 'laundry', qty: 1, rate: 600 });
  const [room, laundry] = f.lines;
  assert.throws(() => voidLine(f.id, laundry.id, ' '), /reason/);
  assert.throws(() => voidLine(f.id, room.id, 'guest unhappy'), /rate correction/);
  setActorProvider(() => ({ id: 'c', name: 'Clerk', role: 'clerk' }));
  const at = new Date('2026-10-21T10:00:00');
  voidLine(f.id, laundry.id, 'posted twice', { at });
  assert.throws(() => voidLine(f.id, room.id, 'Rate correction', { at }), (e) => e instanceof VoidPinRequired, '₹600 + ₹3,500 is above the ₹1,000 cap');
  const out = voidLine(f.id, room.id, 'Rate correction', { at, ownerOk: true });
  assert.equal(out.lines.length, 2, 'voided lines stay on the folio');
  assert.deepEqual(out.lines.map((l) => l.void?.by), ['Clerk', 'Clerk']);
  assert.equal(folioBalance(out), 0);
});

test('open → invoiced once every window is billed; a house folio takes charges directly', () => {
  setupHotel('2026-10-20');
  localDb.clients.upsert(clientMH);
  const { res, line } = stay('2026-10-20', '2026-10-21');
  setBillTo(res.id, 'company', clientMH);
  runNight('2026-10-20');
  postCharge({ resId: res.id, lineId: line.id }, { kind: 'laundry', qty: 1, rate: 200, tax_rate: 18 });
  const [w1, w2] = stayFolios(hotelDb.folios(), res.id);
  saveCheckout({ windows: [{ folioId: w1.id, pay: { method: 'UPI', amount: 236 } }], day: '2026-10-21' });
  assert.equal(hotelDb.folios().find((f) => f.id === w1.id)?.status, 'open', 'one window billed: still open');
  saveCheckout({ windows: [{ folioId: w2.id }], checkout: { resId: res.id, lineId: line.id }, day: '2026-10-21' });
  assert.deepEqual(stayFolios(hotelDb.folios(), res.id).map((f) => f.status), ['invoiced', 'invoiced']);
  const house = openHouseFolio({ client_id: 'c-mh', name: 'Bharat Traders' });
  assert.equal(postCharge({ folioId: house.id }, { kind: 'fnb', qty: 1, rate: 900 }).lines[0].amount, 900);
  assert.equal(house.house, true);
});
