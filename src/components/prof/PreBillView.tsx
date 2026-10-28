/** PS-A3 Pre-bill: review a matter's unbilled time row by row, apply the engagement's model, and create the draft fee note. */
import { lazy, Suspense, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { loadCostCentres } from '../../lib/cost-centres';
import { clientKey, currentLiveInvoiceIds, readTimePrefs, timeDb, unbilledTime } from '../../lib/timesheets';
import { createCommissionDraft, createPrebillDraft, prebillFor, type PrebillInput } from '../../lib/prof/ps-prebill';
import { localDb } from '../../lib/localDb';
import { impliedPacks } from '../../lib/shop-mode';
import { r16bT } from '../../i18n/areas/prof-r16b';
import { planBill, type RowEdit } from '../../lib/prof/ps-models';
import { entryStandard } from '../../lib/prof/ps-staff';
import { wipRules } from '../../lib/prof/ps-settings';
import { loadStaff } from '../../lib/services/sv-staff';
import { round2 } from '../../lib/invoice-calc';
import { formatCurrency, todayInput } from '../../lib/utils';
import { pwT } from '../../i18n/areas/prof-r14a-wip';
import { psT } from '../../i18n/areas/prof-r14-common';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import { Field } from './ps-ui';
import { runWith, type PsDeskProps } from './ps-run';

// R14 PS-C4: foreign-currency rate cards converted at the currency master's rate (lazy; nothing without such a card).
const FxRateRow = lazy(() => import('./FxRateRow'));
// R16-B2: media rows (`media` pack; lazy).
const MediaPrebill = lazy(() => import('./MediaPrebill'));

export default function PreBillView({ notify }: Pick<PsDeskProps, 'notify'>) {
  const run = runWith(notify);
  const go = useNavigate();
  const [params] = useSearchParams();
  const prefs = useMemo(() => readTimePrefs(), []);
  const centres = useMemo(() => loadCostCentres(), []);
  const staff = useMemo(() => new Map(loadStaff().map((s) => [s.id, s.name])), []);
  const keys = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of unbilledTime(timeDb.all(), currentLiveInvoiceIds(), undefined, prefs)) m.set(clientKey(e), e.client_name);
    return [...m];
  }, [prefs]);
  const [key, setKey] = useState(params.get('client') ?? keys[0]?.[0] ?? '');
  const [project, setProject] = useState(params.get('matter') ?? '');
  const [edits, setEdits] = useState<Record<string, RowEdit>>({});
  const [ms, setMs] = useState<string[]>([]);
  const [target, setTarget] = useState('');
  const [reason, setReason] = useState('');
  const [annex, setAnnex] = useState(true);
  const packs = useMemo(() => impliedPacks(localDb.settings.get()), []);
  const [appear, setAppear] = useState(false); // R16-B3 (legal)
  const [media, setMedia] = useState<PrebillInput['extra']>();
  const view = useMemo(() => (key ? prebillFor(key, project || undefined, prefs) : null), [key, project, prefs]);
  const eng = view?.engagement;
  const money = (n: number) => formatCurrency(n, eng?.currency);
  const plan = useMemo(() => {
    if (!view) return null;
    try {
      return planBill(view.sel.time, edits, eng, { prefs, used: view.use.used, feesBefore: view.use.fees, milestonesBilled: view.use.milestones, milestoneIds: ms, target: target === '' ? undefined : Number(target), money });
    } catch (e) {
      return (e as Error).message;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, edits, ms, target]);
  const ed = (id: string, p: Partial<RowEdit>) => setEdits((x) => ({ ...x, [id]: { ...x[id], ...p } }));
  const matters = centres.filter((c) => c.kind === 'project' && (!c.client_id || c.client_id === key));
  const billed = plan && typeof plan !== 'string' ? round2(plan.time.reduce((s, e) => s + entryStandard(e, prefs), 0) + plan.fees.reduce((s, f) => s + f.amount, 0)) : 0;
  const std = view ? round2(view.sel.time.filter((e) => !edits[e.id]?.defer).reduce((s, e) => s + entryStandard(e, prefs), 0)) : 0;
  const create = () => {
    const d = run(() => createPrebillDraft({ key, projectId: project || undefined, edits, milestoneIds: ms, target: target === '' ? undefined : Number(target), reason: reason || undefined, annexure: annex, ...(appear ? { appearances: true } : {}), ...(media ? { extra: media } : {}) }, prefs));
    if (d) go(`/invoice/${d.id}`);
  };
  return (
    <div className={surface.card}>
      <div className={surface.cardBody}>
        <div className={controls.row3}>
          <Field label={pwT('pick')}><select className={controls.select} value={key} onChange={(e) => { setKey(e.target.value); setProject(''); setEdits({}); }} data-prebill-client>{keys.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></Field>
          <Field label={psT('matter')}><select className={controls.select} value={project} onChange={(e) => { setProject(e.target.value); setEdits({}); setMs([]); }} data-prebill-matter><option value="">{pwT('all')}</option>{matters.map((c) => <option key={c.id} value={c.id}>{c.ps?.code ? `${c.ps.code} — ` : ''}{c.name}</option>)}</select></Field>
          {eng && <Field label={psT('engagement')}><input className={controls.input} readOnly value={`${eng.number} · ${psT(`m.${eng.model}`)}`} /></Field>}
          {(!eng || eng.model === 'hourly' || eng.model === 'blended') && <Field label={pwT('target')}><input type="number" min={0} className={controls.input} value={target} onChange={(e) => setTarget(e.target.value)} data-prebill-target /></Field>}
          <Field label={psT('reason')}><select className={controls.select} value={reason} onChange={(e) => setReason(e.target.value)}><option value="">{psT('none')}</option>{wipRules().reasons.map((r) => <option key={r} value={r}>{r}</option>)}</select></Field>
        </div>
        {eng?.model === 'milestone' && (
          <div className={controls.row}>
            <span className={controls.label}>{pwT('milestone')}</span>
            {(eng.milestones ?? []).filter((m) => !view?.use.milestones.includes(m.id)).map((m) => <label key={m.id} className={controls.check}><input type="checkbox" checked={ms.includes(m.id)} onChange={(e) => setMs(e.target.checked ? [...ms, m.id] : ms.filter((x) => x !== m.id))} /> {m.label}{m.done_on || (m.due && m.due <= todayInput()) ? ' ✓' : ''}</label>)}
          </div>
        )}
        {!!view?.sel.time.length && <Suspense fallback={null}><FxRateRow entries={view.sel.time} currency={eng?.currency} onApply={(r) => setEdits((x) => ({ ...x, ...Object.fromEntries(Object.entries(r).map(([id, rate]) => [id, { ...x[id], rate }])) }))} /></Suspense>}
        {!view?.sel.time.length && !view?.sel.expenses.length && <p className={controls.hint}>{pwT('nothing')}</p>}
        <div className={surface.tableWrap}>
          <table className={surface.table} data-prebill>
            <thead><tr><th>{psT('date')}</th><th>{psT('staff')}</th><th>{pwT('desc')}</th><th className={surface.numeric}>{psT('hours')}</th><th className={surface.numeric}>{psT('standard')}</th><th>{pwT('billH')}</th><th>{psT('rate')}</th><th>{pwT('exclude')}</th><th>{pwT('defer')}</th></tr></thead>
            <tbody>
              {view?.sel.time.map((e) => (
                <tr key={e.id} data-prebill-row>
                  <td>{e.date}</td><td>{e.staff_id ? staff.get(e.staff_id) ?? '' : ''}</td><td>{[e.project, e.description].filter(Boolean).join(' — ')}</td>
                  <td className={surface.numeric}>{round2(e.minutes / 60)}</td><td className={surface.numeric}>{money(entryStandard(e, prefs))}</td>
                  <td><input type="number" min={0} step="0.25" className={controls.input} aria-label={pwT('billH')} value={edits[e.id]?.minutes !== undefined ? round2(edits[e.id].minutes! / 60) : ''} onChange={(x) => ed(e.id, { minutes: x.target.value === '' ? undefined : Number(x.target.value) * 60 })} /></td>
                  <td><input type="number" min={0} className={controls.input} aria-label={psT('rate')} value={edits[e.id]?.rate ?? ''} placeholder={String(e.hourly_rate)} onChange={(x) => ed(e.id, { rate: x.target.value === '' ? undefined : Number(x.target.value) })} /></td>
                  <td><input type="checkbox" aria-label={pwT('exclude')} checked={!!edits[e.id]?.exclude} onChange={(x) => ed(e.id, { exclude: x.target.checked })} /></td>
                  <td><input type="checkbox" aria-label={pwT('defer')} checked={!!edits[e.id]?.defer} onChange={(x) => ed(e.id, { defer: x.target.checked })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {typeof plan === 'string' && <p className={controls.error} role="alert">{plan}</p>}
        {plan && typeof plan !== 'string' && <p data-prebill-preview>{plan.basis} · {pwT('preview', { billed: money(billed), standard: money(std), diff: money(round2(billed - std)) })}</p>}
        {packs.includes('media') && key && <Suspense fallback={null}><MediaPrebill key={key} client={key} onChange={setMedia} notify={notify} bill={createCommissionDraft} /></Suspense>}
        {packs.includes('legal') && <label className={controls.check}><input type="checkbox" checked={appear} onChange={(e) => setAppear(e.target.checked)} data-prebill-appear /> {r16bT('appear')}</label>}
        <label className={controls.check}><input type="checkbox" checked={annex} onChange={(e) => setAnnex(e.target.checked)} /> {pwT('annexure')}</label>
        <button type="button" className={controls.btnPrimary} disabled={!key || typeof plan === 'string'} onClick={create} data-prebill-create>{pwT('create')}</button>
      </div>
    </div>
  );
}
