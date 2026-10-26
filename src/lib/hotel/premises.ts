/**
 * R7-C1 specified premises (N 05/2025-CT(R) cl. (xxxvi), Annexures VII–IX — verify with your CA, HT3). For a FY the
 * premises are specified when (a) any unit's value of supply was above ₹7,500 a day in the preceding FY, or (b) an
 * opt-in (Annexure VII) was filed 1 Jan – 31 Mar before the FY, or (c) a new registrant opted in (Annexure VIII) within
 * 15 days of the ARN. A declaration continues until changed; an opt-out (Annexure IX, same window) cancels an earlier
 * opt-in but never clause (a) (D4). Status is per premises (D18: `property_id` = the branch profile; absent = main).
 * Declarations live in `hotel_settings.premises`; a typed highest value for a year before the app in
 * `prev_fy_max_value` (keyed by FY name, e.g. `2025-26`).
 */
import type { HotelSettings, PremisesDecl, RatePlan, Reservation, Room } from '../../types/hotel-r7';
import { shiftDay } from '../dates';
import { SPECIFIED_PREMISES_RULES, ruleAt } from './hotel-rules';
import { fyName, fyRange, fyStartOf } from './hotel-gst';
import { getJson } from '../storage';
import { HOTEL_SETTINGS_KEY, hotelDb } from './hotel-store';

export interface PrevMax {
  value: number;
  /** Room number and night (stays), or nothing (typed). */
  room?: string;
  night?: string;
  source: 'stays' | 'typed';
}

/**
 * Highest unit-day value of the FY before `fy`: the stays' night snapshots (room + extra bed / person + plan meals, after
 * discount, before GST — the value the folio posts and the check-out invoice bills), or the figure typed for a year
 * before the app.
 */
export function prevFyMax(fy: number, d: {
  reservations?: readonly Reservation[]; rooms?: readonly Room[]; plans?: readonly RatePlan[]; typed?: HotelSettings['prev_fy_max_value']; propertyId?: string;
}): PrevMax | null {
  const { from, to } = fyRange(fy - 1);
  let best: PrevMax | null = null;
  const take = (m: PrevMax) => { if (m.value > 0 && (!best || m.value > best.value)) best = m; };
  const rooms = new Map((d.rooms ?? []).map((r) => [r.id, r]));
  for (const res of d.reservations ?? []) {
    for (const l of res.lines) {
      const room = l.room_id ? rooms.get(l.room_id) : undefined;
      if (l.comp || (l.status !== 'checked_in' && l.status !== 'checked_out') || (room?.property_id ?? res.property_id) !== d.propertyId) continue;
      const separate = !!d.plans?.find((p) => p.id === l.rate_plan_id)?.meals_separate;
      for (const n of l.nightly) if (n.night >= from && n.night <= to) take({ value: n.total - (separate ? n.meal : 0), room: room?.number, night: n.night, source: 'stays' });
    }
  }
  const typed = Number(d.typed?.[fyName(fy - 1)]) || 0;
  if (typed) take({ value: typed, source: 'typed' });
  return best;
}

export interface PremisesStatus {
  specified: boolean;
  basis: 'previous_fy_value' | 'opt_in' | 'new_reg_opt_in' | 'none';
  prev: PrevMax | null;
  /** The declaration in force (the latest valid one up to this FY). */
  decl?: PremisesDecl;
  /** An opt-out is on record but clause (a) makes the premises specified by law (D4). */
  optOutIgnored?: boolean;
  /** False before 1 Apr 2025 (declared-tariff era: no declarations). */
  rule: boolean;
  threshold: number;
}

/** The filing window a declaration must fall in, or null when it may not be filed at all (before the rule). */
export function declWindow(d: Pick<PremisesDecl, 'fy' | 'kind' | 'arn_on'>): { from: string; to: string } | null {
  const fy = fyStartOf(d.fy);
  const rule = ruleAt(SPECIFIED_PREMISES_RULES, `${fy}-04-01`);
  if (!rule || !fy) return null;
  if (d.kind === 'new_reg_opt_in') return d.arn_on ? { from: d.arn_on, to: shiftDay(d.arn_on, rule.newRegDays) } : fyRange(fy);
  const p = (n: number) => String(n).padStart(2, '0');
  return { from: `${fy}-${p(rule.window.fromMonth)}-${p(rule.window.fromDay)}`, to: `${fy}-${p(rule.window.toMonth)}-${p(rule.window.toDay)}` };
}

/** Why a declaration is refused (the window it must be filed in), or '' when it is fine. */
export function declError(d: Pick<PremisesDecl, 'fy' | 'kind' | 'filed_on' | 'arn_on'>): string {
  const w = declWindow(d);
  if (!w) return 'No declarations before FY 2025-26 (declared-tariff test).';
  return d.filed_on >= w.from && d.filed_on <= w.to ? '' : `Filed outside the window ${w.from} – ${w.to}.`;
}

export function premisesStatus(fy: number, ctx: { prev: PrevMax | null; decls: readonly PremisesDecl[]; propertyId?: string }): PremisesStatus {
  const rule = ruleAt(SPECIFIED_PREMISES_RULES, `${fy}-04-01`);
  const prev = ctx.prev;
  if (!rule) return { specified: false, basis: 'none', prev, rule: false, threshold: 7500 };
  const decl = ctx.decls
    .filter((d) => (d.property_id ?? undefined) === ctx.propertyId && fyStartOf(d.fy) <= fy && !declError(d))
    .sort((a, b) => a.fy.localeCompare(b.fy) || a.filed_on.localeCompare(b.filed_on))
    .at(-1);
  const base = { prev, rule: true, threshold: rule.threshold, ...(decl ? { decl } : {}) };
  if (prev && prev.value > rule.threshold) return { ...base, specified: true, basis: 'previous_fy_value', ...(decl?.kind === 'opt_out' ? { optOutIgnored: true } : {}) };
  if (decl && decl.kind !== 'opt_out') return { ...base, specified: true, basis: decl.kind };
  return { ...base, specified: false, basis: 'none' };
}

/** Status of a premises (main = no id) from the company's own data (settings and stays). */
export function premisesNow(fy: number, propertyId?: string): PremisesStatus {
  const s = hotelDb.settings();
  const prev = prevFyMax(fy, { reservations: hotelDb.reservations(), rooms: hotelDb.rooms(), plans: hotelDb.ratePlans(), typed: s.prev_fy_max_value, propertyId });
  return premisesStatus(fy, { prev, decls: s.premises ?? [], propertyId });
}

/** Settings write that never freezes an un-audited business date (`settings.manage`). */
function patch(fn: (s: HotelSettings) => Partial<HotelSettings>): void {
  const s = hotelDb.settings();
  const stored = getJson<Partial<HotelSettings>>(HOTEL_SETTINGS_KEY, {});
  hotelDb.saveSettings({ ...s, ...fn(s), business_date: stored.business_date } as HotelSettings);
}

/** Record a declaration (refused outside its window). */
export function addDecl(d: PremisesDecl): void {
  const err = declError(d);
  if (err) throw new Error(err);
  patch((s) => ({ premises: [...(s.premises ?? []), d] }));
}

export const removeDecl = (i: number): void => patch((s) => ({ premises: (s.premises ?? []).filter((_x, j) => j !== i) }));

/** The typed highest unit-day value of a FY before the app (0 clears it). */
export function setPrevFyValue(fy: string, value: number): void {
  patch((s) => {
    const map = { ...(s.prev_fy_max_value ?? {}) };
    if (value > 0) map[fy] = value;
    else delete map[fy];
    return { prev_fy_max_value: map };
  });
}
