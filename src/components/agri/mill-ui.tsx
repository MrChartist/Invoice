/** AG-C mill desk: the small form / table helpers its views share (one lazy chunk with them). */
import type { ReactNode } from 'react';
import { T } from './mill-kit';
import { F } from '../transport/Field';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';

const w = (x?: number) => (x ? { maxWidth: x } : undefined);
export const Txt = ({ l, v, set, x, type = 'text', d }: { l: string; v: string; set: (s: string) => void; x?: number; type?: string; d?: string }) => (
  <span style={w(x)}><F l={l}><input type={type} className={controls.input} value={v} onChange={(e) => set(e.target.value)} data-ml={d} /></F></span>
);
export const Num = ({ l, v, set, x = 130, d }: { l: string; v: string; set: (s: string) => void; x?: number; d?: string }) => <Txt l={l} v={v} set={set} x={x} type="number" d={d} />;
export function Sel({ l, v, set, o, x, d }: { l: string; v: string; set: (k: string) => void; o: readonly (readonly [string, string])[]; x?: number; d?: string }) {
  return <span style={w(x)}><F l={l}><select className={controls.select} value={v} onChange={(e) => set(e.target.value)} data-ml={d}>{o.map(([k, s]) => <option key={k} value={k}>{s}</option>)}</select></F></span>;
}
export const Table = ({ head, rows, d }: { head: string[]; rows: ReactNode[][]; d?: string }) => rows.length ? (
  <div className={surface.tableWrap}><table className={surface.table} data-ml-table={d}><thead><tr>{head.map((h, i) => <th key={i}>{h}</th>)}</tr></thead><tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody></table></div>
) : <p className={controls.hint}>{T('none')}</p>;
