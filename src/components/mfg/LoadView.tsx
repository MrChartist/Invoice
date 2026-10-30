/**
 * MF-A4 Floor → Load: each work centre's load (open orders' remaining hours placed back from their due dates) against
 * its available hours, by day or week, over-100% highlighted; move an order's due date (audited edit, nothing is
 * rescheduled automatically); the promise date for a new quantity of an item.
 */
import { useMemo, useState } from 'react';
import type { MfgContext } from '../manufacturing/context';
import type { ProductionOrder } from '../../types/production-r4';
import { backwardLoad, centreBuckets, promiseDate } from '../../lib/mfg/mf-capacity';
import { addDays, loadCentres } from '../../lib/mfg/mf-centres';
import { loadCards } from '../../lib/mfg/mf-jobcards';
import { defaultRoutingOf, opsForQty } from '../../lib/mfg/mf-routings';
import { productionOrdersDb } from '../../lib/production/orders';
import { getTable } from '../../lib/storage';
import { num } from '../../lib/invoice-calc';
import { todayInput } from '../../lib/utils';
import { fT } from '../../i18n/areas/mfg-r13a';
import controls from '../../styles/controls.module.css';
import { F, Grid, In, Sel } from './floor-ui';
import { fmt, row } from './floor-util';

export default function LoadView({ ctx }: { ctx: MfgContext }) {
  const [v, setV] = useState(0);
  const [from, setFrom] = useState(todayInput());
  const [by, setBy] = useState<'day' | 'week'>('week');
  const to = addDays(from, by === 'week' ? 41 : 13);
  const centres = useMemo(() => loadCentres().filter((c) => c.active), []);
  const orders = useMemo(() => (void v, void ctx.version, productionOrdersDb.all()), [v, ctx.version]);
  const opsOf = useMemo(() => (o: ProductionOrder) => o.mf?.ops ?? (o.status === 'planned' ? (() => { const r = defaultRoutingOf(o.item_id); return r ? opsForQty(r, num(o.planned_qty), centres) : undefined; })() : undefined), [centres]);
  const result = useMemo(() => {
    try {
      return { load: backwardLoad(orders, opsOf, loadCards(), centres), error: '' };
    } catch (e) {
      return { load: new Map(), error: (e as Error).message };
    }
  }, [orders, opsOf, centres]);
  const [item, setItem] = useState('');
  const [qty, setQty] = useState('');
  const [promise, setPromise] = useState('');
  const [move, setMove] = useState<{ id: string; due: string }>({ id: '', due: '' });
  const ask = () => {
    const r = defaultRoutingOf(item);
    if (!r) return setPromise(fT('noRouting'));
    try {
      setPromise(fT('promise', { date: promiseDate(opsForQty(r, num(qty), centres), centres, result.load, from) }));
    } catch (e) {
      setPromise((e as Error).message);
    }
  };
  const moveOrder = () => {
    const o = orders.find((x) => x.id === move.id);
    if (!o || !move.due) return;
    try {
      productionOrdersDb.save({ id: o.id, date: o.date, item_id: o.item_id, bom_id: o.bom_id, planned_qty: o.planned_qty, due_date: move.due, standard_conversion: o.standard_conversion }, ctx.items, getTable('boms'));
      setV((x) => x + 1);
      ctx.changed(fT('moved', { number: o.number, date: move.due }));
    } catch (e) {
      ctx.error((e as Error).message);
    }
  };
  const open = orders.filter((o) => ['planned', 'released', 'in_progress'].includes(o.status));
  return (
    <section data-mf-load>
      <div style={row}>
        <F label={fT('from')} w={160}><In type="date" v={from} set={setFrom} /></F>
        <F label={fT('by')} w={120}><Sel v={by} set={(x) => setBy(x as 'day' | 'week')} o={[['week', fT('week')], ['day', fT('day')]]} /></F>
      </div>
      {result.error && <p className={controls.error} role="alert">{result.error}</p>}
      {centres.map((c) => (
        <div key={c.id} data-mf-load-centre={c.name}>
          <strong>{c.name}</strong>
          <div style={{ display: 'grid', gap: 2, margin: '0.25rem 0 0.75rem' }}>
            {centreBuckets(c, result.load, from, to, by).map((b) => (
              <div key={b.key} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: 'var(--text-sm)' }}>
                <span style={{ width: 92 }}>{b.key}</span>
                <span style={{ flex: 1, background: 'var(--muted)', borderRadius: 'var(--r-6)', height: 12, overflow: 'hidden' }}>
                  <span style={{ display: 'block', height: '100%', width: `${Math.min(b.pct, 100)}%`, background: b.pct > 100 ? 'var(--sys-red-ink)' : 'var(--tint)' }} />
                </span>
                <span style={{ width: 150, color: b.pct > 100 ? 'var(--sys-red-ink)' : undefined }} data-mf-pct={b.pct}>{fmt(b.load)} / {fmt(b.available)} h · {b.pct}%</span>
              </div>
            ))}
          </div>
        </div>
      ))}
      {!centres.length && <p className={controls.hint}>{fT('needCentres')}</p>}
      {ctx.canBooks && open.length > 0 && (
        <div style={row}>
          <F label={fT('order')}><Sel v={move.id} set={(x) => setMove({ id: x, due: orders.find((o) => o.id === x)?.due_date ?? '' })} o={[['', '-'], ...open.map((o) => [o.id, `${o.number}${o.due_date ? ` · ${o.due_date}` : ''}`] as const)]} /></F>
          <F label={fT('due')} w={160}><In type="date" v={move.due} set={(x) => setMove({ ...move, due: x })} /></F>
          <button type="button" className={controls.btnOutline} onClick={moveOrder} disabled={!move.id}>{fT('moveDue')}</button>
        </div>
      )}
      <h4>{fT('promiseTitle')}</h4>
      <div style={row}>
        <F label={fT('item')}><Sel v={item} set={setItem} o={[['', '-'], ...ctx.items.filter((i) => i.track_stock).map((i) => [i.id, i.name] as const)]} /></F>
        <F label={fT('qty')} w={110}><In v={qty} set={setQty} inputMode="decimal" /></F>
        <button type="button" className={controls.btnOutline} onClick={ask} disabled={!item || !(num(qty) > 0)} data-mf="promise">{fT('promiseAsk')}</button>
      </div>
      {promise && <p data-mf-promise>{promise}</p>}
      <Grid attr="open" head={[fT('order'), fT('item'), fT('qty'), fT('due')]} rows={open.map((o) => [o.number, ctx.items.find((i) => i.id === o.item_id)?.name ?? '?', fmt(num(o.planned_qty)), o.due_date ?? '-'])} />
    </section>
  );
}
