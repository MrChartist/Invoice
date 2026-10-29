/** R21: the small form bits the fuel views share (a labelled input / select over a draft object, a row layout). */
import type { CSSProperties } from 'react';
import controls from '../../styles/controls.module.css';

export const row: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end', marginBottom: '0.75rem' };
type Draft = Record<string, string>;

/** A labelled input bound to `d[k]` (`type` number / date / time / text). */
export const In = ({ d, set, k, label, type = 'text', w = '8rem' }: { d: Draft; set: (d: Draft) => void; k: string; label: string; type?: string; w?: string }) => (
  <label className={controls.field}><span className={controls.label}>{label}</span><input className={controls.input} style={{ width: w }} type={type} step="any" value={d[k] ?? ''} onChange={(e) => set({ ...d, [k]: e.target.value })} data-fu-field={k} /></label>
);

/** A labelled select bound to `d[k]` over [value, label] pairs (a blank first option). */
export const Sel = ({ d, set, k, label, opts }: { d: Draft; set: (d: Draft) => void; k: string; label: string; opts: readonly (readonly [string, string])[] }) => (
  <label className={controls.field}><span className={controls.label}>{label}</span><select className={controls.select} value={d[k] ?? ''} onChange={(e) => set({ ...d, [k]: e.target.value })} data-fu-field={k}><option value="" />{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
);
