/**
 * Bell notices for the works-contract pack (R5-B5), loaded lazily by the notification bell only with the pack on; the
 * provider re-checks the pack on every run: retention whose release day is within 30 days or has passed and is not
 * received yet.
 */
import type { InvoiceRecord, Payment } from '../../types/invoice';
import { registerNotificationProvider, type AppNotification } from '../notifications';
import { localDayOf, shiftDay } from '../dates';
import { memoOnTables } from '../table-memo';
import { peekTable } from '../storage';
import { localDb } from '../localDb';
import { isPackOn } from '../industry-packs';
import { num, round2 } from '../invoice-calc';
import { raDueSplit } from './ra-due';

export const RETENTION_ALERT_DAYS = 30;

type Pay = Pick<Payment, 'id' | 'invoice_id' | 'amount' | 'ra_kind' | 'advance_id'>;

export interface HeldRow {
  invoice: InvoiceRecord;
  kind: string;
  label: string;
  amount: number;
  release_on?: string;
}

/** Every held bucket of live RA bills (the "Retention & held" sub-view), release day first. */
export function heldRegister(invoices: readonly InvoiceRecord[], payments: readonly Pay[]): HeldRow[] {
  const out: HeldRow[] = [];
  for (const inv of invoices) {
    if (!inv.ra_deductions?.length || inv.status === 'Cancelled' || inv.status === 'Draft') continue;
    const mine = payments.filter((p) => p.invoice_id === inv.id);
    const paid = mine.reduce((s, p) => s + num(p.amount), 0);
    const outstanding = round2(num(inv.ra_net_payable) + (inv.ra_deductions ?? []).filter((d) => d.kind !== 'it_tds').reduce((s, d) => s + d.amount, 0) - paid);
    for (const h of raDueSplit(inv, mine, outstanding).held) out.push({ invoice: inv, ...h });
  }
  return out.sort((a, b) => (a.release_on ?? '9999').localeCompare(b.release_on ?? '9999'));
}

let unregister: (() => void) | null = null;

export function worksNotices(invoices: readonly InvoiceRecord[], payments: readonly Payment[], today: string, at: string): AppNotification[] {
  const horizon = shiftDay(today, RETENTION_ALERT_DAYS);
  return heldRegister(invoices, payments)
    .filter((h) => h.kind === 'retention' && h.release_on && h.release_on <= horizon)
    .map((h) => ({
      id: `tw:ret:${h.invoice.id}:${h.release_on}`,
      severity: h.release_on! < today ? 'warning' as const : 'info' as const,
      title: `Retention ₹${h.amount.toFixed(2)} on ${h.invoice.invoice_number} ${h.release_on! < today ? 'was due' : 'falls due'} ${h.release_on}`,
      detail: `${h.invoice.client?.name ?? ''}: ask for the release after the defect-liability period and record it in Works → Retention.`,
      href: '/time?tab=works&view=retention',
      cta: 'Open retention',
      at,
    }));
}

export function registerWorksAlerts(): void {
  if (unregister) return;
  unregister = registerNotificationProvider((ctx) => {
    if (!isPackOn(localDb.settings.get(), 'works')) return [];
    const today = localDayOf(ctx.now);
    return memoOnTables('r5b:works-alerts', ['invoices', 'transactions'], () => worksNotices(peekTable<InvoiceRecord>('invoices'), peekTable<Payment>('transactions'), today, ctx.now.toISOString()), today) as AppNotification[];
  });
}

// Loading this chunk registers the provider (the bell's gate only imports it).
registerWorksAlerts();
