import { useState } from 'react';
import { Gift, X } from 'lucide-react';
import { NumberInput } from '../ui/NumberInput';
import { codeShapeIssue, lookupVoucher, promoVoucherIssue, readGvSettings, redeemIssue } from '../../lib/retail/gift-voucher-core';
import { num, round2 } from '../../lib/invoice-calc';
import { cn, formatCurrency } from '../../lib/utils';
import { useT } from '../../i18n';
import { sT } from '../../i18n/areas/stores-r4';
import controls from '../../styles/controls.module.css';
import css from './retail-r4.module.css';

export interface AppliedVoucher {
  id: string;
  number: string;
  amount: number;
  /** Promotional: an amount discount on the bill, not a tender. */
  promo?: boolean;
}

/**
 * POS "Gift voucher" tender (R4-B1): scan or type the code; the balance, expiry and status are checked at once (and
 * again on save). A sold voucher pays part of the bill; a promotional one becomes an amount discount. Loaded lazily,
 * only when the company has vouchers.
 */
export default function GiftVoucherTender({ day, due, applied, onChange }: { day: string; due: number; applied: AppliedVoucher[]; onChange: (next: AppliedVoucher[]) => void }) {
  useT();
  const [code, setCode] = useState('');
  const [amount, setAmount] = useState(0);
  const [error, setError] = useState('');
  const found = code.trim() && !codeShapeIssue(code) ? lookupVoucher(code, day) : {};

  const apply = () => {
    const shape = codeShapeIssue(code);
    if (shape) return setError(shape);
    const { voucher, state } = lookupVoucher(code, day);
    if (voucher && applied.some((a) => a.id === voucher.id)) return setError(sT('gvTwice'));
    const second = promoVoucherIssue(applied, voucher); // QA6 F12: a second promo would be listed but never applied
    if (second) return setError(second);
    const take = round2(num(amount) > 0 ? num(amount) : Math.min(state?.balance ?? 0, Math.max(due, 0)));
    const issue = redeemIssue(voucher, take, day, state, voucher?.promo ? { ...readGvSettings(), allow_partial: true } : readGvSettings());
    if (issue) return setError(issue);
    onChange([...applied, { id: voucher!.id, number: voucher!.number, amount: take, ...(voucher!.promo ? { promo: true } : {}) }]);
    setCode('');
    setAmount(0);
    setError('');
  };

  return (
    <div className={css.box} data-gv-tender>
      <span className={controls.label}><Gift size={14} aria-hidden="true" /> {sT('gvTender')}</span>
      <div className={controls.row}>
        <input
          className={cn(controls.input, css.mono)} value={code} onChange={(e) => { setCode(e.target.value); setError(''); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); apply(); } }}
          placeholder={sT('gvCodePh')} aria-label={sT('gvCode')} data-gv-code autoComplete="off"
        />
        <NumberInput className={cn(controls.input, controls.inputNumeric)} value={amount} onChange={setAmount} placeholder={sT('gvAmountPh')} aria-label={sT('gvAmount')} />
        <button type="button" className={cn(controls.btnOutline, controls.btnSm)} onClick={apply} data-gv-apply>{sT('gvApply')}</button>
      </div>
      {found.voucher && found.state && (
        <span className={css.note}>{sT('gvBalance', { number: found.voucher.number, balance: formatCurrency(found.state.balance), date: found.voucher.expires_on })}{found.voucher.promo ? ` · ${sT('gvPromoNote')}` : ''}</span>
      )}
      {applied.map((a) => (
        <div key={a.id} className={css.applied}>
          <span>{a.number}{a.promo ? ` (${sT('gvPromo')})` : ''}</span>
          <span>
            <strong>{formatCurrency(a.amount)}</strong>{' '}
            <button type="button" className={controls.btnIcon} aria-label={sT('gvRemove', { number: a.number })} onClick={() => onChange(applied.filter((x) => x.id !== a.id))}><X size={14} /></button>
          </span>
        </div>
      ))}
      {error && <p className={controls.error} role="alert">{error}</p>}
    </div>
  );
}
