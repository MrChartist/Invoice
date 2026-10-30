/** PS-A2 Matters: open / edit / close matters (project cost centres + `CostCentre.ps`), the list with WIP / billed / received. */
import { useEffect, useMemo, useState } from 'react';
import type { MatterInfo, MatterParty } from '../../types/prof-r14';
import { loadCostCentres } from '../../lib/cost-centres';
import { localDb } from '../../lib/localDb';
import { clientCode, loadMatters, needsConflictCheck, saveMatter, setMatterClosed, suggestCode } from '../../lib/prof/ps-matters';
import { loadChecks } from '../../lib/prof/ps-conflicts';
import { loadStaff } from '../../lib/services/sv-staff';
import { currentLiveInvoiceIds, readTimePrefs, timeDb, unbilledTime } from '../../lib/timesheets';
import { entryStandard } from '../../lib/prof/ps-staff';
import { downloadText, toCsv } from '../../lib/download';
import { can } from '../../lib/access';
import { formatCurrency, todayInput } from '../../lib/utils';
import { round2 } from '../../lib/invoice-calc';
import { pmT, type PmKey } from '../../i18n/areas/prof-r14a-matters';
import { psT } from '../../i18n/areas/prof-r14-common';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import { Field } from './ps-ui';
import { runWith, type PsDeskProps } from './ps-run';
import { SelectField } from '../ui/SelectField';
import { DateField } from '../ui/DateField';

// PS-B: the client-money balance per matter, read only when its module exists (never a hard dependency).
const cmMods = import.meta.glob<{ matterBalance?: (id: string) => number }>('../../lib/prof/ps-client-money.ts');

const ROLES: MatterParty['role'][] = ['client', 'opposite', 'related', 'witness', 'other'];
const blank = (): MatterInfo => ({ code: '', kind: 'matter', opened: todayInput(), parties: [] });

export default function MattersView({ notify }: Pick<PsDeskProps, 'notify'>) {
  const run = runWith(notify);
  const [tick, setTick] = useState(0);
  const [f, setF] = useState<{ id?: string; name: string; client_id: string; ps: MatterInfo } | null>(null);
  const [cm, setCm] = useState<((id: string) => number) | null>(null);
  /* eslint-disable react-hooks/exhaustive-deps */
  const centres = useMemo(() => loadCostCentres(), [tick]);
  const matters = useMemo(() => loadMatters(centres), [centres]);
  const clients = useMemo(() => localDb.clients.getAll().filter((c) => c.id), []);
  const staff = useMemo(() => loadStaff(), []);
  const checks = useMemo(() => loadChecks(), [tick]);
  const stats = useMemo(() => {
    const prefs = readTimePrefs();
    const live = currentLiveInvoiceIds();
    const out = new Map<string, { wip: number; billed: number; received: number; last: string }>();
    const at = (id: string) => out.get(id) ?? out.set(id, { wip: 0, billed: 0, received: 0, last: '' }).get(id)!;
    for (const e of unbilledTime(timeDb.all(), live, undefined, prefs)) if (e.cost_centre_id) { const s = at(e.cost_centre_id); s.wip = round2(s.wip + entryStandard(e, prefs)); if (e.date > s.last) s.last = e.date; }
    for (const inv of localDb.invoices.getAll()) {
      const id = inv.ps?.matter?.id ?? inv.cost_centre_id;
      if (!id || !live.has(inv.id) || inv.doc_type !== 'INVOICE') continue;
      const s = at(id);
      s.billed = round2(s.billed + inv.taxable_value);
      s.received = round2(s.received + inv.amount_paid);
      if (inv.issue_date > s.last) s.last = inv.issue_date;
    }
    return out;
  }, [tick]);
  /* eslint-enable react-hooks/exhaustive-deps */
  useEffect(() => {
    const load = Object.values(cmMods)[0];
    if (load) void load().then((m) => m.matterBalance && setCm(() => m.matterBalance!)).catch(() => undefined);
  }, []);
  const set = (p: Partial<MatterInfo>) => f && setF({ ...f, ps: { ...f.ps, ...p } });
  const party = (i: number, p: Partial<MatterParty>) => f && set({ parties: f.ps.parties.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  const pickClient = (id: string) => f && setF({ ...f, client_id: id, ps: { ...f.ps, code: f.ps.code || suggestCode(clientCode(clients.find((c) => c.id === id)), centres) } });
  const save = () => f && run(() => saveMatter({ id: f.id, name: f.name, client_id: f.client_id, ps: f.ps }), psT('saved')) && (setF(null), setTick((n) => n + 1));
  const name = (id?: string) => staff.find((s) => s.id === id)?.name ?? '';
  const rows = matters.map((m) => [m.ps.code, m.name, clients.find((c) => c.id === m.client_id)?.name ?? '', name(m.ps.responsible_id), m.ps.closed ? psT('closed') : psT('open'), stats.get(m.id)?.wip ?? 0, stats.get(m.id)?.billed ?? 0, stats.get(m.id)?.received ?? 0, stats.get(m.id)?.last ?? '']);
  const head: PmKey[] = ['code', 'name'];
  return (
    <div className={surface.card}>
      <div className={surface.cardBody}>
        <div className={controls.row}>
          <button type="button" className={controls.btnPrimary} onClick={() => setF({ name: '', client_id: '', ps: blank() })} data-new-matter>{pmT('newMatter')}</button>
          <button type="button" className={controls.btnOutline} onClick={() => downloadText('matters.csv', toCsv([[pmT('code'), pmT('name'), psT('client'), pmT('responsible'), psT('status'), pmT('wip'), psT('billed'), pmT('received'), pmT('last')], ...rows]), 'text/csv')}>{psT('csv')}</button>
        </div>
        {f && (
          <div data-matter-form>
            <div className={controls.row3}>
              <Field label={pmT('name')}><input className={controls.input} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-matter-name /></Field>
              <Field label={psT('client')}><SelectField className={controls.select} value={f.client_id} onChange={(e) => pickClient(e.target.value)} data-matter-client><option value="">{psT('none')}</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</SelectField></Field>
              <Field label={pmT('code')}><input className={`${controls.input} ${controls.inputMono}`} value={f.ps.code} onChange={(e) => set({ code: e.target.value.toUpperCase() })} data-matter-code /></Field>
              <Field label={pmT('kind')}><SelectField className={controls.select} value={f.ps.kind} onChange={(e) => set({ kind: e.target.value as MatterInfo['kind'] })}>{(['matter', 'assignment', 'project'] as const).map((k) => <option key={k} value={k}>{pmT(`k.${k}`)}</option>)}</SelectField></Field>
              <Field label={pmT('court')}><input className={controls.input} value={f.ps.court ?? ''} onChange={(e) => set({ court: e.target.value })} /></Field>
              <Field label={pmT('caseNo')}><input className={controls.input} value={f.ps.case_no ?? ''} onChange={(e) => set({ case_no: e.target.value })} /></Field>
              <Field label={pmT('responsible')}><SelectField className={controls.select} value={f.ps.responsible_id ?? ''} onChange={(e) => set({ responsible_id: e.target.value || undefined })}><option value="">{psT('none')}</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</SelectField></Field>
              <Field label={pmT('opened')}><DateField className={controls.input} value={f.ps.opened} onChange={(e) => set({ opened: e.target.value })} /></Field>
              <Field label={pmT('check')}><SelectField className={controls.select} value={f.ps.conflict_id ?? ''} onChange={(e) => set({ conflict_id: e.target.value || undefined })} data-matter-check><option value="">{psT('none')}</option>{checks.map((c) => <option key={c.id} value={c.id}>{c.date} · {c.terms.join(', ')} · {pmT(`res.${c.result}`)}</option>)}</SelectField></Field>
              {(needsConflictCheck(f.ps) || f.ps.skip_reason) && can('settings.manage') && <Field label={pmT('skip')}><input className={controls.input} value={f.ps.skip_reason ?? ''} onChange={(e) => set({ skip_reason: e.target.value || undefined })} data-matter-skip /></Field>}
            </div>
            <span className={controls.label}>{pmT('parties')}</span>
            {f.ps.parties.map((p, i) => (
              <div key={i} className={controls.row3}>
                <input className={controls.input} aria-label={pmT('party')} placeholder={pmT('party')} value={p.name} onChange={(e) => party(i, { name: e.target.value })} data-party-name />
                <SelectField className={controls.select} aria-label={pmT('role')} value={p.role} onChange={(e) => party(i, { role: e.target.value as MatterParty['role'] })}>{ROLES.map((r) => <option key={r} value={r}>{pmT(`r.${r}`)}</option>)}</SelectField>
                <input className={`${controls.input} ${controls.inputMono}`} aria-label={pmT('pan')} placeholder={pmT('pan')} value={p.pan ?? ''} onChange={(e) => party(i, { pan: e.target.value })} />
              </div>
            ))}
            <div className={controls.row}>
              <button type="button" className={controls.btnGhost} onClick={() => set({ parties: [...f.ps.parties, { name: '', role: 'opposite' }] })} data-add-party>{psT('add')}</button>
              <button type="button" className={controls.btnPrimary} onClick={save} data-save-matter>{psT('save')}</button>
              <button type="button" className={controls.btnOutline} onClick={() => setF(null)}>{psT('close')}</button>
            </div>
          </div>
        )}
        <div className={surface.tableWrap}>
          <table className={surface.table} data-matters>
            <thead><tr>{head.map((k) => <th key={k}>{pmT(k)}</th>)}<th>{psT('client')}</th><th>{pmT('responsible')}</th><th>{psT('status')}</th><th className={surface.numeric}>{pmT('wip')}</th><th className={surface.numeric}>{psT('billed')}</th><th className={surface.numeric}>{pmT('received')}</th>{cm && <th className={surface.numeric}>{pmT('cm')}</th>}<th>{pmT('last')}</th><th /></tr></thead>
            <tbody>
              {matters.map((m, i) => (
                <tr key={m.id} data-matter-row={m.ps.code}>
                  {rows[i].slice(0, 5).map((c, j) => <td key={j}>{c}</td>)}
                  {rows[i].slice(5, 8).map((c, j) => <td key={j} className={surface.numeric}>{formatCurrency(Number(c))}</td>)}
                  {cm && <td className={surface.numeric}>{formatCurrency(cm(m.id))}</td>}
                  <td>{rows[i][8]}</td>
                  <td className={surface.rowActions}>
                    <button type="button" className={controls.btnGhost} onClick={() => setF({ id: m.id, name: m.name, client_id: m.client_id ?? '', ps: m.ps })}>{psT('open')}</button>
                    <button type="button" className={controls.btnGhost} onClick={() => run(() => setMatterClosed(m.id, m.ps.closed ? undefined : todayInput()), psT('saved')) && setTick((n) => n + 1)}>{m.ps.closed ? psT('reopen') : psT('close')}</button>
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
