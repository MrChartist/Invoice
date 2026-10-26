import { useState } from 'react';
import { DEFAULT_BANK_ID, pickableBankAccounts, type BankPickPurpose } from '../../lib/bank-accounts';
import controls from '../../styles/controls.module.css';

/**
 * "Received into / paid from" picker for a receipt or supplier payment (multi-account BRS).
 * Renders nothing for cash, or while only one bank account exists.
 */
export function BankAccountSelect({ id, label, method, value, onChange, purpose = 'any' }: {
  id: string;
  label: string;
  method: string;
  value: string;
  onChange: (id: string) => void;
  /** R5-A2: 'cheque' leaves marketplace clearing accounts out. */
  purpose?: BankPickPurpose;
}) {
  const [accounts] = useState(() => pickableBankAccounts(purpose));
  if (accounts.length < 2 || method.trim().toLowerCase() === 'cash') return null;
  return (
    <div className={controls.field}>
      <label className={controls.label} htmlFor={id}>{label}</label>
      <select id={id} className={controls.select} value={value || DEFAULT_BANK_ID} onChange={(e) => onChange(e.target.value)}>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>{a.name}{a.number ? ` (${a.number})` : ''}</option>
        ))}
      </select>
    </div>
  );
}
