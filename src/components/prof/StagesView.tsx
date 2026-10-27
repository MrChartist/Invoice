/**
 * R14 PS-B4 the `stages` view of the Matters desk (pack `design`): an engagement's fee as a % of project cost, the cost
 * revisions, the stage template (an editable example), the property for the place of supply, and "Make the draft" for a
 * stage. Working paper — verify with your CA (PS6, PS30).
 */
import { useMemo, useState } from 'react';
import { psbT } from '../../i18n/areas/prof-r14b';
import { psT } from '../../i18n/areas/prof-r14-common';
import { localDb } from '../../lib/localDb';
import { getTable } from '../../lib/storage';
import { todayInput } from '../../lib/utils';
import { loadEngagements, saveEngagement } from '../../lib/prof/ps-engagements';
import { billedOnEngagement, createStageBill, exampleStages, stageBill, stageSchedule, type StagePlan } from '../../lib/prof/ps-stages';
import { propertyPos } from '../../lib/prof/ps-property-pos';
import type { LinkLike } from '../../lib/progress-billing';
import { NumberInput } from '../ui/NumberInput';
import { Field } from './ps-ui';
import { runWith, type PsDeskProps } from './ps-run';
import { Tbl } from '../mfg/mfd-ui';
import { row, rs, sm } from '../mfg/mfd-util';
import controls from '../../styles/controls.module.css';

const blank = (): StagePlan => ({ fee_pct: 0, cost_basis: 'estimate', revisions: [{ date: todayInput(), cost: 0 }], stages: exampleStages(), property: { country: 'India' } });

export default function StagesView({ notify }: Pick<PsDeskProps, 'notify'>) {
  const run = runWith(notify);
  const [tick, setTick] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const engs = useMemo(() => loadEngagements().filter((e) => e.status !== 'closed'), [tick]);
  const [id, setId] = useState(engs[0]?.id ?? '');
  const eng = engs.find((e) => e.id === id);
  const [p, setP] = useState<StagePlan>(() => eng?.stage ?? blank());
  const [rev, setRev] = useState({ date: todayInput(), cost: 0 });
  const pick = (x: string) => { setId(x); setP(engs.find((e) => e.id === x)?.stage ?? blank()); };
  const today = todayInput();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const billed = useMemo(() => (eng ? billedOnEngagement(eng.id, localDb.invoices.getAll() as never, getTable<LinkLike>('doc_links')) : 0), [eng, tick]);
  if (!engs.length) return <p className={controls.hint}>{psbT('st.none')}</p>;
  const client = eng ? localDb.clients.getById(eng.client_id) : undefined;
  const pos = propertyPos(p.property, client ?? {});
  const save = () => eng && run(() => saveEngagement({ ...eng, stage: p }), psT('saved')) && setTick((n) => n + 1);
  const make = (sid: string) => {
    const r = eng && run(() => createStageBill({ ...eng, stage: p }, sid, today));
    if (r) { notify(psbT('st.made', { number: r.invoice_number })); setTick((n) => n + 1); }
  };
  const setStage = (k: number, patch: Partial<StagePlan['stages'][number]>) => setP({ ...p, stages: p.stages.map((s, j) => (j === k ? { ...s, ...patch } : s)) });
  return (
    <div data-ps-stages>
      <div style={row}>
        <Field label={psbT('st.eng')}><select className={controls.select} value={id} onChange={(e) => pick(e.target.value)}>{engs.map((e) => <option key={e.id} value={e.id}>{e.number} · {e.title}</option>)}</select></Field>
        <Field label={psbT('st.fee')}><NumberInput className={controls.input} style={{ maxWidth: 90 }} value={p.fee_pct} onChange={(v) => setP({ ...p, fee_pct: v })} data-ps-st="fee" /></Field>
        <Field label={psbT('st.basis')}><select className={controls.select} value={p.cost_basis} onChange={(e) => setP({ ...p, cost_basis: e.target.value as StagePlan['cost_basis'] })}>{(['estimate', 'tender', 'actual'] as const).map((b) => <option key={b} value={b}>{psbT(`st.b.${b}`)}</option>)}</select></Field>
        <Field label={psbT('st.extra')}><NumberInput className={controls.input} style={{ maxWidth: 90 }} value={p.extra_pct ?? 0} onChange={(v) => setP({ ...p, extra_pct: v || undefined })} /></Field>
        <Field label={psbT('st.state')}><input className={controls.input} value={p.property.state ?? ''} onChange={(e) => setP({ ...p, property: { ...p.property, state: e.target.value } })} data-ps-st="state" /></Field>
        <Field label={psbT('st.country')}><input className={controls.input} value={p.property.country ?? ''} onChange={(e) => setP({ ...p, property: { ...p.property, country: e.target.value } })} /></Field>
      </div>
      <div style={row}>
        {p.revisions.map((r, k) => (
          <Field key={k} label={`${psbT('st.cost')} · ${r.date}`}><NumberInput className={controls.input} style={{ maxWidth: 140 }} value={r.cost} onChange={(v) => setP({ ...p, revisions: p.revisions.map((x, j) => (j === k ? { ...x, cost: v } : x)) })} data-ps-st={`cost-${k}`} /></Field>
        ))}
        <Field label={psbT('st.date')}><input type="date" className={controls.input} value={rev.date} onChange={(e) => setRev({ ...rev, date: e.target.value })} data-ps-st="rev-date" /></Field>
        <Field label={psbT('st.cost')}><NumberInput className={controls.input} style={{ maxWidth: 140 }} value={rev.cost} onChange={(v) => setRev({ ...rev, cost: v })} data-ps-st="rev-cost" /></Field>
        <button type="button" className={sm} disabled={!(rev.cost > 0)} onClick={() => { setP({ ...p, revisions: [...p.revisions, rev] }); setRev({ ...rev, cost: 0 }); }} data-ps-st-b="revise">{psbT('st.revise')}</button>
        <button type="button" className={controls.btnPrimary} onClick={save} data-ps-st-b="save">{psbT('st.save')}</button>
      </div>
      <p className={controls.hint} data-ps-st-pos={pos.pos}>{psbT('st.pos', { pos: pos.pos || '—', basis: psbT(pos.basis === 'property' ? 'st.property' : 'st.recipient') })} {psbT('st.billed', { amount: rs(billed) })}</p>
      <Tbl empty="" head={[psbT('st.stage'), psbT('st.cum'), psbT('st.due'), '']} rows={stageSchedule(p, today).map((s, k) => {
        const b = p.fee_pct > 0 ? stageBill(p, s.id, today, billed) : null;
        return [
          <input key="l" className={controls.input} value={p.stages[k].label} onChange={(e) => setStage(k, { label: e.target.value })} />,
          <NumberInput key="c" className={controls.input} style={{ maxWidth: 80 }} value={p.stages[k].cum_pct} onChange={(v) => setStage(k, { cum_pct: v })} />,
          rs(s.cumulative),
          b && b.amount > 0 ? <button key="b" type="button" className={sm} onClick={() => make(s.id)} data-ps-st-bill={s.id}>{psbT('st.bill')} ₹{rs(b.amount)}</button> : '',
        ];
      })} />
      <p className={controls.hint}>{psbT('st.example')}</p>
    </div>
  );
}
