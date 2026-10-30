/**
 * MF-A3 operator screen (phone mode of Floor → Job cards): pick the work centre → my open operations → Start / Stop →
 * report good, rejected and scrap. The order number can be typed or scanned by a barcode / QR scanner that types.
 */
import { useState } from 'react';
import type { JobCard, MfOrderOp, WorkCentre } from '../../types/mfg-r13';
import type { ProductionOrder } from '../../types/production-r4';
import type { MfgContext } from '../manufacturing/context';
import { cardTotals } from '../../lib/mfg/mf-jobcards';
import { defaultRoutingOf } from '../../lib/mfg/mf-routings';
import { num } from '../../lib/invoice-calc';
import { todayInput } from '../../lib/utils';
import { fT } from '../../i18n/areas/mfg-r13a';
import controls from '../../styles/controls.module.css';
import { EntryForm } from './JobCardsView';
import { submitEntry, type EntryDraft } from './floor-util';
import { F, In, Sel } from './floor-ui';
import { fmt } from './floor-util';

const big = { minHeight: 56, fontSize: '1.1rem', width: '100%' } as const;
const now = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export default function OperatorScreen({ ctx, orders, cards, centres, people, onDone }: { ctx: MfgContext; orders: ProductionOrder[]; cards: JobCard[]; centres: WorkCentre[]; people: Parameters<typeof EntryForm>[0]['people']; onDone: () => void }) {
  const [centre, setCentre] = useState('');
  const [find, setFind] = useState('');
  const [run, setRun] = useState<{ order: ProductionOrder; op: MfOrderOp; d: EntryDraft } | null>(null);
  const open = orders.flatMap((o) => (o.mf?.ops ?? []).filter((op) => op.work_centre_id === centre && (!find.trim() || o.number.toLowerCase().includes(find.trim().toLowerCase())))
    .map((op) => ({ o, op, good: cards.filter((c) => c.order_id === o.id && c.op_id === op.id).reduce((s, c) => s + cardTotals(c).good, 0) }))
    .filter((x) => x.good < num(x.o.planned_qty)));
  if (run) {
    return (
      <section data-mf-operator-run>
        <h3>{run.order.number} · {run.op.name}</h3>
        {!run.d.end ? (
          <button type="button" className={controls.btnPrimary} style={big} onClick={() => setRun({ ...run, d: { ...run.d, end: now() } })} data-mf="stop">{fT('stop')} ({run.d.start})</button>
        ) : (
          <>
            <EntryForm ctx={ctx} value={run.d} set={(p) => setRun({ ...run, d: { ...run.d, ...p } })} people={people} />
            <button type="button" className={controls.btnPrimary} style={big} onClick={() => submitEntry(ctx, run.order, run.op, run.d, !!defaultRoutingOf(run.order.item_id)?.allow_out_of_sequence) && (setRun(null), onDone())} data-mf="op-save">{fT('save')}</button>
          </>
        )}
        <button type="button" className={controls.btnOutline} style={big} onClick={() => setRun(null)}>{fT('cancel')}</button>
      </section>
    );
  }
  return (
    <section data-mf-operator style={{ display: 'grid', gap: '0.75rem', maxWidth: 520 }}>
      <F label={fT('centre')}><Sel v={centre} set={setCentre} o={[['', '-'], ...centres.filter((c) => c.active).map((c) => [c.id, c.name] as const)]} data-mf="op-centre" /></F>
      <F label={fT('scanOrder')}><In v={find} set={setFind} autoComplete="off" /></F>
      {open.map(({ o, op, good }) => (
        <button key={`${o.id}-${op.id}`} type="button" className={controls.btnOutline} style={big} onClick={() => setRun({ order: o, op, d: { date: todayInput(), start: now(), opKind: 'employee' } })} data-mf="start">
          {fT('start')}: {o.number} · {op.name} ({fmt(good)} / {fmt(num(o.planned_qty))})
        </button>
      ))}
      {centre && !open.length && <p className={controls.hint}>{fT('none')}</p>}
      <button type="button" className={controls.btnOutline} onClick={onDone}>{fT('back')}</button>
    </section>
  );
}
