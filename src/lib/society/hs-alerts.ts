/**
 * R18-D3 audit notices for the notification bell (loaded lazily by the bell's `society` gate; it registers
 * `hsNotices`, which re-checks the pack on every run). A FY's audit not yet reported is announced from 30 days before
 * its due date (critical from 7 days and once overdue). Working papers — verify with your CA (HS31).
 */
import { hsdT } from '../../i18n/areas/society-r18d';
import type { AppNotification, NotificationContext } from '../notifications';
import type { SocietySettings } from '../../types/society-r18';
import { DB_PREFIX, getJson } from '../storage';
import { localDayOf } from '../dates';
import { localDb } from '../localDb';
import { stateRuleAt } from '../society-rules';
import { HS_OBJECTS } from './hs-shared';
import { auditDue, auditStatus } from './hs-registers';

export function hsAlerts(today: string, s: SocietySettings): Omit<AppNotification, 'at'>[] {
  const months = stateRuleAt(s.state, today, s.confirmed)?.value.audit_due_months ?? null;
  return (s.audit ?? []).flatMap((a) => {
    const due = auditDue(a, months), st = auditStatus(a, due, today);
    if (st.code !== 'sOver' && !(st.code === 'sDue' && st.n! <= 30)) return [];
    return [{ id: `hs:audit:${a.fy}:${st.code === 'sOver' ? 'x' : st.n! <= 7 ? 7 : 30}`, severity: st.code === 'sOver' || st.n! <= 7 ? 'critical' : 'warning', title: hsdT('aTitle', { fy: a.fy, d: due }), detail: st.code === 'sOver' ? hsdT('sOver') : hsdT('sDue', { n: st.n! }), href: '/recurring?tab=society&view=registers', cta: hsdT('aOpen') }];
  });
}

/** The bell provider (registered by the bell's `society` gate). */
export function hsNotices(ctx: Pick<NotificationContext, 'now'>): AppNotification[] {
  const p = (localDb.settings.get() as { industry_packs?: unknown }).industry_packs;
  if (!Array.isArray(p) || !p.includes('society')) return [];
  const at = ctx.now.toISOString();
  return hsAlerts(localDayOf(ctx.now), getJson<SocietySettings | null>(`${DB_PREFIX}${HS_OBJECTS.settings}`, null) ?? {}).map((a) => ({ ...a, at }));
}
