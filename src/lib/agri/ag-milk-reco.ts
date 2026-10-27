/**
 * AG-B4 fat / SNF reconciliation (pure): collected (closed shifts) vs dispatched (sent) vs received (the union's
 * acknowledgement) per day or month, in litres, kg fat and kg SNF; local sales on milk cards as an outflow; the centre
 * gap (collected − sent − local) and the transit shortage (sent − received) with its % of kg fat. Days beyond the
 * tolerance (default 0.5% of kg fat — practice, `MILK_DEFAULTS`) are flagged. Memo only: no write-off is posted (AG28).
 */
import type { AgMilkSettings, MilkCard, MilkDispatch, MilkShift } from '../../types/agri-r12';
import { num, round2 } from '../invoice-calc';
import { ruleAt } from '../tax-rules';
import { MILK_DEFAULTS } from '../agri-rules';
import { clrOf, q3, solids, toL } from './ag-rate-chart';
import { cardQty } from './ag-milk-cards';

interface Solids { l: number; fat: number; snf: number }
export interface RecoRow { key: string; collected: Solids; sent: Solids; received: Solids; local: number; gapL: number; shortFat: number; shortSnf: number; shortPct: number; flag: boolean }

const zero = (): Solids => ({ l: 0, fat: 0, snf: 0 });
const add = (a: Solids, l: number, fat: number, snf: number) => { a.l = q3(a.l + l); a.fat = q3(a.fat + fat); a.snf = q3(a.snf + snf); };

export function milkReco(d: { shifts: readonly MilkShift[]; dispatches: readonly MilkDispatch[]; cards?: readonly MilkCard[]; from: string; to: string; centreId?: string; group?: 'day' | 'month'; settings?: AgMilkSettings }): RecoRow[] {
  const tol = num(d.settings?.tolerance_pct) || ruleAt(MILK_DEFAULTS, d.to).fatTolerancePct;
  const keyOf = (day: string) => (d.group === 'month' ? day.slice(0, 7) : day);
  const inR = (day: string) => day >= d.from && day <= d.to;
  const rows = new Map<string, RecoRow>();
  const row = (day: string) => {
    const k = keyOf(day);
    let r = rows.get(k);
    if (!r) rows.set(k, (r = { key: k, collected: zero(), sent: zero(), received: zero(), local: 0, gapL: 0, shortFat: 0, shortSnf: 0, shortPct: 0, flag: false }));
    return r;
  };
  for (const s of d.shifts) {
    if (!s.closed_at || !inR(s.date) || (d.centreId && s.centre_id !== d.centreId)) continue;
    for (const e of s.entries) {
      if (e.rejected) continue;
      const clr = num(e.clr) || clrOf(e.milk, d.settings, s.date);
      const sol = solids(e.qty, e.unit, e.fat, e.snf, clr);
      add(row(s.date).collected, toL(e.qty, e.unit, clr), sol.kgFat, sol.kgSnf);
    }
  }
  for (const x of d.dispatches) {
    if (!inR(x.date) || (d.centreId && x.centre_id !== d.centreId)) continue;
    const clr = clrOf(x.milk, d.settings, x.date);
    const r = row(x.date);
    const s = solids(x.sent.qty, x.sent.unit, x.sent.fat, x.sent.snf, clr);
    add(r.sent, toL(x.sent.qty, x.sent.unit, clr), s.kgFat, s.kgSnf);
    if (x.received) {
      const v = solids(x.received.qty, x.sent.unit, x.received.fat, x.received.snf, clr);
      add(r.received, toL(x.received.qty, x.sent.unit, clr), v.kgFat, v.kgSnf);
      r.shortFat = q3(r.shortFat + s.kgFat - v.kgFat);
      r.shortSnf = q3(r.shortSnf + s.kgSnf - v.kgSnf);
    }
  }
  for (const c of d.cards ?? []) {
    for (let day = 1; day <= 31; day++) {
      const iso = `${c.month}-${String(day).padStart(2, '0')}`;
      if (!inR(iso) || Number(iso.slice(8)) > new Date(Number(c.month.slice(0, 4)), Number(c.month.slice(5, 7)), 0).getDate()) continue;
      const q = cardQty(c, day);
      if (q > 0) row(iso).local = q3(row(iso).local + q);
    }
  }
  return [...rows.values()].sort((a, b) => a.key.localeCompare(b.key)).map((r) => {
    const sentAcked = r.shortFat + r.received.fat;
    const shortPct = sentAcked > 0 ? round2((r.shortFat / sentAcked) * 100) : 0;
    return { ...r, gapL: q3(r.collected.l - r.sent.l - r.local), shortPct, flag: Math.abs(shortPct) > tol };
  });
}
