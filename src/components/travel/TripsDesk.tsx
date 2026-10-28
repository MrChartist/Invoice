/**
 * R15 Trips desk (`/time?tab=trips&view=`, packs `travel` / `events`): B's views `trips` (files, costing, Bill, trip
 * margin, 5 % ITC overrides) and `bookings` (every component with filters) are in this chunk; C (`statements`) and D
 * (`tcs`, `events`) add one lazy entry each in their block of `VIEWS`. Nothing is read until the tab opens.
 * Working papers — verify with your CA.
 */
import { Suspense, type ComponentType, type LazyExoticComponent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useT } from '../../i18n';
import { tvT } from '../../i18n/areas/travel-r15b';
import controls from '../../styles/controls.module.css';
import type { Notify, TvViewProps } from './tv-run';
import TripsView from './TripsView';
import BookingsView from './BookingsView';
import StatementsView from './StatementsView';
import { cvT } from '../../i18n/areas/travel-r15c';

type View = { label: () => string; C: ComponentType<TvViewProps> | LazyExoticComponent<ComponentType<TvViewProps>> };
const VIEWS: Record<string, View> = {
  // R15-B
  trips: { label: () => tvT('trips'), C: TripsView },
  bookings: { label: () => tvT('bookings'), C: BookingsView },
  // R15-C
  statements: { label: () => cvT('statements'), C: StatementsView }, // in the desk chunk (a lazy entry's preload list cost more)
  // R15-D: tcs, events (one `lazy(() => import(…))` entry each)
};

export default function TripsDesk({ view, notify }: { view?: string; notify: Notify }) {
  useT();
  const [, setParams] = useSearchParams();
  const ids = Object.keys(VIEWS);
  const v = ids.includes(view ?? '') ? view! : 'trips';
  const C = VIEWS[v].C;
  return (
    <section data-trips-desk>
      <div className={controls.segment} role="tablist" style={{ marginBottom: '0.75rem' }}>
        {ids.map((k) => (
          <button key={k} type="button" role="tab" aria-selected={k === v} className={k === v ? controls.segmentBtnActive : controls.segmentBtn} onClick={() => setParams({ tab: 'trips', view: k }, { replace: true })} data-tv-view={k}>{VIEWS[k].label()}</button>
        ))}
      </div>
      <Suspense fallback={null}><C notify={notify} /></Suspense>
      <p className={controls.hint}>{tvT('wp')}</p>
    </section>
  );
}
