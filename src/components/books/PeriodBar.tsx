import { useEffect, useId, useRef } from 'react';
import {
  periodForPreset,
  type Period,
  type PeriodPreset,
} from '../../lib/books';
import { formatDate } from '../../lib/utils';
import surface from '../../styles/surface.module.css';
import controls from '../../styles/controls.module.css';
import styles from './books.module.css';
import { useT } from '../../i18n';
import { booksT, presetLabel } from '../../i18n/areas/books';

export interface PeriodBarProps {
  preset: PeriodPreset;
  period: Period;
  onChange: (preset: PeriodPreset, period: Period) => void;
}

const PRESETS: PeriodPreset[] = ['this_month', 'last_month', 'this_quarter', 'this_fy', 'last_fy', 'custom'];

export function PeriodBar({ preset, period, onChange }: PeriodBarProps) {
  useT();
  const startId = useId();
  const endId = useId();
  const startRef = useRef<HTMLInputElement | null>(null);
  const wantFocus = useRef(false);

  // Alt+F2 (Tally "Period"): switch to a custom range and put the cursor in "From".
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.key !== 'F2') return;
      e.preventDefault();
      wantFocus.current = true;
      if (preset !== 'custom') onChange('custom', period);
      else startRef.current?.focus();
    };
    // Capture phase: on Books, Alt+F2 changes this period instead of the global Gateway period key.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [preset, period, onChange]);
  useEffect(() => {
    if (preset === 'custom' && wantFocus.current) {
      wantFocus.current = false;
      startRef.current?.focus();
    }
  }, [preset]);

  const pick = (p: PeriodPreset) => {
    onChange(p, p === 'custom' ? period : periodForPreset(p));
  };

  return (
    <div className={`${surface.card} ${styles.periodBar}`}>
      <div className={styles.presets} role="group" aria-label={booksT('period')}>
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            className={preset === p ? styles.chipActive : styles.chip}
            aria-pressed={preset === p}
            onClick={() => pick(p)}
          >
            {presetLabel(p)}
          </button>
        ))}
      </div>
      {preset === 'custom' && (
        <div className={styles.dateRow}>
          <div className={`${controls.field} ${styles.dateField}`}>
            <label className={controls.label} htmlFor={startId}>{booksT('from')}</label>
            <input
              ref={startRef}
              id={startId}
              type="date"
              className={controls.input}
              value={period.start}
              max={period.end}
              onChange={(e) => e.target.value && onChange('custom', { ...period, start: e.target.value })}
            />
          </div>
          <div className={`${controls.field} ${styles.dateField}`}>
            <label className={controls.label} htmlFor={endId}>{booksT('to')}</label>
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
      <div className={styles.periodSummary} title="Alt+F2">
        {formatDate(period.start)} – {formatDate(period.end)}
      </div>
    </div>
  );
}
