/**
 * R7-C1 specified premises (N 05/2025-CT(R) cl. (xxxvi), Annexures VII–IX — verify with your CA, HT3). For a FY the
 * premises are specified when (a) any unit's value of supply was above ₹7,500 a day in the preceding FY, or (b) an
 * opt-in (Annexure VII) was filed 1 Jan – 31 Mar before the FY, or (c) a new registrant opted in (Annexure VIII) within
 * 15 days of the ARN. A declaration continues until changed; an opt-out (Annexure IX, same window) cancels an earlier
 * opt-in but never clause (a) (D4). Status is per premises (D18: `property_id` = the branch profile; absent = main).
 * Declarations live in `hotel_settings.premises`; a typed highest value for a year before the app in
 * `prev_fy_max_value` (keyed by FY name, e.g. `2025-26`).
 */
import type { Folio, HotelSettings, PremisesDecl, RatePlan, Reservation, Room, RoomLine } from '../../types/hotel-r7';
import type { InvoiceRecord } from '../../types/invoice';
import { round2 } from '../invoice-calc';
import { ROOM_KINDS } from './room-post';
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

/** D18: the premises (branch profile id; absent = main) of a stay — the booking's, else its room's. One reading for the
 * check-out invoice's sender, its F&B rate and the previous-FY test (QA9 H4). */
export function stayProperty(res: Pick<Reservation, 'property_id' | 'lines'>, line: Pick<RoomLine, 'room_id'> | undefined, rooms: readonly Pick<Room, 'id' | 'property_id'>[]): string | undefined {
  return res.property_id || rooms.find((r) => r.id === (line ?? res.lines[0])?.room_id)?.property_id || undefined;
}

/**
 * Highest unit-day value of the FY before `fy` (QA9 H4: what was actually supplied): per room line × night, the posted
 * non-void folio lines of the room kinds plus the allowances linked to the night (room + extra bed / person + plan
 * meals, after discount, before GST — meals priced separately post as F&B and are left out); a night with no folio
 * line falls back to the stay's snapshot (an early check-out keeps only the nights stayed, H9). Complimentary /
 * house-use rooms are left out. Or the figure typed for a year before the app.
 */
export function prevFyMax(fy: number, d: {
  reservations?: readonly Reservation[]; rooms?: readonly Room[]; plans?: readonly RatePlan[]; typed?: HotelSettings['prev_fy_max_value']; propertyId?: string;
  folios?: readonly Folio[];
}): PrevMax | null {
  const { from, to } = fyRange(fy - 1);
  let best: PrevMax | null = null;
  const take = (m: PrevMax) => { if (m.value > 0 && (!best || m.value > best.value)) best = m; };
  const rooms = new Map((d.rooms ?? []).map((r) => [r.id, r]));
  const posted = new Map<string, number>();
  for (const f of d.folios ?? []) for (const l of f.lines) {
    if (l.void || !l.src?.line_id || !l.src.night || !(ROOM_KINDS.has(l.kind) || l.kind === 'allowance')) continue;
    const k = `${l.src.line_id}|${l.src.night}`;
    posted.set(k, round2((posted.get(k) ?? 0) + l.amount));
  }
  for (const res of d.reservations ?? []) {
    for (const l of res.lines) {
      const room = l.room_id ? rooms.get(l.room_id) : undefined;
      if (l.comp || (l.status !== 'checked_in' && l.status !== 'checked_out') || stayProperty(res, l, d.rooms ?? []) !== d.propertyId) continue;
      const separate = !!d.plans?.find((p) => p.id === l.rate_plan_id)?.meals_separate;
      for (const n of l.nightly) {
        if (n.night < from || n.night > to) continue;
        take({ value: posted.get(`${l.id}|${n.night}`) ?? n.total - (separate ? n.meal : 0), room: room?.number, night: n.night, source: 'stays' });
      }
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
  const prev = prevFyMax(fy, { reservations: hotelDb.reservations(), rooms: hotelDb.rooms(), plans: hotelDb.ratePlans(), folios: hotelDb.folios(), typed: s.prev_fy_max_value, propertyId });
  return premisesStatus(fy, { prev, decls: s.premises ?? [], propertyId });
}

/**
 * QA9 H4: the premises a GST document belongs to — its stay's (folio → booking), else its sender profile when that
 * profile is a hotel property (a room, booking or declaration names it), else the main premises.
 */
export function invoiceProperty(inv: Pick<InvoiceRecord, 'reservation_id' | 'folio_id' | 'sender'>): string | undefined {
  const rooms = hotelDb.rooms();
  const res = inv.reservation_id ? hotelDb.reservation(inv.reservation_id) : undefined;
  if (res) return stayProperty(res, res.lines.find((l) => l.id === hotelDb.folios().find((f) => f.id === inv.folio_id)?.line_id), rooms);
  const id = inv.sender?.id;
  const known = [...rooms.map((r) => r.property_id), ...hotelDb.reservations().map((r) => r.property_id), ...(hotelDb.settings().premises ?? []).map((x) => x.property_id)];
  return id && known.includes(id) ? id : undefined;
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
