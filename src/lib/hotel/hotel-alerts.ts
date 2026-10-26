/**
 * R7-C2 hotel bell notices, loaded lazily by the notification bell only with the hotel pack on; the provider re-checks
 * the pack on every run (turning it off silences it, nothing is deleted):
 *  - Form C due within 6 h, or overdue (per room line);
 *  - arrivals of today not checked in after check-in time + 4 h;
 *  - due-outs past check-out time;
 *  - night audit not run for the previous business date;
 *  - the specified-premises declaration window (1 Jan – 31 Mar), once a year.
 * The interim-invoice notice (D7) belongs to R7-B3's interim builder.
 */
import type { Guest, HotelSettings, Reservation } from '../../types/hotel-r7';
import { registerNotificationProvider, type AppNotification } from '../notifications';
import { localDayOf } from '../dates';
import { memoOnTables } from '../table-memo';
import { localDb } from '../localDb';
import { isPackOn } from '../industry-packs';
import { cT } from '../../i18n/areas/hotel-compliance-r7';
import { hT } from '../../i18n/areas/hotel-frontdesk-r7';
import { SPECIFIED_PREMISES_RULES, ruleAt } from './hotel-rules';
import { getJson } from '../storage';
import { HOTEL_SETTINGS_KEY, HT, hotelDb } from './hotel-store';
import { lineDates } from './availability';
import { FORM_C_WARN_HOURS, formCRows } from './form-c';

const HREF = '/tables?tab=frontdesk';
const minutes = (hhmm: string) => +hhmm.slice(0, 2) * 60 + +hhmm.slice(3, 5);

export interface HotelData {
  reservations: readonly Reservation[];
  guests: readonly Guest[];
  settings: HotelSettings;
  /** True when the business date was stored (a night audit has run). */
  audited: boolean;
}

/** Pure: the notices for `now` (local clock). */
export function hotelNotices(d: HotelData, now: Date): AppNotification[] {
  const at = now.toISOString();
  const today = localDayOf(now);
  const mins = now.getHours() * 60 + now.getMinutes();
  const out: AppNotification[] = [];
  for (const r of formCRows(d.reservations, d.guests, now)) {
    if (r.status !== 'overdue' && !(r.status === 'due' && r.hours <= FORM_C_WARN_HOURS)) continue;
    const g = r.guests.map((x) => x.name).join(', ') || r.res.guest.name;
    out.push({
      id: `ht:fc:${r.line.id}:${r.status}`, severity: r.status === 'overdue' ? 'critical' : 'warning',
      title: r.status === 'overdue' ? cT('a.fcLate', { g }) : cT('a.fcDue', { h: Math.max(0, Math.ceil(r.hours)), g }),
      detail: cT('fcNote'), href: `${HREF}&view=formc`, cta: cT('open'), at,
    });
  }
  const lines = d.reservations.flatMap((res) => (res.status === 'cancelled' || res.status === 'no_show' ? [] : res.lines.map((l) => ({ res, l, ...lineDates(res, l) }))));
  const arr = lines.filter((x) => x.l.status === 'booked' && (x.arrival < today || (x.arrival === today && mins >= minutes(d.settings.checkin_time) + 240)));
  if (arr.length) out.push({ id: `ht:arr:${today}:${arr.length}`, severity: 'warning', title: cT('a.arr', { n: arr.length }), detail: `${hT('checkIn')} / ${hT('noShow')} / ${hT('cancelBooking')}`, href: `${HREF}&view=reservations`, cta: cT('open'), at });
  const dueOut = lines.filter((x) => x.l.status === 'checked_in' && (x.departure < today || (x.departure === today && mins >= minutes(d.settings.checkout_time))));
  if (dueOut.length) out.push({ id: `ht:out:${today}:${dueOut.length}`, severity: 'warning', title: cT('a.out', { n: dueOut.length }), detail: `${hT('checkOut')} / ${hT('extend')}`, href: `${HREF}&view=reservations`, cta: cT('open'), at });
  if (d.audited && d.settings.business_date < today) {
    out.push({ id: `ht:audit:${d.settings.business_date}`, severity: 'warning', title: cT('a.audit', { d: d.settings.business_date }), detail: hT('runAudit'), href: `${HREF}&view=audit`, cta: cT('open'), at });
  }
  const md = today.slice(5);
  const year = +today.slice(0, 4);
  if (md <= '03-31' && ruleAt(SPECIFIED_PREMISES_RULES, `${year}-04-01`)) {
    const fy = `${year}-${String((year + 1) % 100).padStart(2, '0')}`;
    out.push({ id: `ht:decl:${year}`, severity: 'info', title: cT('a.decl', { fy }), detail: cT('verify'), href: '/gst-reports?tab=hotel-gst', cta: cT('open'), at });
  }
  return out;
}

let unregister: (() => void) | null = null;

export function registerHotelAlerts(): void {
  if (unregister) return;
  unregister = registerNotificationProvider((ctx) => {
    if (!isPackOn(localDb.settings.get(), 'hotel')) return [];
    const stamp = `${localDayOf(ctx.now)}T${ctx.now.getHours()}:${Math.floor(ctx.now.getMinutes() / 15)}`;
    return memoOnTables('r7:hotel-alerts', [HT.reservations, HT.guests, 'hotel_settings'], () => hotelNotices({
      reservations: hotelDb.reservations(), guests: hotelDb.guests(), settings: hotelDb.settings(),
      audited: !!getJson<Partial<HotelSettings>>(HOTEL_SETTINGS_KEY, {}).business_date,
    }, ctx.now), stamp) as AppNotification[];
  });
}
