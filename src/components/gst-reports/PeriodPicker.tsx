import { periodForDate, periodLabel, type PeriodKind, type ReportPeriod } from '../../lib/gst-reports';
import controls from '../../styles/controls.module.css';
import styles from './gst-reports.module.css';

const MONTHS = [
  [4, 'April'], [5, 'May'], [6, 'June'], [7, 'July'], [8, 'August'], [9, 'September'],
  [10, 'October'], [11, 'November'], [12, 'December'], [1, 'January'], [2, 'February'], [3, 'March'],
] as const;

export interface PeriodPickerProps {
  value: ReportPeriod;
  onChange: (p: ReportPeriod) => void;
  /** FY start years offered in the dropdown, newest first. */
  fyOptions: number[];
}

export function PeriodPicker({ value, onChange, fyOptions }: PeriodPickerProps) {
  const setKind = (kind: PeriodKind) => {
    // Keep the user's place: jump to the same FY, first month/quarter.
    const base = periodForDate(kind, `${value.fyStart}-04-01`);
    onChange({ ...base, fyStart: value.fyStart });
  };

  return (
    <div className={styles.periodBar}>
      <div className={styles.periodField}>
        <span className={controls.label} id="gst-period-kind">Period</span>
        <div className={`${controls.segment} ${styles.touchSeg}`} role="group" aria-labelledby="gst-period-kind">
          {(['month', 'quarter', 'fy'] as const).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={value.kind === k}
              className={value.kind === k ? controls.segmentBtnActive : controls.segmentBtn}
              onClick={() => setKind(k)}
            >
              {k === 'month' ? 'Month' : k === 'quarter' ? 'Quarter' : 'Financial year'}
            </button>
          ))}
        </div>
      </div>

      <label className={styles.periodField}>
        <span className={controls.label}>Financial year</span>
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
          <span className={controls.label}>Month</span>
          <select
            className={controls.select}
            value={value.month}
            onChange={(e) => onChange({ ...value, month: Number(e.target.value) })}
          >
            {MONTHS.map(([m, name]) => (
              <option key={m} value={m}>{name}</option>
            ))}
          </select>
        </label>
      )}

      {value.kind === 'quarter' && (
        <label className={styles.periodField}>
          <span className={controls.label}>Quarter</span>
          <select
            className={controls.select}
            value={value.quarter}
            onChange={(e) => onChange({ ...value, quarter: Number(e.target.value) as 1 | 2 | 3 | 4 })}
          >
            <option value={1}>Q1 (Apr-Jun)</option>
            <option value={2}>Q2 (Jul-Sep)</option>
            <option value={3}>Q3 (Oct-Dec)</option>
            <option value={4}>Q4 (Jan-Mar)</option>
          </select>
        </label>
      )}

      <p className={controls.hint} aria-live="polite" style={{ alignSelf: 'center', margin: 0 }}>
        Showing {periodLabel(value)}
      </p>
    </div>
  );
}
