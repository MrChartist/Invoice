/**
 * R3-C5 bell notices (lazy; NotificationBell loads this only once `einvoice_meta` holds an e-Way Bill
 * number): e-Way Bills expiring within 12 hours, and those that expired today. Ids carry the bill
 * numbers, so a snoozed / dismissed notice comes back only when the set changes. `ewayNotices` is pure.
 * Validity is a working paper (Rule 138(10) as understood) — verify with your CA.
 */

import type { EInvoiceMeta } from './einvoice';
import type { InvoiceRecord } from '../types/invoice';
import { buildEwayRows, type EwayRow } from './eway-desk';
import { localDay } from './eway-validity';
import { registerNotificationProvider, type AppNotification } from './notifications';
import { getTable, KEYS } from './storage';
import { dkT } from '../i18n/areas/desks-r3';

/** Warn this many hours before expiry. */
export const EWAY_ALERT_HOURS = 12;

const nums = (rows: readonly EwayRow[]) => rows.slice(0, 3).map((r) => r.ewayNo).join(', ') + (rows.length > 3 ? ` +${rows.length - 3}` : '');

export function ewayNotices(rows: readonly EwayRow[], now: Date): AppNotification[] {
  const out: AppNotification[] = [];
  const at = now.toISOString();
  const soon = rows.filter((r) => r.expiresAt && r.status !== 'expired' && (r.expiresAt.getTime() - now.getTime()) <= EWAY_ALERT_HOURS * 3_600_000);
  const today = localDay(now);
  const expired = rows.filter((r) => r.status === 'expired' && r.expiresAt && localDay(r.expiresAt) === today);
  if (soon.length) {
    out.push({
      id: `eway-soon:${soon.map((r) => r.ewayNo).join('|')}`,
      severity: 'warning',
      title: dkT('ew.nSoon', { n: soon.length, h: EWAY_ALERT_HOURS }),
      detail: `${nums(soon)}. ${dkT('ew.nDetail')}`,
      href: '/gst-reports?tab=eway-desk',
      cta: dkT('ew.nOpen'),
      at,
    });
  }
  if (expired.length) {
    out.push({
      id: `eway-expired:${today}:${expired.map((r) => r.ewayNo).join('|')}`,
      severity: 'critical',
      title: dkT('ew.nExpired', { n: expired.length }),
      detail: `${nums(expired)}. ${dkT('ew.nDetail')}`,
      href: '/gst-reports?tab=eway-desk',
      cta: dkT('ew.nOpen'),
      at,
    });
  }
  return out;
}

let registered = false;

export function registerEwayAlerts(): void {
  if (registered) return;
  registered = true;
  registerNotificationProvider((ctx) => {
    const invoices = ctx.invoices.length ? ctx.invoices : getTable<InvoiceRecord>(KEYS.invoices);
    return ewayNotices(buildEwayRows(getTable<EInvoiceMeta>('einvoice_meta'), invoices, ctx.now), ctx.now);
  });
}
