import { Plus, Trash2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { generateId } from '../../lib/storage';
import type { AdditionalCost } from '../../types/manufacturing';
import { mfgT } from '../../i18n/areas/manufacturing';
import controls from '../../styles/controls.module.css';
import styles from './manufacturing.module.css';
import { SelectField } from '../ui/SelectField';

/** Labour / power / overhead lines: a ₹ amount or a % of component cost. */
export function CostsGrid({ costs, onChange }: { costs: AdditionalCost[]; onChange: (c: AdditionalCost[]) => void }) {
  const patch = (id: string, change: Partial<AdditionalCost>) => onChange(costs.map((c) => (c.id === id ? { ...c, ...change } : c)));
  return (
    <div className={styles.wrap}>
      {costs.length > 0 && (
        <table className={styles.grid}>
          <thead><tr><th>{mfgT('costLabel')}</th><th>{mfgT('mode')}</th><th className={styles.num}>{mfgT('value')}</th><th /></tr></thead>
          <tbody>
            {costs.map((c, i) => (
              <tr key={c.id}>
                <td><input className={controls.input} aria-label={`${mfgT('costLabel')} ${i + 1}`} value={c.label} onChange={(e) => patch(c.id, { label: e.target.value })} /></td>
                <td>
                  <SelectField className={controls.select} aria-label={`${mfgT('mode')} ${i + 1}`} value={c.mode} onChange={(e) => patch(c.id, { mode: e.target.value as AdditionalCost['mode'] })}>
                    <option value="amount">{mfgT('amountMode')}</option>
                    <option value="pct">{mfgT('pctMode')}</option>
                  </SelectField>
                </td>
                <td><input className={cn(controls.input, controls.inputNumeric)} inputMode="decimal" aria-label={`${mfgT('value')} ${i + 1}`} value={c.value ? String(c.value) : ''} onChange={(e) => patch(c.id, { value: Number(e.target.value) || 0 })} /></td>
                <td><button type="button" className={controls.btnIcon} aria-label={mfgT('removeLine', { n: i + 1 })} onClick={() => onChange(costs.filter((x) => x.id !== c.id))}><Trash2 size={15} aria-hidden="true" /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={() => onChange([...costs, { id: generateId(), label: costs.length ? '' : 'Labour', mode: 'amount', value: 0 }])}>
        <Plus size={14} aria-hidden="true" /> {mfgT('addLine')} · {mfgT('costLabel')}
      </button>
    </div>
  );
}
