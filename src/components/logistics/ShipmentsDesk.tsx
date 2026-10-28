/**
 * R19 Shipments desk (`/time?tab=shipments&view=`, packs `logistics` / `customs` / `courier` / `warehouse`): A's views
 * `jobs` (job files) and `rates` (charge heads) are in this chunk; B (`billing`, `costing`),
 * C (`customs`, pack `customs`) and D (`agents`, `courier` / `storage` by pack) add one entry each in their block of
 * `VIEWS` (C / D add the `pack` filter with their pack views: a view whose pack is off is not listed, its URL still
 * opens it). Nothing is read until the tab opens.
 * Working papers — verify with your CA.
 */
import { Suspense, type ComponentType, type LazyExoticComponent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useT } from '../../i18n';
import { lgT } from '../../i18n/areas/logistics-r19a';
import { lgbT } from '../../i18n/areas/logistics-r19b';
import controls from '../../styles/controls.module.css';
import JobsView from './JobsView';
import RatesView from './RatesView';
import BillingView from './BillingView';
import CostingView from './CostingView';
import type { LgViewProps } from './lg-ui';

type View = { label: () => string; C: ComponentType<LgViewProps> | LazyExoticComponent<ComponentType<LgViewProps>> };
const VIEWS: Record<string, View> = {
  // R19-A
  jobs: { label: () => lgT('jobs'), C: JobsView },
  rates: { label: () => lgT('rates'), C: RatesView },
  // R19-B
  billing: { label: () => lgbT('billing'), C: BillingView },
  costing: { label: () => lgbT('costing'), C: CostingView },
  // R19-C (customs) · R19-D (agents, courier, storage)
};

export default function ShipmentsDesk({ view, notify }: LgViewProps & { view?: string }) {
  useT();
  const [, setParams] = useSearchParams();
  const v = Object.hasOwn(VIEWS, view ?? '') ? view! : 'jobs';
  const ids = Object.keys(VIEWS);
  const C = VIEWS[v].C;
  return (
    <section data-shipments-desk>
      <div className={controls.segment} role="tablist" style={{ marginBottom: '0.75rem' }}>
        {ids.map((k) => (
          <button key={k} type="button" role="tab" aria-selected={k === v} className={k === v ? controls.segmentBtnActive : controls.segmentBtn} onClick={() => setParams({ tab: 'shipments', view: k }, { replace: true })}>{VIEWS[k].label()}</button>
        ))}
      </div>
      <Suspense fallback={null}><C notify={notify} /></Suspense>
      <p className={controls.hint}>{lgT('wp')}</p>
    </section>
  );
}
