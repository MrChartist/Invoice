/**
 * Bell notices for production (R4-A1) and QC hold (R4-A4). Loaded lazily by the notification bell
 * (`ensureProductionAlerts`) only once a production order or a QC godown exists.
 *  - orders past their due date and not completed;
 *  - orders Completed but not Closed for more than 7 days;
 *  - stock waiting in a QC godown for more than `qc_settings.alert_days` (default 3).
 */
import type { ProductionOrder } from '../../types/production-r4';
import type { Godown } from '../../types/stock';
import { registerNotificationProvider, type AppNotification } from '../notifications';
import { getTable } from '../storage';
import { localDayOf, shiftDay } from '../dates';
import { liveStatus, loadOrderDocs, ordersStore, overdueOrders } from './orders';
import { collectEvents, stockDb } from '../inventory';
import { liveTrackingInputs } from '../stock-tracking';
import { loadQcSettings, qcGodowns, qcNotices, qcStock } from './qc';

export const COMPLETED_GRACE_DAYS = 7;

let unregister: (() => void) | null = null;

/** Day the order reached Completed (its "complete" log row, else its last output), or ''. */
export function completedOn(o: Pick<ProductionOrder, 'log'>): string {
  const rows = (o.log ?? []).filter((r) => r.action === 'complete' || r.action === 'output');
  const last = rows[rows.length - 1];
  return last ? localDayOf(new Date(last.at)) : '';
}

/** Pure: the order notices for `today`. */
export function orderNotices(orders: readonly ProductionOrder[], status: (o: ProductionOrder) => string, today: string, at: string): AppNotification[] {
  const out: AppNotification[] = [];
  const late = overdueOrders(orders, status as (o: ProductionOrder) => ProductionOrder['status'], today);
  if (late.length) {
    out.push({
      id: `wo-late:${late.map((o) => o.id).sort().join(',')}`, severity: 'warning',
      title: `${late.length} production order${late.length === 1 ? ' is' : 's are'} past due`,
      detail: late.slice(0, 3).map((o) => `${o.number} (due ${o.due_date})`).join(', '), href: '/manufacturing?tab=orders', cta: 'Open orders', at,
    });
  }
  const limit = shiftDay(today, -COMPLETED_GRACE_DAYS);
  const stale = orders.filter((o) => status(o) === 'completed' && completedOn(o) && completedOn(o) < limit);
  if (stale.length) {
    out.push({
      id: `wo-close:${stale.map((o) => o.id).sort().join(',')}`, severity: 'info',
      title: `${stale.length} completed production order${stale.length === 1 ? '' : 's'} not closed`,
      detail: `Completed more than ${COMPLETED_GRACE_DAYS} days ago: ${stale.slice(0, 3).map((o) => o.number).join(', ')}. Close them so costing is final.`,
      href: '/manufacturing?tab=orders', cta: 'Close', at,
    });
  }
  return out;
}

export function registerProductionAlerts(): void {
  if (unregister) return;
  unregister = registerNotificationProvider((ctx) => {
    const at = ctx.now.toISOString();
    const today = localDayOf(ctx.now);
    const out: AppNotification[] = [];
    const orders = ordersStore.all();
    if (orders.length) {
      const docs = loadOrderDocs();
      out.push(...orderNotices(orders, (o) => liveStatus(o, docs), today, at));
    }
    out.push(...qcCache.notices(today, at));
    return out;
  });
}

/** QC ageing runs the stock engine: cached per day and data version. */
const qcCache = {
  key: '',
  rows: [] as AppNotification[],
  notices(today: string, at: string): AppNotification[] {
    const godowns = qcGodowns(getTable<Godown>('godowns'));
    if (!godowns.length) return [];
    const key = ['stock_transfers', 'receipt_notes', 'purchases', 'manufacturing_vouchers', 'invoices'].map((t) => getTable(t).length).join('|') + `|${today}`;
    if (key === this.key) return this.rows;
    this.key = key;
    const events = collectEvents({ ...liveTrackingInputs(), includeTransfers: true });
    const items = new Map(stockDb.items().map((i) => [i.id, i.name]));
    this.rows = qcNotices(qcStock(events, new Set(godowns.map((g) => g.id)), today), loadQcSettings().alert_days, (id) => items.get(id) ?? 'Item', at);
    return this.rows;
  },
};
