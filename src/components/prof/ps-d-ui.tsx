/** PS-D desks (Firm, CA desk) and the TDS chase panel: view switch, labelled field, plain table (≤ 1 kB gz). */
import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';

export function Views({ tab, views, view, label }: { tab: string; views: readonly string[]; view: string; label: (v: string) => string }) {
  const [, set] = useSearchParams();
  return (
    <div role="tablist" className={controls.segment} style={{ marginBottom: '0.75rem' }}>
      {views.map((k) => <button key={k} type="button" role="tab" aria-selected={k === view} className={k === view ? controls.segmentBtnActive : controls.segmentBtn} onClick={() => set({ tab, view: k }, { replace: true })} data-ps-view={k}>{label(k)}</button>)}
    </div>
  );
}

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
