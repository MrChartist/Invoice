/** R14: the few UI bits both professional desks share (≤ 1 kB gz): props, a view switcher, a labelled field, a runner. */
import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import controls from '../../styles/controls.module.css';

export function Views<V extends string>({ tab, views, value, label }: { tab: string; views: readonly V[]; value: V; label: (v: V) => string }) {
  const [, setParams] = useSearchParams();
  return (
    <div className={controls.segment} role="tablist" style={{ marginBottom: '0.75rem' }}>
      {views.map((k) => (
        <button key={k} type="button" role="tab" aria-selected={k === value} className={k === value ? controls.segmentBtnActive : controls.segmentBtn} onClick={() => setParams({ tab, view: k }, { replace: true })} data-ps-view={k}>{label(k)}</button>
      ))}
    </div>
  );
}

export const Field = ({ label, children }: { label: string; children: ReactNode }) => <label className={controls.field}><span className={controls.label}>{label}</span>{children}</label>;
