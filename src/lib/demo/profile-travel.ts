/**
 * R15 sample rows of the travel profile (Demo company only, R6-B4). Dispatched by the Demo company's packs (`travel` /
 * `events`); one block per package (§6 of docs/prd/round-15.md). Pure.
 */
import type { DemoExtras } from '../demo-data';
import type { TravelBooking, TvComponent } from '../../types/travel-r15';
import { shiftDay } from '../dates';
import type { ProfileContext } from './profiles';

export function travelExtras(ctx: ProfileContext): DemoExtras {
  const { today, base } = ctx;
  const tables: NonNullable<DemoExtras['tables']> = {};
  // R15-B: a Goa package for a family of four under the 5 % regime, with three bookings (hotel, cab, flights held).
  const from = shiftDay(today, 20);
  const at = `${today}T09:00:00.000Z`;
  tables.cost_centres = [{ id: 'demo-trip-1', demo: true, name: 'Goa — Mehta family (demo)', kind: 'project', client_id: base.clients[0]?.id, active: true, status: 'active', start: from, created_at: at, tv: { code: `${from.slice(2, 4)}${from.slice(5, 7)}-001`, kind: 'trip', scope: 'domestic', destination: 'Goa', start: from, end: shiftDay(from, 5), regime: 'to5', status: 'confirmed', pax: ['Ravi Mehta', 'Asha Mehta', 'Kabir Mehta', 'Mira Mehta'].map((name, i) => ({ name, type: i > 1 ? 'child' : 'adult' })) } }] as never;
  const b = (id: string, component: TvComponent, cost: number, sell: number, status: TravelBooking['status'], ref: string): TravelBooking & { demo: true } => ({ id, demo: true, trip_id: 'demo-trip-1', component, start: from, end: shiftDay(from, 5), cost, sell, status, ref, created_at: at });
  tables.travel_bookings = [b('demo-tb-1', 'hotel', 42000, 50000, 'confirmed', 'Resort 5 nights (demo)'), b('demo-tb-2', 'transfer', 6000, 7500, 'confirmed', 'Cab, airport and sightseeing (demo)'), b('demo-tb-3', 'air', 38000, 42500, 'held', 'PNR DEMO12')];
  return { tables };
}
