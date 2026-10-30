/**
 * MF-A3 Floor → Job cards: per released order, its operations with planned vs reported (good / rejected / hours /
 * scrap kg), report an entry (start / stop or hours, operator, machine, reject reason, rework, scrap kg), the flow rule
 * and overlap warnings, "Send" for outside operations (Material Out prefill), "Use routing" for the standard conversion,
 * the day report, and the large-button operator screen (phone mode).
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { JobCard, MfOrderOp } from '../../types/mfg-r13';
import type { ProductionOrder } from '../../types/production-r4';
import type { MfgContext } from '../manufacturing/context';
import { cardTotals, loadCards, removeEntry } from '../../lib/mfg/mf-jobcards';
import { loadCentres } from '../../lib/mfg/mf-centres';
import { defaultRoutingOf, outsideSendHref, standardConversion } from '../../lib/mfg/mf-routings';
import { rejectReasons } from '../../lib/mfg/mf-settings';
import { floorDay } from '../../lib/mfg/mf-floor-report';
import { productionOrdersDb } from '../../lib/production/orders';
import { getTable } from '../../lib/storage';
import { num } from '../../lib/invoice-calc';
import { todayInput } from '../../lib/utils';
import { fT } from '../../i18n/areas/mfg-r13a';
import controls from '../../styles/controls.module.css';
import { F, Grid, In, Sel } from './floor-ui';
import { fmt, row } from './floor-util';
import OperatorScreen from './OperatorScreen';
import { submitEntry, usePeople, type EntryDraft } from './floor-util';


/** The entry form (also used by the operator screen). */
export function EntryForm({ ctx, value, set, people }: { ctx: MfgContext; value: EntryDraft; set: (p: EntryDraft) => void; people: { employees: [string, string][]; karigars: [string, string][] } }) {
  const scrapItems = ctx.items.filter((i) => i.track_stock);
  const list = value.opKind === 'karigar' ? people.karigars : people.employees;
  return (
    <div style={{ display: 'grid', gap: '0.5rem' }} data-mf-entry>
      <div style={row}>
        <F label={fT('date')} w={150}><In type="date" v={value.date ?? ''} set={(x) => set({ date: x })} /></F>
        <F label={fT('start')} w={110}><In type="time" v={value.start ?? ''} set={(x) => set({ start: x || undefined })} /></F>
        <F label={fT('end')} w={110}><In type="time" v={value.end ?? ''} set={(x) => set({ end: x || undefined })} /></F>
        <F label={fT('hours')} w={90}><In v={value.hours === undefined ? '' : String(value.hours)} set={(x) => set({ hours: num(x) })} inputMode="decimal" data-mf="e-hours" /></F>
        <label className={controls.check}><input type="checkbox" checked={!!value.setup} onChange={(e) => set({ setup: e.target.checked || undefined })} /> {fT('setup')}</label>
      </div>
      <div style={row}>
        <F label={fT('operator')} w={130}><Sel v={value.opKind ?? 'employee'} set={(x) => set({ opKind: x, opId: '' })} o={[['employee', fT('employee')], ['karigar', fT('karigar')]]} /></F>
        <F label={fT('who')}><Sel v={value.opId ?? ''} set={(x) => set({ opId: x })} o={[['', '-'], ...list]} /></F>
        <F label={fT('machine')} w={120}><In v={value.machine ?? ''} set={(x) => set({ machine: x })} /></F>
      </div>
      <div style={row}>
        <F label={fT('good')} w={90}><In v={value.good === undefined ? '' : String(value.good)} set={(x) => set({ good: num(x) })} inputMode="decimal" data-mf="e-good" /></F>
        <F label={fT('rejected')} w={90}><In v={value.rejected === undefined ? '' : String(value.rejected)} set={(x) => set({ rejected: num(x) })} inputMode="decimal" /></F>
        {num(value.rejected) > 0 && <F label={fT('reason')} w={150}><Sel v={value.reason ?? ''} set={(x) => set({ reason: x })} o={[['', '-'], ...rejectReasons().map((r) => [r, r] as const)]} /></F>}
        <F label={fT('rework')} w={90}><In v={value.rework === undefined ? '' : String(value.rework)} set={(x) => set({ rework: num(x) })} inputMode="decimal" /></F>
        <F label={fT('scrapKg')} w={90}><In v={value.scrap_kg === undefined ? '' : String(value.scrap_kg)} set={(x) => set({ scrap_kg: num(x) })} inputMode="decimal" data-mf="e-scrap" /></F>
        {num(value.scrap_kg) > 0 && <F label={fT('scrapItem')} w={180}><Sel v={value.scrap_item_id ?? ''} set={(x) => set({ scrap_item_id: x })} o={[['', '-'], ...scrapItems.map((i) => [i.id, i.name] as const)]} data-mf="e-scrap-item" /></F>}
      </div>
    </div>
  );
}

export default function JobCardsView({ ctx }: { ctx: MfgContext }) {
  const [v, setV] = useState(0);
  const orders = useMemo(() => (void v, void ctx.version, productionOrdersDb.all().filter((o) => ['released', 'in_progress', 'completed'].includes(o.status))), [v, ctx.version]);
  const cards = useMemo(() => (void v, void ctx.version, loadCards()), [v, ctx.version]);
  const centres = useMemo(() => loadCentres(), []);
  const people = usePeople();
  const [orderId, setOrderId] = useState('');
  const [phone, setPhone] = useState(false);
  const [day, setDay] = useState(todayInput());
  const [entry, setEntry] = useState<{ op: MfOrderOp; d: EntryDraft } | null>(null);
  const order = orders.find((o) => o.id === orderId) ?? orders.find((o) => o.mf?.ops?.length);
  const item = (id: string) => ctx.items.find((i) => i.id === id)?.name ?? '?';
  const centre = (id: string) => centres.find((c) => c.id === id)?.name ?? '?';
  const oos = !!(order && defaultRoutingOf(order.item_id)?.allow_out_of_sequence);
  const report = useMemo(() => floorDay(cards, centres, day), [cards, centres, day]);
  const refresh = () => setV((x) => x + 1);

  const applyRouting = (o: ProductionOrder) => {
    try {
      const conv = standardConversion(o.mf?.ops ?? [], num(o.planned_qty));
      productionOrdersDb.save({ id: o.id, date: o.date, item_id: o.item_id, bom_id: o.bom_id, planned_qty: o.planned_qty, due_date: o.due_date, standard_conversion: conv }, ctx.items, getTable('boms'));
      ctx.changed(fT('convSet', { amount: fmt(conv) }));
    } catch (e) {
      ctx.error((e as Error).message);
    }
  };
  if (phone) return <OperatorScreen ctx={ctx} orders={orders} cards={cards} centres={centres} people={people} onDone={() => { setPhone(false); refresh(); }} />;
  const mine = (op: MfOrderOp): JobCard[] => cards.filter((c) => c.order_id === order?.id && c.op_id === op.id);
  return (
    <section data-mf-cards>
      <div style={row}>
        <F label={fT('order')}><Sel v={order?.id ?? ''} set={setOrderId} o={orders.map((o) => [o.id, `${o.number} · ${item(o.item_id)} × ${fmt(num(o.planned_qty))}${o.mf?.ops?.length ? '' : ` (${fT('noOps')})`}`] as const)} data-mf="order" /></F>
        <button type="button" className={controls.btnOutline} onClick={() => setPhone(true)} data-mf="phone">{fT('phoneMode')}</button>
      </div>
      {!orders.length && <p className={controls.hint}>{fT('noOrders')} <Link to="/manufacturing?tab=orders">{fT('ordersLink')}</Link></p>}
      {order && !order.mf?.ops?.length && <p className={controls.hint}>{fT('noOpsHint')}</p>}
      {order?.mf?.ops?.length ? (
        <>
          <Grid attr="ops" head={[fT('operation'), fT('centre'), fT('planned'), fT('good'), fT('rejected'), fT('hours'), fT('scrapKg'), '']} rows={order.mf.ops.map((op) => {
            const t = mine(op).reduce((a, c) => { const x = cardTotals(c); return { good: a.good + x.good, rejected: a.rejected + x.rejected, hours: a.hours + x.hours, scrapKg: a.scrapKg + x.scrapKg }; }, { good: 0, rejected: 0, hours: 0, scrapKg: 0 });
            const send = outsideSendHref(op, order, centres);
            return [
              `${op.seq} ${op.name}`, centre(op.work_centre_id), `${fmt(num(order.planned_qty))} · ${fmt(op.planned_hours)} h`,
              `${fmt(t.good)} / ${fmt(num(order.planned_qty))}`, fmt(t.rejected), fmt(t.hours), fmt(t.scrapKg),
              <span key="a" style={row}>
                {ctx.canBooks && <button type="button" className={controls.btnOutline} onClick={() => setEntry({ op, d: { date: todayInput(), opKind: 'employee' } })} data-mf={`report-${op.seq}`}>{fT('report')}</button>}
                {send && <Link to={send} className={controls.btnOutline}>{fT('send')}</Link>}
              </span>,
            ];
          })} />
          {entry && (
            <div style={{ margin: '0.75rem 0' }} data-mf-entry-box>
              <strong>{entry.op.seq} {entry.op.name}</strong>
              <EntryForm ctx={ctx} value={entry.d} set={(p) => setEntry({ ...entry, d: { ...entry.d, ...p } })} people={people} />
              <div style={row}>
                <button type="button" className={controls.btnPrimary} onClick={() => submitEntry(ctx, order, entry.op, entry.d, oos) && (setEntry(null), refresh())} data-mf="e-save">{fT('save')}</button>
                <button type="button" className={controls.btnOutline} onClick={() => setEntry(null)}>{fT('cancel')}</button>
              </div>
            </div>
          )}
          <Grid attr="entries" head={[fT('card'), fT('date'), fT('operation'), fT('hours'), fT('good'), fT('rejected'), fT('scrapKg'), '']} rows={cards.filter((c) => c.order_id === order.id).flatMap((c) => c.entries.map((e) => [
            c.number, `${e.date}${e.start ? ` ${e.start}–${e.end ?? ''}` : ''}`, order.mf?.ops?.find((o) => o.id === c.op_id)?.name ?? '?', `${fmt(e.hours)}${e.setup ? ` (${fT('setup')})` : ''}`, fmt(e.good), `${fmt(e.rejected)}${e.reason ? ` · ${e.reason}` : ''}`, fmt(num(e.scrap_kg)),
            ctx.canBooks ? <button key="x" type="button" className={controls.btnDanger} onClick={() => { try { removeEntry(c.id, e.id); refresh(); } catch (err) { ctx.error((err as Error).message); } }}>{fT('delete')}</button> : null,
          ]))} />
          <p className={controls.hint}>
            {fT('convHint', { amount: fmt(standardConversion(order.mf.ops, num(order.planned_qty))), typed: fmt(num(order.standard_conversion)) })}{' '}
            {ctx.canBooks && order.status !== 'completed' && <button type="button" className={controls.btnOutline} onClick={() => applyRouting(order)}>{fT('useRouting')}</button>}
          </p>
        </>
      ) : null}
      <h4>{fT('dayReport')}</h4>
      <div style={row}><F label={fT('date')} w={160}><In type="date" v={day} set={setDay} /></F></div>
      <Grid attr="day" head={[fT('centre'), fT('available'), fT('run'), fT('setup'), fT('idle'), fT('good'), fT('rejected'), fT('scrapKg')]} rows={report.centres.filter((c) => c.available || c.run || c.setup).map((c) => [c.name, fmt(c.available), fmt(c.run), fmt(c.setup), fmt(c.idle), fmt(c.good), fmt(c.rejected), fmt(c.scrapKg)])} />
      <Grid attr="operators" head={[fT('who'), fT('hours'), fT('good'), fT('rejected')]} rows={report.operators.map((o) => [[...people.employees, ...people.karigars].find(([id]) => id === o.id)?.[1] ?? (o.id || '-'), fmt(o.hours), fmt(o.good), fmt(o.rejected)])} />
    </section>
  );
}
