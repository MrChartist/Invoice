/**
 * Report options (WP-2, P1-3): Alt+F1 detailed / condensed, F12 configure (zero balances, opening and
 * transactions columns, narration) and comparative columns (Alt+C style). Preferences are remembered
 * per report on this device (`src/lib/report-prefs.ts`). Keys only act while the bar is visible, so
 * a report hidden under a drill-down level does not react.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { Columns3, ListTree, Settings2 } from 'lucide-react';
import type { ReportPrefs } from '../../../lib/report-prefs';
import type { ColumnMode } from '../../../lib/ledger';
import { reportsT } from '../../../i18n/areas/reports-engine';
import { useT } from '../../../i18n';
import { useReportKeys } from '../../../lib/keys/report-keys';
import controls from '../../../styles/controls.module.css';
import books from '../books.module.css';
import styles from './ledger.module.css';

type OptionKey = 'showZero' | 'showOpening' | 'showTransactions' | 'showNarration';

export function ReportOptions({
  prefs,
  onChange,
  options = [],
  detailedToggle = true,
  columns = false,
}: {
  prefs: ReportPrefs;
  onChange: (patch: Partial<ReportPrefs>) => void;
  /** F12 switches this report offers. */
  options?: OptionKey[];
  detailedToggle?: boolean;
  /** Offer comparative columns. */
  columns?: boolean;
}) {
  useT();
  const [open, setOpen] = useState(false);
  const bar = useRef<HTMLDivElement | null>(null);
  const uid = useId();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!bar.current || bar.current.offsetParent === null) return;
      if (e.altKey && e.key === 'F1' && detailedToggle) {
        e.preventDefault();
        onChange({ detailed: !prefs.detailed });
      } else if (e.key === 'F12' && options.length) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    // Capture phase so the report wins over the global Tally keys (F12 = Settings elsewhere).
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [prefs.detailed, onChange, detailedToggle, options.length]);

  // R20-C (Tally keys): Alt+F5 = Alt+F1; Alt+N picks the columns, Alt+C adds the next column set, Alt+D removes them.
  const modes: ColumnMode[] = ['none', 'previous', 'monthly', 'quarterly'];
  const step = modes[Math.min(modes.indexOf(prefs.columns) + 1, modes.length - 1)];
  useReportKeys('report', () => bar.current, {
    'detail.alt': detailedToggle && (() => onChange({ detailed: !prefs.detailed })),
    autoCols: columns && (() => document.getElementById(`${uid}-cols`)?.focus()),
    addCol: columns && (() => onChange({ columns: step })),
    delCol: columns && (() => (prefs.columns === 'none' ? false : onChange({ columns: 'none' }))),
  });

  const labels: Record<OptionKey, string> = {
    showZero: reportsT('optZero'),
    showOpening: reportsT('optOpening'),
    showTransactions: reportsT('optTransactions'),
    showNarration: reportsT('optNarration'),
  };
  const modeLabel: Record<ColumnMode, string> = {
    none: reportsT('colNone'),
    previous: reportsT('colPrevious'),
    monthly: reportsT('colMonthly'),
    quarterly: reportsT('colQuarterly'),
  };

  return (
    <div ref={bar} className={`${books.toolbarGroup} no-print`}>
      {detailedToggle && (
        <button type="button" className={controls.btnOutline} aria-pressed={prefs.detailed} onClick={() => onChange({ detailed: !prefs.detailed })} title="Alt+F1" data-key-row="detail">
          <ListTree size={16} /> {prefs.detailed ? reportsT('condensed') : reportsT('detailed')}
        </button>
      )}
      {columns && (
        <label className={styles.inlineField}>
          <Columns3 size={16} aria-hidden="true" />
          <span className={styles.srOnlyish}>{reportsT('columns')}</span>
          <select id={`${uid}-cols`} className={controls.select} value={prefs.columns} onChange={(e) => onChange({ columns: e.target.value as ColumnMode })} aria-label={reportsT('columns')}>
            {modes.map((m) => (
              <option key={m} value={m}>{modeLabel[m]}</option>
            ))}
          </select>
        </label>
      )}
      {options.length > 0 && (
        <div className={styles.optionsWrap}>
          <button type="button" className={controls.btnOutline} aria-expanded={open} aria-controls={`${uid}-opts`} onClick={() => setOpen((o) => !o)} title="F12">
            <Settings2 size={16} /> {reportsT('configure')}
          </button>
          {open && (
            <fieldset id={`${uid}-opts`} className={styles.optionsPanel}>
              <legend>{reportsT('configureTitle')}</legend>
              {options.map((k) => (
                <label key={k} className={styles.optionRow}>
                  <input type="checkbox" checked={prefs[k]} onChange={(e) => onChange({ [k]: e.target.checked })} />
                  <span>{labels[k]}</span>
                </label>
              ))}
            </fieldset>
          )}
        </div>
      )}
    </div>
  );
}
