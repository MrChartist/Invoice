/** Round 12 desk components shared by the AG-A views: a plain table, a labelled field, a bound input. */
import type { ReactNode } from 'react';
import { agT } from '../../i18n/areas/agri-r12a';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';

export function Grid({ head, rows, attr }: { head: readonly ReactNode[]; rows: readonly ReactNode[][]; attr?: string }) {
  if (!rows.length) return <p className={controls.hint}>{agT('none')}</p>;
  return (
    <div className={surface.tableWrap}>
      <table className={surface.table} data-ag-grid={attr}>
        <thead><tr>{head.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

export function F({ label, children }: { label: string; children: ReactNode }) {
  return <label className={controls.field}><span className={controls.label}>{label}</span>{children}</label>;
}

/** A text / number input bound to a string state. */
export function In({ v, set, type = 'text', w, ...rest }: { v: string; set: (s: string) => void; type?: string; w?: number } & Record<string, unknown>) {
  return <input className={controls.input} type={type} value={v} onChange={(e) => set(e.target.value)} style={w ? { width: w } : undefined} {...rest} />;
}
