import { useMemo } from 'react';
import { localDb } from '../../lib/localDb';
import type { BillableValue } from '../../lib/purchases';
import controls from '../../styles/controls.module.css';
import styles from './purchases.module.css';

/** Compact "re-bill to a client" block for the expense and bill forms (roadmap 6.14). */
export function BillableFields({ idPrefix, value, onChange, rebilledIn }: {
  idPrefix: string;
  value: BillableValue;
  onChange: (v: BillableValue) => void;
  rebilledIn?: string;
}) {
  const clients = useMemo(() => localDb.clients.getAll().filter((c) => c.id && c.name?.trim()), []);
  const billedOn = rebilledIn ? localDb.invoices.getById(rebilledIn) : undefined;
  const on = !!value.billable_to_client_id;
  return (
    <details className={styles.advanced} open={on}>
      <summary>Bill this cost to a client</summary>
      <div className={styles.advancedBody}>
        <div className={controls.row}>
          <div className={controls.field}>
            <label className={controls.label} htmlFor={`${idPrefix}-bill-client`}>Client</label>
            <select id={`${idPrefix}-bill-client`} className={controls.select} value={value.billable_to_client_id ?? ''}
              onChange={(e) => onChange({ ...value, billable_to_client_id: e.target.value || undefined })}>
              <option value="">Not billable</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          {on && !value.pure_agent && (
            <div className={controls.field}>
              <label className={controls.label} htmlFor={`${idPrefix}-markup`}>Markup %</label>
              <input id={`${idPrefix}-markup`} type="number" min={0} step="0.01" className={controls.input} value={value.markup_percent || ''}
                onChange={(e) => onChange({ ...value, markup_percent: Math.max(Number(e.target.value) || 0, 0) })} />
            </div>
          )}
        </div>
        {on && (
          <label className={controls.check}>
            <input type="checkbox" checked={!!value.pure_agent} onChange={(e) => onChange({ ...value, pure_agent: e.target.checked })} />
            Pure agent reimbursement (Rule 33): billed at actual cost as a 0% GST line
          </label>
        )}
        <p className={styles.note}>
          Re-billed costs are part of your taxable supply (billed at your GST rate, cost net of any ITC claimed). A pure-agent
          reimbursement needs the Rule 33 conditions (incurred in the client&apos;s name, recovered at actual cost) — verify with your CA.
          {billedOn && ` Already re-billed on ${billedOn.invoice_number}.`}
        </p>
      </div>
    </details>
  );
}
