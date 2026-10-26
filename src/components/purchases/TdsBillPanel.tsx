import { useId } from 'react';
import type { TdsSuggestion, BillTdsInput } from '../../lib/tds-payables';
import { TDS_PAYABLE_SECTIONS } from '../../lib/tds-rules';
import { formatCurrency } from '../../lib/utils';
import { useT } from '../../i18n';
import { tdsT } from '../../i18n/areas/tds';
import { ita25Words } from '../../i18n/areas/ita2025';
import { withActRef } from '../../lib/ita2025';
import controls from '../../styles/controls.module.css';
import styles from './purchases.module.css';

const numOrUndef = (text: string): number | undefined => {
  if (text.trim() === '') return undefined;
  const n = Number(text);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

/** The "TDS deducted by you" block of the bill / expense forms (Tally parity). Controlled. */
export function TdsBillPanel({ value, onChange, suggestion, payableNet, nonResident, date }: {
  value: BillTdsInput;
  onChange: (v: BillTdsInput) => void;
  suggestion: TdsSuggestion | null;
  /** What the supplier is owed after TDS on booking (shown when deducting on the bill). */
  payableNet?: number;
  nonResident?: boolean;
  /** Bill / expense date: picks the Income-tax Act whose section references the list shows (2025 Act from 1 Apr 2026). */
  date?: string;
}) {
  useT();
  const uid = useId();
  const set = (p: Partial<BillTdsInput>) => onChange({ ...value, ...p });
  const on = !!value.section;
  const shownRate = value.rate ?? suggestion?.rate ?? 0;
  const shownBase = value.base ?? suggestion?.base ?? 0;
  const shownAmount = value.amount ?? (value.rate !== undefined || value.base !== undefined ? Math.round((shownBase * shownRate) / 100) : suggestion?.amount ?? 0);
  return (
    <details className={styles.advanced} open={on}>
      <summary>{tdsT('blockTitle')}</summary>
      <div className={styles.advancedBody}>
        <div className={controls.row}>
          <div className={controls.field}>
            <label className={controls.label} htmlFor={`${uid}-sec`}>{tdsT('section')}</label>
            <select id={`${uid}-sec`} className={controls.select} value={value.section} onChange={(e) => set({ section: e.target.value, rate: undefined, base: undefined, amount: undefined })}>
              <option value="">{tdsT('noTds')}</option>
              {TDS_PAYABLE_SECTIONS.map((s) => (
                <option key={s.code} value={s.code}>{date ? withActRef(s.label, s.code, date, ita25Words()) : s.label}</option>
              ))}
            </select>
          </div>
          {on && (
            <div className={controls.field}>
              <label className={controls.label} htmlFor={`${uid}-on`}>{tdsT('deductOn')}</label>
              <select id={`${uid}-on`} className={controls.select} value={value.on} onChange={(e) => set({ on: e.target.value === 'PAYMENT' ? 'PAYMENT' : 'BILL' })}>
                <option value="BILL">{tdsT('onBill')}</option>
                <option value="PAYMENT">{tdsT('onPayment')}</option>
              </select>
            </div>
          )}
        </div>
        {on && (
          <>
            <div className={controls.row3}>
              <div className={controls.field}>
                <label className={controls.label} htmlFor={`${uid}-pan`}>{tdsT('pan')}</label>
                <input id={`${uid}-pan`} className={`${controls.input} ${controls.inputMono}`} maxLength={10} value={value.pan} onChange={(e) => set({ pan: e.target.value.toUpperCase() })} />
              </div>
              <div className={controls.field}>
                <label className={controls.label} htmlFor={`${uid}-cert`}>{tdsT('lowerCert')}</label>
                <input id={`${uid}-cert`} className={controls.input} value={value.lowerCert ?? ''} onChange={(e) => set({ lowerCert: e.target.value })} />
              </div>
              <div className={controls.field}>
                <label className={controls.label} htmlFor={`${uid}-crate`}>{tdsT('lowerRate')}</label>
                <input id={`${uid}-crate`} type="number" min={0} step="0.01" className={controls.input} value={value.lowerRate ?? ''} onChange={(e) => set({ lowerRate: numOrUndef(e.target.value) })} />
              </div>
            </div>
            <label className={controls.check}>
              <input type="checkbox" checked={!!value.nonFiler} onChange={(e) => set({ nonFiler: e.target.checked })} />
              {tdsT('nonFiler')}
            </label>
            <div className={controls.row3}>
              <div className={controls.field}>
                <label className={controls.label} htmlFor={`${uid}-rate`}>{tdsT('rate')}</label>
                <input id={`${uid}-rate`} type="number" min={0} step="0.01" className={controls.input} value={shownRate} onChange={(e) => set({ rate: numOrUndef(e.target.value), amount: undefined })} />
              </div>
              <div className={controls.field}>
                <label className={controls.label} htmlFor={`${uid}-base`}>{tdsT('base')}</label>
                <input id={`${uid}-base`} type="number" min={0} step="0.01" className={controls.input} value={shownBase} onChange={(e) => set({ base: numOrUndef(e.target.value), amount: undefined })} />
              </div>
              <div className={controls.field}>
                <label className={controls.label} htmlFor={`${uid}-amt`}>{tdsT('amount')}</label>
                <input id={`${uid}-amt`} type="number" min={0} step="1" className={controls.input} value={shownAmount} onChange={(e) => set({ amount: numOrUndef(e.target.value) })} />
              </div>
            </div>
            {suggestion && (
              <p className={controls.hint} aria-live="polite">
                {suggestion.applies
                  ? tdsT('suggested', { rate: suggestion.rate, base: formatCurrency(suggestion.base).replace('₹', ''), amount: formatCurrency(suggestion.amount).replace('₹', '') })
                  : tdsT('notApplicable')}{' '}
                {suggestion.notes.join(' ')}{' '}
                {(value.rate !== undefined || value.base !== undefined || value.amount !== undefined) && (
                  <button type="button" className={controls.btnGhost} onClick={() => set({ rate: undefined, base: undefined, amount: undefined })}>{tdsT('useSuggested')}</button>
                )}
              </p>
            )}
            {value.on === 'BILL' && payableNet !== undefined && (
              <div className={styles.totalRow}>
                <span>{tdsT('payableNet')}</span>
                <span>{formatCurrency(payableNet)}</span>
              </div>
            )}
            {nonResident && <p className={styles.note}>{tdsT('nonResident')}</p>}
            <p className={styles.note}>{tdsT('blockNote')}</p>
          </>
        )}
      </div>
    </details>
  );
}
