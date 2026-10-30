/** MF-A floor desk helpers (this desk only — no shared desk kit, PRD §1): a plain table, a labelled field, a bound input. */
import type { ReactNode } from 'react';
import { fT } from '../../i18n/areas/mfg-r13a';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import { TypedInput } from '../ui/TypedInput';
import { SelectField } from '../ui/SelectField';

export function Grid({ head, rows, attr }: { head: readonly ReactNode[]; rows: readonly ReactNode[][]; attr?: string }) {
  if (!rows.length) return <p className={controls.hint}>{fT('none')}</p>;
  return (
    <div className={surface.tableWrap}>
      <table className={surface.table} data-mf-grid={attr}>
        <thead><tr>{head.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

export function F({ label, children, w }: { label: string; children: ReactNode; w?: number }) {
  return <label className={controls.field} style={w ? { maxWidth: w } : undefined}><span className={controls.label}>{label}</span>{children}</label>;
}

/** A text / number input bound to a string state. */
export function In({ v, set, type = 'text', ...rest }: { v: string; set: (s: string) => void; type?: string } & Record<string, unknown>) {
  return <TypedInput className={controls.input} type={type} value={v} onChange={(e) => set(e.target.value)} {...rest} />;
}

export function Sel({ v, set, o, ...rest }: { v: string; set: (s: string) => void; o: readonly (readonly [string, string])[] } & Record<string, unknown>) {
  return <SelectField className={controls.select} value={v} onChange={(e) => set(e.target.value)} {...rest}>{o.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</SelectField>;
}
