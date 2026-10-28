/**
 * R17-D statutory view (`view=statutory`): wage-revision arrears (a revision typed as ₹ more a duty, the sites that pass
 * it through, one debit note per original bill, what is owed to staff), TDS receivable by client × quarter (+ the R14
 * Form 16A / 131 chase list), licences and renewals (PSARA with the security pack, OSH / contract labour, guards'
 * licences, contract ends — the bell warns at 60 / 30 / 7 days) and the reverse-charge-only registration note.
 */
import { lazy, Suspense, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useT } from '../../i18n';
import { mpT } from '../../i18n/areas/manpower-r17a';
import { mdT } from '../../i18n/areas/manpower-r17d';
import { localDb } from '../../lib/localDb';
import { generateId } from '../../lib/storage';
import { formatCurrency, todayInput } from '../../lib/utils';
import { loadSites } from '../../lib/manpower/mp-sites';
import { loadMusters, loadStaff } from '../../lib/manpower/mp-muster';
import { passesThrough, staffArrears } from '../../lib/manpower/mp-arrears';
import { tdsReceivable } from '../../lib/manpower/mp-tds-recv';
import { mpAlerts } from '../../lib/manpower/mp-alerts';
import { rcmOnlyNote } from '../../lib/manpower/mp-regime';
import { makeArrears, planArrears } from '../../lib/manpower/mp-draft-io';
import { setGuardLicence } from '../../lib/manpower/mp-payroll-io';
import { readManpowerSettings, saveManpowerSettings } from '../../lib/manpower/mp-settings';
import type { ManpowerSettings, MpLicence } from '../../types/manpower-r17';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import { Field, type MpViewProps } from './mp-ui';

const ChasePanel = lazy(() => import('../prof/TdsChasePanel')); // R14 Form 16A / 131 chase list and letter
const bar = { display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end', margin: '0.5rem 0' } as const;
const KINDS: MpLicence['kind'][] = ['psara', 'osh', 'clra', 'trade', 'other'];
type G = { id: string; code: string; name: string; mp?: { guard_licence?: { no: string; valid_till: string } } };
const list = (k: 'cols' | 'tdsCols' | 'kinds') => mdT(k).split(',');
const Tbl = ({ head, rows, ...rest }: { head: string[]; rows: React.ReactNode[][] } & Record<`data-${string}`, string>) => (
  <div className={surface.tableWrap}><table className={surface.table} {...rest}><thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody></table></div>
);

export default function StatutoryView({ notify }: MpViewProps) {
  useT();
  const [tick, setTick] = useState(0);
  const [s, setS] = useState<ManpowerSettings>(readManpowerSettings);
  const revs = s.wage_revisions ?? [];
  const [revId, setRevId] = useState(revs[revs.length - 1]?.id ?? '');
  const [f, setF] = useState<Record<string, string>>({ from: `${todayInput().slice(0, 8)}01`, kind: 'psara' });
  const today = todayInput();
  const d = useMemo(() => {
    void tick;
    const sites = loadSites();
    const staff = loadStaff() as unknown as G[];
    const invoices = localDb.invoices.getAll();
    return { sites, staff, invoices, plan: planArrears(revId), musters: loadMusters(), guards: staff.filter((e) => e.mp?.guard_licence) };
  }, [revId, tick]);
  const rev = d.plan.rev;
  const save = (patch: Partial<ManpowerSettings>) => { try { setS(saveManpowerSettings(patch)); setTick((t) => t + 1); } catch (e) { notify((e as Error).message, 'error'); } };
  const run = (fn: () => void) => { try { fn(); setTick((t) => t + 1); } catch (e) { notify((e as Error).message, 'error'); } };
  const fld = (k: string, label: string, type = 'text') => <Field label={label}><input type={type} className={controls.input} value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} data-mp-st={k} /></Field>;
  const owed = rev ? staffArrears(rev, revs, d.sites, d.musters, d.staff) : [];
  const note = rcmOnlyNote(d.invoices, today);
  const due = mpAlerts({ today, settings: s, packs: (localDb.settings.get() as { industry_packs?: string[] }).industry_packs ?? [], sites: d.sites, guards: d.staff });
  return (
    <section data-mp-statutory>
      {note && <p className={controls.hint} role="note" data-mp-rcm-only>{mdT('rcmOnly')}</p>}
      <h4 className={controls.label}>{mdT('arrears')}</h4>
      <div style={bar}>
        <Field label={mdT('rev')}><select className={controls.select} value={revId} onChange={(e) => setRevId(e.target.value)} data-mp-arr-rev>{revs.map((r) => <option key={r.id} value={r.id}>{r.from} · {r.ref}{r.delta_day ? ` · +₹${r.delta_day}` : ''}</option>)}</select></Field>
        {fld('from', mpT('from'), 'date')}{fld('delta', mdT('delta'), 'number')}{fld('ref', mdT('ref'))}
        <button type="button" className={controls.btnOutline} disabled={!(Number(f.delta) > 0) || !f.ref?.trim() || !f.from} onClick={() => { const id = generateId(); save({ wage_revisions: [...revs, { id, from: f.from, delta_day: Number(f.delta), ref: f.ref.trim() }] }); setRevId(id); }} data-mp-arr-add>{mdT('add')}</button>
      </div>
      {rev && (
        <>
          <div style={bar}>
            <span className={controls.hint}>{mdT('pass')}:</span>
            {d.sites.map((x) => <label key={x.id} className={controls.check}><input type="checkbox" checked={passesThrough(x, rev)} disabled={x.mp.contract?.escalation === 'vda_pass_through'} onChange={(e) => save({ wage_revisions: revs.map((r) => (r.id === rev.id ? { ...r, site_ids: e.target.checked ? [...(r.site_ids ?? []), x.id] : (r.site_ids ?? []).filter((y) => y !== x.id) } : r)) })} data-mp-arr-site={x.mp.code} /> {x.mp.code}</label>)}
          </div>
          {d.plan.notes.length ? <Tbl data-mp-arrears="" head={list('cols')} rows={d.plan.notes.map((n) => [n.of.invoice_number || n.of.issue_date, [...new Set(n.lines.map((l) => l.site.mp.code))].join(', '), n.of.mp?.month, <span key="a" data-mp-arr-amt={n.of.id}>{n.lines.filter((l) => l.duties).map((l) => `${l.duties} × ₹${l.delta}`).join(' + ')} = {formatCurrency(n.amount)}</span>, n.raised.map((r) => <Link key={r.id} to={`/invoice/${r.id}`} data-mp-arr-raised>{r.invoice_number || '—'}</Link>)])} /> : <p className={controls.hint}>{mdT('none')}</p>}
          {d.plan.notes.some((n) => !n.raised.length) && <button type="button" className={controls.btnPrimary} onClick={() => run(() => notify(mdT('made', { n: makeArrears(rev.id).length })))} data-mp-arr-make>{s.arrears_doc === 'invoice' ? mdT('makeInv') : mdT('make')}</button>}
          {owed.length > 0 && <p className={controls.hint}>{mdT('staff', { n: owed.length, a: formatCurrency(owed.reduce((t, o) => t + o.amount, 0)) })} · <Link to="/payroll?tab=arrears">{mdT('payroll')}</Link></p>}
        </>
      )}
      <h4 className={controls.label}>{mdT('tds')}</h4>
      <Tbl data-mp-tds="" head={list('tdsCols')} rows={tdsReceivable(d.invoices).map((r) => [r.client, `Q${r.q} FY${String(r.fy).slice(2)}-${String(r.fy + 1).slice(2)}`, r.bills, formatCurrency(r.base), <span key="e" title={r.label} data-mp-tds-exp={r.client}>{formatCurrency(r.expected)}</span>, formatCurrency(r.booked), formatCurrency(r.diff)])} />
      <Suspense fallback={null}><ChasePanel /></Suspense>
      <h4 className={controls.label}>{mdT('lic')}</h4>
      {due.length ? due.map((a) => <p key={a.id} className={controls.hint} role="note" data-mp-due={a.severity}>{a.title} · {a.detail}</p>) : <p className={controls.hint}>{mdT('due')}</p>}
      <Tbl data-mp-lic="" head={[mdT('kind'), mdT('state'), mdT('no'), mdT('till'), '']} rows={(s.licences ?? []).map((l) => [list('kinds')[KINDS.indexOf(l.kind)], l.state ?? '', l.no, l.valid_till, <button key="x" type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => save({ licences: (s.licences ?? []).filter((x) => x.id !== l.id) })}>{mpT('remove')}</button>])} />
      <div style={bar}>
        <Field label={mdT('kind')}><select className={controls.select} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} data-mp-st="kind">{KINDS.map((k, i) => <option key={k} value={k}>{list('kinds')[i]}</option>)}</select></Field>
        {fld('state', mdT('state'))}{fld('no', mdT('no'))}{fld('till', mdT('till'), 'date')}
        <button type="button" className={controls.btnOutline} disabled={!f.no?.trim() || !f.till} onClick={() => save({ licences: [...(s.licences ?? []), { id: generateId(), kind: f.kind as MpLicence['kind'], no: f.no.trim(), valid_till: f.till, ...(f.state?.trim() ? { state: f.state.trim() } : {}) }] })} data-mp-lic-add>{mdT('add')}</button>
      </div>
      <div style={bar}>
        <Field label={mdT('guard')}><select className={controls.select} value={f.emp ?? ''} onChange={(e) => setF({ ...f, emp: e.target.value })}><option value="">—</option>{d.staff.map((e) => <option key={e.id} value={e.id}>{e.code} {e.name}</option>)}</select></Field>
        {fld('gno', mdT('no'))}{fld('gtill', mdT('till'), 'date')}
        <button type="button" className={controls.btnOutline} disabled={!f.emp} onClick={() => run(() => setGuardLicence(f.emp, f.gno?.trim() ? { no: f.gno, valid_till: f.gtill ?? '' } : null))}>{mpT('save')}</button>
      </div>
      {d.guards.map((g) => <p key={g.id} className={controls.hint}>{g.code} {g.name}: {g.mp?.guard_licence?.no} · {g.mp?.guard_licence?.valid_till}</p>)}
    </section>
  );
}
