import { periodForDate, periodLabel, type PeriodKind, type ReportPeriod } from '../../lib/gst-reports';
import controls from '../../styles/controls.module.css';
import styles from './gst-reports.module.css';
import { useT } from '../../i18n';
import { gvT } from '../../i18n/areas/gst-views';

const MONTHS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3] as const;

export interface PeriodPickerProps {
  value: ReportPeriod;
  onChange: (p: ReportPeriod) => void;
  /** FY start years offered in the dropdown, newest first. */
  fyOptions: number[];
}

export function PeriodPicker({ value, onChange, fyOptions }: PeriodPickerProps) {
  useT();
  const setKind = (kind: PeriodKind) => {
    // Keep the user's place: jump to the same FY, first month/quarter.
    const base = periodForDate(kind, `${value.fyStart}-04-01`);
    onChange({ ...base, fyStart: value.fyStart });
  };

  return (
    <div className={styles.periodBar}>
      <div className={styles.periodField}>
        <span className={controls.label} id="gst-period-kind">{gvT('period')}</span>
        <div className={`${controls.segment} ${styles.touchSeg}`} role="group" aria-labelledby="gst-period-kind">
          {(['month', 'quarter', 'fy'] as const).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={value.kind === k}
              className={value.kind === k ? controls.segmentBtnActive : controls.segmentBtn}
              onClick={() => setKind(k)}
            >
              {k === 'month' ? gvT('month') : k === 'quarter' ? gvT('quarter') : gvT('financialYear')}
            </button>
          ))}
        </div>
      </div>

      <label className={styles.periodField}>
        <span className={controls.label}>{gvT('financialYear')}</span>
        <select
          className={controls.select}
          value={value.fyStart}
          onChange={(e) => onChange({ ...value, fyStart: Number(e.target.value) })}
        >
          {fyOptions.map((y) => (
            <option key={y} value={y}>
              FY {String(y).slice(2)}-{String(y + 1).slice(2)}
            </option>
          ))}
        </select>
      </label>

      {value.kind === 'month' && (
        <label className={styles.periodField}>
          <span className={controls.label}>{gvT('month')}</span>
          <select
            className={controls.select}
            value={value.month}
            onChange={(e) => onChange({ ...value, month: Number(e.target.value) })}
          >
            {MONTHS.map((m) => (
              <option key={m} value={m}>{gvT(`m${m}`)}</option>
            ))}
          </select>
        </label>
      )}

      {value.kind === 'quarter' && (
        <label className={styles.periodField}>
          <span className={controls.label}>{gvT('quarter')}</span>
          <select
            className={controls.select}
            value={value.quarter}
            onChange={(e) => onChange({ ...value, quarter: Number(e.target.value) as 1 | 2 | 3 | 4 })}
          >
            <option value={1}>{gvT('q1')}</option>
            <option value={2}>{gvT('q2')}</option>
            <option value={3}>{gvT('q3')}</option>
            <option value={4}>{gvT('q4')}</option>
          </select>
        </label>
      )}

      <p className={controls.hint} aria-live="polite" style={{ alignSelf: 'center', margin: 0 }}>
        {gvT('showing', { period: periodLabel(value) })}
      </p>
    </div>
  );
}
