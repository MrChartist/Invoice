/** PS-A2 Engagements: model, fees / cap / milestones / success event, matters covered, letter, renewal, close. */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Engagement, EngagementMilestone, EngagementModel } from '../../types/prof-r14';
import { localDb } from '../../lib/localDb';
import { MODELS, deleteEngagement, loadEngagements, renewalsDue, saveEngagement, successPrompt, syncAcceptances, type EngagementInput } from '../../lib/prof/ps-engagements';
import { makeLetter } from '../../lib/prof/ps-letters';
import { loadMatters } from '../../lib/prof/ps-matters';
import { loadRetainers } from '../../lib/retainers';
import { can } from '../../lib/access';
import { todayInput } from '../../lib/utils';
import { pmT } from '../../i18n/areas/prof-r14a-matters';
import { psT } from '../../i18n/areas/prof-r14-common';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import { Field } from './ps-ui';
import { runWith, type PsDeskProps } from './ps-run';

const blank = (): EngagementInput => ({ client_id: '', matter_ids: [], title: '', model: 'hourly', currency: 'INR', disb_policy: 'agent', start: todayInput(), status: 'draft' });
const n = (v: string) => (v === '' ? undefined : Number(v));

export default function EngagementsView({ notify }: Pick<PsDeskProps, 'notify'>) {
  const run = runWith(notify);
  const go = useNavigate();
  const [tick, setTick] = useState(0);
  const [f, setF] = useState<EngagementInput | null>(null);
  /* eslint-disable react-hooks/exhaustive-deps */
  const list = useMemo(() => { syncAcceptances(localDb.invoices.getAll()); return loadEngagements(); }, [tick]);
  /* eslint-enable react-hooks/exhaustive-deps */
  const clients = useMemo(() => localDb.clients.getAll().filter((c) => c.id), []);
  const matters = useMemo(() => loadMatters(), []);
  const retainers = useMemo(() => loadRetainers(), []);
  const kind = localDb.settings.get().prof_kind;
  const refresh = () => setTick((x) => x + 1);
  const set = (p: Partial<EngagementInput>) => f && setF({ ...f, ...p });
  const ms = (i: number, p: Partial<EngagementMilestone>) => f && set({ milestones: (f.milestones ?? []).map((m, j) => (j === i ? { ...m, ...p } : m)) });
  const save = () => {
    if (!f) return;
    const r = run(() => saveEngagement(f, { kind, partyNames: matters.filter((m) => f.matter_ids.includes(m.id)).flatMap((m) => m.ps.parties.map((p) => p.name)) }), psT('saved'));
    if (!r) return;
    for (const w of r.warnings) notify(w, 'info');
    setF(null);
    refresh();
  };
  const prompt = f ? successPrompt(kind, f) : '';
  const num = (k: 'fee' | 'cap' | 'blended_rate', label: string) => <Field label={label}><input type="number" min={0} className={controls.input} value={f?.[k] ?? ''} onChange={(e) => set({ [k]: n(e.target.value) })} data-eng-field={k} /></Field>;
  const due = renewalsDue(list, todayInput());
  return (
    <div className={surface.card}>
      <div className={surface.cardBody}>
        <div className={controls.row}>
          <button type="button" className={controls.btnPrimary} onClick={() => setF(blank())} data-new-engagement>{pmT('newEng')}</button>
          {due.length > 0 && <span className={controls.hint}>{pmT('renewals', { n: due.length })}</span>}
        </div>
        {f && (
          <div data-engagement-form>
            <div className={controls.row3}>
              <Field label={psT('client')}><select className={controls.select} value={f.client_id} onChange={(e) => set({ client_id: e.target.value })} data-eng-client><option value="">{psT('none')}</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
              <Field label={pmT('title')}><input className={controls.input} value={f.title} onChange={(e) => set({ title: e.target.value })} data-eng-title /></Field>
              <Field label={psT('model')}><select className={controls.select} value={f.model} onChange={(e) => set({ model: e.target.value as EngagementModel })} data-eng-model>{MODELS.map((m) => <option key={m} value={m}>{psT(`m.${m}`)}</option>)}</select></Field>
              {(f.model === 'fixed' || f.model === 'milestone' || f.model === 'retainer' || f.model === 'hourly') && num('fee', psT('fee'))}
              {f.model === 'capped' && num('cap', pmT('capField'))}
              {f.model === 'blended' && num('blended_rate', pmT('blended'))}
              {f.model === 'retainer' && <Field label={pmT('retainer')}><select className={controls.select} value={f.retainer_id ?? ''} onChange={(e) => set({ retainer_id: e.target.value || undefined })}><option value="">{psT('none')}</option>{retainers.map((r) => <option key={r.id} value={r.id}>{r.client_name ?? r.client_key} · {r.hours_per_period} h</option>)}</select></Field>}
              <Field label={pmT('currency')}><input className={controls.input} value={f.currency} onChange={(e) => set({ currency: e.target.value.toUpperCase() })} /></Field>
              <Field label={pmT('disb')}><select className={controls.select} value={f.disb_policy} onChange={(e) => set({ disb_policy: e.target.value as Engagement['disb_policy'] })}>{(['agent', 'markup', 'included'] as const).map((d) => <option key={d} value={d}>{pmT(`d.${d}`)}</option>)}</select></Field>
              <Field label={pmT('start')}><input type="date" className={controls.input} value={f.start} onChange={(e) => set({ start: e.target.value })} /></Field>
              <Field label={pmT('end')}><input type="date" className={controls.input} value={f.end ?? ''} onChange={(e) => set({ end: e.target.value || undefined })} /></Field>
              <Field label={pmT('renew')}><input type="date" className={controls.input} value={f.renew_on ?? ''} onChange={(e) => set({ renew_on: e.target.value || undefined })} /></Field>
            </div>
            {f.model === 'success' && (
              <div className={controls.row3}>
                <Field label={pmT('event')}><input className={controls.input} value={f.success?.event ?? ''} onChange={(e) => set({ success: { basis: '', ...f.success, event: e.target.value } })} /></Field>
                <Field label={pmT('pct')}><input type="number" className={controls.input} value={f.success?.pct ?? ''} onChange={(e) => set({ success: { basis: '', event: '', ...f.success, pct: n(e.target.value) } })} /></Field>
                <Field label={psT('amount')}><input type="number" className={controls.input} value={f.success?.amount ?? ''} onChange={(e) => set({ success: { basis: '', event: '', ...f.success, amount: n(e.target.value) } })} /></Field>
                <Field label={pmT('base')}><input type="number" className={controls.input} value={f.success?.base_amount ?? ''} onChange={(e) => set({ success: { basis: '', event: '', ...f.success, base_amount: n(e.target.value) } })} /></Field>
                <Field label={pmT('done')}><input type="date" className={controls.input} value={f.success?.done_on ?? ''} onChange={(e) => set({ success: { basis: '', event: '', ...f.success, done_on: e.target.value || undefined } })} /></Field>
                <Field label={pmT('ref')}><input className={controls.input} value={f.success?.ref ?? ''} onChange={(e) => set({ success: { basis: '', event: '', ...f.success, ref: e.target.value } })} /></Field>
              </div>
            )}
            {f.model === 'milestone' && (
              <>
                {(f.milestones ?? []).map((m, i) => (
                  <div key={m.id || i} className={controls.row3}>
                    <input className={controls.input} aria-label={pmT('label')} placeholder={pmT('label')} value={m.label} onChange={(e) => ms(i, { label: e.target.value })} />
                    <input type="number" className={controls.input} aria-label={pmT('pct')} placeholder={pmT('pct')} value={m.pct ?? ''} onChange={(e) => ms(i, { pct: n(e.target.value) })} />
                    <input type="date" className={controls.input} aria-label={pmT('done')} value={m.done_on ?? ''} onChange={(e) => ms(i, { done_on: e.target.value || undefined })} />
                  </div>
                ))}
                <button type="button" className={controls.btnGhost} onClick={() => set({ milestones: [...(f.milestones ?? []), { id: '', label: '' }] })}>{pmT('milestones')} +</button>
              </>
            )}
            <span className={controls.label}>{pmT('matters')}</span>
            <div className={controls.row}>
              {matters.filter((m) => !f.client_id || m.client_id === f.client_id).map((m) => (
                <label key={m.id} className={controls.check}><input type="checkbox" checked={f.matter_ids.includes(m.id)} onChange={(e) => set({ matter_ids: e.target.checked ? [...f.matter_ids, m.id] : f.matter_ids.filter((x) => x !== m.id) })} data-eng-matter={m.ps.code} /> {m.ps.code}</label>
              ))}
            </div>
            {prompt && <p className={controls.error} role="alert">{pmT('warn')}: {prompt}</p>}
            {prompt && can('settings.manage') && <Field label={pmT('ethics')}><input className={controls.input} value={f.ethics_reason ?? ''} onChange={(e) => set({ ethics_reason: e.target.value })} /></Field>}
            <div className={controls.row}>
              <button type="button" className={controls.btnPrimary} onClick={save} data-save-engagement>{psT('save')}</button>
              <button type="button" className={controls.btnOutline} onClick={() => setF(null)}>{psT('close')}</button>
            </div>
          </div>
        )}
        <div className={surface.tableWrap}>
          <table className={surface.table} data-engagements>
            <thead><tr><th>{psT('engagement')}</th><th>{psT('client')}</th><th>{pmT('title')}</th><th>{psT('model')}</th><th>{psT('status')}</th><th>{pmT('start')}</th><th>{pmT('renew')}</th><th /></tr></thead>
            <tbody>
              {list.map((e) => (
                <tr key={e.id} data-engagement-row={e.number}>
                  <td>{e.number}</td><td>{clients.find((c) => c.id === e.client_id)?.name ?? ''}</td><td>{e.title}</td><td>{psT(`m.${e.model}`)}</td><td>{psT(`s.${e.status}`)}</td><td>{e.start}</td><td>{e.renew_on ?? e.end ?? ''}</td>
                  <td className={surface.rowActions}>
                    <button type="button" className={controls.btnGhost} onClick={() => setF({ ...e })}>{psT('open')}</button>
                    <button type="button" className={controls.btnGhost} onClick={() => { const q = run(() => makeLetter(e.id)); if (q) go(`/invoice/${q.id}`); }} data-make-letter>{pmT('letter')}</button>
                    {e.status !== 'closed' && <button type="button" className={controls.btnGhost} onClick={() => run(() => saveEngagement({ ...e, status: 'closed' }, { kind }), psT('saved')) && refresh()}>{pmT('closeEng')}</button>}
                    <button type="button" className={controls.btnGhost} onClick={() => run(() => (deleteEngagement(e.id), true), psT('saved')) && refresh()}>{psT('remove')}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
