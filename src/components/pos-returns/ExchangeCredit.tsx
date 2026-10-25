import { X } from 'lucide-react';
import { formatCurrency } from '../../lib/utils';
import { useT } from '../../i18n';
import { returnsT } from '../../i18n/areas/extras';
import controls from '../../styles/controls.module.css';
import own from './returns.module.css';

/** The exchange credit waiting to pay the bill on the POS counter (WP-9). */
export function ExchangeCredit({ number, amount, used, onDrop }: { number: string; amount: number; used: number; onDrop: () => void }) {
  useT();
  return (
    <div className={own.credit} data-pos-exchange>
      <span>
        {returnsT('exchangeCredit', { number })}
        {amount > used + 0.004 ? ` · ${returnsT('exchangeRest', { amount: formatCurrency(amount - used) })}` : ''}
      </span>
      <strong>−{formatCurrency(used)}</strong>
      <button type="button" className={controls.btnIcon} onClick={onDrop} aria-label={returnsT('exchangeDrop')} title={returnsT('exchangeDrop')}>
        <X size={14} />
      </button>
    </div>
  );
}
