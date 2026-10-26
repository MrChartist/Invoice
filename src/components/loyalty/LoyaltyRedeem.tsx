import { useMemo, useState } from 'react';
import { Gift } from 'lucide-react';
import { NumberInput } from '../ui/NumberInput';
import { loyaltyInfo } from '../../lib/loyalty';
import { cn, formatCurrency, formatDate } from '../../lib/utils';
import { defineArea } from '../../i18n/area';

// R4-B2: tier, next tier and points expiry under the balance.
const tierT = defineArea(
  { tier: '{tier} tier', next: '{amount} more for {tier}', expire: '{n} points expire on {date}' } as const,
  { tier: '{tier} टियर', next: '{tier} के लिए {amount} और', expire: '{n} पॉइंट {date} को समाप्त होंगे' },
);
import { useT } from '../../i18n';
import { loyaltyT } from '../../i18n/areas/extras';
import controls from '../../styles/controls.module.css';
import own from '../dashboard/tiles.module.css';

/**
 * Redeem loyalty points on a bill (POS; the editor can mount it the same way). `points` is what is
 * applied now; `errors` come from `applyRedemption` and are shown under the box.
 */
export function LoyaltyRedeem({ customer, points, errors, onApply }: { customer: string; points: number; errors: string[]; onApply: (points: number) => void }) {
  useT();
  const info = useMemo(() => loyaltyInfo(customer), [customer]);
  const [typed, setTyped] = useState(points);
  if (!info.enabled) return null;
  return (
    <div className={own.form} data-loyalty>
      <span className={controls.label}><Gift size={14} aria-hidden="true" /> {loyaltyT('balance', { n: String(info.balance), value: formatCurrency(info.balance * info.pointValue) })}</span>
      <div className={controls.row}>
        <NumberInput className={cn(controls.input, controls.inputNumeric)} value={typed} onChange={setTyped} aria-label={loyaltyT('redeemLabel')} placeholder={loyaltyT('redeemLabel')} />
        <button type="button" className={cn(controls.btnOutline, controls.btnSm)} onClick={() => onApply(Math.trunc(typed))} disabled={info.balance <= 0}>
          {points ? loyaltyT('update') : loyaltyT('redeem')}
        </button>
        {points > 0 && <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={() => { setTyped(0); onApply(0); }}>{loyaltyT('clear')}</button>}
      </div>
      {(info.tier || info.next || info.expiring) && (
        <span className={controls.hint} data-loyalty-tier>
          {[
            info.tier && tierT('tier', { tier: info.tier }),
            info.next && tierT('next', { amount: formatCurrency(info.next.need), tier: info.next.name }),
            info.expiring && tierT('expire', { n: String(info.expiring.points), date: formatDate(info.expiring.date) }),
          ].filter(Boolean).join(' · ')}
        </span>
      )}
      {errors.length > 0 && <p className={controls.error} role="alert">{errors[0]}</p>}
    </div>
  );
}
