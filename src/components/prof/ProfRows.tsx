/**
 * PS-A lazy rows in existing forms (each mounted only while the `practice` pack is on; one small chunk): the bill
 * dialog's "Open the pre-bill" link, the project form's "Matter details" link, the R10 staff form's capacity and rates,
 * and the business profile's SWIFT / IBAN (printed on export documents only, from the sender snapshot).
 */
import { Link } from 'react-router-dom';
import type { SenderProfile } from '../../types/invoice';
import type { PsStaff } from '../../types/prof-r14';
import { todayInput } from '../../lib/utils';
import { psT } from '../../i18n/areas/prof-r14-common';
import controls from '../../styles/controls.module.css';

export function PreBillLink({ clientKey, projectId }: { clientKey: string; projectId?: string }) {
  const q = new URLSearchParams({ tab: 'wip', view: 'prebill', client: clientKey, ...(projectId ? { matter: projectId } : {}) });
  return <Link className={controls.btnGhost} to={`/time?${q}`} data-open-prebill>{psT('prebill')}</Link>;
}

export function MatterLink({ code }: { code?: string }) {
  return <Link className={controls.btnGhost} to="/time?tab=matters&view=matters" data-matter-details>{psT('details')}{code ? ` · ${code}` : ''}</Link>;
}

export function StaffPsRow({ value, onChange }: { value?: PsStaff; onChange: (ps: PsStaff) => void }) {
  const r = value?.rates?.at(-1);
  const rate = (k: 'standard_rate' | 'cost_rate', v: number) => onChange({ ...value, rates: [...(value?.rates ?? []).slice(0, -1), { from: r?.from ?? todayInput(), standard_rate: r?.standard_rate ?? 0, cost_rate: r?.cost_rate ?? 0, [k]: v }] });
  const n = (label: string, v: number | undefined, set: (x: number) => void) => (
    <label className={controls.field}><span className={controls.label}>{label}</span><input type="number" min={0} className={controls.input} value={v ?? ''} onChange={(e) => set(Number(e.target.value) || 0)} /></label>
  );
  return (
    <>
      {n(psT('cap'), value?.capacity_hours_week, (x) => onChange({ ...value, capacity_hours_week: x }))}
      {n(psT('std'), r?.standard_rate, (x) => rate('standard_rate', x))}
      {n(psT('cost'), r?.cost_rate, (x) => rate('cost_rate', x))}
      {n(psT('target'), value?.target_pct, (x) => onChange({ ...value, target_pct: x }))}
    </>
  );
}

export function SwiftRow({ profile, onChange }: { profile: SenderProfile; onChange: (patch: Partial<SenderProfile>) => void }) {
  const f = (k: 'swift' | 'iban' | 'intermediary_bank', label: string) => (
    <label className={controls.field}><span className={controls.label}>{label}</span><input className={`${controls.input} ${controls.inputMono}`} value={profile[k] ?? ''} onChange={(e) => onChange({ [k]: e.target.value.toUpperCase() || undefined })} data-profile-bank={k} /></label>
  );
  return (
    <div className={controls.row3} title={psT('bankHint')}>
      {f('swift', psT('swift'))}{f('iban', psT('iban'))}{f('intermediary_bank', psT('interBank'))}
    </div>
  );
}
