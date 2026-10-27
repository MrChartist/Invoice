/** AG-D4 subsidised fertiliser: flag the items, PoS stock vs book stock per month (typed from the PoS report), sales missing a PoS no., the monthly cap. */
import { useMemo, useState } from 'react';
import { agdT } from '../../i18n/areas/agri-r12d';
import { todayInput } from '../../lib/utils';
import { localDb } from '../../lib/localDb';
import { loadPositions } from '../../lib/inventory';
import { flagSubsidised, posCheck, subsidisedTest } from '../../lib/agri/ag-subsidy';
import { readAgriSettings, saveAgriSettings } from '../../lib/agri/ag-settings';
import { NumberInput } from '../ui/NumberInput';
import { F, Tbl } from './agd-kit';
import { btn, useRun, wrap, type Done } from './agd-ui';
import controls from '../../styles/controls.module.css';

export default function SubsidyView({ onDone }: { onDone: Done }) {
  const { tick, run } = useRun(onDone);
  const [month, setMonth] = useState(todayInput().slice(0, 7));
  const s = useMemo(() => { void tick; return readAgriSettings(); }, [tick]);
  const positions = useMemo(() => { void tick; return loadPositions(); }, [tick]);
  const isSub = useMemo(() => { void tick; return subsidisedTest(); }, [tick]);
  const r = posCheck(month, positions, s.pos_stock, localDb.invoices.getAll(), isSub);
  const [cap, setCap] = useState(s.subsidy?.cap ?? 0);
  const setPos = (id: string, v: number) => run(() => { saveAgriSettings({ pos_stock: { ...(s.pos_stock ?? {}), [month]: { ...(s.pos_stock?.[month] ?? {}), [id]: v } } }); });
  return (
    <>
      <div style={wrap}>
        <F label={agdT('month')}><input type="month" className={controls.input} value={month} onChange={(e) => setMonth(e.target.value)} /></F>
        <F label={agdT('cap')} w={150}><NumberInput className={controls.input} value={cap} onChange={setCap} /></F>
        <button type="button" className={btn} onClick={() => run(() => { saveAgriSettings({ subsidy: cap > 0 ? { cap } : {} }); return agdT('saved'); })}>{agdT('save')}</button>
      </div>
      <Tbl
        head={[agdT('item'), agdT('book'), agdT('posStock'), agdT('diff')]}
        flag={r.rows.map((x) => !!x.diff)}
        rows={r.rows.map((x) => [x.item, x.book, <NumberInput key="p" className={controls.input} style={{ maxWidth: 110 }} value={x.pos ?? 0} onChange={(v) => setPos(x.item_id, v)} data-agd="pos-stock" />, x.diff ?? '—'])}
      />
      {!!r.missing.length && <><h3>{agdT('missingPos')}</h3><Tbl head={[agdT('bill'), agdT('date'), agdT('party')]} rows={r.missing.map((i) => [i.invoice_number, i.issue_date, i.client?.name ?? ''])} /></>}
      <h3>{agdT('flagItems')}</h3>
      <div style={wrap}>
        {positions.filter((p) => p.item.track_stock).map((p) => <label key={p.item.id}><input type="checkbox" checked={!!p.item.ag_subsidised} onChange={(e) => run(() => flagSubsidised(p.item.id, e.target.checked))} /> {p.item.name}</label>)}
      </div>
      <p className={controls.hint}>{agdT('subsidyNote')}</p>
    </>
  );
}
