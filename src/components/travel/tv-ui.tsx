/** R15: the few UI bits the Trips desk views share (props, a labelled field, a write runner, a list select). */
import type { ReactNode } from 'react';
import controls from '../../styles/controls.module.css';
import { tvList } from '../../i18n/areas/travel-r15b';

export type Notify = (message: string, tone?: 'success' | 'error' | 'info') => void;
export interface TvViewProps { notify: Notify }

export const Field = ({ label, children }: { label: string; children: ReactNode }) => <label className={controls.field}><span className={controls.label}>{label}</span>{children}</label>;

/** Run a write; report its error, or `ok`. Returns the result (undefined on error). */
export const runWith = (notify: Notify) => <T,>(fn: () => T, ok?: string): T | undefined => {
  try {
    const r = fn();
    if (ok) notify(ok);
    return r;
  } catch (e) {
    notify((e as Error).message, 'error');
    return undefined;
  }
};

/** A select over `ids` labelled from the comma list `list`. */
export function ListSelect<T extends string>({ list, ids, value, onChange, attr }: { list: Parameters<typeof tvList>[0]; ids: readonly T[]; value: T; onChange: (v: T) => void; attr?: string }) {
  return (
    <select className={controls.select} value={value} onChange={(e) => onChange(e.target.value as T)} {...(attr ? { [attr]: '' } : {})}>
      {ids.map((k) => <option key={k} value={k}>{tvList(list, ids, k)}</option>)}
    </select>
  );
}

export const pct = (n: number | null): string => (n === null ? '—' : `${n.toFixed(1)}%`);
