/**
 * R15-B2 / B3 purchase-bill row (lazy, packs `travel` / `events`): the trip (and booking) a supplier bill belongs to,
 * written as `PurchaseRecord.tv`. A bill of a 5 % trip is prefilled "ITC not eligible" (except another operator's
 * package); claiming it anyway needs a reason, which the bill form audits (TV8, TV28).
 */
import { useMemo } from 'react';
import { useT } from '../../i18n';
import { tvList, tvT } from '../../i18n/areas/travel-r15b';
import type { PurchaseRecord } from '../../types/purchases';
import { loadTrips, tripLabel } from '../../lib/travel/tv-trips';
import { TV_COMPONENTS, loadBookings } from '../../lib/travel/tv-bookings';
import { tripTag } from '../../lib/travel/tv-itc';
import controls from '../../styles/controls.module.css';
import { Field } from './tv-ui';

type Tag = PurchaseRecord['tv'];

export default function TripPick({ value, onChange, itc, setItc }: { value: Tag; onChange: (v: Tag) => void; itc: boolean; setItc: (on: boolean) => void }) {
  useT();
  const trips = useMemo(() => loadTrips(), []);
  const tripId = value?.trip_id;
  const bookings = useMemo(() => (tripId ? loadBookings(tripId) : []), [tripId]);
  const pick = (tripId: string, bookingId?: string) => {
    const trip = trips.find((t) => t.id === tripId);
    if (!trip) return onChange(undefined);
    const tag = tripTag(trip, bookings.find((b) => b.id === bookingId && b.trip_id === tripId));
    if (tag.regime === 'to5') setItc(false);
    onChange(tag);
  };
  if (!trips.length && !value) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end' }} data-tv-trip-pick>
      <Field label={tvT('trip')}>
        <select className={controls.select} value={value?.trip_id ?? ''} onChange={(e) => pick(e.target.value)} data-tv-bill-trip>
          <option value="">—</option>
          {trips.map((t) => <option key={t.id} value={t.id}>{tripLabel(t)}</option>)}
        </select>
      </Field>
      {value?.trip_id && bookings.length > 0 && (
        <Field label={tvT('booking')}>
          <select className={controls.select} value={value.booking_id ?? ''} onChange={(e) => pick(value.trip_id, e.target.value || undefined)} data-tv-bill-booking>
            <option value="">—</option>
            {bookings.map((b) => <option key={b.id} value={b.id}>{b.start} · {tvList('comps', TV_COMPONENTS, b.component)}{b.ref ? ` · ${b.ref}` : ''}</option>)}
          </select>
        </Field>
      )}
      {value?.regime === 'to5' && (itc
        ? <Field label={tvT('itcReason')}><input className={controls.input} value={value.itc_reason ?? ''} onChange={(e) => onChange({ ...value, itc_reason: e.target.value })} data-tv-itc-reason /></Field>
        : <span className={controls.hint} data-tv-itc-blocked>{tvT('itcBlocked')}</span>)}
    </div>
  );
}
