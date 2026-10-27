/** MF-C garments desk components (this desk only; no shared desk kit): a table, a labelled field, bound inputs, a button. */
import type { ReactNode } from 'react';
import { gT } from '../../i18n/areas/mfg-r13c';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';


export function Grid({ head, rows, attr }: { head: readonly ReactNode[]; rows: readonly ReactNode[][]; attr?: string }) {
  if (!rows.length) return <p className={controls.hint}>{gT('none')}</p>;
  return (
    <div className={surface.tableWrap}>
      <table className={surface.table} data-mfc-grid={attr}>
        <thead><tr>{head.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

export function F({ label, children, w }: { label: string; children: ReactNode; w?: number }) {
  return <label className={controls.field} style={w ? { maxWidth: w } : undefined}><span className={controls.label}>{label}</span>{children}</label>;
}

export function In({ v, set, type = 'text', ...rest }: { v: string; set: (s: string) => void; type?: string } & Record<string, unknown>) {
  return <input className={controls.input} type={type} value={v} onChange={(e) => set(e.target.value)} {...rest} />;
}

export function Sel({ v, set, o, ...rest }: { v: string; set: (s: string) => void; o: readonly (readonly [string, string])[] } & Record<string, unknown>) {
  return <select className={controls.select} value={v} onChange={(e) => set(e.target.value)} {...rest}>{o.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>;
}

export const Btn = ({ on, children, kind = 'btnOutline', ...rest }: { on: () => void; children: ReactNode; kind?: 'btnPrimary' | 'btnOutline' | 'btnDanger' | 'btnGhost' } & Record<string, unknown>) => (
  <button type="button" className={controls[kind]} onClick={on} {...rest}>{children}</button>
);
