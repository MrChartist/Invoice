import { lazy, Suspense, useEffect, useId, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
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
import { useReportKeys } from '../../lib/keys/report-keys';
import { stepPeriod } from '../../lib/keys/report-actions';
import { defaultView, loadViews, viewHref } from '../../lib/report-views';

// R20-C: Ctrl+H / Ctrl+L saved-views sheet (lazy).
const ViewsSheet = lazy(() => import('../keys/ReportSheets').then((m) => ({ default: m.ViewsSheet })));

export interface PeriodBarProps {
  preset: PeriodPreset;
  period: Period;
  onChange: (preset: PeriodPreset, period: Period) => void;
}

// 8.107: MTD / QTD / YTD run from the start of the period to today.
const PRESETS: PeriodPreset[] = ['mtd', 'qtd', 'ytd', 'this_month', 'last_month', 'this_quarter', 'this_fy', 'last_fy', 'custom'];

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

  // R20-C (Tally keys): + / − (and ] / [) step the period; Ctrl+H views, Ctrl+L save this view.
  const card = useRef<HTMLDivElement | null>(null);
  const [views, setViews] = useState(false);
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const tab = params.get('tab') ?? '';
  const step = (dir: 1 | -1) => () => onChange('custom', stepPeriod(preset, period, dir));
  useReportKeys('report', () => card.current, {
    stepNext: step(1),
    'stepNext.alias': step(1),
    stepPrev: step(-1),
    'stepPrev.alias': step(-1),
    views: () => setViews(true),
    saveView: () => setViews(true),
  });
  // A view marked "Open by default" opens when this screen + tab is visited without a view of that tab.
  useEffect(() => {
    const v = defaultView(pathname, tab);
    const cur = loadViews().find((x) => x.id === params.get('view'));
    if (v && (!cur || cur.tab !== tab)) navigate(viewHref(v), { replace: true });
  }, [pathname, tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (p: PeriodPreset) => {
    onChange(p, p === 'custom' ? period : periodForPreset(p));
  };

  return (
    <div ref={card} className={`${surface.card} ${styles.periodBar}`}>
      {views && (
        <Suspense fallback={null}>
          <ViewsSheet route={pathname} tab={tab} preset={preset} period={period} onClose={() => setViews(false)} />
        </Suspense>
      )}
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
