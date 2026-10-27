/** Round 12 desk helpers shared by the AG-A views (one small chunk): run-and-report, a plain table, a labelled field. */
import { useState, type ReactNode } from 'react';
import { agT } from '../../i18n/areas/agri-r12a';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';

export type Done = (msg: string, error?: boolean) => void;
export const wrap = { display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end' } as const;

/** Run a data-layer call, then report its message (or the error) and re-render. */
export function useRun(onDone: Done) {
  const [tick, setTick] = useState(0);
  const run = (fn: () => string | void) => {
    try {
      const m = fn();
      setTick((t) => t + 1);
      if (m) onDone(m);
    } catch (err) {
      onDone((err as Error).message, true);
    }
  };
  return { tick, run };
}

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

export const F = ({ label, children }: { label: string; children: ReactNode }) => (
  <label className={controls.field}><span className={controls.label}>{label}</span>{children}</label>
);

/** A text / number input bound to a string state. */
export const In = ({ v, set, type = 'text', w, ...rest }: { v: string; set: (s: string) => void; type?: string; w?: number } & Record<string, unknown>) => (
  <input className={controls.input} type={type} value={v} onChange={(e) => set(e.target.value)} style={w ? { width: w } : undefined} {...rest} />
);

export const money = (n: unknown) => `₹${(Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
