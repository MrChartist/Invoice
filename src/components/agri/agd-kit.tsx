/** AG-D desks: the shared bits of UI (field, picker, table, desk frame with its view switch). */
import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useT } from '../../i18n';
import { agdT, type AgdKey } from '../../i18n/areas/agri-r12d';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';

export function F({ label, w, children }: { label: string; w?: number; children: ReactNode }) {
  return <label className={controls.field} style={w ? { maxWidth: w } : undefined}><span className={controls.label}>{label}</span>{children}</label>;
}

export function Sel({ value, onChange, opts, blank, ...rest }: { value: string; onChange: (v: string) => void; opts: readonly (readonly [string, string])[]; blank?: string; 'data-agd'?: string }) {
  return (
    <select className={controls.select} value={value} onChange={(e) => onChange(e.target.value)} {...rest}>
      {blank !== undefined && <option value="">{blank}</option>}
      {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

export function Tbl({ head, rows, flag }: { head: readonly ReactNode[]; rows: readonly ReactNode[][]; flag?: readonly boolean[] }) {
  if (!rows.length) return <p className={controls.hint}>{agdT('none')}</p>;
  return (
    <div className={surface.tableWrap}>
      <table className={surface.table}>
        <thead><tr>{head.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} data-agd-row style={flag?.[i] ? { background: 'var(--muted)' } : undefined}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

/** A desk on Inventory (`?tab=<tab>&view=<view>`): title, the view switch, the body, the working-paper note. */
export function Desk({ tab, title, icon, views, view, children }: { tab: string; title: AgdKey; icon: ReactNode; views: readonly string[]; view: string; children: ReactNode }) {
  useT();
  const [, setParams] = useSearchParams();
  return (
    <section className={surface.card} data-agd-desk={`${tab}:${view}`}>
      <div className={surface.cardHead}>
        <span className={surface.cardHeadIcon}>{icon} {agdT(title)}</span>
        <div className={controls.segment} role="tablist">
          {views.map((x) => <button key={x} type="button" role="tab" aria-selected={view === x} className={view === x ? controls.segmentBtnActive : controls.segmentBtn} onClick={() => setParams({ tab, view: x }, { replace: true })} data-agd-view={x}>{agdT(`v.${x}` as AgdKey)}</button>)}
        </div>
      </div>
      <div className={surface.cardBody}>{children}</div>
      <p className={controls.hint} style={{ padding: '0 1rem 1rem' }}>{agdT('workingPaper')}</p>
    </section>
  );
}
