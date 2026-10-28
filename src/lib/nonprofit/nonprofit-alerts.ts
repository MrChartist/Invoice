/**
 * R5-C3 non-profit notices: the last FY's Form 10BD (Form 113 from FY 2026-27) due — from 1 May until marked filed;
 * Form 10BE certificates not sent after their due date; 80G / 12AB approval expiring within 60 days (or expired).
 */
import type { Donation, Form10bdFiling, Form10beRow, NpoProfile } from '../../types/institutions-r5';
import { daysFrom } from '../institutions/r5c';
import { fyOf } from './donations';
import { due10bd, pending10be } from './form-10bd';

export interface NpoNotice {
  id: string;
  kind: '10bd' | '10be' | 'expiry';
  fy?: number;
  date: string;
  days: number;
  count?: number;
  what?: '80G' | '12AB';
}

export function npoNotices(donations: readonly Donation[], filings: readonly Form10bdFiling[], be: readonly Form10beRow[], npo: NpoProfile | undefined, today: string): NpoNotice[] {
  const out: NpoNotice[] = [];
  const fy = fyOf(today) - 1;
  const due = due10bd(fy);
  const filing = filings.find((f) => f.fy === fy);
  const reportable = donations.some((d) => !d.cancelled && d.section !== 'none' && fyOf(d.date) === fy);
  if (reportable && !filing?.filed_on && today >= `${fy + 1}-05-01`) out.push({ id: `10bd:${fy}`, kind: '10bd', fy, date: due.bd, days: daysFrom(today, due.bd) });
  const pend = filing?.filed_on && today > due.be ? pending10be(filing, be) : [];
  if (pend.length) out.push({ id: `10be:${fy}:${pend.length}`, kind: '10be', fy, date: due.be, days: daysFrom(today, due.be), count: pend.length });
  for (const [what, to] of [['80G', npo?.urn_80g_valid_to], ['12AB', npo?.reg_12ab_valid_to]] as const) {
    if (to && daysFrom(today, to) <= 60) out.push({ id: `exp:${what}:${to}`, kind: 'expiry', what, date: to, days: daysFrom(today, to) });
  }
  return out;
}
