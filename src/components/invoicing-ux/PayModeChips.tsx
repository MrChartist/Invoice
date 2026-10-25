import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useInvoiceStore } from '../../store/useInvoiceStore';
import { pick } from '../../store/pick';
import { PAY_MODES, fullyPaidAmount, type PayMode } from '../../lib/counter-receipt';
import { cn } from '../../lib/utils';
import { useT } from '../../i18n';
import { uxT } from '../../i18n/areas/invoicing-ux';
import controls from '../../styles/controls.module.css';
import ux from './ux.module.css';

const COLLECTIBLE = new Set(['INVOICE', 'TAX_INVOICE', 'BILL_OF_SUPPLY', 'DEBIT_NOTE']);
const LABEL: Record<PayMode, 'pmCash' | 'pmUpi' | 'pmBank'> = { Cash: 'pmCash', UPI: 'pmUpi', 'Bank Transfer': 'pmBank' };

/**
 * A3: how "Amount received" came in (Cash / UPI / Bank, + UTR) and a "Fully paid" toggle (total − TDS).
 * On save the store turns the not-yet-recorded part into a receipt with this mode (`counter-receipt.ts`).
 */
export function PayModeChips() {
  useT();
  const s = useInvoiceStore(useShallow((st) => pick(st, ['doc_type', 'pay_mode', 'pay_ref', 'fully_paid', 'amount_paid', 'totals', 'total', 'tds_amount', 'setAmountPaid'])));
  const full = fullyPaidAmount({ total: s.totals?.total ?? s.total, tds_amount: s.totals?.tds_amount ?? s.tds_amount });
  // "Fully paid" follows the total while lines change.
  useEffect(() => {
    if (s.fully_paid && Math.abs((s.amount_paid || 0) - full) >= 0.005) s.setAmountPaid(full);
  }, [s, full]);
  if (!COLLECTIBLE.has(s.doc_type)) return null;
  const isFull = !!s.fully_paid || (full > 0 && Math.abs((s.amount_paid || 0) - full) < 0.005);
  const setMode = (m: PayMode) => useInvoiceStore.setState({ pay_mode: s.pay_mode === m ? null : m });
  return (
    <div className={cn(ux.row, ux.noPrint)} data-pay-mode>
      <label className={controls.check}>
        <input type="checkbox" checked={isFull} onChange={(e) => { useInvoiceStore.setState({ fully_paid: e.target.checked }); s.setAmountPaid(e.target.checked ? full : 0); }} data-fully-paid /> {uxT('pmFull')}
      </label>
      <div className={controls.segment} role="group" aria-label={uxT('pmMode')}>
        {PAY_MODES.map((m) => (
          <button key={m} type="button" className={s.pay_mode === m ? controls.segmentBtnActive : controls.segmentBtn} aria-pressed={s.pay_mode === m} onClick={() => setMode(m)}>
            {uxT(LABEL[m])}
          </button>
        ))}
      </div>
      {(s.pay_mode === 'UPI' || s.pay_mode === 'Bank Transfer') && (
        <input className={cn(controls.input, ux.narrow)} value={s.pay_ref ?? ''} onChange={(e) => useInvoiceStore.setState({ pay_ref: e.target.value })} placeholder={uxT('pmUtr')} aria-label={uxT('pmUtr')} maxLength={40} />
      )}
    </div>
  );
}

export default PayModeChips;
