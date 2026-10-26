import { useMemo } from 'react';
import type { Client, ReminderMode } from '../../types/invoice';
import { loadPaymentTerms } from '../../lib/payment-terms';
import { useT } from '../../i18n';
import { colT } from '../../i18n/areas/collections';
import controls from '../../styles/controls.module.css';

const MODES: ReminderMode[] = ['auto', 'manual', 'never'];
const label = (m: ReminderMode) => (m === 'auto' ? colT('rmAuto') : m === 'manual' ? colT('rmManual') : colT('rmNever'));

type Patch = Pick<Client, 'reminder_mode' | 'payment_terms_id'>;

/**
 * R2-A5 / A1: the party's collection settings in the client form — the reminder mode (automatic, the default;
 * manual = only on demand; never) and the default payment term new documents pre-select. `onChange` receives
 * the patch for the client record (`auto` / no term are stored as absent).
 */
export function ReminderModeField({ client, onChange }: { client: Patch; onChange: (patch: Partial<Patch>) => void }) {
  useT();
  const terms = useMemo(() => loadPaymentTerms(), []);
  const value = client.reminder_mode ?? 'auto';
  const term = client.payment_terms_id ?? '';
  return (
    <div className={controls.row}>
      <label className={controls.field}>
        <span className={controls.label}>{colT('tpLabel')}</span>
        <select className={controls.select} value={term} onChange={(e) => onChange({ payment_terms_id: e.target.value || undefined })} data-client-terms>
          <option value="">{colT('fuNone')}</option>
          {terms.filter((t) => !t.inactive || t.id === term).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </label>
      <label className={controls.field}>
        <span className={controls.label}>{colT('rmMode')}</span>
        <select className={controls.select} value={value} onChange={(e) => onChange({ reminder_mode: e.target.value === 'auto' ? undefined : (e.target.value as ReminderMode) })} data-reminder-mode>
          {MODES.map((m) => <option key={m} value={m}>{label(m)}</option>)}
        </select>
      </label>
    </div>
  );
}

export default ReminderModeField;
