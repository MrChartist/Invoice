/** MF-B desks (Shop, Moulding, Press): the tiny form / table helpers their views share (no strings; ≤ 1 kB gz). */
import { useState, type ReactNode } from 'react';
import { F } from '../transport/Field';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';

export type Done = (msg: string, error?: boolean) => void;
export const row = { display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end' } as const;
export const n = (s: string | undefined) => Number(s) || 0;
export const fmt = (x: number) => x.toLocaleString('en-IN', { maximumFractionDigits: 3 });

const w = (x?: number) => (x ? { maxWidth: x } : undefined);
export const Txt = ({ l, v, set, x, type = 'text', d }: { l: string; v: string; set: (s: string) => void; x?: number; type?: string; d?: string }) => (
  <span style={w(x)}><F l={l}><input type={type} className={controls.input} value={v} onChange={(e) => set(e.target.value)} data-mfb={d} /></F></span>
);
export const Num = (p: { l: string; v: string; set: (s: string) => void; x?: number; d?: string }) => <Txt {...p} x={p.x ?? 110} type="number" />;
export const Sel = ({ l, v, set, o, x, d }: { l: string; v: string; set: (k: string) => void; o: readonly (readonly [string, string])[]; x?: number; d?: string }) => (
  <span style={w(x)}><F l={l}><select className={controls.select} value={v} onChange={(e) => set(e.target.value)} data-mfb={d}>{o.map(([k, s]) => <option key={k} value={k}>{s}</option>)}</select></F></span>
);
export const Table = ({ head, rows, empty, d }: { head: string[]; rows: ReactNode[][]; empty: string; d?: string }) => rows.length ? (
  <div className={surface.tableWrap}><table className={surface.table} data-mfb-table={d}><thead><tr>{head.map((h, i) => <th key={i}>{h}</th>)}</tr></thead><tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody></table></div>
) : <p className={controls.hint}>{empty}</p>;

/** `[[id, name]]` with a leading blank option. */
export const opt = <X,>(xs: readonly X[], id: (x: X) => string, name: (x: X) => string) => [['', '—'] as const, ...xs.map((x) => [id(x), name(x)] as const)];

/** Run a writer: its message (or `ok`), a refresh tick, errors as an error notice. */
export function useRun(onDone: Done, ok: string) {
  const [tick, setTick] = useState(0);
  return [tick, (fn: () => string | void) => {
    try {
      onDone(fn() || ok);
      setTick((t) => t + 1);
    } catch (e) {
      onDone(e instanceof Error ? e.message : String(e), true);
    }
  }] as const;
}
