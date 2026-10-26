/**
 * Bell notices for production (R4-A1) and QC hold (R4-A4). Loaded lazily by the notification bell
 * (`ensureProductionAlerts`) only once a production order or a QC godown exists.
 *  - orders past their due date and not completed;
 *  - orders Completed but not Closed for more than 7 days;
 *  - stock waiting in a QC godown for more than `qc_settings.alert_days` (default 3).
 *
 * This module imports almost nothing statically, so the bell's lazy chunk stays tiny; the order and stock engines load
 * on the first refresh (their own chunks) and the notices are cached until the data changes.
 */
import type { ProductionOrder } from '../../types/production-r4';
import { registerNotificationProvider, type AppNotification } from '../notifications';
import { peekTable } from '../storage';
import { localDayOf, shiftDay } from '../dates';

export const COMPLETED_GRACE_DAYS = 7;

let unregister: (() => void) | null = null;
let cacheKey = '';
let cached: AppNotification[] = [];
let running = false;

/** Day the order reached Completed (its "complete" log row, else its last output), or ''. */
export function completedOn(o: Pick<ProductionOrder, 'log'>): string {
  const rows = (o.log ?? []).filter((r) => r.action === 'complete' || r.action === 'output');
  const last = rows[rows.length - 1];
  return last ? localDayOf(new Date(last.at)) : '';
}

/** Pure: the order notices for `today` (`status` = the live status of an order). */
export function orderNotices(orders: readonly ProductionOrder[], status: (o: ProductionOrder) => string, today: string, at: string): AppNotification[] {
  const out: AppNotification[] = [];
  const late = orders.filter((o) => {
    const s = status(o);
    return !!o.due_date && o.due_date < today && (s === 'planned' || s === 'released' || s === 'in_progress');
  });
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

const TABLES = ['production_orders', 'godowns', 'stock_transfers', 'manufacturing_vouchers', 'stock_journals', 'receipt_notes', 'purchases', 'invoices'];

async function refresh(now: Date, onChange?: () => void): Promise<void> {
  running = true;
  try {
    const [orders, qc, inv, st] = await Promise.all([import('./orders'), import('./qc'), import('../inventory'), import('../stock-tracking')]);
    const at = now.toISOString();
    const today = localDayOf(now);
    const list = orders.ordersStore.all();
    const docs = orders.loadOrderDocs();
    const out = orderNotices(list, (o) => orders.liveStatus(o, docs), today, at);
    const qcIds = new Set(qc.qcGodowns(peekTable('godowns')).map((g) => g.id));
    if (qcIds.size) {
      const events = inv.collectEvents({ ...st.liveTrackingInputs(), includeTransfers: true });
      const names = new Map(inv.stockDb.items().map((i) => [i.id, i.name]));
      out.push(...qc.qcNotices(qc.qcStock(events, qcIds, today), qc.loadQcSettings().alert_days, (id) => names.get(id) ?? 'Item', at));
    }
    const changed = JSON.stringify(out.map((n) => n.id)) !== JSON.stringify(cached.map((n) => n.id));
    cached = out;
    if (changed) onChange?.();
  } catch {
    /* a failed refresh keeps the last notices */
  } finally {
    running = false;
  }
}

export function registerProductionAlerts(onChange?: () => void): void {
  if (unregister) return;
  unregister = registerNotificationProvider((ctx) => {
    const key = `${localDayOf(ctx.now)}|${TABLES.map((t) => peekTable(t).length).join('|')}|${peekTable<{ updated_at?: string }>('production_orders').map((o) => o.updated_at ?? '').join(',')}`;
    if (key !== cacheKey && !running) {
      cacheKey = key;
      void refresh(ctx.now, onChange);
    }
    return cached;
  });
}
