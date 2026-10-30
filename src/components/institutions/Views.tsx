/** R5-C shared components: sub-view switch, the "pack off" line and compact form fields (one chunk with the screens). */
import type { ReactNode } from 'react';
import { iT } from '../../i18n/areas/packs-institutions-r5';
import { isPackOn, type PackId } from '../../lib/industry-packs';
import { localDb } from '../../lib/localDb';
import c from '../../styles/controls.module.css';
import s from '../../styles/surface.module.css';
import styles from './institutions.module.css';
import { TypedInput } from '../ui/TypedInput';
import { SelectField } from '../ui/SelectField';

export function Views<T extends string>({ views, value, onChange, label }: { views: readonly T[]; value: T; onChange: (v: T) => void; label: (v: T) => string }) {
  return (
    <div className={styles.views} role="tablist">
      {views.map((v) => (
        <button key={v} type="button" role="tab" aria-selected={value === v} className={value === v ? styles.viewActive : styles.view} onClick={() => onChange(v)} data-r5c-view={v}>
          {label(v)}
        </button>
      ))}
    </div>
  );
}

/** "This pack is off" line for a tab opened by URL with its pack off. */
export function PackNote({ pack }: { pack: PackId }) {
  return isPackOn(localDb.settings.get(), pack) ? null : <p className={styles.warn}>{iT('packOff')}</p>;
}

const data = (d?: string) => (d ? { [`data-${d}`]: '' } : {});

/** Labelled input; `t` = input type, `d` = a `data-` hook for tests. */
export function T({ l, v, on, t, d, bad, ph }: { l: string; v: string | number | undefined; on: (v: string) => void; t?: string; d?: string; bad?: boolean; ph?: string }) {
  return (
    <label className={c.field}>
      <span className={c.label}>{l}</span>
      <TypedInput className={bad ? `${c.input} ${c.inputInvalid}` : c.input} type={t} value={v ?? ''} placeholder={ph} onChange={(e) => on(e.target.value)} {...data(d)} />
    </label>
  );
}

/** Labelled select over `[value, label]` pairs. */
export function S({ l, v, on, o, d }: { l: string; v: string | number | undefined; on: (v: string) => void; o: readonly (readonly [string | number, string])[]; d?: string }) {
  return (
    <label className={c.field}>
      <span className={c.label}>{l}</span>
      <SelectField className={c.select} value={v ?? ''} onChange={(e) => on(e.target.value)} {...data(d)}>
        {o.map(([k, x]) => <option key={k} value={k}>{x}</option>)}
      </SelectField>
    </label>
  );
}

export function C({ l, v, on }: { l: string; v: boolean | undefined; on: (v: boolean) => void }) {
  return <label className={c.check}><input type="checkbox" checked={!!v} onChange={(e) => on(e.target.checked)} /> {l}</label>;
}

/** Button: `p` primary, `g` ghost, else outline; `sm` small. */
export function B({ l, on, p, g, sm, d, dis }: { l: ReactNode; on: () => void; p?: boolean; g?: boolean; sm?: boolean; d?: string; dis?: boolean }) {
  return <button type="button" className={`${p ? c.btnPrimary : g ? c.btnGhost : c.btnOutline}${sm ? ` ${c.btnSm}` : ''}`} onClick={on} disabled={dis} {...data(d)}>{l}</button>;
}

/** File picker styled as a button (CSV import). */
export function F({ l, on }: { l: string; on: (f: File) => void }) {
  return <label className={c.btnOutline}>{l}<input type="file" accept=".csv,text/csv" hidden onChange={(e) => e.target.files?.[0] && on(e.target.files[0])} /></label>;
}

/** A plain table: header labels and rows of cells. */
export function Tbl({ h, rows, d }: { h: readonly string[]; rows: readonly (readonly ReactNode[])[]; d?: string }) {
  return (
    <div className={s.tableWrap}>
      <table className={s.table} {...data(d)}>
        <thead><tr>{h.map((x, i) => <th key={i}>{x}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((x, k) => <td key={k}>{x}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

/** Card with the pack note, the sub-views and a working-paper note under it. */
export function Shell<V extends string>({ pack, views, view, go, label, note, d, children }: { pack: PackId; views: readonly V[]; view: V; go: (v: V) => void; label: (v: V) => string; note: string; d: string; children: ReactNode }) {
  return (
    <div className={styles.stack} {...data(d)}>
      <PackNote pack={pack} />
      <Views views={views} value={view} onChange={go} label={label} />
      <div className={s.card}><div className={s.cardBody}>{children}</div></div>
      <p className={styles.note}>{note}</p>
    </div>
  );
}
