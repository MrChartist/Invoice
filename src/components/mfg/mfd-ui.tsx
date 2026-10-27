/** MF-D desks (Food, Statutory, Floor → WIP): the few shared bits — view switch, table, field, run-and-report. ≤ 1 kB. */
import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import { row } from './mfd-util';


export function Views({ tab, views, view, label }: { tab: string; views: readonly string[]; view: string; label: (v: string) => string }) {
  const [, set] = useSearchParams();
  return (
    <div role="tablist" style={row}>
      {views.map((k) => <button key={k} type="button" role="tab" aria-selected={k === view} className={k === view ? controls.btnPrimary : controls.btnOutline} onClick={() => set({ tab, view: k })} data-mfd-view={k}>{label(k)}</button>)}
    </div>
  );
}

export const Fld = ({ l, children }: { l: string; children: ReactNode }) => <label className={controls.field}><span className={controls.label}>{l}</span>{children}</label>;

export function Tbl({ head, rows, empty }: { head: readonly string[]; rows: readonly ReactNode[][]; empty: string }) {
  if (!rows.length) return <p className={controls.hint}>{empty}</p>;
  return (
    <div className={surface.tableWrap}>
      <table className={surface.table}>
        <thead><tr>{head.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} data-mfd-row>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}
