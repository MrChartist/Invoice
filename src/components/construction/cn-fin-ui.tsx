/** CN-B: small form helpers shared by the contractor-finance Works views (one lazy chunk with them). */
import type { Dispatch, SetStateAction } from 'react';
import type { WorksContract } from '../../types/construction-r11';
import { cbT } from '../../i18n/areas/construction-r11b';
import { F } from '../transport/Field';
import controls from '../../styles/controls.module.css';
import styles from '../transport/transport.module.css';
import { SelectField } from '../ui/SelectField';
import { TypedInput } from '../ui/TypedInput';

export type Vals = Record<string, string | boolean | undefined>;
/** [field, label, input type | select options] — 'check' renders a checkbox. */
export type Spec = readonly [string, string, ('number' | 'date' | 'check' | readonly (readonly [string, string])[])?];

export function Fields({ spec, v, set }: { spec: readonly Spec[]; v: Vals; set: Dispatch<SetStateAction<Vals>> }) {
  const on = (k: string, val: string | boolean) => set((o) => ({ ...o, [k]: val }));
  return (
    <div className={styles.grid}>
      {spec.map(([k, l, t]) => (t === 'check'
        ? <label key={k} className={controls.check}><input type="checkbox" checked={!!v[k]} onChange={(e) => on(k, e.target.checked)} /> {l}</label>
        : <F key={k} l={l}>{Array.isArray(t)
          ? <SelectField className={controls.select} value={String(v[k] ?? '')} onChange={(e) => on(k, e.target.value)} data-cn-f={k}>{t.map(([x, y]) => <option key={x} value={x}>{y}</option>)}</SelectField>
          : <TypedInput className={controls.input} type={(t as string) || 'text'} value={String(v[k] ?? '')} onChange={(e) => on(k, e.target.value)} data-cn-f={k} />}</F>))}
    </div>
  );
}

export function ContractPick({ contracts, value, onChange }: { contracts: readonly WorksContract[]; value: string; onChange: (id: string) => void }) {
  return (
    <F l={cbT('contract')}>
      <SelectField className={controls.select} value={value} onChange={(e) => onChange(e.target.value)} data-cn-contract>
        {!contracts.length && <option value="">{cbT('noContract')}</option>}
        {contracts.map((c) => <option key={c.id} value={c.id}>{c.agreement_no ? `${c.agreement_no} · ` : ''}{c.name_of_work}</option>)}
      </SelectField>
    </F>
  );
}
