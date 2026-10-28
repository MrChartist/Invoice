/** AG-D5 working papers: co-operative deduction by head (80P(2) → Sec 149 by date) with the members' share, producer company 80PA, and the members' statutory calendar with typed dates. */
import { useMemo, useState } from 'react';
import { agdT } from '../../i18n/areas/agri-r12d';
import { todayInput } from '../../lib/utils';
import { localDb } from '../../lib/localDb';
import { fyOf, patronageOf } from '../../lib/agri/ag-patronage';
import { COOP_HEAD_LABEL, coopPaper, membersCalendar, producerPaper } from '../../lib/agri/ag-coop-papers';
import { readAgriSettings, saveAgriSettings } from '../../lib/agri/ag-settings';
import { B, F, Form, Hint, Tbl } from './agd-kit';
import { fmt, useRun, wrap, type Done } from './agd-ui';
import { NumberInput } from '../ui/NumberInput';
import controls from '../../styles/controls.module.css';

export default function PapersView({ onDone }: { onDone: Done }) {
  const { tick, run } = useRun(onDone);
  const s = useMemo(() => { void tick; return readAgriSettings(); }, [tick]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [d, setD] = useState<Record<string, any>>({ fy: fyOf(todayInput()), kind: localDb.settings.get().agri_kind === 'coop' ? 'coop' : 'producer' });
  const [heads, setHeads] = useState<Record<string, number>>({});
  const pct = useMemo(() => (d.kind === 'coop' ? patronageOf(d.fy).memberPct : 0), [d.fy, d.kind]);
  const coop = coopPaper(d.fy, heads, pct);
  const prod = producerPaper(d.fy, d.profit, d.turnover);
  const rows = membersCalendar(d.kind, d.fy, s.calendar);
  const setDate = (key: string, v: string) => { if (v !== (s.calendar?.[key] ?? '')) run(() => { if (v && !/^\d{2}-\d{2}$/.test(v)) throw new Error(agdT('typedDate')); saveAgriSettings({ calendar: { ...s.calendar, [key]: v } }); }); };
  return (
    <>
      <Form v={d} set={setD} f={[['fy', 'fy', 'n', 120], ['kind', 'entity', [['producer', agdT('producer')], ['coop', agdT('coop')]]], d.kind === 'producer' && ['profit', 'eligibleProfit', 'n', 160], d.kind === 'producer' && ['turnover', 'turnover', 'n', 160]]} />
      {d.kind === 'coop' ? (
        <section data-agd-paper="coop">
          <h3>{agdT('coopTitle', { section: coop.section, act: coop.act })}</h3>
          <div style={wrap}>{Object.keys(COOP_HEAD_LABEL).map((h) => <F key={h} label={COOP_HEAD_LABEL[h]} w={200}><NumberInput className={controls.input} value={heads[h] ?? 0} onChange={(v) => setHeads({ ...heads, [h]: v })} /></F>)}</div>
          <Tbl head={['head', 'profit', 'membersPct', 'membersPart']} rows={coop.rows.map((r) => [r.label, fmt(r.profit), `${r.membersPct}%`, fmt(r.membersPart)])} />
          <Hint k="coopNote" />
        </section>
      ) : <p data-agd-80pa><strong>{agdT('paTitle', { ay: prod.ay })} — {agdT('deduction')}: ₹{fmt(prod.deduction)}</strong> — {prod.note}</p>}
      <h3>{agdT('calendar')}</h3>
      <Tbl head={['what', 'dueOn', 'typedDate']} rows={rows.map((c) => [c.label, c.due,
        <input key={`${c.key}${tick}`} className={controls.input} style={{ maxWidth: 90 }} defaultValue={s.calendar?.[c.key] ?? ''} placeholder={c.due.slice(5)} onBlur={(e) => setDate(c.key, e.target.value.trim())} aria-label={`${agdT('typedDate')}: ${c.label}`} data-agd-cal={c.key} />])} />
      <B k="resetDates" on={() => run(() => { saveAgriSettings({ calendar: {} }); return agdT('saved'); })} />
      <Hint k="calendarNote" />
    </>
  );
}
