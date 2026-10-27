/**
 * MF-A3 day report: per work centre — hours run, set-up, idle (available − run − set-up), good / rejected, scrap kg —
 * and per operator (hours, good, rejected). Pure: cards and centres in, rows out.
 */
import type { JobCard, WorkCentre } from '../../types/mfg-r13';
import { num, round2 } from '../invoice-calc';
import { availableHours } from './mf-centres';

export interface CentreDay { id: string; name: string; available: number; run: number; setup: number; idle: number; good: number; rejected: number; scrapKg: number }
export interface OperatorDay { key: string; kind: 'employee' | 'karigar' | 'none'; id: string; hours: number; good: number; rejected: number }

const r3 = (x: number) => Math.round((x + Number.EPSILON) * 1000) / 1000 || 0;

export function floorDay(cards: readonly JobCard[], centres: readonly WorkCentre[], day: string): { centres: CentreDay[]; operators: OperatorDay[] } {
  const rows = new Map<string, CentreDay>(centres.map((c) => [c.id, { id: c.id, name: c.name, available: availableHours(c, day), run: 0, setup: 0, idle: 0, good: 0, rejected: 0, scrapKg: 0 }]));
  const ops = new Map<string, OperatorDay>();
  for (const c of cards) {
    const row = rows.get(c.work_centre_id);
    for (const e of c.entries) {
      if (e.date !== day) continue;
      if (row) {
        if (e.setup) row.setup += num(e.hours);
        else row.run += num(e.hours);
        row.good += num(e.good);
        row.rejected += num(e.rejected);
        row.scrapKg += num(e.scrap_kg);
      }
      const key = e.operator ? `${e.operator.kind}:${e.operator.id}` : 'none:';
      const o = ops.get(key) ?? { key, kind: e.operator?.kind ?? 'none', id: e.operator?.id ?? '', hours: 0, good: 0, rejected: 0 };
      o.hours += num(e.hours);
      o.good += num(e.good);
      o.rejected += num(e.rejected);
      ops.set(key, o);
    }
  }
  const centresOut = [...rows.values()].map((r) => ({ ...r, run: round2(r.run), setup: round2(r.setup), idle: round2(Math.max(r.available - r.run - r.setup, 0)), good: r3(r.good), rejected: r3(r.rejected), scrapKg: r3(r.scrapKg) }));
  return { centres: centresOut, operators: [...ops.values()].map((o) => ({ ...o, hours: round2(o.hours), good: r3(o.good), rejected: r3(o.rejected) })) };
}
