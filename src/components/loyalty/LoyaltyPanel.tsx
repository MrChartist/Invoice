import { lazy, Suspense, useMemo, useState } from 'react';
import { Gift } from 'lucide-react';
import { NumberInput } from '../ui/NumberInput';
import { useCan } from '../../hooks/useCan';
import { adjustmentsDb, readProgram, ruleOn, saveProgram, topBalances } from '../../lib/loyalty';
import { localDb } from '../../lib/localDb';
import { cn, todayInput } from '../../lib/utils';
import { useT } from '../../i18n';
import { loyaltyT } from '../../i18n/areas/extras';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import own from '../dashboard/tiles.module.css';

// R4-B2: tiers / expiry editor and the liability report (own chunks, loaded when shown).
const LoyaltyTiers = lazy(() => import('../retail/LoyaltyTiers'));
const LoyaltyLiability = lazy(() => import('../retail/LoyaltyLiability'));

/** Loyalty programme (WP-9): top balances, programme settings and manual adjustments (R4-B2: tiers, expiry, liability). */
export function LoyaltyPanel({ notify }: { notify: (m: string, tone?: 'success' | 'error' | 'info') => void }) {
  useT();
  const { can } = useCan();
  const today = todayInput();
  const [tick, setTick] = useState(0);
  const program = useMemo(() => readProgram(), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const rule = ruleOn(program, today);
  const top = useMemo(() => topBalances(localDb.invoices.getAll(), adjustmentsDb.all(), program), [program, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const [form, setForm] = useState({ enabled: program.enabled, points_per_100: rule.points_per_100, point_value: rule.point_value, min_redeem: program.min_redeem });
  const [adj, setAdj] = useState({ name: '', points: 0, note: '' });

  const run = (fn: () => void, ok: string) => {
    try {
      fn();
      notify(ok);
      setTick((t) => t + 1);
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };

  return (
    <section className={surface.card} aria-label={loyaltyT('title')}>
      <div className={surface.cardHead}><span className={surface.cardHeadIcon}><Gift size={16} /> {loyaltyT('title')}</span></div>
      <div className={cn(surface.cardBody, own.form)}>
        <p className={controls.hint}>
          {program.enabled ? loyaltyT('rule', { pts: String(rule.points_per_100), value: String(rule.point_value) }) : loyaltyT('off')}
        </p>
        {top.length > 0 && (
          <ol className={own.list}>
            {top.map((t) => <li key={t.name}><span>{t.name}</span><strong>{loyaltyT('points', { n: String(t.points) })}</strong></li>)}
          </ol>
        )}
        {can('settings.manage') && (
          <details>
            <summary>{loyaltyT('settings')}</summary>
            <div className={own.form}>
              <label className={controls.check}><input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /> {loyaltyT('enable')}</label>
              <div className={controls.row}>
                <label className={controls.field}><span className={controls.label}>{loyaltyT('per100')}</span><NumberInput className={cn(controls.input, controls.inputNumeric)} value={form.points_per_100} onChange={(v) => setForm({ ...form, points_per_100: v })} /></label>
                <label className={controls.field}><span className={controls.label}>{loyaltyT('pointValue')}</span><NumberInput className={cn(controls.input, controls.inputNumeric)} value={form.point_value} onChange={(v) => setForm({ ...form, point_value: v })} /></label>
                <label className={controls.field}><span className={controls.label}>{loyaltyT('minRedeem')}</span><NumberInput className={cn(controls.input, controls.inputNumeric)} value={form.min_redeem} onChange={(v) => setForm({ ...form, min_redeem: v })} /></label>
              </div>
              <p className={controls.hint}>{loyaltyT('hint')}</p>
              <button type="button" className={cn(controls.btnOutline, controls.btnSm)} onClick={() => run(() => saveProgram(form, today), loyaltyT('saved'))}>{loyaltyT('save')}</button>
              <Suspense fallback={null}><LoyaltyTiers key={tick} notify={notify} onSaved={() => setTick((t) => t + 1)} /></Suspense>
            </div>
          </details>
        )}
        {program.enabled && <Suspense fallback={null}><LoyaltyLiability key={tick} /></Suspense>}
        {can('master.edit') && program.enabled && (
          <details>
            <summary>{loyaltyT('adjust')}</summary>
            <div className={own.form}>
              <input className={controls.input} value={adj.name} onChange={(e) => setAdj({ ...adj, name: e.target.value })} placeholder={loyaltyT('customer')} aria-label={loyaltyT('customer')} />
              <NumberInput className={cn(controls.input, controls.inputNumeric)} value={adj.points} onChange={(v) => setAdj({ ...adj, points: v })} aria-label={loyaltyT('adjustPoints')} placeholder={loyaltyT('adjustPoints')} />
              <input className={controls.input} value={adj.note} onChange={(e) => setAdj({ ...adj, note: e.target.value })} placeholder={loyaltyT('note')} aria-label={loyaltyT('note')} />
              <button type="button" className={cn(controls.btnOutline, controls.btnSm)} onClick={() => run(() => { adjustmentsDb.add(adj.name, adj.points, today, adj.note); setAdj({ name: '', points: 0, note: '' }); }, loyaltyT('adjusted'))}>{loyaltyT('adjustSave')}</button>
            </div>
          </details>
        )}
      </div>
    </section>
  );
}
