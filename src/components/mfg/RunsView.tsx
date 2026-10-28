/** MF-B4 Moulding → Runs: moulds (cavities, cycle, life) and runs with inputs by kind; each run posts one manufacturing journal. */
import { useMemo, useState } from 'react';
import type { ProcessRun } from '../../types/mfg-r13';
import type { MfgContext } from '../manufacturing/context';
import { can } from '../../lib/access';
import { productionOrdersDb } from '../../lib/production/orders';
import { expectedOutput, loadMoulds, loadRuns, mouldLife, removeRun, runBalance, saveMould, saveRun } from '../../lib/mfg/mf-runs';
import { readMfgSettings } from '../../lib/mfg/mf-settings';
import { moT as M } from '../../i18n/areas/mfg-r13b-mould';
import { B, today } from '../transport/shared';
import controls from '../../styles/controls.module.css';
import { Num, Sel, Table, Txt } from './mfb-ui';
import { fmt, n, opt, row, useRun, type Done } from './mfb-util';

type In = { item: string; kind: ProcessRun['inputs'][number]['kind']; kg: string };
const KINDS: readonly In['kind'][] = ['virgin', 'regrind', 'masterbatch', 'additive'];

export default function RunsView({ ctx, done }: { ctx: MfgContext; done: Done }) {
  const [tick, run] = useRun(done, M('saved'));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const d = useMemo(() => ({ moulds: loadMoulds(), runs: loadRuns(), orders: productionOrdersDb.all().filter((o) => o.status === 'released' || o.status === 'in_progress') }), [tick, ctx.version]);
  const [m, setM] = useState({ name: '', item: '', cav: '', cycle: '', shot: '', runner: '', life: '', done: '' });
  const [f, setF] = useState({ date: today(), shift: '', mould: '', item: '', order: '', hours: '', cycle: '', cav: '', part: '', good: '', reject: '', runner: '', purge: '', rgOut: '', rgItem: readMfgSettings().regrind_item_id ?? '' });
  const [ins, setIns] = useState<In[]>([{ item: '', kind: 'virgin', kg: '' }]);
  const name = (id?: string) => ctx.items.find((i) => i.id === id)?.name ?? '—';
  const mould = d.moulds.find((x) => x.id === f.mould);
  const set = (k: keyof typeof f) => (x: string) => setF({ ...f, [k]: x });
  const draft: ProcessRun = {
    id: '', date: f.date, item_id: f.item || mould?.item_id || '', hours: n(f.hours), cycle_s: n(f.cycle) || mould?.cycle_s, cavities: n(f.cav) || mould?.cavities, part_g: n(f.part) || undefined,
    inputs: ins.filter((i) => i.item && n(i.kg) > 0).map((i) => ({ item_id: i.item, kind: i.kind, kg: n(i.kg) })), good_qty: n(f.good), reject_qty: n(f.reject), runner_kg: n(f.runner), purge_kg: n(f.purge),
    regrind_out_kg: n(f.rgOut), ...(f.rgItem ? { regrind_item_id: f.rgItem } : {}), ...(f.mould ? { mould_id: f.mould } : {}), ...(f.order ? { order_id: f.order } : {}), ...(f.shift ? { shift: f.shift } : {}),
  };
  const bal = draft.hours > 0 ? runBalance(draft, mould) : undefined;
  return (
    <div data-mfb-view="runs">
      {can('settings.manage') && (
        <>
          <h4>{M('moulds')}</h4>
          <div style={row}>
            <Txt l={M('mould')} v={m.name} set={(x) => setM({ ...m, name: x })} x={120} d="mould-name" />
            <Sel l={M('part')} v={m.item} set={(x) => setM({ ...m, item: x })} o={opt(ctx.items, (i) => i.id, (i) => i.name)} x={170} d="mould-item" />
            <Num l={M('cavities')} v={m.cav} set={(x) => setM({ ...m, cav: x })} x={90} d="mould-cav" />
            <Num l={M('cycleS')} v={m.cycle} set={(x) => setM({ ...m, cycle: x })} x={90} d="mould-cycle" />
            <Num l={M('shotG')} v={m.shot} set={(x) => setM({ ...m, shot: x })} x={90} />
            <Num l={M('runnerG')} v={m.runner} set={(x) => setM({ ...m, runner: x })} x={90} />
            <Num l={M('lifeShots')} v={m.life} set={(x) => setM({ ...m, life: x })} x={110} />
            <Num l={M('shotsDone')} v={m.done} set={(x) => setM({ ...m, done: x })} x={110} />
            <button type="button" className={B.p} data-mfb-save-mould onClick={() => run(() => { saveMould({ name: m.name, item_id: m.item, cavities: n(m.cav), cycle_s: n(m.cycle), shot_g: n(m.shot) || undefined, runner_g: n(m.runner) || undefined, life_shots: n(m.life) || undefined, shots_done: n(m.done) }); setM({ ...m, name: '' }); })}>{M('add')}</button>
          </div>
        </>
      )}
      <Table d="moulds" empty={M('noMoulds')} head={[M('mould'), M('part'), M('cavities'), M('cycleS'), M('life')]} rows={d.moulds.map((x) => {
        const l = mouldLife(x, d.runs);
        return [x.name, name(x.item_id), x.cavities, x.cycle_s, <span key="l" data-mfb-life-warn={l.warn ? '1' : undefined}>{x.life_shots ? `${fmt(l.shots)} / ${fmt(x.life_shots)} (${l.pct}%)${l.warn ? ` · ${M('lifeWarn')}` : ''}` : fmt(l.shots)}</span>];
      })} />

      <h4>{M('newRun')}</h4>
      <div style={row}>
        <Txt l={M('date')} type="date" v={f.date} set={set('date')} x={150} />
        <Txt l={M('shift')} v={f.shift} set={set('shift')} x={80} />
        <Sel l={M('mould')} v={f.mould} set={(x) => { const y = d.moulds.find((z) => z.id === x); setF({ ...f, mould: x, item: y?.item_id ?? f.item }); }} o={opt(d.moulds, (x) => x.id, (x) => x.name)} x={140} d="run-mould" />
        <Sel l={M('part')} v={f.item || mould?.item_id || ''} set={set('item')} o={opt(ctx.items, (i) => i.id, (i) => i.name)} x={170} d="run-item" />
        <Sel l={M('order')} v={f.order} set={set('order')} o={opt(d.orders, (o) => o.id, (o) => o.number)} x={150} />
        <Num l={M('hours')} v={f.hours} set={set('hours')} x={80} d="run-hours" />
        <Num l={M('cycleS')} v={f.cycle} set={set('cycle')} x={90} d="run-cycle" />
        <Num l={M('cavities')} v={f.cav} set={set('cav')} x={90} d="run-cav" />
        <Num l={M('partG')} v={f.part} set={set('part')} x={90} d="run-part" />
      </div>
      {ins.map((i, k) => (
        <div key={k} style={row}>
          <Sel l={M('input')} v={i.item} set={(x) => setIns(ins.map((y, j) => (j === k ? { ...y, item: x } : y)))} o={opt(ctx.items, (x) => x.id, (x) => x.name)} x={190} d="run-input" />
          <Sel l={M('kind')} v={i.kind} set={(x) => setIns(ins.map((y, j) => (j === k ? { ...y, kind: x as In['kind'] } : y)))} o={KINDS.map((x) => [x, M(`k.${x}`)] as const)} x={140} d="run-kind" />
          <Num l={M('kg')} v={i.kg} set={(x) => setIns(ins.map((y, j) => (j === k ? { ...y, kg: x } : y)))} x={90} d="run-kg" />
          {k === ins.length - 1 && <button type="button" className={B.os} onClick={() => setIns([...ins, { item: '', kind: 'virgin', kg: '' }])}>{M('addInput')}</button>}
        </div>
      ))}
      <div style={row}>
        <Num l={M('good')} v={f.good} set={set('good')} x={100} d="run-good" />
        <Num l={M('rejects')} v={f.reject} set={set('reject')} x={90} d="run-reject" />
        <Num l={M('runnerKg')} v={f.runner} set={set('runner')} x={90} d="run-runner" />
        <Num l={M('purgeKg')} v={f.purge} set={set('purge')} x={90} />
        <Num l={M('regrindOut')} v={f.rgOut} set={set('rgOut')} x={110} d="run-rgout" />
        <Sel l={M('regrindItem')} v={f.rgItem} set={set('rgItem')} o={opt(ctx.items, (x) => x.id, (x) => x.name)} x={170} d="run-rgitem" />
      </div>
      {bal && <p className={controls.hint} data-mfb-run-preview>{M('preview', { exp: fmt(bal.expected), eff: bal.efficiency_pct, y: bal.yield_pct, loss: fmt(bal.loss_kg), rg: bal.regrind_pct })}</p>}
      <button type="button" className={B.p} data-mfb-save-run onClick={() => run(() => { const r = saveRun(draft, ctx.items, ctx.inputs); setIns([{ item: '', kind: 'virgin', kg: '' }]); return M('runSaved', { n: fmt(r.good_qty) }); })}>{M('saveRun')}</button>

      <h4>{M('runs')}</h4>
      <Table d="runs" empty={M('none')} head={[M('date'), M('mould'), M('part'), M('hours'), M('good'), M('expected'), '']} rows={[...d.runs].reverse().map((r) => [
        r.date, d.moulds.find((x) => x.id === r.mould_id)?.name ?? '—', name(r.item_id), r.hours, fmt(r.good_qty), fmt(expectedOutput(r.hours, r.cycle_s ?? 0, r.cavities ?? 1)),
        <button key="x" type="button" className={B.gs} onClick={() => run(() => { removeRun(r.id); })}>{M('del')}</button>,
      ])} />
    </div>
  );
}
