import { useId } from 'react';
import type { ManualVoucher, ManualVoucherType } from '../../../lib/ledger/vouchers';
import { useT } from '../../../i18n';
import { tallyT } from '../../../i18n/areas/tally';
import controls from '../../../styles/controls.module.css';
import styles from './tally.module.css';

export type VariantValue = Pick<ManualVoucher, 'variant' | 'post_dated' | 'reverse_on' | 'voucher_class'>;

/** Voucher variants (Tally parity) in the voucher editor: optional / memorandum, post-dated, reversing, class. */
export function VoucherVariantFields({ type, value, onChange }: { type: ManualVoucherType; value: VariantValue; onChange: (v: VariantValue) => void }) {
  useT();
  const uid = useId();
  const set = (p: Partial<VariantValue>) => onChange({ ...value, ...p });
  return (
    <div>
      <div className={styles.grid}>
        <div className={controls.field}>
          <label className={controls.label} htmlFor={`${uid}-var`}>{tallyT('variantLabel')}</label>
          <select id={`${uid}-var`} className={controls.select} value={value.variant ?? ''} onChange={(e) => set({ variant: (e.target.value || undefined) as VariantValue['variant'] })}>
            <option value="">{tallyT('vRegular')}</option>
            <option value="OPTIONAL">{tallyT('vOptional')}</option>
            <option value="MEMO">{tallyT('vMemo')}</option>
          </select>
        </div>
        {type === 'JOURNAL' && (
          <div className={controls.field}>
            <label className={controls.label} htmlFor={`${uid}-rev`}>{tallyT('reverseOn')}</label>
            <input id={`${uid}-rev`} type="date" className={controls.input} value={value.reverse_on ?? ''} onChange={(e) => set({ reverse_on: e.target.value || undefined })} />
          </div>
        )}
        <div className={controls.field}>
          <label className={controls.label} htmlFor={`${uid}-cls`}>{tallyT('voucherClass')}</label>
          <input id={`${uid}-cls`} className={controls.input} value={value.voucher_class ?? ''} onChange={(e) => set({ voucher_class: e.target.value || undefined })} />
        </div>
      </div>
      <label className={controls.check}>
        <input type="checkbox" checked={!!value.post_dated} onChange={(e) => set({ post_dated: e.target.checked || undefined })} />
        {tallyT('postDated')}
      </label>
      {type === 'JOURNAL' && value.reverse_on && <p className={controls.hint}>{tallyT('reverseHint')}</p>}
    </div>
  );
}
