import { lazy, Suspense, useMemo, useState } from 'react';
import { Edit3, Trash2 } from 'lucide-react';
import { areasDb, assignParties, beatsDb, routesDb, type Beat } from '../../lib/distribution';
import { getTable } from '../../lib/storage';
import type { Client } from '../../types/invoice';
import { useT } from '../../i18n';
import { distT } from '../../i18n/areas/distribution';
import { crT } from '../../i18n/areas/credit';
import controls from '../../styles/controls.module.css';
import own from './dist.module.css';
// R8-A (TR-A1): party-item special rates and bulk paste (distributor / commodity pack, lazy).
const PartyRatesEditor = lazy(() => import('../trade/PartyRatesEditor'));
import { impliedPacks } from '../../lib/shop-mode';
import { localDb } from '../../lib/localDb';

const DAYS = [0, 1, 2, 3, 4, 5, 6];
interface Agent { id: string; name: string }

/** 8.81 masters: areas, routes, beats (salesman + visiting days) and party assignment. */
export default function DistMasters({ onDone }: { onDone: (msg: string, error?: boolean) => void }) {
  useT();
  const [tick, setTick] = useState(0);
  /* eslint-disable react-hooks/exhaustive-deps */
  const areas = useMemo(() => areasDb.all(), [tick]);
  const routes = useMemo(() => routesDb.all(), [tick]);
  const beats = useMemo(() => beatsDb.all(), [tick]);
  const clients = useMemo(() => getTable<Client>('clients').filter((c) => c?.id), [tick]);
  /* eslint-enable react-hooks/exhaustive-deps */
  const agents = useMemo(() => getTable<Agent>('sales_agents').filter((a) => a?.id), []);
  const [areaName, setAreaName] = useState('');
  const [route, setRoute] = useState({ id: '', name: '', area_id: '' });
  const [beat, setBeat] = useState<Omit<Beat, 'id'> & { id: string }>({ id: '', name: '', days: [] });
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const [beatFilter, setBeatFilter] = useState('');
  const [assign, setAssign] = useState({ area_id: '', beat_id: '', agent_id: '', credit_policy: '' });

  const run = (fn: () => string) => {
    try {
      onDone(fn());
      setTick((t) => t + 1);
    } catch (err) {
      onDone((err as Error).message, true);
    }
  };
  const nameOf = (list: readonly { id: string; name: string }[], id?: string) => list.find((x) => x.id === id)?.name ?? '';
  const shown = clients.filter((c) => (!q.trim() || c.name.toLowerCase().includes(q.trim().toLowerCase())) && (!beatFilter || (beatFilter === '-' ? !c.beat_id : c.beat_id === beatFilter)));

  return (
    <div className={own.stack} data-dist-masters>
      <p className={own.muted}>{distT('mastersIntro')}</p>
      <div className={own.grid}>
        <div className={own.day}>
          <h4>{distT('areas')}</h4>
          <ul>{areas.map((a) => <li key={a.id}>{a.name} <button type="button" className={controls.btnIcon} aria-label={distT('deleteNamed', { name: a.name })} onClick={() => run(() => { areasDb.remove(a.id); return distT('deleted'); })}><Trash2 size={12} /></button></li>)}</ul>
          <form className={own.row} onSubmit={(e) => { e.preventDefault(); run(() => { areasDb.save({ name: areaName }); setAreaName(''); return distT('saved'); }); }}>
            <input className={controls.input} value={areaName} placeholder={distT('areaName')} aria-label={distT('areaName')} onChange={(e) => setAreaName(e.target.value)} data-area-name />
            <button type="submit" className={`${controls.btnOutline} ${controls.btnSm}`}>{distT('add')}</button>
          </form>
        </div>
        <div className={own.day}>
          <h4>{distT('routes')}</h4>
          <ul>{routes.map((r) => <li key={r.id}>{r.name}{r.area_id ? ` · ${nameOf(areas, r.area_id)}` : ''} <button type="button" className={controls.btnIcon} aria-label={distT('deleteNamed', { name: r.name })} onClick={() => run(() => { routesDb.remove(r.id); return distT('deleted'); })}><Trash2 size={12} /></button></li>)}</ul>
          <form className={own.row} onSubmit={(e) => { e.preventDefault(); run(() => { routesDb.save({ name: route.name, ...(route.area_id ? { area_id: route.area_id } : {}) }); setRoute({ id: '', name: '', area_id: '' }); return distT('saved'); }); }}>
            <input className={controls.input} value={route.name} placeholder={distT('routeName')} aria-label={distT('routeName')} onChange={(e) => setRoute({ ...route, name: e.target.value })} />
            <select className={controls.select} value={route.area_id} aria-label={distT('area')} onChange={(e) => setRoute({ ...route, area_id: e.target.value })}>
              <option value="">{distT('noArea')}</option>
              {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <button type="submit" className={`${controls.btnOutline} ${controls.btnSm}`}>{distT('add')}</button>
          </form>
        </div>
      </div>

      <h4>{distT('beats')}</h4>
      <div className={own.tableWrap}>
        <table className={own.table}>
          <thead><tr><th>{distT('beat')}</th><th>{distT('area')}</th><th>{distT('route')}</th><th>{distT('salesman')}</th><th>{distT('days')}</th><th className={own.num}>{distT('parties')}</th><th /></tr></thead>
          <tbody>
            {beats.map((b) => (
              <tr key={b.id} data-beat-row={b.name}>
                <td>{b.name}</td><td>{nameOf(areas, b.area_id)}</td><td>{nameOf(routes, b.route_id)}</td><td>{nameOf(agents, b.agent_id)}</td>
                <td>{(b.days ?? []).map((d) => distT(`d${d as 0 | 1 | 2 | 3 | 4 | 5 | 6}`)).join(', ')}</td>
                <td className={own.num}>{clients.filter((c) => c.beat_id === b.id).length}</td>
                <td>
                  <button type="button" className={controls.btnIcon} aria-label={distT('editNamed', { name: b.name })} onClick={() => setBeat({ ...b, days: b.days ?? [] })}><Edit3 size={14} /></button>
                  <button type="button" className={controls.btnIcon} aria-label={distT('deleteNamed', { name: b.name })} onClick={() => run(() => { beatsDb.remove(b.id); return distT('deleted'); })}><Trash2 size={14} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form className={own.stack} onSubmit={(e) => { e.preventDefault(); run(() => { const { id, ...rest } = beat; beatsDb.save(id ? { ...rest, id } : rest); setBeat({ id: '', name: '', days: [] }); return distT('saved'); }); }}>
        <div className={own.row}>
          <input className={controls.input} value={beat.name} placeholder={distT('beatName')} aria-label={distT('beatName')} onChange={(e) => setBeat({ ...beat, name: e.target.value })} data-beat-name />
          <select className={controls.select} value={beat.area_id ?? ''} aria-label={distT('area')} onChange={(e) => setBeat({ ...beat, area_id: e.target.value || undefined })}>
            <option value="">{distT('noArea')}</option>
            {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <select className={controls.select} value={beat.route_id ?? ''} aria-label={distT('route')} onChange={(e) => setBeat({ ...beat, route_id: e.target.value || undefined })}>
            <option value="">{distT('noRoute')}</option>
            {routes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <select className={controls.select} value={beat.agent_id ?? ''} aria-label={distT('salesman')} onChange={(e) => setBeat({ ...beat, agent_id: e.target.value || undefined })}>
            <option value="">{distT('noSalesman')}</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div className={own.tabs} role="group" aria-label={distT('days')}>
          {DAYS.map((d) => (
            <label key={d} className={controls.check}>
              <input type="checkbox" checked={(beat.days ?? []).includes(d)} onChange={(e) => setBeat({ ...beat, days: e.target.checked ? [...(beat.days ?? []), d].sort() : (beat.days ?? []).filter((x) => x !== d) })} /> {distT(`d${d as 0 | 1 | 2 | 3 | 4 | 5 | 6}`)}
            </label>
          ))}
        </div>
        <div><button type="submit" className={controls.btnPrimary}>{beat.id ? distT('saveBeat') : distT('addBeat')}</button></div>
      </form>

      <h4>{distT('partiesTitle')}</h4>
      <p className={own.muted}>{distT('partiesIntro')}</p>
      <div className={own.row}>
        <input type="search" className={controls.input} value={q} placeholder={distT('searchParties')} aria-label={distT('searchParties')} onChange={(e) => setQ(e.target.value)} />
        <select className={controls.select} value={beatFilter} aria-label={distT('beat')} onChange={(e) => setBeatFilter(e.target.value)}>
          <option value="">{distT('allBeats')}</option>
          <option value="-">{distT('notAssigned')}</option>
          {beats.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </div>
      <div className={own.tableWrap}>
        <table className={own.table}>
          <thead><tr>
            <th><input type="checkbox" aria-label={distT('selectAll')} checked={shown.length > 0 && shown.every((c) => pick.has(c.id!))} onChange={(e) => setPick(e.target.checked ? new Set(shown.map((c) => c.id!)) : new Set())} /></th>
            <th>{distT('party')}</th><th>{distT('area')}</th><th>{distT('beat')}</th><th>{distT('salesman')}</th><th>{crT('mode')}</th>
          </tr></thead>
          <tbody>
            {shown.slice(0, 300).map((c) => (
              <tr key={c.id} data-party-row={c.name}>
                <td><input type="checkbox" aria-label={distT('selectNamed', { name: c.name })} checked={pick.has(c.id!)} onChange={(e) => { const n = new Set(pick); if (e.target.checked) n.add(c.id!); else n.delete(c.id!); setPick(n); }} /></td>
                <td>{c.name}</td><td>{nameOf(areas, c.area_id)}</td><td>{nameOf(beats, c.beat_id)}</td><td>{nameOf(agents, c.agent_id)}</td>
                <td>{c.credit_policy ? crT(c.credit_policy) : crT('companyDefault')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pick.size > 0 && (
        <div className={own.row}>
          <select className={controls.select} value={assign.area_id} aria-label={distT('area')} onChange={(e) => setAssign({ ...assign, area_id: e.target.value })}>
            <option value="">{distT('keepArea')}</option><option value="-">{distT('clear')}</option>
            {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <select className={controls.select} value={assign.beat_id} aria-label={distT('beat')} onChange={(e) => setAssign({ ...assign, beat_id: e.target.value })} data-assign-beat>
            <option value="">{distT('keepBeat')}</option><option value="-">{distT('clear')}</option>
            {beats.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <select className={controls.select} value={assign.agent_id} aria-label={distT('salesman')} onChange={(e) => setAssign({ ...assign, agent_id: e.target.value })}>
            <option value="">{distT('keepSalesman')}</option><option value="-">{distT('clear')}</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <select className={controls.select} value={assign.credit_policy} aria-label={crT('mode')} onChange={(e) => setAssign({ ...assign, credit_policy: e.target.value })}>
            <option value="">{distT('keepCredit')}</option><option value="-">{crT('companyDefault')}</option>
            <option value="off">{crT('off')}</option><option value="warn">{crT('warn')}</option><option value="block">{crT('block')}</option>
          </select>
          <button type="button" className={controls.btnPrimary} data-assign onClick={() => run(() => {
            const v = (x: string) => (x === '' ? undefined : x === '-' ? '' : x);
            const n = assignParties([...pick], { area_id: v(assign.area_id), beat_id: v(assign.beat_id), agent_id: v(assign.agent_id), credit_policy: v(assign.credit_policy) });
            setPick(new Set());
            return distT('assigned', { n });
          })}>{distT('assign', { n: pick.size })}</button>
        </div>
      )}
      {impliedPacks(localDb.settings.get()).some((p) => p === 'distributor' || p === 'commodity') && <Suspense fallback={null}><PartyRatesEditor onDone={onDone} /></Suspense>}
    </div>
  );
}
