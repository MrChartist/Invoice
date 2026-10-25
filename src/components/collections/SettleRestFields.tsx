import { useMemo } from 'react';
import type { InvoiceRecord } from '../../types/invoice';
import { can } from '../../lib/access';
import { clerkCap, loadCollectionSettings, settlementOptions, type SettleChoice } from '../../lib/settlement';
import { rupeeValue } from '../../lib/approval-gate';
import { formatCurrency, formatDate } from '../../lib/utils';
import { useT } from '../../i18n';
import { colT } from '../../i18n/areas/collections';
import controls from '../../styles/controls.module.css';
import styles from './collections.module.css';

export interface SettleValue {
  choice: SettleChoice;
  amount: string;
  gst: boolean;
}

export interface SettleRestFieldsProps {
  invoice: InvoiceRecord;
  /** What is still due before this receipt. */
  due: number;
  /** The receipt amount being entered. */
  amount: number;
  /** Receipt date (local day). */
  date: string;
  value: SettleValue;
  onChange: (next: SettleValue) => void;
  /** Shown above the options (e.g. "Settles the rest of INV/…" in the khata sheet). */
  caption?: string;
}

/**
 * R2-A2 "Settle the rest": shown when a receipt is below what is due. Leave open (default), settle as an
 * early-payment discount (pre-filled from the bill's term when the receipt is on time) or as a short payment /
 * kasar. The note is a financial credit note (no GST); the GST variant appears only when the company enabled
 * it, for settlement discounts.
 */
export function SettleRestFields({ invoice, due, amount, date, value, onChange, caption }: SettleRestFieldsProps) {
  useT();
  const settings = useMemo(loadCollectionSettings, []);
  const opts = settlementOptions(invoice, due, amount, date);
  if (!(opts.rest > 0.004) || !(amount > 0)) return null;
  const cap = clerkCap(rupeeValue(invoice), settings);
  const settleAmount = Number(value.amount) || 0;
  const overCap = value.choice !== 'leave' && !can('doc.approve') && settleAmount > cap + 0.004;
  const pick = (choice: SettleChoice) => {
    const preset = choice === 'settlement_discount' && opts.early ? opts.early.amount : opts.rest;
    onChange({ choice, amount: choice === 'leave' ? '' : String(preset), gst: choice === 'settlement_discount' ? value.gst : false });
  };
  const cur = invoice.currency || 'INR';
  return (
    <fieldset className={styles.box} data-settle-rest>
      <legend className={styles.boxHead}>{colT('settleTitle')} · {formatCurrency(opts.rest, cur)}</legend>
      {caption && <p className={styles.note}>{caption}</p>}
      <div className={styles.radios} role="radiogroup" aria-label={colT('settleTitle')}>
        {(['leave', 'settlement_discount', 'short_payment'] as const).map((c) => (
          <label key={c} className={controls.check}>
            <input type="radio" name={`settle-${invoice.id}`} checked={value.choice === c} onChange={() => pick(c)} data-settle-choice={c} />
            {c === 'leave' ? colT('settleLeave') : c === 'settlement_discount' ? colT('settleEarly') : colT('settleShort')}
          </label>
        ))}
      </div>
      {opts.early && <p className={styles.note}>{colT('settleEarlyHint', { percent: opts.early.percent, date: formatDate(opts.early.until) })}</p>}
      {value.choice !== 'leave' && (
        <>
          <label className={controls.field}>
            <span className={controls.label}>{colT('settleAmount')}</span>
            <input className={`${controls.input} ${controls.inputNumeric}`} type="number" min="0" step="0.01" inputMode="decimal" max={opts.rest}
              value={value.amount} onChange={(e) => onChange({ ...value, amount: e.target.value })} data-settle-amount />
          </label>
          <p className={styles.note}>{colT('settleHint')}</p>
          {value.choice === 'settlement_discount' && settings.gst_variant && Number(invoice.tax_amount) > 0 && (
            <>
              <label className={controls.check}>
                <input type="checkbox" checked={value.gst} onChange={(e) => onChange({ ...value, gst: e.target.checked })} />
                {colT('settleGst')}
              </label>
              {value.gst && <p className={styles.warn} role="note">{colT('settleGstWarn')}</p>}
            </>
          )}
          {overCap && <p className={styles.warn} role="note">{colT('settleCapped', { amount: formatCurrency(cap, 'INR') })}</p>}
        </>
      )}
    </fieldset>
  );
}

export default SettleRestFields;
