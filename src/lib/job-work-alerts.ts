/**
 * Job-work return clocks in the notification bell (7S, roadmap 7.73). Sec 143: inputs must come back from a job
 * worker within one year and capital goods within three; a challan line still open after its clock is a deemed
 * supply on the day it was sent. The Job work tab already lists these; the bell now shows one notice per level
 * (past the clock / due within 30 days). Loaded by the lazy stock-alerts provider only while a Material Out
 * exists, so first paint is unchanged. Pure apart from `liveJobWorkNotices`.
 */
import type { AppNotification } from './notifications';
import { jobWorkAlerts, liveChallanBalances, type ChallanBalances } from './job-work';
import { s7mT as jwAlertT } from '../i18n/areas/inventory-7s-mini';

const HREF = '/manufacturing?tab=jobwork&jw=clocks';

/** Bell notices from challan balances: one "deemed supply" (critical) and one "due soon" (warning) notice at most. */
export function jobWorkClockNotices(b: ChallanBalances, at: string): AppNotification[] {
  const alerts = jobWorkAlerts(b);
  const out: AppNotification[] = [];
  const expired = alerts.filter((a) => a.level === 'danger');
  const soon = alerts.filter((a) => a.level === 'warning');
  const list = (xs: typeof alerts) => [...new Set(xs.map((a) => a.line.number))];
  if (expired.length) {
    const nums = list(expired);
    out.push({
      id: `jw-clock:expired:${nums.join(',').slice(0, 120)}`,
      severity: 'critical',
      title: jwAlertT('expiredTitle', { n: nums.length }),
      detail: jwAlertT('expiredDetail', { list: nums.slice(0, 3).join(', '), party: expired[0].line.party, date: expired[0].line.deadline }),
      href: HREF,
      cta: jwAlertT('cta'),
      at,
    });
  }
  if (soon.length) {
    const nums = list(soon);
    out.push({
      id: `jw-clock:soon:${nums.join(',').slice(0, 120)}`,
      severity: 'warning',
      title: jwAlertT('soonTitle', { n: nums.length }),
      detail: jwAlertT('soonDetail', { list: nums.slice(0, 3).join(', '), party: soon[0].line.party, date: soon[0].line.deadline }),
      href: HREF,
      cta: jwAlertT('cta'),
      at,
    });
  }
  return out;
}

/** Live notices (today = local day). */
export function liveJobWorkNotices(today: string, at: string): AppNotification[] {
  return jobWorkClockNotices(liveChallanBalances(today), at);
}
