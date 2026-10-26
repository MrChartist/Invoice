/**
 * Bell notices for transfer requests (R4-B4). Loaded lazily by the notification bell (`ensureTransferAlerts`) only once
 * a transfer request exists: goods in transit for more than 3 days, requests past their needed-by date.
 */
import { registerNotificationProvider, type AppNotification } from '../notifications';
import { localDayOf } from '../dates';
import { memoOnTables } from '../table-memo';
import { loadRequestDocs, requestsStore, transferNotices } from './transfer-requests';

export const TRANSIT_ALERT_DAYS = 3;
let unregister: (() => void) | null = null;

export function registerTransferAlerts(): void {
  if (unregister) return;
  unregister = registerNotificationProvider((ctx) => {
    const today = localDayOf(ctx.now);
    const at = ctx.now.toISOString();
    return memoOnTables('r4b:transfer-alerts', ['transfer_requests', 'stock_transfers', 'stock_journals'], () =>
      transferNotices(requestsStore.all(), loadRequestDocs(), today, TRANSIT_ALERT_DAYS, at) as AppNotification[], today) as AppNotification[];
  });
}
