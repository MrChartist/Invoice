/** MF-B desks (Shop, Moulding, Press): the tiny form / table components their views share (no strings; ≤ 1 kB gz). */
import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { F } from '../transport/Field';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';

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

/** A desk's view tabs (`?tab=<desk>&view=<id>`), the active view and the working-paper hint. */
export function Desk({ desk, views, v, label, hint, children }: { desk: string; views: readonly string[]; v: string; label: (k: string) => string; hint: string; children: ReactNode }) {
  const [, setParams] = useSearchParams();
  return (
    <section {...{ [`data-${desk}-desk`]: v }}>
      <div role="tablist" className={controls.segment} style={{ marginBottom: '0.75rem' }}>
        {views.map((k) => <button key={k} type="button" role="tab" aria-selected={k === v} className={k === v ? controls.segmentBtnActive : controls.segmentBtn} onClick={() => setParams({ tab: desk, view: k })} {...{ [`data-${desk}-view`]: k }}>{label(k)}</button>)}
      </div>
      {children}
      <p className={controls.hint}>{hint}</p>
    </section>
  );
}

