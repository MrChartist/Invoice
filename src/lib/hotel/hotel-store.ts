/**
 * R7-A1 hotel store: typed getters / setters for every hotel table and the `hotel_settings` object. The registries
 * (backup, sync, edit log / recycle bin, roles, open export) list every table, so deletes here (rows dropped through
 * `setTable`) reach the recycle bin like any watched table.
 *
 * Guards: masters need `master.edit`; reservations, folios, guests and night audits `doc.create`; settings
 * `settings.manage`. Two writes are made "as the app" after their own `doc.create` check, because a clerk does them:
 * housekeeping status on `hotel_rooms` (`patchRooms`) and the business date (`setBusinessDate`, night audit only).
 * Period lock: dated writes call `assertUnlocked` in their own modules (reservations, night audit).
 */
import type { Folio, Guest, HotelSettings, NightAudit, RatePlan, Reservation, Room, RoomType } from '../../types/hotel-r7';
import { DB_PREFIX, getJson, getTable, peekTable, setJson, setTable } from '../storage';
import { asSystem, requireAccess } from '../access';
import { todayIso } from '../tax-rules';

export const HT = {
  roomTypes: 'hotel_room_types',
  rooms: 'hotel_rooms',
  ratePlans: 'hotel_rate_plans',
  reservations: 'hotel_reservations',
  folios: 'hotel_folios',
  guests: 'hotel_guests',
  audits: 'hotel_night_audits',
} as const;
export const HOTEL_TABLES: readonly string[] = Object.values(HT);
export const HOTEL_SETTINGS_KEY = `${DB_PREFIX}hotel_settings`;
/** Reservation series (`RES/FY26-27/0001`). */
export const RES_PREFIX = 'RES';

export const DEFAULT_HOTEL_SETTINGS: Omit<HotelSettings, 'business_date'> = {
  checkin_time: '12:00',
  checkout_time: '11:00',
  clerk_void_cap: { lines: 2, amount: 1000 },
  interim_days: 30,
  interim_year_end: true,
  premises: [],
  tax_inclusive_default: false,
  sac_room: '996311',
  sac_fnb: '996331',
  hk_dirty_on_audit: true,
};

/* ── Starter masters (A2): shown until the first save, then written with it ── */

export const STARTER_TYPE: RoomType = { id: 'rt_std', name: 'Standard', code: 'STD', base_occupancy: 2, max_occupancy: 3, max_extra_beds: 1, sac: '996311' };
export const STARTER_PLAN: RatePlan = {
  id: 'rp_ep', name: 'Room only', code: 'EP', meal_plan: 'EP', audience: 'public', active: true,
  rates: [{ room_type_id: 'rt_std', single: 0, double: 0, extra_adult: 0, extra_child: 0, extra_bed: 0 }],
};
export const starterRooms = (): Room[] =>
  Array.from({ length: 10 }, (_, i) => ({ id: `rm_${101 + i}`, number: String(101 + i), room_type_id: 'rt_std', floor: '1', active: true, hk_status: 'clean' as const }));

/** True while the company still sees the starter masters (nothing saved yet). */
export const usingStarter = (): boolean => !peekTable(HT.roomTypes).length;

/** Write the starter masters the first time a booking needs them (not a user edit of masters). */
export function persistStarters(): void {
  asSystem(() => {
    if (!peekTable(HT.roomTypes).length) setTable(HT.roomTypes, [STARTER_TYPE]);
    if (!peekTable(HT.rooms).length) setTable(HT.rooms, starterRooms());
    if (!peekTable(HT.ratePlans).length) setTable(HT.ratePlans, [STARTER_PLAN]);
  });
}

/** Replace rows by id (new ids appended). */
function put<T extends { id: string }>(table: string, changed: readonly T[]): void {
  const ids = new Set(changed.map((r) => r.id));
  setTable(table, [...getTable<T>(table).filter((r) => !ids.has(r.id)), ...changed]);
}

const rowsOr = <T,>(table: string, starter: () => T[]): T[] => {
  const rows = getTable<T>(table);
  return rows.length ? rows : starter();
};

export const hotelDb = {
  roomTypes: (): RoomType[] => rowsOr(HT.roomTypes, () => [STARTER_TYPE]).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.name.localeCompare(b.name)),
  rooms: (): Room[] => rowsOr(HT.rooms, starterRooms).sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true })),
  ratePlans: (): RatePlan[] => rowsOr(HT.ratePlans, () => [STARTER_PLAN]),
  saveRoomTypes: (rows: RoomType[]): void => {
    requireAccess('master.edit');
    setTable(HT.roomTypes, rows);
  },
  saveRooms: (rows: Room[]): void => {
    requireAccess('master.edit');
    setTable(HT.rooms, rows);
  },
  saveRatePlans: (rows: RatePlan[]): void => {
    requireAccess('master.edit');
    setTable(HT.ratePlans, rows);
  },
  /** Housekeeping / occupancy fields on rooms (a clerk's job): `doc.create`, then written as the app. */
  patchRooms: (patch: Record<string, Partial<Pick<Room, 'hk_status' | 'hk_at' | 'hk_by' | 'ooo'>>>): void => {
    requireAccess('doc.create');
    if (usingStarter()) persistStarters();
    const rows = getTable<Room>(HT.rooms).map((r) => (patch[r.id] ? { ...r, ...patch[r.id] } : r));
    for (const r of rows) if (r.ooo === undefined) delete r.ooo;
    asSystem(() => setTable(HT.rooms, rows));
  },

  reservations: (): Reservation[] => getTable<Reservation>(HT.reservations),
  reservation: (id: string): Reservation | undefined => peekTable<Reservation>(HT.reservations).find((r) => r.id === id),
  putReservations: (...rows: Reservation[]): void => {
    requireAccess('doc.create');
    put(HT.reservations, rows);
  },

  folios: (): Folio[] => getTable<Folio>(HT.folios),
  putFolios: (...rows: Folio[]): void => {
    requireAccess('doc.create');
    put(HT.folios, rows);
  },

  guests: (): Guest[] => getTable<Guest>(HT.guests),
  putGuests: (...rows: Guest[]): void => {
    requireAccess('doc.create');
    put(HT.guests, rows);
  },

  audits: (): NightAudit[] => getTable<NightAudit>(HT.audits).sort((a, b) => a.business_date.localeCompare(b.business_date)),
  putAudit: (row: NightAudit): void => {
    requireAccess('doc.create');
    put(HT.audits, [row]);
  },

  /** Settings with defaults; the business date starts at the device's today until the first audit. */
  settings: (): HotelSettings => {
    const s = getJson<Partial<HotelSettings>>(HOTEL_SETTINGS_KEY, {});
    return { ...DEFAULT_HOTEL_SETTINGS, ...s, business_date: s.business_date || todayIso() } as HotelSettings;
  },
  saveSettings: (s: HotelSettings): void => {
    requireAccess('settings.manage');
    setJson(HOTEL_SETTINGS_KEY, s);
  },
  /** Night audit only (`doc.create`): the roll of the business date. */
  setBusinessDate: (day: string): void => {
    requireAccess('doc.create');
    const s = getJson<Partial<HotelSettings>>(HOTEL_SETTINGS_KEY, {});
    asSystem(() => setJson(HOTEL_SETTINGS_KEY, { ...s, business_date: day }));
  },
};
