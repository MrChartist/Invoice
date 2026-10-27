/**
 * RT-D2 POS tender row "Finance (EMI)": financier, loan, DO no., scheme. The loan part is left for the financier
 * (`recordFinance` after the bill is saved). Part of the devices desk chunk.
 */
import { HandCoins } from 'lucide-react';
import { rtdT } from '../../i18n/areas/retail-r9d';
import { NumberInput } from '../ui/NumberInput';
import controls from '../../styles/controls.module.css';

export interface FinTender {
  financier: string;
  loan: number;
  doNo: string;
  scheme: string;
}

export default function FinanceTender({ value, financiers, onChange }: { value: FinTender | null; financiers: readonly string[]; onChange: (v: FinTender | null) => void }) {
  const v = value ?? { financier: '', loan: 0, doNo: '', scheme: '' };
  const set = (p: Partial<FinTender>) => onChange({ ...v, ...p });
  return (
    <fieldset className={controls.row} style={{ flexWrap: 'wrap', gap: '0.4rem', border: 0, padding: 0, margin: 0 }} data-pos-finance>
      <label className={controls.check}><input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked ? v : null)} data-pos-finance-on /> <HandCoins size={14} aria-hidden="true" /> {rtdT('finTender')}</label>
      {value && (
        <>
          <input className={controls.input} list="dev-financiers" placeholder={rtdT('financier')} aria-label={rtdT('financier')} value={v.financier} onChange={(e) => set({ financier: e.target.value })} data-pos-financier />
          <datalist id="dev-financiers">{financiers.map((f) => <option key={f} value={f} />)}</datalist>
          <NumberInput className={controls.input} placeholder={rtdT('loan')} aria-label={rtdT('loan')} value={v.loan} onChange={(loan) => set({ loan })} data-pos-loan />
          <input className={controls.input} placeholder={rtdT('doNo')} aria-label={rtdT('doNo')} value={v.doNo} onChange={(e) => set({ doNo: e.target.value })} data-pos-do />
          <input className={controls.input} placeholder={rtdT('scheme')} aria-label={rtdT('scheme')} value={v.scheme} onChange={(e) => set({ scheme: e.target.value })} style={{ maxWidth: 90 }} />
        </>
      )}
    </fieldset>
  );
}
