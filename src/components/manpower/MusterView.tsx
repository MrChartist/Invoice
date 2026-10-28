/**
 * R17-B1 / B2 muster view (`view=muster&site=&month=`): the duty register of a site × month — person, post, duties
 * (0.5 steps), OT hours, reliever; totals per post against heads × days; warnings (never block); "Copy last month",
 * CSV / XLSX import, save, lock / unlock. "Send to payroll" previews the month's attendance from every locked muster
 * and writes it on confirm (the payroll bridge is loaded on click).
 */
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useT } from '../../i18n';
import { mpT } from '../../i18n/areas/manpower-r17a';
import { mbT } from '../../i18n/areas/manpower-r17b';
import { todayInput } from '../../lib/utils';
import { loadSites, siteLabel } from '../../lib/manpower/mp-sites';
import { copyRows, daysIn, loadMusters, loadStaff, musterOf, musterWarnings, postTotals } from '../../lib/manpower/mp-muster';
import { logMusterImport, saveMuster, setMusterLock } from '../../lib/manpower/mp-muster-save';
import { mapMusterTable } from '../../lib/manpower/mp-muster-import';
import { unlockedSites, type AttendancePush } from '../../lib/manpower/mp-attendance';
import type { MusterRow } from '../../types/manpower-r17';
import { readFileTables } from '../marketplace/file-read';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import { Field, type MpViewProps } from './mp-ui';

const bar = { display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end', margin: '0.5rem 0' } as const;
const sm = `${controls.btnOutline} ${controls.btnSm}`;

export default function MusterView({ notify }: MpViewProps) {
  useT();
  const [params, setParams] = useSearchParams();
  const [tick, setTick] = useState(0);
  const sites = useMemo(() => loadSites(), []);
  const staff = useMemo(() => loadStaff(), []);
  const month = params.get('month') || todayInput().slice(0, 7);
  const site = sites.find((s) => s.id === params.get('site')) ?? sites[0];
  const musters = useMemo(() => { void tick; return loadMusters(month); }, [month, tick]);
  const m = site && musterOf(musters, site.id, month);
  const [rows, setRows] = useState<MusterRow[] | null>(null);
  const [push, setPush] = useState<{ rows: AttendancePush[]; missing: string } | null>(null);
  const cur = rows ?? m?.rows ?? [];
  const ro = m?.status === 'locked';
  const go = (p: Record<string, string>) => { setRows(null); setPush(null); setParams({ tab: 'deploy', view: 'muster', ...(site ? { site: site.id } : {}), month, ...p }, { replace: true }); };
  const run = (fn: () => void, ok?: string) => { try { fn(); if (ok) notify(ok); } catch (e) { notify((e as Error).message, 'error'); } };
  const done = () => { setRows(null); setTick((t) => t + 1); };
  if (!site) return <p className={controls.hint}>{mpT('none')}</p>;
  const set = (i: number, p: Partial<MusterRow>) => setRows(cur.map((r, k) => (k === i ? { ...r, ...p } : r)));
  const days = daysIn(month);
  const warn = musterWarnings({ site_id: site.id, month, rows: cur }, musters, staff);
  const name = (id: string) => staff.find((e) => e.id === id);
  const onFile = async (f?: File) => {
    if (!f) return;
    try {
      const t = (await readFileTables(f))[0]?.table;
      if (!t) throw new Error('No table with a header row was found in the file.');
      const r = mapMusterTable(t, site, staff);
      setRows(r.rows);
      logMusterImport(f.name, r.rows.length, r.unknown.length);
      notify(r.unknown.length ? mbT('unknown', { c: r.unknown.join(', ') }) : mbT('imported', { n: r.rows.length }), r.unknown.length ? 'info' : 'success');
    } catch (e) { notify((e as Error).message, 'error'); }
  };
  const preview = async () => {
    const io = await import('../../lib/manpower/mp-payroll-io');
    run(() => setPush({ rows: io.previewPush(month), missing: unlockedSites(sites, month, musters).map((s) => s.mp.code).join(', ') }));
  };
  const send = async () => {
    const io = await import('../../lib/manpower/mp-payroll-io');
    run(() => { notify(mbT('pushed', { n: io.pushAttendance(month) })); setPush(null); });
  };
  return (
    <section data-mp-muster={m?.status ?? 'new'}>
      <div style={bar}>
        <Field label={mpT('site')}>
          <select className={controls.select} value={site.id} onChange={(e) => go({ site: e.target.value })} data-mp-muster-site>
            {sites.map((s) => <option key={s.id} value={s.id}>{siteLabel(s)}</option>)}
          </select>
        </Field>
        <Field label={mpT('month')}><input type="month" className={controls.input} value={month} onChange={(e) => e.target.value && go({ month: e.target.value })} data-mp-muster-month /></Field>
        <span className={controls.hint}>{m ? (ro ? mbT('locked') : mbT('draft')) : ''}</span>
      </div>
      <div className={surface.tableWrap}>
        <table className={surface.table} data-mp-muster-rows>
          <thead><tr><th>{mbT('person')}</th><th>{mpT('post')}</th><th>{mpT('duties')}</th><th>{mbT('ot')}</th><th>{mpT('reliever')}</th><th /></tr></thead>
          <tbody>
            {cur.map((r, i) => (
              <tr key={i} data-mp-muster-row={name(r.employee_id)?.code ?? i}>
                <td>
                  <select className={controls.select} aria-label={mbT('person')} disabled={ro} value={r.employee_id} onChange={(e) => set(i, { employee_id: e.target.value })} data-mp-row-person>
                    <option value="">—</option>
                    {staff.map((e) => <option key={e.id} value={e.id}>{e.code} {e.name}</option>)}
                  </select>
                </td>
                <td>
                  <select className={controls.select} aria-label={mpT('post')} disabled={ro} value={r.post_id} onChange={(e) => set(i, { post_id: e.target.value })} data-mp-row-post>
                    {site.mp.posts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </td>
                <td><input type="number" min={0} step={0.5} className={controls.input} aria-label={mpT('duties')} disabled={ro} value={r.duties} onChange={(e) => set(i, { duties: Number(e.target.value) })} data-mp-row-duties /></td>
                <td><input type="number" min={0} className={controls.input} aria-label={mbT('ot')} disabled={ro} value={r.ot_hours ?? ''} onChange={(e) => set(i, { ot_hours: Number(e.target.value) || undefined })} data-mp-row-ot /></td>
                <td><input type="checkbox" aria-label={mpT('reliever')} disabled={ro} checked={!!r.relief} onChange={(e) => set(i, { relief: e.target.checked })} data-mp-row-relief /></td>
                <td>{!ro && <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => setRows(cur.filter((_, k) => k !== i))}>{mpT('remove')}</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={controls.hint} data-mp-muster-totals>{postTotals(site, cur, days).map((t) => `${t.post.name}: ${mbT('total', { d: t.duties, f: t.full })}`).join(' · ')}</p>
      {warn.map((w, i) => <p key={i} className={controls.hint} style={{ color: 'var(--destructive)' }} data-mp-muster-warn>{w.text}</p>)}
      <div style={bar}>
        {!ro && (
          <>
            <button type="button" className={sm} onClick={() => setRows(copyRows(site, month, loadMusters(), staff))} data-mp-muster-copy>{mbT('copy')}</button>
            <button type="button" className={sm} onClick={() => setRows([...cur, { employee_id: '', post_id: site.mp.posts[0]?.id ?? '', duties: 0, relief: true }])} data-mp-muster-add>{mbT('add')}</button>
            <label className={sm}>{mbT('imp')}<input type="file" accept=".csv,.xlsx" hidden onChange={(e) => void onFile(e.target.files?.[0])} data-mp-muster-file /></label>
            <button type="button" className={controls.btnOutline} onClick={() => run(() => { saveMuster(site, month, cur, m?.id); done(); }, mbT('saved'))} data-mp-muster-save>{mbT('saveDraft')}</button>
          </>
        )}
        {m && !rows && <button type="button" className={controls.btnPrimary} onClick={() => run(() => { setMusterLock(m.id, !ro); done(); })} data-mp-muster-lock>{ro ? mbT('unlock') : mbT('lock')}</button>}
        <button type="button" className={controls.btnOutline} onClick={() => void preview()} data-mp-push>{mbT('push')}</button>
      </div>
      {push && (
        <div data-mp-push-preview>
          {push.missing && <p className={controls.hint}>{mbT('missing', { s: push.missing })}</p>}
          <table className={surface.table}>
            <thead><tr><th>{mbT('person')}</th><th className={surface.numeric}>{mpT('duties')}</th><th className={surface.numeric}>{mbT('lopNow')}</th><th className={surface.numeric}>{mbT('lop')}</th><th className={surface.numeric}>{mbT('ot')}</th></tr></thead>
            <tbody>{push.rows.map((r) => <tr key={r.employee_id} data-mp-push-row={name(r.employee_id)?.code}><td>{name(r.employee_id)?.name ?? r.employee_id}</td><td className={surface.numeric}>{r.duties}</td><td className={surface.numeric}>{r.cur?.lop ?? '—'}</td><td className={surface.numeric}>{r.lop}</td><td className={surface.numeric}>{r.units.ot_hours ?? ''}</td></tr>)}</tbody>
          </table>
          <button type="button" className={controls.btnPrimary} disabled={!push.rows.length} onClick={() => void send()} data-mp-push-confirm>{mbT('confirm')}</button>
        </div>
      )}
    </section>
  );
}
