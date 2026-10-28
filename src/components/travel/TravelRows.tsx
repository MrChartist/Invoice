/**
 * R15-B3 editor row (lazy, packs `travel` / `events`): pick the trip and the regime — the document takes the trip's
 * cost centre and the `tv` snapshot (trip, regime, printed sentence); other `tv` sub-objects (C / D) are
 * kept. Only the user's pick writes; an issued document keeps what it was saved with. Mixing the 5 % line with other
 * taxed lines warns (TV9), never blocks. D adds its POS / TCS chips as `switch` arms below.
 */
import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useInvoiceStore } from '../../store/useInvoiceStore';
import { useT } from '../../i18n';
import { tvT } from '../../i18n/areas/travel-r15b';
import type { TvRegime } from '../../types/travel-r15';
import { loadTrips, tripLabel } from '../../lib/travel/tv-trips';
import { regimeMix, tvSnapshot } from '../../lib/travel/tv-regime';
import { TV_REGIMES } from '../../lib/travel/tv-settings';
import controls from '../../styles/controls.module.css';
import { ListSelect } from './tv-ui';

// R15-D: place-of-supply and outbound TCS chips (in this lazy chunk; a nested Suspense here left the items footer
// without a layout box after reveal in Chromium — container-query invalidation).
import TvChips from './TvChips';

export default function TravelRows() {
  useT();
  const s = useInvoiceStore(useShallow((st) => ({ items: st.items, issue_date: st.issue_date, tv: st.tv, cc: st.cost_centre_id })));
  const trips = useMemo(() => loadTrips(), []);
  const tripId = s.tv?.trip?.id ?? (trips.some((t) => t.id === s.cc) ? s.cc : '');
  const trip = trips.find((t) => t.id === tripId);
  const apply = (id: string, regime?: TvRegime) => {
    const trip = trips.find((t) => t.id === id);
    if (!trip) return;
    const r = regime ?? s.tv?.regime ?? trip.tv.regime;
    useInvoiceStore.getState().patch({ cost_centre_id: trip.id, tv: { ...s.tv, ...tvSnapshot(trip, r, s.issue_date) } });
  };
  if (!trips.length && !s.tv) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }} data-tv-rows>
      <select className={controls.select} aria-label={tvT('trip')} value={tripId ?? ''} onChange={(e) => apply(e.target.value)} data-tv-pick-trip>
        <option value="">{tvT('trip')} —</option>
        {trips.map((t) => <option key={t.id} value={t.id}>{tripLabel(t)}</option>)}
      </select>
      {tripId && <ListSelect list="regs" ids={TV_REGIMES} value={s.tv?.regime ?? 'to18'} onChange={(r) => apply(tripId, r)} attr="data-tv-pick-regime" />}
      {regimeMix(s.items, s.tv?.regime) && <span className={controls.hint} role="note" data-tv-mix>{tvT('mix')}</span>}
      {/* R15-D */}
      {trip && <TvChips trip={trip} />}
    </div>
  );
}
