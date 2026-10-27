/** MF-C garments desk helpers (this desk only; no shared desk kit): a table, a labelled field, bound inputs, a run guard. */
import type { CSSProperties, ReactNode } from 'react';
import type { MfgContext } from '../manufacturing/context';
import { gT } from '../../i18n/areas/mfg-r13c';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';

export const row: CSSProperties = { display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end' };
export const stack: CSSProperties = { display: 'grid', gap: '0.5rem', margin: '0.75rem 0' };
export const n2 = (n: number) => String(Math.round((n + Number.EPSILON) * 100) / 100);

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

/** Run a write; toast the result or the error. */
export function run(ctx: MfgContext, fn: () => string | void, after?: () => void): void {
  try {
    const msg = fn();
    after?.();
    ctx.changed(msg || gT('saved'));
  } catch (e) {
    ctx.error((e as Error).message);
  }
}

/** "S1 M2 L2 XL1" / "S=1, M=2" ⇄ { S: 1, … }. */
export function parseRatio(s: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of s.matchAll(/([A-Za-z0-9+]+?)\s*[=:]?\s*(\d+)(?=[\s,;]|$)/g)) out[m[1].toUpperCase()] = Number(m[2]);
  return out;
}
export const ratioText = (r: Record<string, number> | undefined) => Object.entries(r ?? {}).map(([k, v]) => `${k}${v}`).join(' ');
export const opts = (list: readonly { id: string; name: string }[], blank = true): (readonly [string, string])[] => [...(blank ? [['', '—'] as const] : []), ...list.map((x) => [x.id, x.name] as const)];
export { todayInput as today } from '../../lib/utils';
