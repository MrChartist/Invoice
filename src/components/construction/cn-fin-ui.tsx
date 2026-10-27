/** CN-B: small form helpers shared by the contractor-finance Works views (one lazy chunk with them). */
import type { WorksContract } from '../../types/construction-r11';
import { cbT, type CbKey } from '../../i18n/areas/construction-r11b';
import { F } from '../transport/Field';
import controls from '../../styles/controls.module.css';
import styles from '../transport/transport.module.css';

/** [field, label key, input type] — 'check' renders a checkbox. */
export type Spec = readonly [string, CbKey, ('number' | 'date' | 'text' | 'check')?];
export type Vals = Record<string, string | boolean | undefined>;

export function Fields({ spec, v, on }: { spec: readonly Spec[]; v: Vals; on: (k: string, val: string | boolean) => void }) {
  return (
    <div className={styles.grid}>
      {spec.map(([k, l, t]) => (t === 'check'
        ? <label key={k} className={controls.check}><input type="checkbox" checked={!!v[k]} onChange={(e) => on(k, e.target.checked)} /> {cbT(l)}</label>
        : <F key={k} l={cbT(l)}><input className={controls.input} type={t || 'text'} value={String(v[k] ?? '')} onChange={(e) => on(k, e.target.value)} data-cn-f={k} /></F>))}
    </div>
  );
}

export function ContractPick({ contracts, value, onChange }: { contracts: readonly WorksContract[]; value: string; onChange: (id: string) => void }) {
  return (
    <F l={cbT('contract')}>
      <select className={controls.select} value={value} onChange={(e) => onChange(e.target.value)} data-cn-contract>
        {!contracts.length && <option value="">{cbT('noContract')}</option>}
        {contracts.map((c) => <option key={c.id} value={c.id}>{c.agreement_no ? `${c.agreement_no} · ` : ''}{c.name_of_work}</option>)}
      </select>
    </F>
  );
}
