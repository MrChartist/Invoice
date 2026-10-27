/**
 * MF-A4 capacity load and promise date. Infinite backward loading: each open order's remaining operation hours are
 * placed BACKWARDS from its due date on its work centres' available hours (shifts × parallel units × efficiency − weekly
 * offs − holidays), operation by operation, as if the order were alone; the load per centre per day (or week) is then
 * compared with the hours available — over 100% is an overload the planner fixes by moving an order (nothing is
 * rescheduled automatically). The promise date forward-loads a new quantity into what is still free (finite, simple, no
 * re-sequencing). A work centre with no available hours is refused. Pure.
 */
import type { JobCard, MfOrderOp, WorkCentre } from '../../types/mfg-r13';
import type { ProductionOrder } from '../../types/production-r4';
import { num, round2 } from '../invoice-calc';
import { addDays, availableHours } from './mf-centres';

const HORIZON = 400;

/** Hours a day per centre (`centre id → day → hours`). */
export type LoadMap = Map<string, Map<string, number>>;

const add = (m: LoadMap, centre: string, day: string, h: number) => {
  const d = m.get(centre) ?? new Map<string, number>();
  d.set(day, round2((d.get(day) ?? 0) + h));
  m.set(centre, d);
};

/**
 * Refuses a centre that never has an available hour (shifts / days / efficiency of 0). QA16 P10: judged on its weekly
 * pattern without holidays — a shutdown of a week or more (Diwali) is not "no working hours"; the loading loops skip it.
 */
export function assertHours(c: WorkCentre, from: string): void {
  const plain = { ...c, holidays: [] };
  for (let i = 0; i < 7; i++) if (availableHours(plain, addDays(from, i)) > 0) return;
  throw new Error(`Work centre ${c.name} has no working hours: give it a shift and working days.`);
}

/** Remaining hours of each operation of an order: planned − reported (0 once the operation's good reaches the plan). */
export function remainingOps(order: Pick<ProductionOrder, 'id' | 'planned_qty'>, ops: readonly MfOrderOp[], cards: readonly JobCard[]): { op: MfOrderOp; hours: number }[] {
  return [...ops].sort((a, b) => a.seq - b.seq).map((op) => {
    const mine = cards.filter((c) => c.order_id === order.id && c.op_id === op.id);
    const good = mine.reduce((s, c) => s + c.entries.reduce((x, e) => x + num(e.good), 0), 0);
    const done = mine.reduce((s, c) => s + c.entries.reduce((x, e) => x + num(e.hours), 0), 0);
    return { op, hours: good + 0.0005 >= num(order.planned_qty) ? 0 : round2(Math.max(num(op.planned_hours) - done, 0)) };
  });
}

/**
 * Backward infinite loading of open orders (`opsOf` gives a planned order its default routing's operations). Orders
 * without a due date are loaded back from their own date + the routing's days. Returns the load map.
 */
export function backwardLoad(orders: readonly ProductionOrder[], opsOf: (o: ProductionOrder) => readonly MfOrderOp[] | undefined, cards: readonly JobCard[], centres: readonly WorkCentre[]): LoadMap {
  const byId = new Map(centres.map((c) => [c.id, c]));
  const load: LoadMap = new Map();
  for (const o of orders) {
    if (!['planned', 'released', 'in_progress'].includes(o.status)) continue;
    const ops = opsOf(o);
    if (!ops?.length) continue;
    let cursor = o.due_date || o.date;
    for (const { op, hours } of remainingOps(o, ops, cards).reverse()) {
      const c = byId.get(op.work_centre_id);
      if (!c || !(hours > 0)) continue;
      assertHours(c, cursor);
      let left = hours;
      let day = cursor;
      for (let i = 0; left > 0.0005 && i < HORIZON; i++, day = addDays(day, -1)) {
        const a = availableHours(c, day);
        if (!(a > 0)) continue;
        const take = Math.min(a, left);
        add(load, c.id, day, take);
        left = round2(left - take);
        cursor = day;
      }
    }
  }
  return load;
}

export interface LoadBucket { key: string; from: string; available: number; load: number; pct: number }

/** Load vs available per bucket (`day` or `week` starting Monday) between `from` and `to` for one centre. */
export function centreBuckets(c: WorkCentre, load: LoadMap, from: string, to: string, by: 'day' | 'week' = 'day'): LoadBucket[] {
  const out = new Map<string, LoadBucket>();
  for (let day = from, i = 0; day <= to && i < HORIZON; day = addDays(day, 1), i++) {
    const wd = new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10))).getUTCDay();
    const key = by === 'day' ? day : addDays(day, -((wd + 6) % 7));
    const b = out.get(key) ?? { key, from: key, available: 0, load: 0, pct: 0 };
    b.available = round2(b.available + availableHours(c, day));
    b.load = round2(b.load + (load.get(c.id)?.get(day) ?? 0));
    out.set(key, b);
  }
  return [...out.values()].map((b) => ({ ...b, pct: b.available > 0 ? Math.round((b.load / b.available) * 100) : b.load > 0 ? 999 : 0 }));
}

/**
 * Promise date: forward-load the operations (planned hours for the new quantity) from `start` into each centre's free
 * hours (available − already loaded); the day the last operation ends. Throws for a centre without hours.
 */
export function promiseDate(ops: readonly Pick<MfOrderOp, 'work_centre_id' | 'planned_hours' | 'seq'>[], centres: readonly WorkCentre[], load: LoadMap, start: string): string {
  const byId = new Map(centres.map((c) => [c.id, c]));
  const used: LoadMap = new Map();
  let cursor = start;
  for (const op of [...ops].sort((a, b) => a.seq - b.seq)) {
    const c = byId.get(op.work_centre_id);
    if (!c) continue;
    assertHours(c, cursor);
    let left = num(op.planned_hours);
    let day = cursor;
    for (let i = 0; left > 0.0005 && i < HORIZON * 2; i++) {
      const free = availableHours(c, day) - (load.get(c.id)?.get(day) ?? 0) - (used.get(c.id)?.get(day) ?? 0);
      if (free > 0.0005) {
        const take = Math.min(free, left);
        add(used, c.id, day, take);
        left = round2(left - take);
        cursor = day;
      }
      if (left > 0.0005) day = addDays(day, 1);
    }
    if (left > 0.0005) throw new Error(`No free capacity on ${c.name} within two years.`);
  }
  return cursor;
}
