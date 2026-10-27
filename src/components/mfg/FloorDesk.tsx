/**
 * MF-A Floor desk (`/manufacturing?tab=floor&view=`, pack `shopfloor`): work centres, routings, job cards (with the
 * operator screen and the day report), capacity load and promise date; WIP (MF-D5) is a stub until MF-D merges. The
 * desk and its views are ONE lazy chunk (gzip shares their vocabulary); nothing is read until the tab opens.
 * Working papers — verify with your CA.
 */
import { lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useT } from '../../i18n';
import { fT } from '../../i18n/areas/mfg-r13a';
import controls from '../../styles/controls.module.css';
import type { MfDeskProps } from './desk-props';
import CentresView from './CentresView';
import RoutingsView from './RoutingsView';
import JobCardsView from './JobCardsView';
import LoadView from './LoadView';

const WipView = lazy(() => import('./WipView')); // MF-D replaces it
const VIEWS = ['centres', 'routings', 'cards', 'load', 'wip'] as const;
type View = (typeof VIEWS)[number];

export default function FloorDesk({ view, ctx }: MfDeskProps) {
  useT();
  const [, setParams] = useSearchParams();
  const v: View = (VIEWS as readonly string[]).includes(view ?? '') ? (view as View) : 'cards';
  return (
    <section data-floor-desk>
      <div role="tablist" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
        {VIEWS.map((k) => (
          <button key={k} type="button" role="tab" aria-selected={k === v} className={k === v ? controls.btnPrimary : controls.btnOutline} onClick={() => setParams({ tab: 'floor', view: k })} data-floor-view={k}>{fT(`view.${k}`)}</button>
        ))}
      </div>
      {v === 'centres' && <CentresView ctx={ctx} />}
      {v === 'routings' && <RoutingsView ctx={ctx} />}
      {v === 'cards' && <JobCardsView ctx={ctx} />}
      {v === 'load' && <LoadView ctx={ctx} />}
      {v === 'wip' && <Suspense fallback={null}><WipView ctx={ctx} /></Suspense>}
      <p className={controls.hint}>{fT('wp')}</p>
    </section>
  );
}
