/**
 * SV-C2 check-in (table `checkins`, `doc.create`, audited "Check-ins", dated `date`): ONE row per day with its
 * entries (~365 rows a year). Find a member by member code (the MEM number, also on the card's barcode), phone or
 * name; the membership status decides the gate (`service_settings.checkin_gate`: off / warn / block; fitness `warn`);
 * a package with `redeem_on_checkin` redeems one session. Reports: daily footfall, peak hours, members not seen.
 */
import './sv-registry';
import type { InvoiceRecord } from '../../types/invoice';
import type { CheckinDay, CheckinEntry, Membership } from '../../types/services-r10';
import { generateId, setTable } from '../storage';
import { requireAccess } from '../access';
import { shiftDay } from '../dates';
import { SV_TABLES } from './sv-shared';
import { loadCheckins, sessionsUsed, statusOf, type MemberStatus } from './sv-members';

const digits = (s: unknown) => String(s ?? '').replace(/\D/g, '');

/** Memberships matching a typed / scanned code, phone or name (open ones first). */
export function findMembers(q: string, all: readonly Membership[]): Membership[] {
  const t = q.trim().toLowerCase();
  if (!t) return [];
  const d = digits(t);
  const hit = all.filter((m) => m.number.toLowerCase() === t || (d.length >= 4 && (digits(m.phone).endsWith(d) || (d.length <= 4 && digits(m.number).endsWith(d)))) || (t.length >= 2 && m.client_name.toLowerCase().includes(t)));
  return hit.sort((a, b) => Number(!!a.closed) - Number(!!b.closed) || b.start.localeCompare(a.start));
}

/** The gate for a status: `ok`, `warn` (asked to renew, can still enter) or `block`. */
export const gateFor = (st: MemberStatus, gate: 'off' | 'warn' | 'block' = 'off'): 'ok' | 'warn' | 'block' => (st === 'active' || gate === 'off' ? 'ok' : gate);

/**
 * Check a member in on `date` at `time` (one row per day). Refused when blocked by the gate or already in today;
 * a package with `redeem_on_checkin` redeems a session (refused when none is left).
 */
export function checkIn(m: Membership, date: string, time: string, ctx: { gate?: 'off' | 'warn' | 'block'; invoices: readonly InvoiceRecord[]; class_id?: string; by?: string }): CheckinEntry {
  requireAccess('doc.create');
  const days = loadCheckins();
  const used = sessionsUsed(m, ctx.invoices, days);
  const st = statusOf(m, date, used, ctx.invoices);
  if (gateFor(st, ctx.gate) === 'block') throw new Error(`${m.number} is ${st}. Renew it to check in.`);
  const row = days.find((d) => d.date === date);
  if (row?.entries.some((e) => e.membership_id === m.id && (e.class_id ?? '') === (ctx.class_id ?? ''))) throw new Error(`${m.client_name} is already checked in today.`);
  const redeem = !!m.plan.redeem_on_checkin && st === 'active' && Number(m.plan.sessions) > used;
  const e: CheckinEntry = { client_id: m.client_id, name: m.client_name, time, membership_id: m.id, ...(ctx.by ? { by: ctx.by } : {}), ...(ctx.class_id ? { class_id: ctx.class_id } : {}), ...(redeem ? { redeem: true } : {}) };
  const next: CheckinDay = row ? { ...row, entries: [...row.entries, e], updated_at: new Date().toISOString() } : { id: generateId(), date, entries: [e] };
  setTable(SV_TABLES.checkins, row ? days.map((d) => (d.id === row.id ? next : d)) : [...days, next]);
  return e;
}

/** Remove one entry of a day (a mistaken check-in); an empty day row is deleted (recycle bin). */
export function undoCheckin(date: string, index: number): void {
  requireAccess('doc.create');
  const days = loadCheckins();
  const row = days.find((d) => d.date === date);
  if (!row) return;
  const entries = row.entries.filter((_e, i) => i !== index);
  setTable(SV_TABLES.checkins, entries.length ? days.map((d) => (d.id === row.id ? { ...row, entries, updated_at: new Date().toISOString() } : d)) : days.filter((d) => d.id !== row.id));
}

/** Footfall per day and per hour over `from`…`to`. */
export function footfall(days: readonly CheckinDay[], from: string, to: string): { byDay: [string, number][]; byHour: [string, number][] } {
  const byDay = new Map<string, number>();
  const byHour = new Map<string, number>();
  for (const d of days) {
    if (d.date < from || d.date > to) continue;
    byDay.set(d.date, (byDay.get(d.date) ?? 0) + d.entries.length);
    for (const e of d.entries) byHour.set(e.time.slice(0, 2), (byHour.get(e.time.slice(0, 2)) ?? 0) + 1);
  }
  return { byDay: [...byDay].sort(), byHour: [...byHour].sort((a, b) => b[1] - a[1]) };
}

/** Open memberships whose member has not checked in for `days` days (churn list), with the last visit. */
export function notSeen(all: readonly Membership[], days: readonly CheckinDay[], today: string, n = 14): { m: Membership; last: string }[] {
  const last = new Map<string, string>();
  for (const d of days) for (const e of d.entries) if (e.membership_id && (last.get(e.membership_id) ?? '') < d.date) last.set(e.membership_id, d.date);
  const cut = shiftDay(today, -n);
  return all.filter((m) => !m.closed && m.plan.kind !== 'wallet' && m.start <= cut && (!m.end || m.end >= today) && (last.get(m.id) ?? '') < cut).map((m) => ({ m, last: last.get(m.id) ?? '' }));
}
