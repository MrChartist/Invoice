import { useId } from 'react';
import {
  PERIOD_PRESET_LABELS,
  periodForPreset,
  type Period,
  type PeriodPreset,
} from '../../lib/books';
import { formatDate } from '../../lib/utils';
import surface from '../../styles/surface.module.css';
import controls from '../../styles/controls.module.css';
import styles from './books.module.css';

export interface PeriodBarProps {
  preset: PeriodPreset;
  period: Period;
  onChange: (preset: PeriodPreset, period: Period) => void;
}

const PRESETS: PeriodPreset[] = ['this_month', 'last_month', 'this_quarter', 'this_fy', 'last_fy', 'custom'];

export function PeriodBar({ preset, period, onChange }: PeriodBarProps) {
  const startId = useId();
  const endId = useId();

  const pick = (p: PeriodPreset) => {
    onChange(p, p === 'custom' ? period : periodForPreset(p));
  };

  return (
    <div className={`${surface.card} ${styles.periodBar}`}>
      <div className={styles.presets} role="group" aria-label="Period">
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            className={preset === p ? styles.chipActive : styles.chip}
            aria-pressed={preset === p}
            onClick={() => pick(p)}
          >
            {PERIOD_PRESET_LABELS[p]}
          </button>
        ))}
      </div>
      {preset === 'custom' && (
        <div className={styles.dateRow}>
          <div className={`${controls.field} ${styles.dateField}`}>
            <label className={controls.label} htmlFor={startId}>From</label>
            <input
              id={startId}
              type="date"
              className={controls.input}
              value={period.start}
              max={period.end}
              onChange={(e) => e.target.value && onChange('custom', { ...period, start: e.target.value })}
            />
          </div>
          <div className={`${controls.field} ${styles.dateField}`}>
            <label className={controls.label} htmlFor={endId}>To</label>
            <input
              id={endId}
              type="date"
              className={controls.input}
              value={period.end}
              min={period.start}
              onChange={(e) => e.target.value && onChange('custom', { ...period, end: e.target.value })}
            />
          </div>
        </div>
      )}
      <div className={styles.periodSummary}>
        {formatDate(period.start)} – {formatDate(period.end)}
      </div>
    </div>
  );
}
