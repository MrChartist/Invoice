/**
 * Expiry alerts in the notification bell (6.6). Loaded on demand by the bell, and only when some
 * stock item tracks batches, so the stock engine stays out of the shell / notifications chunk.
 */

import { registerNotificationProvider } from './notifications';
import { DEFAULT_EXPIRY_ALERT_DAYS, loadSettings } from './inventory';
import { expiringBatches, expiryNotices, loadTracking } from './stock-tracking';
import { localDayOf } from './dates';

let unregister: (() => void) | null = null;

/** Register the expiry provider once; it reads live stock each time the bell refreshes. */
export function registerExpiryAlerts(): void {
  if (unregister) return;
  unregister = registerNotificationProvider((ctx) => {
    const today = localDayOf(ctx.now);
    const days = loadSettings().expiryAlertDays ?? DEFAULT_EXPIRY_ALERT_DAYS;
    return expiryNotices(expiringBatches(loadTracking(), today, days), today, days, ctx.now.toISOString());
  });
}
