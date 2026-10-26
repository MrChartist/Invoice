/** R5-C1 fee plan editor: heads, instalments (shares sum to 100), fine, preset. */
import { useState } from 'react';
import type { FeeHead, FeePlan, FeePreset } from '../../types/institutions-r5';
import { FEE_PRESETS, equalShares, presetHead, savePlan } from '../../lib/institutions/fee-plans';
import { iT } from '../../i18n/areas/packs-institutions-r5';
import styles from './institutions.module.css';
import { B, S, T } from './Views';
import { attempt, num, opts, type Notify } from './ui';

type Draft = Omit<FeePlan, 'id'> & { id?: string };
const PRESETS = Object.keys(FEE_PRESETS) as FeePreset[];

export function FeePlanForm({ plan, notify, onSaved }: { plan?: FeePlan; notify: Notify; onSaved: () => void }) {
  const [p, setP] = useState<Draft>(() => plan ?? { name: '', year_label: '', heads: [presetHead('education', '', 0)], instalments: [{ label: 'I', due_date: '', share: 100 }], preset: 'education' });
  const set = (x: Partial<Draft>) => setP({ ...p, ...x });
  const head = (i: number, x: Partial<FeeHead>) => set({ heads: p.heads.map((h, k) => (k === i ? { ...h, ...x } : h)) });
  const inst = (i: number, x: Partial<FeePlan['instalments'][number]>) => set({ instalments: p.instalments.map((h, k) => (k === i ? { ...h, ...x } : h)) });
  const fine = p.fine;
  return (
    <div className={styles.stack} data-fee-plan-form>
      <div className={styles.toolbar}>
        <T l={iT('planName')} v={p.name} on={(name) => set({ name })} d="fee-plan-name" />
        <T l={iT('yearLabel')} v={p.year_label} on={(year_label) => set({ year_label })} ph="2026-27" />
        <S l={iT('preset')} v={p.preset} o={opts(PRESETS, 'preset.')} on={(v) => {
          const f = FEE_PRESETS[v as FeePreset];
          set({ preset: v as FeePreset, heads: p.heads.map((h) => ({ ...h, tax: f.tax, sac: f.sac, gst_rate: f.gst_rate })) });
        }} />
      </div>
      <p className={styles.note}>{iT('presetNote')}</p>
      {p.heads.map((h, i) => (
        <div key={i} className={styles.toolbar}>
          <T l={iT('head')} v={h.name} on={(name) => head(i, { name })} d="fee-head-name" />
          <T l={iT('amount')} v={h.amount || ''} on={(v) => head(i, { amount: num(v) })} d="fee-head-amount" />
          <T l="SAC" v={h.sac} on={(sac) => head(i, { sac })} />
          <S l={iT('tax')} v={h.tax} o={opts(['exempt', 'nil', 'taxable'] as const, 'tax.')} on={(v) => head(i, { tax: v as FeeHead['tax'] })} />
          {h.tax === 'taxable' && <T l="GST %" v={h.gst_rate} on={(v) => head(i, { gst_rate: num(v) })} />}
          <S l={iT('frequency')} v={h.frequency} o={opts(['per_instalment', 'once'] as const, 'freq.')} on={(v) => head(i, { frequency: v as FeeHead['frequency'] })} />
          <T l={iT('sessions')} v={h.sessions} on={(v) => head(i, { sessions: num(v) || undefined })} />
          <B g sm l="×" on={() => set({ heads: p.heads.filter((_x, k) => k !== i) })} />
        </div>
      ))}
      <div><B sm l={iT('addHead')} on={() => set({ heads: [...p.heads, presetHead(p.preset, '', 0)] })} /></div>
      {p.instalments.map((x, i) => (
        <div key={i} className={styles.toolbar}>
          <T l={iT('instalment')} v={x.label} on={(label) => inst(i, { label })} />
          <T l={iT('dueDate')} t="date" v={x.due_date} on={(due_date) => inst(i, { due_date })} d="fee-due" />
          <T l={iT('share')} v={x.share} on={(v) => inst(i, { share: num(v) })} />
        </div>
      ))}
      <div className={styles.line}>{[1, 2, 3, 4, 12].map((n) => <B key={n} sm l={iT('nEqual', { n })} on={() => set({ instalments: equalShares(n).map((share, i) => ({ label: p.instalments[i]?.label || `${i + 1}`, due_date: p.instalments[i]?.due_date ?? '', share })) })} />)}</div>
      <div className={styles.toolbar}>
        <S l={iT('fine')} v={fine?.kind ?? ''} o={[['', '—'], ...opts(['flat', 'per_day'] as const, 'fine.')]} on={(v) => set({ fine: v ? { amount: 0, grace_days: 0, ...fine, kind: v as 'flat' } : undefined })} />
        {fine && (<>
          <T l={iT('amount')} v={fine.amount || ''} on={(v) => set({ fine: { ...fine, amount: num(v) } })} />
          <T l={iT('graceDays')} v={fine.grace_days || ''} on={(v) => set({ fine: { ...fine, grace_days: num(v) } })} />
          <T l={iT('cap')} v={fine.cap} on={(v) => set({ fine: { ...fine, cap: num(v) || undefined } })} />
        </>)}
      </div>
      <div><B p l={iT('save')} d="fee-plan-save" on={() => attempt(notify, () => { savePlan(p); onSaved(); }, iT('saved'))} /></div>
    </div>
  );
}
