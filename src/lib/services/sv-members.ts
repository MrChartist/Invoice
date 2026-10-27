/**
 * SV-C1 membership plans (table `member_plans`, `master.edit`, audited "Membership plan") and the pure maths of a
 * membership: the end date from the term (month ends clamp), freezes, status by date, sessions used (live bills'
 * redemption lines + redeeming check-ins), the unused value (pro rata by days or sessions, at the old price), the
 * redemption line, the renewal window and forfeited sessions. GST timing (SV14 / SV15): the whole price is invoiced
 * and taxed at sale; a redemption is a ₹0 line (no second tax); forfeiture at expiry is no GST event. Working papers —
 * verify with your CA.
 */
import './sv-registry';
import type { InvoiceItem, InvoiceRecord } from '../../types/invoice';
import type { CheckinDay, MemberPlan, Membership } from '../../types/services-r10';
import { generateId, getTable, setTable } from '../storage';
import { requireAccess } from '../access';
import { shiftDay } from '../dates';
import { num, round2 } from '../invoice-calc';
import { SV_TABLES } from './sv-shared';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ms = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
/** Days from `a` to `b` (b − a). */
export const daysBetween = (a: string, b: string) => Math.round((ms(b) - ms(a)) / 86400000);
const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();
const rows = <T>(t: string): T[] => getTable<T>(t).filter((r) => !!r && typeof (r as { id?: unknown }).id === 'string');

export const loadMemberPlans = (): MemberPlan[] => rows<MemberPlan>(SV_TABLES.memberPlans);
export const loadMemberships = (): Membership[] => rows<Membership>(SV_TABLES.memberships);
export const loadCheckins = (): CheckinDay[] => rows<CheckinDay>(SV_TABLES.checkins);

export type PlanInput = Omit<MemberPlan, 'id' | 'created_at'> & { id?: string };

export function saveMemberPlan(i: PlanInput): MemberPlan {
  requireAccess('master.edit');
  const name = i.name.trim();
  if (!name) throw new Error('Name the plan.');
  if (!(num(i.price) >= 0)) throw new Error('Enter the price.');
  const timed = i.kind === 'membership' || i.kind === 'combo';
  if (timed && !(num(i.months) > 0 || num(i.days) > 0)) throw new Error('Give the term in months or days.');
  if ((i.kind === 'package' || i.kind === 'combo') && !(num(i.sessions) > 0)) throw new Error('Give the number of sessions.');
  const all = loadMemberPlans();
  if (all.some((p) => p.id !== i.id && norm(p.name) === norm(name))) throw new Error(`${name} already exists.`);
  const prev = i.id ? all.find((p) => p.id === i.id) : undefined;
  const row: MemberPlan = { ...prev, ...i, name, price: round2(num(i.price)), id: prev?.id ?? generateId(), created_at: prev?.created_at ?? new Date().toISOString(), ...(prev ? { updated_at: new Date().toISOString() } : {}) };
  setTable(SV_TABLES.memberPlans, prev ? all.map((p) => (p.id === row.id ? row : p)) : [...all, row]);
  return row;
}

/** Delete a plan (recycle bin). Memberships keep their plan snapshot. */
export function deleteMemberPlan(id: string): void {
  requireAccess('master.edit');
  setTable(SV_TABLES.memberPlans, loadMemberPlans().filter((p) => p.id !== id));
}

/** `day` + `n` months: the same day of the month, clamped to the month end (31 Jan + 1 month = 28 Feb). */
export function addMonths(day: string, n: number): { day: string; clamped: boolean } {
  const y = +day.slice(0, 4);
  const m = +day.slice(5, 7) - 1 + n;
  const d = +day.slice(8, 10);
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const t = new Date(Date.UTC(y, m, Math.min(d, last)));
  return { day: t.toISOString().slice(0, 10), clamped: d > last };
}

/** Last day of the term before freezes ('' = open: a wallet, or a package with no validity). */
export function baseEnd(plan: Pick<MemberPlan, 'kind' | 'months' | 'days' | 'validity_days'>, start: string): string {
  if (plan.kind === 'wallet') return '';
  if (plan.kind === 'package') return num(plan.validity_days) > 0 ? shiftDay(start, num(plan.validity_days) - 1) : '';
  let end = start;
  if (num(plan.months) > 0) {
    const a = addMonths(start, num(plan.months));
    end = a.clamped ? a.day : shiftDay(a.day, -1);
  } else end = shiftDay(start, -1);
  return num(plan.days) > 0 ? shiftDay(end, num(plan.days)) : end;
}

export const frozenDays = (m: Pick<Membership, 'freezes'>) => (m.freezes ?? []).reduce((s, f) => s + daysBetween(f.from, f.to) + 1, 0);
/** The end: the term's end moved by every frozen day. */
export const endOf = (m: Pick<Membership, 'plan' | 'start' | 'freezes'>) => ((b) => (b ? shiftDay(b, frozenDays(m)) : ''))(baseEnd(m.plan, m.start));

const live = (i: InvoiceRecord) => i.status !== 'Draft' && i.status !== 'Cancelled' && i.doc_type !== 'CREDIT_NOTE';

/** Sessions used: redemption lines on live bills + check-ins that redeemed one. */
export function sessionsUsed(m: Pick<Membership, 'id'>, invoices: readonly InvoiceRecord[], checkins: readonly CheckinDay[] = []): number {
  let n = 0;
  for (const i of invoices) if (i && live(i)) for (const l of i.items ?? []) if (l?.sv?.redeem?.membership_id === m.id) n += Math.max(1, num(l.quantity));
  for (const d of checkins) for (const e of d?.entries ?? []) if (e.redeem && e.membership_id === m.id) n++;
  return n;
}

export type MemberStatus = 'active' | 'frozen' | 'expired' | 'cancelled' | 'transferred' | 'upgraded';

/** Status on `today`: stored terminal state, else frozen (a freeze covers today), expired (past the end or used up), active. */
export function statusOf(m: Membership, today: string, used = 0): MemberStatus {
  if (m.closed) return m.closed;
  if ((m.freezes ?? []).some((f) => f.from <= today && today <= f.to)) return 'frozen';
  if ((m.end && today > m.end) || (num(m.plan.sessions) > 0 && used >= num(m.plan.sessions))) return 'expired';
  return 'active';
}

/** Check a new freeze against the plan's rules; returns the error text or ''. */
export function freezeError(m: Membership, from: string, to: string): string {
  if (!DAY.test(from) || !DAY.test(to) || to < from) return 'Choose the freeze dates.';
  if (from < m.start || (m.end && from > m.end)) return 'The freeze must start inside the membership.';
  if ((m.freezes ?? []).some((f) => f.from <= to && from <= f.to)) return 'It overlaps an earlier freeze.';
  const r = m.plan.freeze ?? {};
  const days = daysBetween(from, to) + 1;
  if (num(r.min_days) > 0 && days < num(r.min_days)) return `A freeze is at least ${r.min_days} days.`;
  if (num(r.max_days) > 0 && frozenDays(m) + days > num(r.max_days)) return `At most ${r.max_days} frozen days per term (${frozenDays(m)} used).`;
  if (num(r.max_times) > 0 && (m.freezes ?? []).length >= num(r.max_times)) return `At most ${r.max_times} freezes per term.`;
  return '';
}

/**
 * Unused value of a membership on `day` at its own price (taxable, GST excluded): pro rata by the active days left
 * (time-based, combo) or by the sessions left (package). Day `day` counts as used. Wallets: 0 (their balance is an advance).
 */
export function unusedValue(m: Membership, day: string, used = 0): { value: number; left: number; of: number; by: 'days' | 'sessions' } {
  const price = num(m.plan.price);
  if (m.plan.kind === 'package' || (m.plan.kind === 'combo' && !m.end)) {
    const of = num(m.plan.sessions);
    const left = Math.max(0, of - used);
    return { value: of ? round2((price * left) / of) : 0, left, of, by: 'sessions' };
  }
  if (!m.end || m.plan.kind === 'wallet') return { value: 0, left: 0, of: 0, by: 'days' };
  const of = daysBetween(m.start, baseEnd(m.plan, m.start)) + 1;
  const frozenTo = (m.freezes ?? []).reduce((s, f) => s + Math.max(0, daysBetween(f.from, f.to < day ? f.to : day) + 1), 0);
  const usedDays = Math.min(of, Math.max(0, daysBetween(m.start, day) + 1 - frozenTo));
  const left = of - usedDays;
  return { value: round2((price * left) / of), left, of, by: 'days' };
}

/** Does a session of the plan cover this line (by item name or category; empty = any service)? */
export const covers = (plan: Pick<MemberPlan, 'covers'>, name: string, category?: string) =>
  !plan.covers?.length || plan.covers.some((c) => norm(c) === norm(name) || (!!category && norm(c) === norm(category)));

/** Printed on a redemption line: "Session 3 of 6 — MEM/FY26-27/0031". */
export const sessionText = (n: number, of: number, number: string) => `Session ${n} of ${of} — ${number}`;

/**
 * The redemption of one session on `line`: the line becomes ₹0 (no second tax), prints the session text and carries
 * `sv.redeem` (value = price ÷ sessions, the commission base). Refused when used up, expired, frozen or closed.
 */
export function redeemPatch(m: Membership, line: Pick<InvoiceItem, 'sv' | 'name'>, today: string, used: number): Partial<InvoiceItem> {
  const of = num(m.plan.sessions);
  const st = statusOf(m, today, used);
  if (!of) throw new Error(`${m.number} has no sessions.`);
  if (st !== 'active') throw new Error(`${m.number} is ${st}${st === 'expired' ? ' — renew it' : ''}.`);
  if (!covers(m.plan, line.name)) throw new Error(`${m.plan.name} does not cover ${line.name}.`);
  const n = used + 1;
  return { rate: 0, amount: 0, discount_percent: 0, quantity: 1, description: sessionText(n, of, m.number), sv: { ...line.sv, redeem: { membership_id: m.id, session: n, of, value: round2(num(m.plan.price) / of) } } };
}

/** Renewal window: ending within `days` (or ended within the last 30), not closed or renewed. */
export function renewals(all: readonly Membership[], today: string, days = 30): { m: Membership; left: number }[] {
  return all
    .filter((m) => !m.closed && !m.next_id && m.end && m.plan.kind !== 'wallet')
    .map((m) => ({ m, left: daysBetween(today, m.end) }))
    .filter((r) => r.left <= days && r.left >= -30)
    .sort((a, b) => a.left - b.left);
}

/** Forfeited value of packages that expired with sessions unused, by month of expiry (SV15: no GST event). */
export function forfeited(all: readonly Membership[], invoices: readonly InvoiceRecord[], checkins: readonly CheckinDay[], today: string): { m: Membership; month: string; unused: number; value: number }[] {
  const out: { m: Membership; month: string; unused: number; value: number }[] = [];
  for (const m of all) {
    const of = num(m.plan.sessions);
    if (!of || m.closed || !m.end || m.end >= today) continue;
    const unused = Math.max(0, of - sessionsUsed(m, invoices, checkins));
    if (unused) out.push({ m, month: m.end.slice(0, 7), unused, value: round2((num(m.plan.price) * unused) / of) });
  }
  return out.sort((a, b) => b.month.localeCompare(a.month));
}
