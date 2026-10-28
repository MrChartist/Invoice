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
import { getPeriodContext, subscribePeriodContext, type PeriodContext } from './books';

// The store itself lives in books.ts (PENDING 36: GST reports and Inventory share it without a new chunk name in the
// entry's preload map); this module keeps the React binding and re-exports the store.
export { PERIOD_CONTEXT_KEY, getPeriodContext, normalizePeriodContext, resetPeriodContextForTests, setPeriodContext, setPeriodRange, subscribePeriodContext, type PeriodContext } from './books';

/** React binding: re-renders when any screen changes the period. */
export function usePeriodContext(): PeriodContext {
  return useSyncExternalStore(subscribePeriodContext, getPeriodContext, getPeriodContext);
}
