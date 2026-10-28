/** R17: the UI bits the Deploy desk views and the editor row share (props, a labelled field, the regime chip). */
import type { ReactNode } from 'react';
import { mpT } from '../../i18n/areas/manpower-r17a';
import { mpRegime } from '../../lib/manpower/mp-regime';
import type { Client } from '../../types/invoice';
import controls from '../../styles/controls.module.css';

export type Notify = (message: string, tone?: 'success' | 'error' | 'info') => void;
export interface MpViewProps { notify: Notify }

export const Field = ({ label, children }: { label: string; children: ReactNode }) => <label className={controls.field}><span className={controls.label}>{label}</span>{children}</label>;

/** The regime chip of a client's posts on a date (A3): regime, CA ids, and the split warning for mixed posts. */
export function RegimeChip({ client, sacs, date, entity }: { client?: Pick<Client, 'gstin' | 'mp'> | null; sacs: readonly string[]; date: string; entity: string }) {
  const r = mpRegime({ date, entityType: entity, client }, sacs);
  return (
    <span className={controls.hint} data-mp-regime={r.regime}>
      {mpT(`reg.${r.regime}`, { r: r.rate })} ({r.ca.join(', ')}){r.split ? ` — ${mpT('split')}` : ''}
    </span>
  );
}
