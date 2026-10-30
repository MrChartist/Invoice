/**
 * R15-B2 bookings: the components of a trip (table `travel_bookings`, dated by `start`, synced, audited, right
 * `doc.create`; a delete goes to the recycle bin through `setTable`). Billed state is DERIVED from `line_ref` — the
 * line must still be on a live (not cancelled) invoice — never a stored flag that can drift. Pure above "Storage".
 */
import './tv-registry';
import type { InvoiceRecord } from '../../types/invoice';
import type { TravelBooking, TvComponent } from '../../types/travel-r15';
import { generateId, getTable, setTable } from '../storage';
import { requireAccess } from '../access';
import { assertUnlocked } from '../period-lock';
import { round2 } from '../invoice-calc';
import { TV_TABLES } from './tv-shared';

export const TV_COMPONENTS: readonly TvComponent[] = ['air', 'rail', 'bus', 'hotel', 'transfer', 'sightseeing', 'visa', 'insurance', 'package', 'venue', 'catering', 'decor', 'artist', 'av', 'manpower', 'other'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Cost in rupees at the booking's rate (`fx`, 1 for INR). */
export const costInr = (b: Pick<TravelBooking, 'cost' | 'fx'>): number => round2((Number(b.cost) || 0) * (Number(b.fx) || 1));

/** Line ids still on live invoices (`invoice:line`). */
export function liveLines(invoices: readonly Pick<InvoiceRecord, 'id' | 'status' | 'items'>[]): Set<string> {
  const out = new Set<string>();
  for (const i of invoices) if (i?.status !== 'Cancelled') for (const l of i.items ?? []) out.add(`${i.id}:${l.id}`);
  return out;
}
export const isBilled = (b: Pick<TravelBooking, 'line_ref'>, live: ReadonlySet<string>): boolean => !!b.line_ref && live.has(`${b.line_ref.invoice_id}:${b.line_ref.line_id}`);

/** Problems with a booking (empty = may be saved). */
export function validateBooking(b: Partial<TravelBooking>): string {
  if (!b.trip_id) return 'Pick the trip.';
  if (!TV_COMPONENTS.includes(b.component as TvComponent)) return 'Choose the component.';
  if (!DAY.test(b.start ?? '')) return 'Enter the date.';
  if (b.end && b.end < (b.start ?? '')) return 'The end date is before the start date.';
  if (!(Number(b.cost) >= 0) || !(Number(b.sell) >= 0)) return 'Cost and sell cannot be negative.';
  return '';
}

// ── Storage ──────────────────────────────────────────────────────

export const loadBookings = (tripId?: string): TravelBooking[] => {
  const all = getTable<TravelBooking>(TV_TABLES.bookings).filter((b) => b?.id);
  return tripId ? all.filter((b) => b.trip_id === tripId) : all;
};

/** Add / edit a booking (`doc.create`; refused in a locked period). A billed booking keeps its line reference. */
export function saveBooking(i: Omit<TravelBooking, 'id' | 'created_at'> & { id?: string }): TravelBooking {
  requireAccess('doc.create');
  const err = validateBooking(i);
  if (err) throw new Error(err);
  assertUnlocked({ issue_date: i.start }, 'edit');
  const rows = loadBookings();
  const prev = i.id ? rows.find((b) => b.id === i.id) : undefined;
  const now = new Date().toISOString();
  const row: TravelBooking = { ...prev, ...i, id: prev?.id ?? generateId(), cost: round2(Number(i.cost) || 0), sell: round2(Number(i.sell) || 0), created_at: prev?.created_at ?? now, ...(prev ? { updated_at: now } : {}) };
  setTable(TV_TABLES.bookings, prev ? rows.map((b) => (b.id === row.id ? row : b)) : [...rows, row]);
  return row;
}

/** Delete a booking that is not billed (recycle bin through the watched table). */
export function removeBooking(id: string, live: ReadonlySet<string>): void {
  requireAccess('doc.create');
  const rows = loadBookings();
  const b = rows.find((x) => x.id === id);
  if (!b) return;
  if (isBilled(b, live)) throw new Error('This booking is billed: cancel it instead.');
  assertUnlocked({ issue_date: b.start }, 'delete');
  setTable(TV_TABLES.bookings, rows.filter((x) => x.id !== id));
}
