/** AG-D1 chambers (`agri_settings.chambers`) with utilisation; receipt terms; the release LTV for partial release under a lien. */
import { useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { agdT } from '../../i18n/areas/agri-r12d';
import { generateId } from '../../lib/storage';
import { chamberUse, loadLots } from '../../lib/agri/ag-cold-lots';
import { readAgriSettings, saveAgriSettings } from '../../lib/agri/ag-settings';
import { NumberInput } from '../ui/NumberInput';
import { F, Tbl } from './agd-kit';
import { btn, useRun, wrap, type Done } from './agd-ui';
import controls from '../../styles/controls.module.css';

export default function ChambersView({ onDone }: { onDone: Done }) {
  const { tick, run } = useRun(onDone);
  const s = useMemo(() => { void tick; return readAgriSettings(); }, [tick]);
  const chambers = s.chambers ?? [];
  const [c, setC] = useState({ name: '', capacity_bags: 0, floors: 0, temp_range: '' });
  const [terms, setTerms] = useState(s.cold?.receipt_terms ?? '');
  const [ltv, setLtv] = useState(s.cold?.release_ltv_pct ?? 0);
  const use = chamberUse(loadLots(), chambers);
  return (
    <>
      <div style={wrap}>
        <F label={agdT('chamber')}><input className={controls.input} value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} data-agd="chamber-name" /></F>
        <F label={agdT('capacity')} w={110}><NumberInput className={controls.input} value={c.capacity_bags} onChange={(v) => setC({ ...c, capacity_bags: v })} data-agd="chamber-cap" /></F>
        <F label={agdT('floors')} w={80}><NumberInput className={controls.input} value={c.floors} onChange={(v) => setC({ ...c, floors: v })} /></F>
        <F label={agdT('temp')} w={120}><input className={controls.input} value={c.temp_range} onChange={(e) => setC({ ...c, temp_range: e.target.value })} placeholder="2–4 °C" /></F>
        <button type="button" className={controls.btnPrimary} onClick={() => run(() => {
          if (!c.name.trim() || !(c.capacity_bags > 0)) throw new Error(agdT('chamberNeed'));
          saveAgriSettings({ chambers: [...chambers, { id: generateId(), name: c.name.trim(), capacity_bags: c.capacity_bags, ...(c.floors > 0 ? { floors: c.floors } : {}), ...(c.temp_range.trim() ? { temp_range: c.temp_range.trim() } : {}) }] });
          setC({ name: '', capacity_bags: 0, floors: 0, temp_range: '' });
          return agdT('saved');
        })} data-agd-add-chamber>{agdT('add')}</button>
      </div>
      <Tbl
        head={[agdT('chamber'), agdT('capacity'), agdT('stored'), '%', agdT('temp'), '']}
        rows={use.map((u) => [u.chamber.name, u.chamber.capacity_bags, u.bags, `${u.pct}%`, u.chamber.temp_range ?? '',
          <button key="d" type="button" className={btn} aria-label={agdT('delete')} disabled={u.bags > 0} onClick={() => run(() => { saveAgriSettings({ chambers: chambers.filter((x) => x.id !== u.chamber.id) }); return agdT('deleted'); })}><Trash2 size={14} aria-hidden="true" /></button>])}
      />
      <div style={wrap}>
        <F label={agdT('terms')}><textarea className={controls.textarea} rows={2} value={terms} onChange={(e) => setTerms(e.target.value)} /></F>
        <F label={agdT('releaseLtv')} w={160}><NumberInput className={controls.input} value={ltv} onChange={setLtv} /></F>
        <button type="button" className={btn} onClick={() => run(() => { saveAgriSettings({ cold: { receipt_terms: terms.trim(), ...(ltv > 0 ? { release_ltv_pct: ltv } : {}) } }); return agdT('saved'); })}>{agdT('save')}</button>
      </div>
      <p className={controls.hint}>{agdT('custodyNote')}</p>
    </>
  );
}
