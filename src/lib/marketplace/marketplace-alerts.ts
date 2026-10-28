/**
 * Bell notices for the marketplace pack (R5-A4.8 / A6.3). Loaded lazily by the notification bell
 * (`ensureMarketplaceAlerts`) only once the pack is on and a channel exists; the provider re-checks the pack on every
 * run, so turning the pack off silences it (nothing is deleted).
 *  - orders unsettled past the channel's payout cycle (+ 7 days);
 *  - settlements imported but not posted for 7 days;
 *  - a non-zero clearing balance at the last month end;
 *  - returns pending receipt beyond 15 days; claim windows closing in ≤ 3 days.
 */
import { registerNotificationProvider, type AppNotification } from '../notifications';
import { localDayOf, shiftDay } from '../dates';
import { memoOnTables } from '../table-memo';
import { peekTable } from '../storage';
import { localDb } from '../localDb';
import { isPackOn } from '../industry-packs';
import type { InvoiceRecord } from '../../types/invoice';
import { loadChannels, CHANNELS_TABLE, SETTLEMENTS_TABLE, MARKETPLACE_RETURNS_TABLE } from './channels';
import { loadSettlements } from './settlement-import';
import { reconcileOrders } from './settlement-recon';
import { clearingBalance } from './settlement-post';
import { deskAlerts, loadReturns } from './returns-desk';

const HREF = '/receivables?tab=marketplace';
let unregister: (() => void) | null = null;

export function marketplaceNotices(today: string, at: string): AppNotification[] {
  const channels = loadChannels().filter((c) => c.active);
  if (!channels.length) return [];
  const out: AppNotification[] = [];
  const settlements = loadSettlements();
  const invoices = peekTable<InvoiceRecord>('invoices');
  const prevMonthEnd = shiftDay(`${today.slice(0, 7)}-01`, -1);
  for (const c of channels) {
    const unsettled = reconcileOrders(c, invoices, settlements, { today }).filter((r) => r.status === 'unsettled');
    if (unsettled.length) out.push({ id: `mkt:unsettled:${c.id}:${unsettled.length}`, severity: 'warning', title: `${c.name}: ${unsettled.length} order(s) not settled`, detail: 'Past the payout cycle with no settlement line. Check the settlement files or raise it with the marketplace.', href: `${HREF}&view=settlements`, cta: 'Open settlements', at });
    const stale = settlements.filter((s) => s.channel_id === c.id && !s.posted && shiftDay(s.deposit_date, 7) < today);
    if (stale.length) out.push({ id: `mkt:unposted:${c.id}:${stale.length}`, severity: 'info', title: `${c.name}: ${stale.length} settlement(s) not posted`, detail: 'Imported more than 7 days ago. Post them so receipts, fees and the payout reach the books.', href: `${HREF}&view=settlements`, cta: 'Post', at });
    const bal = c.clearing_bank_id ? clearingBalance(c.clearing_bank_id, prevMonthEnd) : 0;
    if (Math.abs(bal) >= 0.01) out.push({ id: `mkt:clearing:${c.id}:${prevMonthEnd}`, severity: 'warning', title: `${c.name} clearing is ₹${bal.toFixed(2)} at ${prevMonthEnd}`, detail: 'A fully posted settlement leaves the clearing account at zero. Find the unposted or unmatched settlement.', href: `${HREF}&view=settlements`, cta: 'Reconcile', at });
  }
  const { overdue, closing } = deskAlerts(loadReturns(), channels, today);
  if (overdue.length) out.push({ id: `mkt:returns:${overdue.length}`, severity: 'warning', title: `${overdue.length} return(s) not received for 15+ days`, detail: 'Chase the courier / marketplace, or raise a claim before the window closes.', href: `${HREF}&view=returns`, cta: 'Open returns', at });
  for (const { row, deadline } of closing) out.push({ id: `mkt:claim:${row.id}`, severity: 'critical', title: `Claim window closes ${deadline}`, detail: `Order ${row.order_id}: raise the claim on the seller portal.`, href: `${HREF}&view=returns`, cta: 'Open returns', at });
  return out;
}

export function registerMarketplaceAlerts(): void {
  if (unregister) return;
  unregister = registerNotificationProvider((ctx) => {
    if (!isPackOn(localDb.settings.get(), 'marketplace')) return [];
    const today = localDayOf(ctx.now);
    const at = ctx.now.toISOString();
    return memoOnTables('r5a:marketplace-alerts', [CHANNELS_TABLE, SETTLEMENTS_TABLE, MARKETPLACE_RETURNS_TABLE, 'invoices', 'transactions', 'vouchers'], () => marketplaceNotices(today, at), today) as AppNotification[];
  });
}
