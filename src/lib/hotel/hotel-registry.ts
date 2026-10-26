/**
 * R7 hotel table registrations that live in first-paint maps. `TABLE_ACTIONS` (access.ts) and `WATCHED_TABLES`
 * (audit-edits.ts) ship with the shell, so the hotel rows are added here at runtime by a lazy chunk (the Round 8
 * `tr-registry.ts` pattern). Importers: `hotel-store.ts` (every hotel write goes through it), and the lazy writers that
 * touch every table — the folder-sync engine and the recycle bin. Backup lists, sync DATED / NUMBERED and the
 * open-export schema are ordinary static rows. `tests/hotel-pack.test.ts` pins both maps.
 */
import { TABLE_ACTIONS, type AccessAction } from '../access';
import { WATCHED_TABLES, type WatchedTable } from '../audit-edits';

/** Masters need `master.edit`; bookings, folios, guests, night audits `doc.create` (housekeeping status: doc.create via
 * `hotelDb.patchRooms`); hotel settings `settings.manage`. */
export const HOTEL_TABLE_ACTIONS: Readonly<Record<string, AccessAction>> = {
  hotel_room_types: 'master.edit',
  hotel_rooms: 'master.edit',
  hotel_rate_plans: 'master.edit',
  hotel_reservations: 'doc.create',
  hotel_folios: 'doc.create',
  hotel_guests: 'doc.create',
  hotel_night_audits: 'doc.create',
  hotel_settings: 'settings.manage',
};

/** Every row change logged; deletes go to the recycle bin. Guest ID / passport / date-of-birth values are hidden. */
export const HOTEL_WATCHED: Readonly<Record<string, WatchedTable>> = {
  hotel_room_types: { entity: 'item', label: 'Room type' },
  hotel_rooms: { entity: 'item', label: 'Room' },
  hotel_rate_plans: { entity: 'item', label: 'Rate plan' },
  hotel_reservations: { entity: 'invoice', label: 'Reservation' },
  hotel_folios: { entity: 'invoice', label: 'Folio' },
  hotel_guests: { entity: 'client', label: 'Guest' },
  hotel_night_audits: { entity: 'voucher', label: 'Night audit' },
};

/** Idempotent: adds the rows once (never overwrites a row another module set). */
export function registerHotelTables(): void {
  const actions = TABLE_ACTIONS as Record<string, AccessAction | readonly AccessAction[]>;
  const watched = WATCHED_TABLES as Record<string, WatchedTable>;
  for (const [t, a] of Object.entries(HOTEL_TABLE_ACTIONS)) if (!actions[t]) actions[t] = a;
  for (const [t, w] of Object.entries(HOTEL_WATCHED)) if (!watched[t]) watched[t] = w;
}

registerHotelTables();
