/**
 * R15-D2 / D3 place of supply of a trip or an event (pure; a chip and a printed note, never a change the user did not
 * make):
 *   - Indian client: Sec 12(2) IGST — registered → its State; else the address on record (TV18); hotel bookings billed
 *     outside a package: Sec 12(3), the property's location (hint);
 *   - foreign tourist / agent, tour performed in India (inbound or domestic): Sec 13(3)(b) — POS India, NOT an export
 *     even in foreign currency (TV19), taxable in the regime chosen;
 *   - foreign tourist, tour wholly outside India (outbound): offers the `exempt_outside` regime (TV10);
 *   - events (kind `event`), Sec 12(7)(a): registered client → its State; unregistered → the event's State in India;
 *     event abroad → the client's location (TV21).
 * When the user marks the supply as an export, the Sec 2(6) conditions come from R14 `ps-export-check.ts` (class
 * `physical`: performed abroad only on an outbound trip). A foreign DMC's bill for services abroad gets a "no import RCM
 * where the place of supply is outside India — verify" hint only (TV20); the bill's RCM default is not changed.
 * Working papers — verify with your CA.
 */
import type { Client, InvoiceRecord } from '../../types/invoice';
import type { TripInfo, TvComponent } from '../../types/travel-r15';
import { resolveStateCode } from '../india-states';
import { exportCheck, verdict, checkApplies } from '../prof/ps-export-check';

export type PosKey = 'reg' | 'addr' | 'inbound' | 'outside' | 'event_reg' | 'event_venue' | 'event_abroad' | 'unknown';
export interface TvPos {
  key: PosKey;
  /** GST state code of the place of supply ('' = not known / outside India per the rule). */
  state: string;
  /** The sentence snapshotted as `tv.pos_note` and printed. */
  note: string;
  /** A hotel booked on its own: Sec 12(3) hint. */
  hotel?: boolean;
  /** Offer the `exempt_outside` regime. */
  exempt?: boolean;
}

type Party = Partial<Pick<Client, 'gstin' | 'state_code' | 'state' | 'tv' | 'ps'>> | null | undefined;
const VERIFY = ' Verify with your CA.';

/** A foreign tourist / non-resident / foreign-address client. */
export const isForeign = (c: Party): boolean => !!(c?.tv?.foreign_tourist || c?.tv?.non_resident || c?.state_code === '96' || (c?.ps?.country && !/^(in|ind|india|bharat)$/i.test(c.ps.country.trim())));
const regOf = (c: Party) => (c?.gstin && c.gstin.trim().length === 15 ? c.gstin.trim().slice(0, 2) : '');
const stateOf = (c: Party) => resolveStateCode({ code: c?.state_code, gstin: c?.gstin, name: c?.state });

/** Sec 12(7)(a) for an event (TV21). `eventState` = GST state code of the venue, `96` = abroad. */
export function eventPos(client: Party, eventState?: string): TvPos {
  const reg = regOf(client);
  if (reg) return { key: 'event_reg', state: reg, note: 'Place of supply: location of the registered recipient (Sec 12(7)(a)(i) IGST).' + VERIFY };
  if (eventState && eventState !== '96') return { key: 'event_venue', state: eventState, note: 'Place of supply: where the event is held (Sec 12(7)(a)(ii) IGST).' + VERIFY };
  if (eventState === '96') return { key: 'event_abroad', state: stateOf(client), note: 'Event outside India: place of supply is the recipient\'s location (Sec 12(7)(a)(ii) IGST).' + VERIFY };
  return { key: 'unknown', state: '', note: '' };
}

/** POS of a trip / event invoice for this client (D2 / D3). */
export function travelPos(trip: Pick<TripInfo, 'kind' | 'scope' | 'regime' | 'event'>, client: Party, components: readonly TvComponent[] = []): TvPos {
  if (trip.kind === 'event') return eventPos(client, trip.event?.state);
  if (isForeign(client)) {
    return trip.scope === 'outbound'
      ? { key: 'outside', state: '96', exempt: trip.regime !== 'exempt_outside', note: 'Tour wholly outside India for a foreign tourist: exempt entry may apply (as reported).' + VERIFY }
      : { key: 'inbound', state: '', note: 'Performed in India: place of supply India, not an export even in foreign currency (Sec 13(3)(b) IGST, as recalled).' + VERIFY };
  }
  const reg = regOf(client);
  const hotel = trip.regime === 'agent' && components.includes('hotel');
  const s = reg || stateOf(client);
  if (!s) return { key: 'unknown', state: '', note: '', hotel };
  return { key: reg ? 'reg' : 'addr', state: s, hotel, note: `Place of supply: ${reg ? 'location of the registered recipient' : 'address of the recipient on record'} (Sec 12(2) IGST).` + VERIFY };
}

/**
 * The Sec 2(6) check (R14 PS-C1) for a trip invoice the user marked as an export (supply type / POS 96); null when the
 * document is not marked. Physical-presence class: performed abroad only on an outbound trip.
 */
export function tripExportCheck(inv: Partial<InvoiceRecord>, client: Parameters<typeof exportCheck>[0]['client'], scope: TripInfo['scope']) {
  if (!checkApplies(inv)) return null;
  const c = exportCheck({ invoice: { ...inv, ps: { ...inv.ps, export: { ...inv.ps?.export, pos_class: 'physical', abroad: scope === 'outbound' } } }, client });
  return { ok: c.ok, of: c.items.length, verdict: verdict(c) };
}

/** A foreign supplier's bill on an outbound trip: the "no import RCM where POS is outside India" hint (TV20). */
export const dmcHint = (vendor: { state_code?: string; gstin?: string; tv?: { kind?: string } } | undefined, scope?: TripInfo['scope']): boolean =>
  scope === 'outbound' && !!vendor && !vendor.gstin && (vendor.tv?.kind === 'dmc' || vendor.state_code === '96');
