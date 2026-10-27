/** AG-B Dairy desk form bits (fields, centre picker). Lazy: desk chunks only. */
import { useState, type ReactNode } from 'react';
import { NumberInput } from '../ui/NumberInput';
import { bT } from '../../i18n/areas/agri-r12b';
import { readAgriSettings, saveAgriSettings } from '../../lib/agri/ag-settings';
import controls from '../../styles/controls.module.css';
import { milkCentres, sm, type Done } from './dairy-kit';

export const F = ({ l, w, children }: { l: string; w?: number; children: ReactNode }) => (
  <label className={controls.field} style={w ? { maxWidth: w } : undefined}><span className={controls.label}>{l}</span>{children}</label>
);
export const N = ({ l, v, set, w = 100, d }: { l: string; v: number; set: (n: number) => void; w?: number; d?: string }) => (
  <F l={l} w={w}><NumberInput className={controls.input} value={v} onChange={set} data-dairy={d} /></F>
);
export const Sel = <T extends string>({ l, v, set, opts, w = 140, d }: { l: string; v: T; set: (v: T) => void; opts: readonly (readonly [T, string])[]; w?: number; d?: string }) => (
  <F l={l} w={w}><select className={controls.select} value={v} onChange={(e) => set(e.target.value as T)} data-dairy={d}>{opts.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></F>
);

/** The centre picker; with no milk centre yet, a one-line form adds the first (owner). */
export function CentrePick({ v, set, onDone }: { v: string; set: (id: string) => void; onDone: Done }) {
  const [name, setName] = useState('');
  const list = milkCentres();
  if (!list.length) {
    return (
      <F l={bT('newCentre')} w={260}>
        <span className={controls.row}>
          <input className={controls.input} value={name} onChange={(e) => setName(e.target.value)} data-dairy="centre-name" />
          <button type="button" className={sm} onClick={() => {
            try {
              const s = saveAgriSettings({ centres: [...(readAgriSettings().centres ?? []), { id: '', name, kind: 'milk' }] });
              set(s.centres?.find((c) => c.name === name.trim())?.id ?? '');
            } catch (e) {
              onDone((e as Error).message, true);
            }
          }}>{bT('add')}</button>
        </span>
      </F>
    );
  }
  return <Sel l={bT('centre')} v={v || list[0].id} set={set} opts={list.map((c) => [c.id, c.name] as const)} d="centre" />;
}

