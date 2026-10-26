/**
 * R7-A6 night audit. For the business date's night:
 *  1. pre-checks — due-outs still checked in and arrivals not checked in block (a guaranteed booking is kept as a
 *     "late arrival"); an incomplete Form C is only a warning;
 *  2. the idempotent room post (`room-post.ts`) into every in-house folio — a re-run or catch-up never posts twice;
 *  3. housekeeping: occupied rooms → dirty (setting);
 *  4. a `hotel_night_audits` row (id `na:<night>`, so a repeat replaces it) with statistics, revenue by kind, payments
 *     by mode, the guest ledger and advances held;
 *  5. the roll: business date + 1.
 * A missed audit catches up night by night up to yesterday (`auditNights`). Posting into a locked period is refused
 * and the audit stops at that date. Statistics (D14): complimentary / house-use rooms count as occupied for occupancy
 * but not for ADR; ADR = room revenue ÷ paid occupied rooms; RevPAR = room revenue ÷ rooms available (active − OOO).
 */
import type { AuditStats, Folio, FolioLineKind, Guest, NightAudit, Reservation, Room } from '../../types/hotel-r7';
import type { Payment } from '../../types/invoice';
import { requireAccess } from '../access';
import { assertUnlocked, isPeriodLockedError } from '../period-lock';
import { round2 } from '../invoice-calc';
import { localDb } from '../localDb';
import { movedNoCash, advanceBalance } from '../advance-tax';
import { loadAdvances } from '../advances';
import { withTablesRollback } from '../table-txn';
import { todayIso } from '../tax-rules';
import { HT, hotelDb } from './hotel-store';
import { isLiveRes, lineDates, oooOn } from './availability';
import { HotelError } from './reservations';
import { auditNights, isYearEnd, nextDay } from './business-date';
import { ROOM_KINDS, folioBalance, postNight } from './room-post';
import { formCMissing } from './guests';
import { setHk, who } from './housekeeping';

export interface LineRef {
  res: Reservation;
  lineId: string;
}

export interface PreCheck {
  /** Still checked in on / after their departure day (blocking: check out or extend). */
  dueOuts: LineRef[];
  /** Arriving tonight (or earlier) and not checked in, not guaranteed (blocking: check in, no-show or cancel). */
  arrivals: LineRef[];
  /** Guaranteed bookings not yet in: kept as late arrivals. */
  late: LineRef[];
  /** Foreign guests with Form C fields missing (warning). */
  formC: LineRef[];
}

export function preCheck(night: string, reservations: readonly Reservation[], guests: readonly Guest[]): PreCheck {
  const out: PreCheck = { dueOuts: [], arrivals: [], late: [], formC: [] };
  const byId = new Map(guests.map((g) => [g.id, g]));
  for (const res of reservations) {
    if (!isLiveRes(res)) continue;
    for (const l of res.lines) {
      const d = lineDates(res, l);
      const ref = { res, lineId: l.id };
      if (l.status === 'checked_in') {
        if (d.departure <= night) out.dueOuts.push(ref);
        if ((l.guest_ids ?? []).some((id) => { const g = byId.get(id); return !!g && formCMissing(g).length > 0; })) out.formC.push(ref);
      } else if (l.status === 'booked' && d.arrival <= night && night < d.departure) {
        (res.guarantee !== 'none' ? out.late : out.arrivals).push(ref);
      }
    }
  }
  return out;
}

export const blocking = (p: PreCheck): boolean => p.dueOuts.length > 0 || p.arrivals.length > 0;

/** The statistics formulas (pure; D14). */
export function statsOf(x: { available: number; occupied: number; complimentary: number; house: number; ooo: number; room_revenue: number }): AuditStats {
  const paid = x.occupied - x.complimentary - x.house;
  return {
    ...x,
    room_revenue: round2(x.room_revenue),
    adr: paid > 0 ? round2(x.room_revenue / paid) : 0,
    revpar: x.available > 0 ? round2(x.room_revenue / x.available) : 0,
    occupancy: x.available > 0 ? round2((x.occupied / x.available) * 100) : 0,
  };
}

/** Rooms in use on `night` (checked in / out lines covering it). */
function occupiedOn(night: string, reservations: readonly Reservation[]) {
  const lines = reservations.flatMap((r) => r.lines.filter((l) => (l.status === 'checked_in' || l.status === 'checked_out') && lineDates(r, l).arrival <= night && night < lineDates(r, l).departure).map((l) => ({ r, l })));
  return lines;
}

export function nightStats(night: string, rooms: readonly Room[], reservations: readonly Reservation[], folios: readonly Folio[]): AuditStats {
  const active = rooms.filter((r) => r.active);
  const ooo = active.filter((r) => oooOn(r, night)).length;
  const occ = occupiedOn(night, reservations);
  const revenue = folios.flatMap((f) => f.lines).filter((l) => !l.void && l.date === night && ROOM_KINDS.has(l.kind)).reduce((s, l) => s + l.amount, 0);
  return statsOf({
    available: active.length - ooo, occupied: occ.length, ooo, room_revenue: revenue,
    complimentary: occ.filter((x) => x.l.comp === 'complimentary').length, house: occ.filter((x) => x.l.comp === 'house').length,
  });
}

export interface NightResult {
  audit: NightAudit;
  /** D7: 31 March with guests in house — offer interim invoices (R7-B3). */
  yearEnd: boolean;
}

/** Close one night (the business date). Throws `HotelError` on a blocking pre-check, `PeriodLockedError` when locked. */
export function runNight(night: string, at: Date = new Date()): NightResult {
  requireAccess('doc.create');
  const settings = hotelDb.settings();
  if (night !== settings.business_date) throw new HotelError(`The business date is ${settings.business_date}.`);
  const reservations = hotelDb.reservations();
  const guests = hotelDb.guests();
  const pc = preCheck(night, reservations, guests);
  if (blocking(pc)) throw new HotelError(`Resolve ${pc.dueOuts.length} due-out(s) and ${pc.arrivals.length} arrival(s) first.`);
  assertUnlocked({ id: `na:${night}`, issue_date: night }, 'create');
  const rooms = hotelDb.rooms();
  const types = hotelDb.roomTypes();
  const plans = hotelDb.ratePlans();
  let folios = hotelDb.folios();
  const keys: string[] = [];
  const changed = new Map<string, Folio>();
  for (const res of reservations) {
    for (const l of res.lines) {
      const d = lineDates(res, l);
      if (l.status !== 'checked_in' || !(d.arrival <= night && night < d.departure)) continue;
      const room = rooms.find((r) => r.id === l.room_id);
      const p = postNight(res, l, night, folios, {
        roomNo: room?.number ?? '', typeName: types.find((t) => t.id === l.room_type_id)?.name ?? '',
        plan: plans.find((x) => x.id === l.rate_plan_id), sacRoom: settings.sac_room, sacFnb: settings.sac_fnb,
      });
      for (const f of p.changed) changed.set(f.id, f);
      folios = [...folios.filter((f) => !changed.has(f.id)), ...changed.values()];
      keys.push(...p.keys);
    }
  }
  const day = (p: Pick<Payment, 'date'>) => String(p.date ?? '').slice(0, 10) === night;
  const payments: Record<string, number> = {};
  for (const p of localDb.payments.getAll()) if (day(p) && !movedNoCash(p)) payments[p.method || 'Other'] = round2((payments[p.method || 'Other'] ?? 0) + Number(p.amount || 0));
  const byKind: Partial<Record<FolioLineKind, number>> = {};
  for (const l of folios.flatMap((f) => f.lines)) if (!l.void && l.date === night) byKind[l.kind] = round2((byKind[l.kind] ?? 0) + l.amount);
  const advIds = new Set(reservations.flatMap((r) => r.advance_ids ?? []));
  const invoices = localDb.invoices.getAll();
  const allPayments = localDb.payments.getAll();
  const advancesHeld = loadAdvances().filter((a) => advIds.has(a.id)).reduce((s, a) => s + advanceBalance(a, allPayments, invoices).open, 0);
  const audit: NightAudit = {
    id: `na:${night}`, business_date: night, at: at.toISOString(), by: who(), posted_keys: keys,
    no_shows: reservations.filter((r) => r.status === 'no_show' && r.arrival === night).map((r) => r.number),
    late_arrivals: pc.late.map((x) => x.res.number), due_outs: [],
    stats: nightStats(night, rooms, reservations, folios), revenue_by_kind: byKind, payments_by_mode: payments,
    guest_ledger: round2(folios.filter((f) => f.status === 'open').reduce((s, f) => s + folioBalance(f), 0)),
    advances_held: round2(advancesHeld),
  };
  withTablesRollback([HT.folios, HT.audits], () => {
    if (changed.size) hotelDb.putFolios(...changed.values());
    hotelDb.putAudit(audit);
  });
  if (settings.hk_dirty_on_audit) {
    const occ = [...new Set(occupiedOn(night, reservations).filter((x) => x.l.status === 'checked_in' && x.l.room_id).map((x) => x.l.room_id!))];
    if (occ.length) setHk(occ, 'dirty', at);
  }
  hotelDb.setBusinessDate(nextDay(night));
  const inHouse = reservations.some((r) => r.lines.some((l) => l.status === 'checked_in'));
  return { audit, yearEnd: isYearEnd(night) && settings.interim_year_end && inHouse };
}

export interface AuditRun {
  nights: string[];
  done: NightResult[];
  /** Why the run stopped early (a blocking pre-check or a locked period), with the night. */
  stopped?: { night: string; reason: string; locked: boolean };
}

/** Run every night due (catch-up after a missed audit). The UI confirms the list of nights first. */
export function runAudit(opts: { today?: string; at?: Date } = {}): AuditRun {
  const nights = auditNights(hotelDb.settings().business_date, opts.today ?? todayIso());
  const run: AuditRun = { nights, done: [] };
  for (const night of nights) {
    try {
      run.done.push(runNight(night, opts.at));
    } catch (err) {
      run.stopped = { night, reason: (err as Error).message, locked: isPeriodLockedError(err) };
      break;
    }
  }
  return run;
}
