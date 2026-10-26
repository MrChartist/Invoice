/**
 * R3-C6 bell notices for the open company's DSC register (lazy; NotificationBell loads this only once
 * `dsc_register` has rows): certificates expiring within 30 days, within 7 days, or already expired
 * (for 30 days after). Ids carry the certificate ids + stage so snooze / dismiss follow the usual rules.
 */

import { dscStatus, daysToExpiry, DSC_WARN_DAYS, dscDb, type DscRow } from './dsc-register';
import { registerNotificationProvider, type AppNotification } from './notifications';
import { localDay } from './eway-validity';
import { dkT } from '../i18n/areas/desks-r3';

export function dscNotices(rows: readonly DscRow[], today: string, at: string): AppNotification[] {
  const out: AppNotification[] = [];
  const stage = (s: 'expired' | 'urgent' | 'soon', severity: AppNotification['severity'], title: (n: number) => string) => {
    const list = rows.filter((r) => dscStatus(r, today) === s && daysToExpiry(r, today) >= -DSC_WARN_DAYS[0]);
    if (!list.length) return;
    out.push({
      id: `dsc-${s}:${list.map((r) => r.id).join('|')}`,
      severity,
      title: title(list.length),
      detail: list.slice(0, 3).map((r) => dkT('dsc.nLine', { holder: r.holder, date: r.valid_to })).join('; ') + (list.length > 3 ? ` +${list.length - 3}` : ''),
      href: '/practice',
      cta: dkT('dsc.nOpen'),
      at,
    });
  };
  stage('expired', 'critical', (n) => dkT('dsc.nExpired', { n }));
  stage('urgent', 'critical', (n) => dkT('dsc.nUrgent', { n, d: DSC_WARN_DAYS[1] }));
  stage('soon', 'warning', (n) => dkT('dsc.nSoon', { n, d: DSC_WARN_DAYS[0] }));
  return out;
}

let registered = false;

export function registerDscAlerts(): void {
  if (registered) return;
  registered = true;
  registerNotificationProvider((ctx) => dscNotices(dscDb.all(), localDay(ctx.now), ctx.now.toISOString()));
}
