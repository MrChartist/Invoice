/**
 * AG-A Farm desk (`/inventory?tab=farm&view=`, pack `agri`): farmers and members, farmer purchase vouchers, pooled
 * payment cycles, quality-cut tables and farm batches — each view its own lazy chunk. Working papers — verify with your CA.
 */
import { lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useT } from '../../i18n';
import { agT } from '../../i18n/areas/agri-r12a';
import controls from '../../styles/controls.module.css';
import type { Done } from './agri-util';

const VIEWS = {
  farmers: lazy(() => import('./FarmersView')),
  vouchers: lazy(() => import('./VouchersView')),
  cycles: lazy(() => import('./CyclesView')),
  quality: lazy(() => import('./QualityView')),
  batches: lazy(() => import('./BatchesView')),
} as const;
type View = keyof typeof VIEWS;

export default function FarmDesk({ view, onDone }: { view?: string; onDone: Done }) {
  useT();
  const [, setParams] = useSearchParams();
  const v: View = view && view in VIEWS ? (view as View) : 'farmers';
  const Body = VIEWS[v];
  return (
    <section data-farm-desk>
      <div role="tablist" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
        {(Object.keys(VIEWS) as View[]).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={k === v} className={k === v ? controls.btnPrimary : controls.btnOutline} onClick={() => setParams({ tab: 'farm', view: k })} data-farm-view={k}>{agT(`view.${k}`)}</button>
        ))}
      </div>
      <Suspense fallback={null}><Body onDone={onDone} /></Suspense>
      <p className={controls.hint}>{agT('wp')}</p>
    </section>
  );
}
