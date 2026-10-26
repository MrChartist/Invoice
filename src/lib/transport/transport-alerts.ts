/**
 * Bell notices for the transport pack (R5-B1 / B3), loaded lazily by the notification bell only with the pack on; the
 * provider re-checks the pack on every run (turning it off silences it, nothing is deleted):
 *  - from 1 Jan to 31 Mar: the GTA option for the next FY (Annexure V / VI window) when none is recorded;
 *  - vehicle documents expiring within 15 days or expired;
 *  - trips open for more than 10 days.
 */
import { registerNotificationProvider, type AppNotification } from '../notifications';
import { localDayOf, shiftDay } from '../dates';
import { memoOnTables } from '../table-memo';
import { localDb } from '../localDb';
import { isPackOn } from '../industry-packs';
import { inGtaWindow } from '../transport-works-rules';
import { fyOf, GTA_OPTIONS_TABLE, loadGtaOptions, nextFy } from './gta-option';
import { docAlerts, loadVehicles, VEHICLES_TABLE } from './vehicles';
import { loadTrips, OPEN_TRIP_DAYS, TRIPS_TABLE } from './trips';

const HREF = '/distribution?tab=transport';
let unregister: (() => void) | null = null;

export function transportNotices(today: string, at: string): AppNotification[] {
  const out: AppNotification[] = [];
  const fy = nextFy(fyOf(today));
  if (inGtaWindow(today) && !loadGtaOptions().some((o) => o.fy === fy)) {
    out.push({ id: `tw:gta:${fy}`, severity: 'info', title: `GTA option for FY ${fy}`, detail: 'Annexure V / VI window: record your forward-charge or reverse-charge option for the next year (verify the dates with your CA).', href: `${HREF}&view=settings`, cta: 'Set option', at });
  }
  for (const a of docAlerts(loadVehicles(), today)) {
    out.push({ id: `tw:doc:${a.vehicle.id}:${a.doc.kind}:${a.doc.expires_on}`, severity: a.expired ? 'critical' : 'warning', title: `${a.vehicle.reg_no}: ${a.doc.kind.replace('_', ' ')} ${a.expired ? 'expired' : 'expires'} ${a.doc.expires_on}`, detail: 'Renew it before the vehicle goes out on a trip.', href: `${HREF}&view=vehicles`, cta: 'Open vehicles', at });
  }
  const stale = loadTrips().filter((t) => t.status === 'open' && shiftDay(t.start_date, OPEN_TRIP_DAYS) < today);
  if (stale.length) out.push({ id: `tw:trips:${stale.length}`, severity: 'info', title: `${stale.length} trip(s) open for more than ${OPEN_TRIP_DAYS} days`, detail: 'Close them to settle the driver advance and see the trip P&L.', href: `${HREF}&view=trips`, cta: 'Open trips', at });
  return out;
}

export function registerTransportAlerts(): void {
  if (unregister) return;
  unregister = registerNotificationProvider((ctx) => {
    if (!isPackOn(localDb.settings.get(), 'transport')) return [];
    const today = localDayOf(ctx.now);
    return memoOnTables('r5b:transport-alerts', [GTA_OPTIONS_TABLE, VEHICLES_TABLE, TRIPS_TABLE], () => transportNotices(today, ctx.now.toISOString()), today) as AppNotification[];
  });
}

// Loading this chunk registers the provider (the bell's gate only imports it).
registerTransportAlerts();
