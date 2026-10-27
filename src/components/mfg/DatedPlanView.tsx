/**
 * MF-A4 "By date" view of the production plan (lazy, from the MRP tab): dated demand (open sales orders, released
 * orders' materials, the plan's lines at its due date) and dated supply (stock, open POs, open orders) netted bucket by
 * bucket; planned receipts with their "order by" dates, past-due and late flags. Suggestions only — the MRP tab's
 * "Create purchase order" / "Create production orders" buttons act on the plan.
 */
import { useMemo, useState } from 'react';
import type { MfgContext } from '../manufacturing/context';
import type { ProductionPlanLine } from '../../types/manufacturing';
import { computeStock } from '../../lib/inventory';
import { bomsDb } from '../../lib/manufacturing';
import { datedSources, runDatedMrp } from '../../lib/mfg/mf-mrp-dated';
import { makeDaysOf } from '../../lib/mfg/mf-routings';
import { num } from '../../lib/invoice-calc';
import { todayInput } from '../../lib/utils';
import { fT } from '../../i18n/areas/mfg-r13a';
import controls from '../../styles/controls.module.css';
import { F, Grid, Sel, fmt, row } from './floor-ui';

export default function DatedPlanView({ ctx, lines, due }: { ctx: MfgContext; lines: readonly ProductionPlanLine[]; due?: string }) {
  const [by, setBy] = useState<'day' | 'week'>('week');
  const today = todayInput();
  const rows = useMemo(() => {
    const src = datedSources(ctx.items, today);
    const plan = lines.filter((l) => l.item_id && num(l.qty) > 0).map((l) => ({ item_id: l.item_id, date: due || today, qty: num(l.qty), source: 'Plan' }));
    const stock = new Map(computeStock(ctx.inputs).map((p) => [p.item.id, p.qty]));
    return runDatedMrp({ items: ctx.items, boms: bomsDb.all(), stock, demand: [...src.demand, ...plan], supply: src.supply, start: today, by, count: by === 'week' ? 7 : 14, makeDays: (id) => makeDaysOf(id) });
  }, [ctx.items, ctx.inputs, lines, due, today, by]);
  const keys = rows[0]?.buckets.map((b) => b.key) ?? [];
  return (
    <section data-mf-dated>
      <div style={row}><F label={fT('by')} w={120}><Sel v={by} set={(x) => setBy(x as 'day' | 'week')} o={[['week', fT('week')], ['day', fT('day')]]} /></F></div>
      <Grid attr="dated" head={[fT('item'), fT('action'), fT('lead'), fT('orderBy'), ...keys.map((k) => k.slice(5))]} rows={rows.map((r) => [
        `${r.item.name}${r.pastDue ? ` · ${fT('pastDue')}` : ''}`,
        r.action === 'none' ? '—' : fT(r.action),
        r.lead,
        r.orders.map((o) => `${fmt(o.qty)} @ ${o.release}${o.late ? ` (${fT('late')})` : ''}`).join(', ') || '—',
        ...r.buckets.map((b) => (b.gross || b.planned ? `${fmt(b.gross)}${b.planned ? ` +${fmt(b.planned)}` : ''}` : '')),
      ])} />
      <p className={controls.hint}>{fT('datedHint')}</p>
    </section>
  );
}
