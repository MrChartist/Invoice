/** AG-D desks: the shared bits of UI — a data-driven field row, picker, table, button and the desk frame. */
import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useT } from '../../i18n';
import { agdT, type AgdKey } from '../../i18n/areas/agri-r12d';
import { NumberInput } from '../ui/NumberInput';
import { btn, wrap } from './agd-ui';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import { SelectField } from '../ui/SelectField';
import { TypedInput } from '../ui/TypedInput';

type Opts = readonly (readonly [string, string])[];
/** A field: key in the state object, label key, kind (n number, d date, m month, c checkbox, t / absent text, or options), width. */
export type Fd = readonly [key: string, label: AgdKey, kind?: 'n' | 'd' | 'm' | 'c' | 't' | Opts, w?: number];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Obj = Record<string, any>;

export function F({ label, w, children }: { label: string; w?: number; children: ReactNode }) {
  return <label className={controls.field} style={w ? { maxWidth: w } : undefined}><span className={controls.label}>{label}</span>{children}</label>;
}

export function Sel({ value, onChange, opts, blank, ...rest }: { value: string; onChange: (v: string) => void; opts: Opts; blank?: string; 'data-agd'?: string }) {
  return (
    <SelectField className={controls.select} value={value} onChange={(e) => onChange(e.target.value)} {...rest}>
      {blank !== undefined && <option value="">{blank}</option>}
      {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </SelectField>
  );
}

/** A row of fields bound to one state object (`data-agd` = the key), then any buttons. */
export function Form({ v, set, f, children }: { v: Obj; set: (v: Obj) => void; f: readonly (Fd | false)[]; children?: ReactNode }) {
  return (
    <div style={wrap}>
      {f.map((x) => {
        if (!x) return null;
        const [k, label, kind, w] = x;
        const on = (val: unknown) => set({ ...v, [k]: val });
        const input = kind === 'n' ? <NumberInput className={controls.input} value={Number(v[k]) || 0} onChange={on} data-agd={k} />
          : kind === 'c' ? <input type="checkbox" checked={!!v[k]} onChange={(e) => on(e.target.checked)} data-agd={k} />
          : Array.isArray(kind) ? <Sel value={String(v[k] ?? '')} onChange={on} opts={kind} blank="-" data-agd={k} />
          : <TypedInput type={kind === 'd' ? 'date' : kind === 'm' ? 'month' : 'text'} className={controls.input} value={String(v[k] ?? '')} onChange={(e) => on(e.target.value)} data-agd={k} />;
        return <F key={k} label={agdT(label)} w={w}>{input}</F>;
      })}
      {children}
    </div>
  );
}

/** A button: primary when `p`, else the small outline one. */
export function B({ k, on, p, off, ...rest }: { k: AgdKey; on: () => void; p?: boolean; off?: boolean; 'data-agd-b'?: string }) {
  return <button type="button" className={p ? controls.btnPrimary : btn} disabled={off} onClick={on} {...rest}>{agdT(k)}</button>;
}

export function Tbl({ head, rows, flag }: { head: readonly (AgdKey | '')[]; rows: readonly ReactNode[][]; flag?: readonly boolean[] }) {
  if (!rows.length) return <p className={controls.hint}>{agdT('none')}</p>;
  return (
    <div className={surface.tableWrap}>
      <table className={surface.table}>
        <thead><tr>{head.map((h, i) => <th key={i}>{h && agdT(h)}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} data-agd-row style={flag?.[i] ? { background: 'var(--muted)' } : undefined}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

export const Hint = ({ k }: { k: AgdKey }) => <p className={controls.hint}>{agdT(k)}</p>;

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
