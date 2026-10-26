/**
 * R7-A4 guest register (`hotel_guests`). Privacy (D9): an Aadhaar number is stored masked (`XXXX XXXX 1234`) unless
 * the user un-ticks "store masked"; lists show masked ids; the ID image is optional and off by default; nothing leaves
 * the device except through the user's own backup / sync. A foreign guest needs the Form C fields (as understood —
 * verify); "complete later" is allowed and keeps the Form C clock red.
 */
import type { ForeignDetails, Guest, IdType, Reservation } from '../../types/hotel-r7';
import { generateId } from '../storage';
import { hotelDb } from './hotel-store';
import { lineDates } from './availability';

export const ID_TYPES: readonly IdType[] = ['aadhaar', 'passport', 'driving_licence', 'voter_id', 'other'];

export const isIndian = (nationality?: string): boolean => !nationality || /^(in|ind|india|indian)$/i.test(nationality.trim());

/** `XXXX XXXX 1234` (any 12-digit Aadhaar; other strings keep their last 4). */
export function maskAadhaar(v: string): string {
  const d = String(v ?? '').replace(/\D/g, '');
  if (!d) return '';
  return `XXXX XXXX ${d.slice(-4)}`;
}

/** What a list shows for an ID (Aadhaar always masked; others: last 4). */
export function shownId(g: Pick<Guest, 'id_doc'>): string {
  const doc = g.id_doc;
  if (!doc?.number) return '';
  if (doc.type === 'aadhaar') return maskAadhaar(doc.number);
  return doc.number.length > 4 ? `…${doc.number.slice(-4)}` : doc.number;
}

/** Form C fields, in the order the portal asks them (as understood — verify). */
export const FORM_C_FIELDS: readonly (keyof ForeignDetails)[] = [
  'passport_no', 'passport_place', 'passport_issued', 'passport_expiry',
  'visa_no', 'visa_type', 'visa_place', 'visa_issued', 'visa_expiry',
  'arrived_india_on', 'arrived_from', 'next_destination', 'purpose', 'address_in_india',
];

/** Missing Form C fields of a foreign guest ([] for an Indian guest). */
export const formCMissing = (g: Pick<Guest, 'nationality' | 'foreign'>): (keyof ForeignDetails)[] =>
  isIndian(g.nationality) ? [] : FORM_C_FIELDS.filter((k) => !String(g.foreign?.[k] ?? '').trim());

/** A returning guest: same phone (last 10 digits) or same passport number. */
export function matchGuest(guests: readonly Guest[], q: { phone?: string; passport?: string }): Guest | undefined {
  const ph = String(q.phone ?? '').replace(/\D/g, '').slice(-10);
  const pp = String(q.passport ?? '').trim().toUpperCase();
  return guests.find((g) => (ph.length === 10 && String(g.phone ?? '').replace(/\D/g, '').slice(-10) === ph) || (!!pp && String(g.foreign?.passport_no ?? '').trim().toUpperCase() === pp));
}

export type GuestInput = Omit<Guest, 'id'> & { id?: string; storeMasked?: boolean };

/** Clean a guest for saving (masking, trimming). Pure. */
export function cleanGuest(input: GuestInput, now = new Date()): Guest {
  const { storeMasked = true, ...g } = input;
  if (!g.name?.trim()) throw new Error('Enter the guest name.');
  const doc = g.id_doc?.number?.trim() ? { ...g.id_doc, number: g.id_doc.number.trim() } : undefined;
  if (doc?.type === 'aadhaar') {
    const digits = doc.number.replace(/\D/g, '');
    if (!doc.masked && digits.length !== 12) throw new Error('An Aadhaar number has 12 digits.');
    if (storeMasked && !doc.masked) Object.assign(doc, { number: maskAadhaar(digits), masked: true });
  }
  const out: Guest = { ...g, id: g.id || generateId(), name: g.name.trim(), nationality: (g.nationality || 'IN').trim().toUpperCase(), updated_at: now.toISOString() };
  if (doc) out.id_doc = doc;
  else delete out.id_doc;
  if (isIndian(out.nationality)) delete out.foreign;
  if (!g.created_at) out.created_at = now.toISOString();
  return out;
}

export function saveGuest(input: GuestInput, now = new Date()): Guest {
  const g = cleanGuest(input, now);
  hotelDb.putGuests(g);
  return g;
}

export interface RegisterRow {
  guest: Guest;
  res: Reservation;
  room: string;
  arrival: string;
  departure: string;
  checked_in_at?: string;
  checked_out_at?: string;
}

/** Police / guest register: one row per guest per stay checked in between `from` and `to` (local days). */
export function guestRegister(reservations: readonly Reservation[], guests: readonly Guest[], roomNo: (id?: string) => string, from: string, to: string): RegisterRow[] {
  const byId = new Map(guests.map((g) => [g.id, g]));
  const out: RegisterRow[] = [];
  for (const res of reservations) {
    for (const l of res.lines) {
      const day = lineDates(res, l).arrival;
      if (!l.checked_in_at || day < from || day > to) continue;
      for (const gid of l.guest_ids ?? []) {
        const guest = byId.get(gid);
        if (guest) out.push({ guest, res, room: roomNo(l.room_id), ...lineDates(res, l), checked_in_at: l.checked_in_at, checked_out_at: l.checked_out_at });
      }
    }
  }
  return out.sort((a, b) => (a.checked_in_at ?? '').localeCompare(b.checked_in_at ?? ''));
}
