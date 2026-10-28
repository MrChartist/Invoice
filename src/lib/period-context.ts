/**
 * Shared report period (WP-2, P1-26 — Tally's "Period" button, Alt+F2): one current period used by
 * every ledger report on this device. Device-local (`mrchartist_report_period` in localStorage, not
 * under the `mrchartist_inv_` prefix, so it is never in a backup or synced); presets are re-resolved
 * against today on read, so "This FY" rolls over on 1 April by itself.
 *
 *   const { preset, period } = usePeriodContext();   setPeriodContext('custom', { start, end });
 *
 * Pure apart from localStorage (fail-soft: no storage = the default "This FY").
 */

import { useSyncExternalStore } from 'react';
import { periodForPreset, type Period, type PeriodPreset } from './books';

export const PERIOD_CONTEXT_KEY = 'mrchartist_report_period';

export interface PeriodContext {
  preset: PeriodPreset;
  period: Period;
}

const PRESETS: readonly PeriodPreset[] = ['this_month', 'last_month', 'this_quarter', 'this_fy', 'last_fy', 'mtd', 'qtd', 'ytd', 'custom'];
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Validate a stored / typed value; anything odd falls back to This FY. */
export function normalizePeriodContext(raw: unknown, today: Date = new Date()): PeriodContext {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const preset = PRESETS.includes(o.preset as PeriodPreset) ? (o.preset as PeriodPreset) : 'this_fy';
  if (preset !== 'custom') return { preset, period: periodForPreset(preset, today) };
  const p = (o.period && typeof o.period === 'object' ? o.period : {}) as Record<string, unknown>;
  const start = typeof p.start === 'string' && ISO.test(p.start) ? p.start : '';
  const end = typeof p.end === 'string' && ISO.test(p.end) ? p.end : '';
  if (!start || !end || start > end) return { preset: 'this_fy', period: periodForPreset('this_fy', today) };
  return { preset, period: { start, end } };
}

let current: PeriodContext | null = null;
const listeners = new Set<() => void>();

function read(): PeriodContext {
  if (current) return current;
  const raw = (() => {
    try {
      const s = globalThis.localStorage?.getItem(PERIOD_CONTEXT_KEY);
      return s ? (JSON.parse(s) as unknown) : null;
    } catch {
      return null;
    }
  })();
  current = normalizePeriodContext(raw);
  return current;
}

export function getPeriodContext(): PeriodContext {
  return read();
}

export function setPeriodContext(preset: PeriodPreset, period?: Period): PeriodContext {
  const next = normalizePeriodContext({ preset, period: period ?? read().period });
  current = next;
  try {
    globalThis.localStorage?.setItem(PERIOD_CONTEXT_KEY, JSON.stringify(next));
  } catch {
    /* private mode: the period still applies for this session */
  }
  for (const l of listeners) l();
  return next;
}

export function subscribePeriodContext(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Test hook: forget the cached value (re-read storage next time). */
export function resetPeriodContextForTests(): void {
  current = null;
}

/**
 * PENDING 36 (GAP P1-26): set the shared period from a plain date range picked on another screen (GST reports,
 * Inventory). A range equal to a rolling preset (this / last month, this quarter, this / last FY) keeps that preset,
 * so it still rolls over; anything else is stored as custom.
 */
export function setPeriodRange(period: Period, today: Date = new Date()): PeriodContext {
  const cur = read();
  if (cur.period.start === period.start && cur.period.end === period.end) return cur;
  const preset = (['this_month', 'last_month', 'this_quarter', 'this_fy', 'last_fy'] as const).find((p) => {
    const r = periodForPreset(p, today);
    return r.start === period.start && r.end === period.end;
  });
  return preset ? setPeriodContext(preset) : setPeriodContext('custom', period);
}

/** React binding: re-renders when any screen changes the period. */
export function usePeriodContext(): PeriodContext {
  return useSyncExternalStore(subscribePeriodContext, getPeriodContext, getPeriodContext);
}
