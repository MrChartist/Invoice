/** PS-D desks (Firm, CA desk) and the TDS chase panel: labelled field and plain table (the view switch is PS-A's `ps-ui.tsx`) (≤ 1 kB gz). */
import type { ReactNode } from 'react';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';

export const Fld = ({ l, children }: { l: string; children: ReactNode }) => <label className={controls.field}><span className={controls.label}>{l}</span>{children}</label>;

export function Tbl({ head, rows, empty }: { head: readonly string[]; rows: readonly ReactNode[][]; empty: string }) {
  if (!rows.length) return empty ? <p className={controls.hint}>{empty}</p> : null;
  return (
    <div className={surface.tableWrap}>
      <table className={surface.table}>
        <thead><tr>{head.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} data-ps-row>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}
