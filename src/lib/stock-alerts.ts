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
import { getTable } from './storage';
import { liveJobWorkNotices } from './job-work-alerts';

let unregister: (() => void) | null = null;

/** Register the stock provider once; it reads live stock each time the bell refreshes. */
export function registerExpiryAlerts(): void {
  if (unregister) return;
  unregister = registerNotificationProvider((ctx) => {
    const today = localDayOf(ctx.now);
    const at = ctx.now.toISOString();
    const items = stockDb.items().filter((i) => i.track_stock);
    const out = [];
    if (items.some((i) => i.track_batches)) {
      const days = loadSettings().expiryAlertDays ?? DEFAULT_EXPIRY_ALERT_DAYS;
      out.push(...expiryNotices(expiringBatches(loadTracking(), today, days), today, days, at));
    }
    if (items.some((i) => num(i.reorder_level) > 0 || Object.values(i.reorder_by_godown ?? {}).some((v) => num(v) > 0))) {
      out.push(...reorderNotices(loadReorderStatus(), at));
    }
    // 7S: Sec 143 return clocks (deemed supply / due soon) while any Material Out exists.
    if (getTable('job_work_out').length) out.push(...liveJobWorkNotices(today, at));
    return out;
  });
}
