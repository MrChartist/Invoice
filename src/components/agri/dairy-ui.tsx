/** AG-B Dairy desk form bits (fields, centre picker). Lazy: desk chunks only. */
import type { ReactNode } from 'react';
import { NumberInput } from '../ui/NumberInput';
import { bT } from '../../i18n/areas/agri-r12b';
import controls from '../../styles/controls.module.css';
import { milkCentres, type Done } from './dairy-kit';

export const F = ({ l, w, children }: { l: string; w?: number; children: ReactNode }) => (
  <label className={controls.field} style={w ? { maxWidth: w } : undefined}><span className={controls.label}>{l}</span>{children}</label>
);
export const N = ({ l, v, set, w = 100, d }: { l: string; v: number; set: (n: number) => void; w?: number; d?: string }) => (
  <F l={l} w={w}><NumberInput className={controls.input} value={v} onChange={set} data-dairy={d} /></F>
);
export const Sel = <T extends string>({ l, v, set, opts, w = 140, d }: { l: string; v: T; set: (v: T) => void; opts: readonly (readonly [T, string])[]; w?: number; d?: string }) => (
  <F l={l} w={w}><select className={controls.select} value={v} onChange={(e) => set(e.target.value as T)} data-dairy={d}>{opts.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></F>
);

/** The centre picker (milk centres; "Main centre" until the Farm settings add one). */
export function CentrePick({ v, set }: { v: string; set: (id: string) => void; onDone?: Done }) {
  const list = milkCentres();
  return <Sel l={bT('centre')} v={v || list[0].id} set={set} opts={list.map((c) => [c.id, c.name] as const)} d="centre" />;
}
