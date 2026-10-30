import { useMemo } from 'react';
import { localDb } from '../../lib/localDb';
import type { BillableValue } from '../../lib/purchases';
import { useT } from '../../i18n';
import { purT } from '../../i18n/areas/purchases';
import controls from '../../styles/controls.module.css';
import styles from './purchases.module.css';
import { SelectField } from '../ui/SelectField';

/** Compact "re-bill to a client" block for the expense and bill forms (roadmap 6.14). */
export function BillableFields({ idPrefix, value, onChange, rebilledIn }: {
  idPrefix: string;
  value: BillableValue;
  onChange: (v: BillableValue) => void;
  rebilledIn?: string;
}) {
  useT(); // re-render on a language switch (5.4)
  const clients = useMemo(() => localDb.clients.getAll().filter((c) => c.id && c.name?.trim()), []);
  const billedOn = rebilledIn ? localDb.invoices.getById(rebilledIn) : undefined;
  const on = !!value.billable_to_client_id;
  return (
    <details className={styles.advanced} open={on}>
      <summary>{purT('billableSummary')}</summary>
      <div className={styles.advancedBody}>
        <div className={controls.row}>
          <div className={controls.field}>
            <label className={controls.label} htmlFor={`${idPrefix}-bill-client`}>{purT('client')}</label>
            <SelectField id={`${idPrefix}-bill-client`} className={controls.select} value={value.billable_to_client_id ?? ''}
              onChange={(e) => onChange({ ...value, billable_to_client_id: e.target.value || undefined })}>
              <option value="">{purT('notBillable')}</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </SelectField>
          </div>
          {on && !value.pure_agent && (
            <div className={controls.field}>
              <label className={controls.label} htmlFor={`${idPrefix}-markup`}>{purT('markup')}</label>
              <input id={`${idPrefix}-markup`} type="number" min={0} step="0.01" className={controls.input} value={value.markup_percent || ''}
                onChange={(e) => onChange({ ...value, markup_percent: Math.max(Number(e.target.value) || 0, 0) })} />
            </div>
          )}
        </div>
        {on && (
          <label className={controls.check}>
            <input type="checkbox" checked={!!value.pure_agent} onChange={(e) => onChange({ ...value, pure_agent: e.target.checked })} />
            {purT('pureAgent')}
          </label>
        )}
        <p className={styles.note}>
          {purT('billableNote')}
          {billedOn && ` ${purT('alreadyRebilled', { number: billedOn.invoice_number })}`}
        </p>
      </div>
    </details>
  );
}
