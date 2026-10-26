/**
 * R4-C4 / C5, loaded lazily by the notification bell (`ensureTrustAlerts`) once the recycle bin has rows or the edit
 * log is old: purges expired bin entries (after first paint, audited) and warns once per FY when the oldest edit-log
 * entry is older than the 8 financial years the books must be kept (Sec 128(5)) — download an auditor pack before
 * erasing anything. Verify with your CA.
 */
import { registerNotificationProvider, type AppNotification } from '../notifications';
import type { AuditEntry } from '../../types/audit';
import { tlT } from '../../i18n/areas/trade-trust-r4-links';
import { getIndianFY } from '../invoice-number';
import { localDayOf } from '../dates';
import { auditSegments } from '../audit';
import { peekTable } from '../storage';
import { AUDIT_RETENTION_FYS } from '../trade/trade-rules';
import { purgeBin } from './recycle-bin';

/** Pure: FYs between the oldest entry and today (0 = same FY). */
export function fysSince(oldestAt: string, today: string): number {
  const a = getIndianFY(localDayOf(new Date(oldestAt))).startYear;
  const b = getIndianFY(today).startYear;
  return b - a;
}

export function retentionNotice(oldestAt: string | undefined, today: string, at: string): AppNotification[] {
  if (!oldestAt || Number.isNaN(Date.parse(oldestAt))) return [];
  const n = fysSince(oldestAt, today);
  if (n <= AUDIT_RETENTION_FYS) return [];
  const fy = getIndianFY(today).label;
  return [{ id: `audit-retention:${fy}`, severity: 'info', title: tlT('retentionTitle', { n: AUDIT_RETENTION_FYS }), detail: tlT('retentionDetail'), href: '/settings?tab=activity&pack=1', cta: tlT('retentionCta'), at }];
}

let registered = false;
export function registerTrustAlerts(): void {
  if (registered) return;
  registered = true;
  try {
    purgeBin();
  } catch {
    /* the next start tries again */
  }
  registerNotificationProvider((ctx) => {
    const first = auditSegments()[0];
    const oldest = (first ? peekTable<AuditEntry>(first)[0] : peekTable<AuditEntry>('audit_log')[0])?.at;
    return retentionNotice(oldest, localDayOf(ctx.now), ctx.now.toISOString());
  });
}
