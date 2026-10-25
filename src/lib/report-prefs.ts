/**
 * Per-report display options (WP-2, P1-3 — Tally F12 "Configure", Alt+F1 detailed / condensed,
 * Alt+C columns). Device-local (`mrchartist_report_prefs` in localStorage, never backed up): these
 * are viewing preferences, not company data. Fail-soft: no storage = defaults.
 */

import type { ColumnMode } from './ledger/columns';

export interface ReportPrefs {
  /** Alt+F1: expand sub-groups and ledgers. */
  detailed: boolean;
  /** Show rows with no balance and no movement. */
  showZero: boolean;
  /** Opening-balance column. */
  showOpening: boolean;
  /** Debit / credit (transactions) columns. */
  showTransactions: boolean;
  /** Narration under each voucher row. */
  showNarration: boolean;
  /** Comparative columns. */
  columns: ColumnMode;
}

export const DEFAULT_REPORT_PREFS: ReportPrefs = {
  detailed: false,
  showZero: false,
  showOpening: true,
  showTransactions: true,
  showNarration: true,
  columns: 'none',
};

export const REPORT_PREFS_KEY = 'mrchartist_report_prefs';
const COLUMN_MODES: readonly ColumnMode[] = ['none', 'previous', 'monthly', 'quarterly'];

export function normalizeReportPrefs(raw: unknown, base: ReportPrefs = DEFAULT_REPORT_PREFS): ReportPrefs {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const b = (k: keyof ReportPrefs) => (typeof o[k] === 'boolean' ? (o[k] as boolean) : (base[k] as boolean));
  return {
    detailed: b('detailed'),
    showZero: b('showZero'),
    showOpening: b('showOpening'),
    showTransactions: b('showTransactions'),
    showNarration: b('showNarration'),
    columns: COLUMN_MODES.includes(o.columns as ColumnMode) ? (o.columns as ColumnMode) : base.columns,
  };
}

function readAll(): Record<string, unknown> {
  try {
    const s = globalThis.localStorage?.getItem(REPORT_PREFS_KEY);
    const v = s ? JSON.parse(s) : {};
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

export function getReportPrefs(reportId: string, defaults: Partial<ReportPrefs> = {}): ReportPrefs {
  return normalizeReportPrefs(readAll()[reportId], { ...DEFAULT_REPORT_PREFS, ...defaults });
}

export function setReportPrefs(reportId: string, prefs: ReportPrefs): ReportPrefs {
  const clean = normalizeReportPrefs(prefs);
  try {
    globalThis.localStorage?.setItem(REPORT_PREFS_KEY, JSON.stringify({ ...readAll(), [reportId]: clean }));
  } catch {
    /* remembered for this render only */
  }
  return clean;
}

/** 8.109 saved views: every report's options at once (snapshot / restore). */
export function getAllReportPrefs(): Record<string, ReportPrefs> {
  const all = readAll();
  return Object.fromEntries(Object.keys(all).map((k) => [k, normalizeReportPrefs(all[k])]));
}

export function setAllReportPrefs(map: Record<string, unknown>): void {
  const clean = Object.fromEntries(Object.entries(map ?? {}).slice(0, 60).map(([k, v]) => [k.slice(0, 40), normalizeReportPrefs(v)]));
  try {
    globalThis.localStorage?.setItem(REPORT_PREFS_KEY, JSON.stringify({ ...readAll(), ...clean }));
  } catch {
    /* remembered for this render only */
  }
}
