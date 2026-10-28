/**
 * Stock alerts in the notification bell: batch expiry (6.6), reorder levels (Phase 7) and job-work return clocks
 * (7S). Loaded on demand by the bell, and only when some stock item tracks batches or has a reorder level, or a
 * job-work challan exists, so the
 * stock engine stays out of the shell / notifications chunk.
 */

import { registerNotificationProvider } from './notifications';
import { DEFAULT_EXPIRY_ALERT_DAYS, loadSettings, stockDb } from './inventory';
import { expiringBatches, expiryNotices, loadTracking } from './stock-tracking';
import { loadReorderStatus, reorderNotices } from './reorder';
import { localDayOf } from './dates';
import { num } from './invoice-calc';
import { peekTable } from './storage';
import { memoOnReads } from './table-memo';
import { liveJobWorkNotices } from './job-work-alerts';

let unregister: (() => void) | null = null;

/**
 * Register the stock provider once; it reads live stock each time the bell refreshes. PERF-1: the
 * stock engine's results are memoised on the keys they read, so an unchanged stock picture costs
 * lookups only; the notices themselves are rebuilt each time (they carry the refresh time).
 */
export function registerExpiryAlerts(): void {
  if (unregister) return;
  unregister = registerNotificationProvider((ctx) => {
    const today = localDayOf(ctx.now);
    const at = ctx.now.toISOString();
    const items = stockDb.items().filter((i) => i.track_stock);
    const out = [];
    if (items.some((i) => i.track_batches)) {
      const days = loadSettings().expiryAlertDays ?? DEFAULT_EXPIRY_ALERT_DAYS;
      const rows = memoOnReads('stock-alerts:expiring', () => expiringBatches(loadTracking(), today, days), `${today}|${days}`);
      out.push(...expiryNotices(rows, today, days, at));
    }
    if (items.some((i) => num(i.reorder_level) > 0 || Object.values(i.reorder_by_godown ?? {}).some((v) => num(v) > 0))) {
      out.push(...reorderNotices(loadReorderStatus(), at));
    }
    // 7S: Sec 143 return clocks (deemed supply / due soon) while any Material Out exists.
    if (peekTable('job_work_out').length) out.push(...liveJobWorkNotices(today, at));
    return out;
  });
}
