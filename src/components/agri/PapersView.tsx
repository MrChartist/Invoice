/** AG-D5 working papers: co-operative deduction by head (80P(2) → Sec 149 by date), producer company 80PA, and the members' statutory calendar. */
import { useMemo, useState } from 'react';
import { agdT } from '../../i18n/areas/agri-r12d';
import { getTable } from '../../lib/storage';
import { todayInput } from '../../lib/utils';
import { localDb } from '../../lib/localDb';
import { loadMembers } from '../../lib/agri/ag-members';
import { fyOf, patronage } from '../../lib/agri/ag-patronage';
import { COOP_HEAD_LABEL, coopPaper, membersCalendar, producerPaper } from '../../lib/agri/ag-coop-papers';
import { readAgriSettings, saveAgriSettings } from '../../lib/agri/ag-settings';
import { NumberInput } from '../ui/NumberInput';
import { F, Sel, Tbl } from './agd-kit';
import { btn, fmt, useRun, wrap, type Done } from './agd-ui';
import controls from '../../styles/controls.module.css';

export default function PapersView({ onDone }: { onDone: Done }) {
  const { tick, run } = useRun(onDone);
  const [fy, setFy] = useState(fyOf(todayInput()));
  const s = useMemo(() => { void tick; return readAgriSettings(); }, [tick]);
  const [kind, setKind] = useState<'producer' | 'coop'>((localDb.settings.get() as { agri_kind?: string }).agri_kind === 'coop' ? 'coop' : 'producer');
  const [heads, setHeads] = useState<Record<string, number>>({});
  const [pc, setPc] = useState({ profit: 0, turnover: 0 });
  const pct = useMemo(() => patronage(fy, { members: loadMembers(), cycles: getTable('farmer_cycles'), purchases: getTable('purchases'), invoices: localDb.invoices.getAll(), farmerIds: new Set(getTable<{ id: string; ag?: unknown }>('vendors').filter((v) => v.ag).map((v) => v.id)) }).memberPct, [fy]);
  const coop = coopPaper(fy, heads, pct);
  const prod = producerPaper(fy, pc.profit, pc.turnover);
  const cal = membersCalendar(kind, fy, s.calendar);
  return (
    <>
      <div style={wrap}>
        <F label={agdT('fy')} w={120}><NumberInput className={controls.input} value={fy} onChange={(v) => setFy(Math.round(v))} calculator={false} /></F>
        <F label={agdT('entity')}><Sel value={kind} onChange={(v) => setKind(v as 'producer' | 'coop')} opts={[['producer', agdT('producer')], ['coop', agdT('coop')]]} /></F>
      </div>
      {kind === 'coop' ? (
        <section data-agd-paper="coop">
          <h3>{agdT('coopTitle', { section: coop.section, act: coop.act })}</h3>
          <div style={wrap}>{Object.keys(COOP_HEAD_LABEL).map((h) => <F key={h} label={COOP_HEAD_LABEL[h]} w={200}><NumberInput className={controls.input} value={heads[h] ?? 0} onChange={(v) => setHeads({ ...heads, [h]: v })} /></F>)}</div>
          <Tbl head={[agdT('head'), agdT('profit'), agdT('membersPct'), agdT('membersPart')]} rows={coop.rows.map((r) => [r.label, fmt(r.profit), `${r.membersPct}%`, fmt(r.membersPart)])} />
          <p className={controls.hint}>{agdT('coopNote')}</p>
        </section>
      ) : (
        <section data-agd-paper="producer">
          <h3>{agdT('paTitle', { ay: prod.ay })}</h3>
          <div style={wrap}>
            <F label={agdT('eligibleProfit')} w={160}><NumberInput className={controls.input} value={pc.profit} onChange={(v) => setPc({ ...pc, profit: v })} /></F>
            <F label={agdT('turnover')} w={160}><NumberInput className={controls.input} value={pc.turnover} onChange={(v) => setPc({ ...pc, turnover: v })} /></F>
          </div>
          <p data-agd-80pa><strong>{agdT('deduction')}: ₹{fmt(prod.deduction)}</strong> — {prod.note}</p>
        </section>
      )}
      <h3>{agdT('calendar')}</h3>
      <Tbl head={[agdT('what'), agdT('dueOn'), '']} rows={cal.map((c) => [c.label, c.due,
        <input key="t" className={controls.input} style={{ maxWidth: 90 }} defaultValue={s.calendar?.[c.key] ?? ''} placeholder={c.due.slice(5)} onBlur={(e) => { const v = e.target.value.trim(); if (v !== (s.calendar?.[c.key] ?? '')) run(() => { saveAgriSettings({ calendar: { ...(s.calendar ?? {}), [c.key]: v } }); }); }} aria-label={agdT('typedDate')} />])} />
      <button type="button" className={btn} onClick={() => run(() => { saveAgriSettings({ calendar: {} }); return agdT('saved'); })}>{agdT('resetDates')}</button>
      <p className={controls.hint}>{agdT('calendarNote')}</p>
    </>
  );
}
