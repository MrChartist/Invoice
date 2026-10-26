import { codeShapeIssue, lookupVoucher } from '../../lib/retail/gift-voucher-core';
import { cn, formatCurrency } from '../../lib/utils';
import { useT } from '../../i18n';
import { sT } from '../../i18n/areas/stores-r4';
import controls from '../../styles/controls.module.css';
import css from './retail-r4.module.css';

/** Payment dialog (R4-B1): the gift voucher code, with its balance and expiry as soon as the code is complete. Lazy. */
export default function GiftVoucherCodeField({ code, onChange, day }: { code: string; onChange: (code: string) => void; day: string }) {
  useT();
  const shape = code.trim() ? codeShapeIssue(code) : '';
  const { voucher, state } = code.trim() && !shape ? lookupVoucher(code, day) : {};
  return (
    <label className={controls.field}>
      <span className={controls.label}>{sT('gvCode')}</span>
      <input className={cn(controls.input, css.mono)} value={code} onChange={(e) => onChange(e.target.value)} placeholder={sT('gvCodePh')} autoComplete="off" data-gv-pay-code />
      <span className={controls.hint}>
        {shape || (voucher && state
          ? sT('gvBalance', { number: voucher.number, balance: formatCurrency(state.balance), date: voucher.expires_on })
          : code.trim() ? sT('gvNotFound') : sT('gvPayHint'))}
      </span>
    </label>
  );
}
