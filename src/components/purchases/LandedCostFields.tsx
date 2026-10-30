import { useId, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { landedTotal } from '../../lib/landed-cost';
import { formatCurrency } from '../../lib/utils';
import { unitT } from '../../i18n/areas/units';
import controls from '../../styles/controls.module.css';
import styles from './purchases.module.css';
import { SelectField } from '../ui/SelectField';

export interface LandedValue {
  costs: { label: string; amount: string }[];
  basis: 'value' | 'qty';
}

/**
 * Landed cost on a bill (WP-8): freight, loading … spread over the goods lines' stock cost. Memo only —
 * the bill total, GST and books are unchanged (book the freight as its own expense). Collapsed until used.
 */
export function LandedCostFields({ value, onChange }: { value: LandedValue; onChange: (v: LandedValue) => void }) {
  const uid = useId();
  const [open, setOpen] = useState(value.costs.length > 0);
  if (!open) {
    return (
      <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} style={{ alignSelf: 'flex-start' }} onClick={() => { setOpen(true); if (!value.costs.length) onChange({ ...value, costs: [{ label: '', amount: '' }] }); }}>
        <Plus size={14} aria-hidden="true" /> {unitT('landedAdd')}
      </button>
    );
  }
  const set = (i: number, k: 'label' | 'amount', v: string) => onChange({ ...value, costs: value.costs.map((c, j) => (j === i ? { ...c, [k]: v } : c)) });
  return (
    <fieldset className={styles.landed}>
      <legend className={controls.label}>{unitT('landedTitle')}</legend>
      <p className={styles.note}>{unitT('landedHint')}</p>
      {value.costs.map((c, i) => (
        <div key={i} className={styles.landedRow}>
          <input className={controls.input} value={c.label} placeholder={unitT('landedLabelPh')} aria-label={unitT('landedLabel', { n: i + 1 })} onChange={(e) => set(i, 'label', e.target.value)} />
          <input className={`${controls.input} ${controls.inputNumeric}`} inputMode="decimal" value={c.amount} placeholder="0.00" aria-label={unitT('landedAmount', { n: i + 1 })} onChange={(e) => set(i, 'amount', e.target.value)} />
          <button type="button" className={controls.btnIcon} aria-label={unitT('landedRemove', { n: i + 1 })} onClick={() => onChange({ ...value, costs: value.costs.filter((_, j) => j !== i) })}><X size={14} /></button>
        </div>
      ))}
      <div className={styles.landedRow}>
        <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => onChange({ ...value, costs: [...value.costs, { label: '', amount: '' }] })}>
          <Plus size={14} aria-hidden="true" /> {unitT('landedMore')}
        </button>
        <label className={controls.label} htmlFor={`${uid}-basis`}>{unitT('landedBasis')}</label>
        <SelectField id={`${uid}-basis`} className={controls.select} value={value.basis} onChange={(e) => onChange({ ...value, basis: e.target.value === 'qty' ? 'qty' : 'value' })}>
          <option value="value">{unitT('landedByValue')}</option>
          <option value="qty">{unitT('landedByQty')}</option>
        </SelectField>
        <strong>{formatCurrency(landedTotal(value.costs.map((c) => ({ label: c.label, amount: Number(c.amount) }))))}</strong>
      </div>
    </fieldset>
  );
}
