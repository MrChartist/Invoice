/**
 * R5-C5 lease notices: escalation in the next 30 days ("rent goes from ₹x to ₹y on date"), lock-in ending in 30 days,
 * lease expiring in 60 / 30 days, and a 194-I Form 16A overdue for a quarter (from the TDS register, lease documents only).
 */
import type { InvoiceRecord } from '../../types/invoice';
import type { Lease } from '../../types/institutions-r5';
import type { TdsCertificate } from '../tds-register';
import { buildTdsRegister } from '../tds-register';
import { daysFrom } from '../institutions/r5c';
import { nextEscalation } from './escalation';

export interface LeaseNotice {
  id: string;
  kind: 'escalation' | 'lockin' | 'expiry' | 'cert';
  lease?: Lease;
  date: string;
  from?: number;
  to?: number;
  days: number;
  count?: number;
}

export function leaseNotices(leases: readonly Lease[], invoices: readonly InvoiceRecord[], certificates: readonly TdsCertificate[], today: string): LeaseNotice[] {
  const out: LeaseNotice[] = [];
  for (const l of leases) {
    if (l.status !== 'active') continue;
    const n = nextEscalation(l.rent, l.escalation, l.start, today);
    if (n && daysFrom(today, n.date) <= 30) out.push({ id: `esc:${l.id}:${n.date}`, kind: 'escalation', lease: l, date: n.date, from: n.from, to: n.to, days: daysFrom(today, n.date) });
    if (l.lock_in_end && l.lock_in_end >= today && daysFrom(today, l.lock_in_end) <= 30) out.push({ id: `lock:${l.id}`, kind: 'lockin', lease: l, date: l.lock_in_end, days: daysFrom(today, l.lock_in_end) });
    const left = daysFrom(today, l.end);
    if (left >= 0 && left <= 60) out.push({ id: `end:${l.id}:${left <= 30 ? 30 : 60}`, kind: 'expiry', lease: l, date: l.end, days: left });
  }
  const sched = new Set(leases.map((l) => l.schedule_id).filter(Boolean));
  const docs = invoices.filter((i) => i.recurring_id && sched.has(i.recurring_id) && i.tds_enabled && /^194I/.test(i.tds_section ?? ''));
  if (docs.length) {
    const overdue = buildTdsRegister({ invoices: docs, certificates: [...certificates] }, { today }).rows.filter((r) => r.certificate === 'overdue');
    if (overdue.length) out.push({ id: `cert:${overdue.length}`, kind: 'cert', date: today, days: 0, count: overdue.length });
  }
  return out;
}
