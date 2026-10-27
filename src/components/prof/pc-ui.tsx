/** R14 PS-C desk bits: a table (fields come from PS-A's `ps-ui.tsx`). */
import type { ReactNode } from 'react';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import { pcT } from '../../i18n/areas/prof-r14c-export';


export function Tbl({ head, rows, tag }: { head: readonly string[]; rows: readonly ReactNode[][]; tag: string }) {
  if (!rows.length) return <p className={controls.hint}>{pcT('none')}</p>;
  return (
    <div className={surface.tableWrap}>
      <table className={surface.table}>
        <thead><tr>{head.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} {...{ [`data-ps-${tag}`]: '' }}>{r.map((c, j) => <td key={j} colSpan={r.length === 1 ? head.length : undefined}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}
