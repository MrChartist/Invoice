/**
 * R18 Society desk (`/recurring?tab=society&view=`, pack `society`): A's views `units` (units and members, import) and
 * `heads` (tariff, State defaults, preview) are in this chunk; B (`bills`, `gst`), C (`dues`) and D (`funds`,
 * `registers`) add one entry each in their block of `VIEWS`. Nothing is read until the tab opens.
 * Working papers — verify with your CA.
 */
import { lazy, Suspense, type ComponentType, type LazyExoticComponent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useT } from '../../i18n';
import { hsT } from '../../i18n/areas/society-r18a';
import { hsbT } from '../../i18n/areas/society-r18b';
import controls from '../../styles/controls.module.css';
import UnitsView from './UnitsView';
import HeadsView from './HeadsView';
import type { HsViewProps } from './hs-ui';

type View = { label: () => string; C: ComponentType<HsViewProps> | LazyExoticComponent<ComponentType<HsViewProps>> };
const VIEWS: Record<string, View> = {
  // R18-A
  units: { label: () => hsT('units'), C: UnitsView },
  heads: { label: () => hsT('heads'), C: HeadsView },
  // R18-B
  bills: { label: () => hsbT('bills'), C: lazy(() => import('./BillsView')) },
  gst: { label: () => hsbT('gst'), C: lazy(() => import('./GstView')) },
};

export default function SocietyDesk({ view, notify }: HsViewProps & { view?: string }) {
  useT();
  const [, setParams] = useSearchParams();
  const ids = Object.keys(VIEWS);
  const v = ids.includes(view ?? '') ? view! : 'units';
  const C = VIEWS[v].C;
  return (
    <section data-society-desk>
      <div className={controls.segment} role="tablist" style={{ marginBottom: '0.75rem' }}>
        {ids.map((k) => (
          <button key={k} type="button" role="tab" aria-selected={k === v} className={k === v ? controls.segmentBtnActive : controls.segmentBtn} onClick={() => setParams({ tab: 'society', view: k }, { replace: true })}>{VIEWS[k].label()}</button>
        ))}
      </div>
      <Suspense fallback={null}><C notify={notify} /></Suspense>
      <p className={controls.hint}>{hsT('wp')}</p>
    </section>
  );
}
