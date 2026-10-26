/**
 * R7-B4 company / travel-agent billing (city ledger). A company or agent bill is an ordinary credit invoice to that
 * client (due days from its terms), so receivables, ageing, statements, follow-ups and the TDS register work unchanged.
 * TDS the company deducts is chosen per client (D11): `none` (default) / `194I-B` (rooms taken on a regular basis =
 * rent, CBDT Circular 5/2002 as quoted) / `194C`; the rate comes from the existing date-keyed table (`tdsSections`) and
 * the label from `ita2025.ts` (Sec 393(1) from 1 Apr 2026). The app never guesses. Working paper — verify with your CA.
 */
import type { Client, InvoiceRecord } from '../../types/invoice';
import type { Reservation } from '../../types/hotel-r7';
import { tdsSections } from '../tax-rules';
import { sectionText } from '../ita2025';
import { requireAccess } from '../access';
import { hotelDb } from './hotel-store';
import { HotelError } from './reservations';
import { cleanRouting, defaultRouting } from './routing';

export const TDS_DEFAULTS = ['none', '194I-B', '194C'] as const;

/** The stored TDS code of a client default ('194C' → the "others" row: a company deducts as a company). */
export const tdsCode = (d: string | undefined): string => (d === '194C' ? '194C-2' : d === '194I-B' ? '194I-B' : '');

/** Invoice TDS fields for a client's default on `day` (null = none). */
export function tdsFor(client: Pick<Client, 'hotel'> | undefined, day: string): Pick<InvoiceRecord, 'tds_enabled' | 'tds_section' | 'tds_rate'> | null {
  const code = tdsCode(client?.hotel?.tds_default);
  const rate = code ? tdsSections(day).find((s) => s.section === code)?.rate : undefined;
  return rate === undefined ? null : { tds_enabled: true, tds_section: code, tds_rate: rate };
}

/** Label of a TDS code on a date (ITA 2025 reference from 1 Apr 2026). */
export const tdsLabel = (code: string, day: string): string => sectionText(code, day);

export const billKind = (r: Pick<Reservation, 'bill_kind' | 'bill_to'>): 'guest' | 'company' | 'agent' => r.bill_kind ?? (r.bill_to ? 'company' : 'guest');

/** Set the bill-to of a booking; the company default routing (room + meal plan → window 2) unless rules are given. */
export function setBillTo(resId: string, kind: 'guest' | 'company' | 'agent', client?: Pick<Client, 'id' | 'name' | 'company'>, routing?: Reservation['routing']): Reservation {
  requireAccess('doc.create');
  const res = hotelDb.reservation(resId);
  if (!res) throw new HotelError('This booking no longer exists.');
  if (kind !== 'guest' && !client?.id) throw new HotelError('Pick the company or agent (a saved client).');
  const bill_to = kind === 'guest' || !client?.id ? undefined : { client_id: client.id, name: client.company || client.name };
  const next: Reservation = { ...res, bill_kind: kind, bill_to, routing: cleanRouting(routing ?? defaultRouting({ bill_to })) };
  if (!bill_to) delete next.bill_to;
  // Open window-2 folios follow the new payer (the company's window); billed ones keep theirs.
  const payer = bill_to ? { kind: 'client' as const, client_id: bill_to.client_id, name: bill_to.name } : { kind: 'guest' as const, name: res.guest.name };
  const moved = hotelDb.folios().filter((f) => f.reservation_id === res.id && f.window === 2 && f.status === 'open' && !f.invoice_ids?.length);
  hotelDb.putReservations(next);
  if (moved.length) hotelDb.putFolios(...moved.map((f) => ({ ...f, payer })));
  return next;
}
