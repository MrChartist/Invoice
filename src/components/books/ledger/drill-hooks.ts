/**
 * Drill-down plumbing shared by DrillStack and the report screens (WP-2): the stack context, the
 * `useDrill()` API, keyboard row navigation (`useDrillRows`) and per-report options (`useReportPrefs`).
 * Kept apart from the components so React Fast Refresh stays happy.
 */
import { createContext, useCallback, useContext, useEffect, useId, useState, type ReactNode } from 'react';
import { getReportPrefs, setReportPrefs, type ReportPrefs } from '../../../lib/report-prefs';
import styles from './ledger.module.css';

export interface DrillFrame {
  /** Unique within the stack (re-pushing the same key replaces nothing; it is a new level). */
  key: string;
  title: string;
  render: () => ReactNode;
}

export interface DrillEntry {
  frame: DrillFrame;
  selected: number;
  scrollY: number;
}

export interface DrillApi {
  push(frame: DrillFrame): void;
  /** Back one level (Esc). */
  pop(): void;
  /** Back to level `depth` (0 = the root report). */
  popTo(depth: number): void;
  depth: number;
  /** Selected row of the CURRENT frame (kept when the user comes back with Esc). */
  selected: number;
  setSelected(i: number): void;
}

export const DrillContext = createContext<DrillApi | null>(null);

/** Inside a DrillStack: the stack API. Outside one: a no-op API, so views render standalone too. */
export function useDrill(): DrillApi {
  const ctx = useContext(DrillContext);
  const [selected, setSelected] = useState(0);
  return ctx ?? { push: () => {}, pop: () => {}, popTo: () => {}, depth: 0, selected, setSelected };
}

export const typing = (el: EventTarget | null) => {
  const t = el as HTMLElement | null;
  return !!t && (t.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName));
};
export const dialogOpen = () => typeof document !== 'undefined' && !!document.querySelector('[role="dialog"], [role="alertdialog"]');

/**
 * Keyboard row navigation for a report table (↑ ↓ Home End PgUp PgDn, Enter drills). The selection
 * lives in the DrillStack, so Esc back lands on the same row.
 */
export function useDrillRows(count: number, onActivate: (index: number) => void) {
  const { selected, setSelected } = useDrill();
  // The row container is found by id (no ref object, so callers may pass `nav` around during render).
  const bodyId = useId();
  const sel = Math.min(Math.max(selected, 0), Math.max(count - 1, 0));

  useEffect(() => {
    const el = document.getElementById(bodyId)?.querySelector<HTMLElement>('[data-selected="true"]');
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [sel, bodyId]);

  // Focus the table when it appears so the keys work at once (no scroll jump).
  useEffect(() => {
    const t = document.getElementById(bodyId)?.closest<HTMLElement>('[tabindex]');
    if (t && !typing(document.activeElement) && !dialogOpen()) t.focus({ preventScroll: true });
  }, [bodyId]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (typing(e.target) || !count) return;
    const page = 10;
    const map: Record<string, number> = {
      ArrowDown: Math.min(sel + 1, count - 1),
      ArrowUp: Math.max(sel - 1, 0),
      Home: 0,
      End: count - 1,
      PageDown: Math.min(sel + page, count - 1),
      PageUp: Math.max(sel - page, 0),
    };
    if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'BUTTON' && (e.target as HTMLElement).tagName !== 'A') {
      e.preventDefault();
      onActivate(sel);
      return;
    }
    if (map[e.key] === undefined) return;
    e.preventDefault();
    setSelected(map[e.key]);
  };

  return {
    table: { tabIndex: 0, onKeyDown },
    bodyId,
    row: (i: number) => ({
      'data-selected': i === sel ? 'true' : undefined,
      className: i === sel ? styles.rowSel : undefined,
      onClick: (e: React.MouseEvent) => {
        setSelected(i);
        if ((e.target as HTMLElement).closest('a, button')) return;
        onActivate(i);
      },
    }),
    selected: sel,
  };
}

/** Per-report display options remembered on this device (F12 / Alt+F1 / columns). */
export function useReportPrefs(reportId: string, defaults: Partial<ReportPrefs> = {}): [ReportPrefs, (patch: Partial<ReportPrefs>) => void] {
  const [prefs, setPrefs] = useState<ReportPrefs>(() => getReportPrefs(reportId, defaults));
  const update = useCallback(
    (patch: Partial<ReportPrefs>) => setPrefs((p) => setReportPrefs(reportId, { ...p, ...patch })),
    [reportId],
  );
  return [prefs, update];
}
