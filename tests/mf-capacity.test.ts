/** MF-A4 capacity: available hours, backward loading from the due date, overload %, promise date, 0-hour centre refused. */
import './helpers/shim.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backwardLoad, centreBuckets, promiseDate } from '../src/lib/mfg/mf-capacity.ts';
import type { MfOrderOp, WorkCentre } from '../src/types/mfg-r13.ts';
import type { ProductionOrder } from '../src/types/production-r4.ts';

const wc = (id: string, x: Partial<WorkCentre> = {}): WorkCentre => ({ id, name: id, kind: 'machine', hourly_rate: 0, shifts: [{ name: 'S', hours: 8 }], days: [1, 2, 3, 4, 5, 6], active: true, ...x });
const op = (id: string, seq: number, centre: string, h: number): MfOrderOp => ({ id, seq, name: id, work_centre_id: centre, setup_min: 0, planned_hours: h, rate: 0 });
const order = (id: string, due: string, ops: MfOrderOp[], status: ProductionOrder['status'] = 'released'): ProductionOrder => ({ id, number: id, date: '2026-11-01', item_id: 'i', planned_qty: 10, due_date: due, wip_godown_id: 'w', status, log: [], mf: { ops } });

test('backward loading from the due date, skipping Sunday; overload over 100%', () => {
  const laser = wc('laser');
  const brake = wc('brake');
  // Due Mon 16 Nov: bend 10 h on the brake (Mon 8 h, Sat 14th 2 h), cut 12 h on the laser before it (Sat 8 h, Fri 4 h).
  const load = backwardLoad([order('o1', '2026-11-16', [op('cut', 10, 'laser', 12), op('bend', 20, 'brake', 10)])], (o) => o.mf?.ops, [], [laser, brake]);
  assert.deepEqual(Object.fromEntries(load.get('brake')!), { '2026-11-16': 8, '2026-11-14': 2 });
  assert.deepEqual(Object.fromEntries(load.get('laser')!), { '2026-11-14': 8, '2026-11-13': 4 });
  const more = backwardLoad([order('o1', '2026-11-16', [op('cut', 10, 'laser', 12)]), order('o2', '2026-11-16', [op('cut', 10, 'laser', 12)])], (o) => o.mf?.ops, [], [laser]);
  const week = centreBuckets(laser, more, '2026-11-09', '2026-11-15', 'week');
  assert.deepEqual(week.map((b) => [b.key, b.available, b.load]), [['2026-11-09', 48, 8]]);
  const days = centreBuckets(laser, more, '2026-11-16', '2026-11-16');
  assert.equal(days[0].pct, 200, 'two orders on one day: infinite loading shows the overload');
  assert.deepEqual(backwardLoad([order('o3', '2026-11-16', [op('x', 10, 'laser', 5)], 'closed')], (o) => o.mf?.ops, [], [laser]).size, 0);
});

test('reported hours reduce the remaining load; promise date forward-loads into free hours; 0-hour centre refused', () => {
  const laser = wc('laser', { capacity_units: 1, efficiency_pct: 100 });
  const o = order('o1', '2026-11-16', [op('cut', 10, 'laser', 12)]);
  const card = { id: 'c', number: 'JCD/1', date: '2026-11-10', order_id: 'o1', op_id: 'cut', work_centre_id: 'laser', planned: { qty: 10, hours: 12 }, status: 'running' as const, entries: [{ id: 'e', date: '2026-11-10', hours: 4, good: 3, rejected: 0, rework: 0 }] };
  const load = backwardLoad([o], (x) => x.mf?.ops, [card], [laser]);
  assert.equal([...load.get('laser')!.values()].reduce((s, h) => s + h, 0), 8);
  assert.equal(promiseDate([op('a', 10, 'laser', 20)], [laser], new Map(), '2026-11-09'), '2026-11-11', 'Mon 8 + Tue 8 + Wed 4');
  assert.equal(promiseDate([op('a', 10, 'laser', 8)], [laser], new Map([['laser', new Map([['2026-11-09', 8]])]]), '2026-11-09'), '2026-11-10', 'Monday is full');
  assert.throws(() => promiseDate([op('a', 10, 'dead', 1)], [wc('dead', { days: [] })], new Map(), '2026-11-09'), /no working hours/);
});
