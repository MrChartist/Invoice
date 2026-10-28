/**
 * PS-A4 timekeepers: the R10 `service_staff` row is the staff master; `ServiceStaff.ps` adds weekly capacity, dated
 * standard (billing) and cost rates, a utilisation target and a local-user hint (a hint only — local users are
 * device-local and never synced). Standard value of time = billable minutes × the rate the entry captured (R3-B1).
 * Cost rates are management data and never print. Pure above "Storage".
 */
import type { ServiceStaff } from '../../types/services-r10';
import type { PsStaff, PsStaffRate } from '../../types/prof-r14';
import type { TimeEntry, TimePrefs } from '../../types/time';
import { entryAmount } from '../timesheets';
import { num, round2 } from '../invoice-calc';
import { loadStaff, saveStaff } from '../services/sv-staff';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The rate row in force on `date` (latest `from` ≤ date). */
export function rateAt(s: Pick<ServiceStaff, 'ps'> | undefined, date: string): PsStaffRate | undefined {
  let hit: PsStaffRate | undefined;
  for (const r of [...(s?.ps?.rates ?? [])].sort((a, b) => a.from.localeCompare(b.from))) if (r.from <= date) hit = r;
  return hit;
}

/** Standard value of an entry: billable minutes (billing step applied) × its captured rate; 0 when non-billable. */
export const entryStandard = (e: TimeEntry, prefs: TimePrefs): number => (e.billable ? entryAmount(e, prefs) : 0);

/** Staff cost of an entry: hours × the timekeeper's cost rate on the entry's day. */
export const entryCost = (e: Pick<TimeEntry, 'minutes' | 'date' | 'staff_id'>, staff: ReadonlyMap<string, ServiceStaff>): number =>
  round2((Math.max(num(e.minutes), 0) / 60) * num(rateAt(e.staff_id ? staff.get(e.staff_id) : undefined, e.date)?.cost_rate));

/** The timekeeper a local user's new entries default to (its `user_hint`). */
export const defaultStaffFor = (userId: string | undefined, staff: readonly ServiceStaff[]): ServiceStaff | undefined =>
  userId ? staff.find((s) => s.active !== false && s.ps?.user_hint === userId) : undefined;

/** Pure: a cleaned `ps` block (bad rows dropped, rates sorted, one row per date). */
export function cleanStaffPs(ps: PsStaff | undefined): PsStaff | undefined {
  if (!ps) return undefined;
  const cap = num(ps.capacity_hours_week);
  const target = num(ps.target_pct);
  const byDay = new Map<string, PsStaffRate>();
  for (const r of ps.rates ?? []) if (DAY.test(r.from)) byDay.set(r.from, { from: r.from, standard_rate: Math.max(round2(num(r.standard_rate)), 0), cost_rate: Math.max(round2(num(r.cost_rate)), 0) });
  const out: PsStaff = {
    ...(cap > 0 ? { capacity_hours_week: Math.min(round2(cap), 168) } : {}),
    ...(byDay.size ? { rates: [...byDay.values()].sort((a, b) => a.from.localeCompare(b.from)) } : {}),
    ...(target > 0 ? { target_pct: Math.min(round2(target), 100) } : {}),
    ...(ps.user_hint ? { user_hint: ps.user_hint } : {}),
  };
  return Object.keys(out).length ? out : undefined;
}

// ── Storage ──────────────────────────────────────────────────────

export const staffMap = (all: readonly ServiceStaff[] = loadStaff()): Map<string, ServiceStaff> => new Map(all.map((s) => [s.id, s]));

/** Save a timekeeper's capacity and rates (`master.edit`, through the R10 data layer). */
export function saveStaffPs(id: string, ps: PsStaff): ServiceStaff {
  const s = loadStaff().find((x) => x.id === id);
  if (!s) throw new Error('This staff member is no longer on the list.');
  const { id: _id, created_at: _c, ...rest } = s;
  return saveStaff({ ...rest, id, ps: cleanStaffPs(ps) });
}

/** Add a timekeeper by name (employee, not bookable) with capacity and a first rate row. */
export const addTimekeeper = (name: string, ps: PsStaff): ServiceStaff =>
  saveStaff({ name, role: 'other', employment: 'employee', bookable: false, active: true, ps: cleanStaffPs(ps) });
