import { useState } from 'react';
import { Plus, Trash2, Trophy } from 'lucide-react';
import { NumberInput } from '../ui/NumberInput';
import { readProgram, ruleOn, saveProgram, type LoyaltyTier } from '../../lib/loyalty';
import { MAX_TIERS, tiersOn } from '../../lib/retail/loyalty-tiers';
import { generateId } from '../../lib/storage';
import { cn, todayInput } from '../../lib/utils';
import { useT } from '../../i18n';
import { sT } from '../../i18n/areas/stores-r4';
import controls from '../../styles/controls.module.css';
import css from './retail-r4.module.css';
import { DateField } from '../ui/DateField';

/**
 * Loyalty tiers and points expiry (R4-B2): up to five tiers on rolling 12-month spend (a changed list applies from the
 * chosen date; older bills keep their tiers) and the months after which points lapse (FIFO). Lazy, in the loyalty tile.
 */
export default function LoyaltyTiers({ onSaved, notify }: { onSaved: () => void; notify: (m: string, tone?: 'success' | 'error' | 'info') => void }) {
  useT();
  const program = readProgram();
  const [from, setFrom] = useState(todayInput());
  const [tiers, setTiers] = useState<LoyaltyTier[]>(() => tiersOn(program.tiers, todayInput()).map((t) => ({ ...t })));
  const [months, setMonths] = useState(program.expiry_months ?? 0);
  const patch = (id: string, change: Partial<LoyaltyTier>) => setTiers((ts) => ts.map((t) => (t.id === id ? { ...t, ...change } : t)));
  const save = () => {
    try {
      const cur = readProgram();
      const rule = ruleOn(cur, from);
      saveProgram({ enabled: cur.enabled, points_per_100: rule.points_per_100, point_value: rule.point_value, min_redeem: cur.min_redeem, tiers, expiry_months: months }, from);
      notify(sT('saved'), 'success');
      onSaved();
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };
  return (
    <div className={css.box} data-loyalty-tiers>
      <div className={css.boxHead}><span><Trophy size={14} aria-hidden="true" /> {sT('lyTiers')}</span></div>
      {tiers.map((t) => (
        <div key={t.id} className={controls.row}>
          <input className={controls.input} value={t.name} onChange={(e) => patch(t.id, { name: e.target.value })} placeholder={sT('lyTierName')} aria-label={sT('lyTierName')} />
          <NumberInput className={cn(controls.input, controls.inputNumeric)} value={t.min_spend_12m} onChange={(v) => patch(t.id, { min_spend_12m: v })} aria-label={sT('lyMinSpend')} placeholder={sT('lyMinSpend')} />
          <NumberInput className={cn(controls.input, controls.inputNumeric)} value={t.multiplier} onChange={(v) => patch(t.id, { multiplier: v })} aria-label={sT('lyMultiplier')} placeholder={sT('lyMultiplier')} />
          <button type="button" className={controls.btnDanger} aria-label={sT('remove')} onClick={() => setTiers((ts) => ts.filter((x) => x.id !== t.id))}><Trash2 size={14} /></button>
        </div>
      ))}
      {tiers.length < MAX_TIERS && (
        <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={() => setTiers((ts) => [...ts, { id: generateId(), name: '', min_spend_12m: 0, multiplier: 1 }])}>
          <Plus size={14} aria-hidden="true" /> {sT('lyAddTier')}
        </button>
      )}
      <div className={controls.row}>
        <label className={controls.field}><span className={controls.label}>{sT('lyFrom')}</span><DateField className={controls.input} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className={controls.field}><span className={controls.label}>{sT('lyExpiryMonths')}</span><NumberInput className={cn(controls.input, controls.inputNumeric)} value={months} onChange={setMonths} /></label>
      </div>
      <p className={css.note}>{sT('lyTiersHint')}</p>
      <button type="button" className={cn(controls.btnOutline, controls.btnSm)} onClick={save}>{sT('save')}</button>
    </div>
  );
}
