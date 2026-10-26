/** R7 test world: a Maharashtra lodge with two Deluxe rooms, one Suite and an EP plan. */
import { resetStorage } from './shim.ts';
import { installSettings } from './world.ts';
import { hotelDb, HOTEL_SETTINGS_KEY } from '../../src/lib/hotel/hotel-store.ts';
import { getJson, setJson } from '../../src/lib/storage.ts';
import type { RatePlan, Room, RoomType } from '../../src/types/hotel-r7.ts';
import type { ReservationInput } from '../../src/lib/hotel/reservations.ts';

export const DLX: RoomType = { id: 'dlx', name: 'Deluxe', code: 'DLX', base_occupancy: 2, max_occupancy: 3, max_extra_beds: 1 };
export const STE: RoomType = { id: 'ste', name: 'Suite', code: 'STE', base_occupancy: 2, max_occupancy: 4, max_extra_beds: 1 };
export const ROOMS: Room[] = [
  { id: 'r101', number: '101', room_type_id: 'dlx', floor: '1', active: true, hk_status: 'clean' },
  { id: 'r102', number: '102', room_type_id: 'dlx', floor: '1', active: true, hk_status: 'clean' },
  { id: 'r201', number: '201', room_type_id: 'ste', floor: '2', active: true, hk_status: 'clean' },
];
export const EP: RatePlan = {
  id: 'ep', name: 'Room only', code: 'EP', meal_plan: 'EP', audience: 'public', weekend_pct: 20,
  rates: [
    { room_type_id: 'dlx', single: 3000, double: 3500, extra_adult: 800, extra_child: 500, extra_bed: 700 },
    { room_type_id: 'ste', single: 8000, double: 8000, extra_adult: 1000, extra_child: 500, extra_bed: 1000 },
  ],
};

export function setupHotel(businessDate = '2026-10-20', over: Record<string, unknown> = {}): void {
  resetStorage();
  installSettings({ industry_packs: ['hotel'], ...over } as never);
  hotelDb.saveRoomTypes([DLX, STE]);
  hotelDb.saveRooms(ROOMS.map((r) => ({ ...r })));
  hotelDb.saveRatePlans([EP]);
  setJson(HOTEL_SETTINGS_KEY, { ...getJson(HOTEL_SETTINGS_KEY, {}), business_date: businessDate });
}

/** A one-room booking input. */
export function booking(arrival: string, departure: string, line: Partial<ReservationInput['lines'][number]> = {}, over: Partial<ReservationInput> = {}): ReservationInput {
  return {
    booked_on: arrival, source: 'phone', guest: { name: 'Asha Rao', phone: '9876543210' }, arrival, departure, guarantee: 'none',
    lines: [{ room_type_id: 'dlx', rate_plan_id: 'ep', adults: 2, children: 0, extra_beds: 0, ...line }],
    ...over,
  };
}
