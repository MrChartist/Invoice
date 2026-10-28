/**
 * MF-C Garments desk (`/manufacturing?tab=garments&view=`, pack `garments`): styles, cut plans, bundles, CMT job work,
 * karigars — one lazy chunk; the Rule 89(5) working paper (`inverted`) is its own lazy chunk. Working papers — verify with
 * your CA.
 */
import { lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useT } from '../../i18n';
import { gT } from '../../i18n/areas/mfg-r13c';
import controls from '../../styles/controls.module.css';
import type { MfDeskProps } from './desk-props';
import StylesView from './StylesView';
import CutPlansView from './CutPlansView';
import BundlesView from './BundlesView';
import CmtView from './CmtView';
import KarigarsView from './KarigarsView';

const InvertedDutyView = lazy(() => import('./InvertedDutyView'));
const VIEWS = ['styles', 'cutplans', 'bundles', 'cmt', 'karigars', 'inverted'] as const;
type View = (typeof VIEWS)[number];

export default function GarmentsDesk({ view, ctx }: MfDeskProps) {
  useT();
  const [, setParams] = useSearchParams();
  const v: View = (VIEWS as readonly string[]).includes(view ?? '') ? (view as View) : 'styles';
  return (
    <section data-garments-desk>
      <div role="tablist" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
        {VIEWS.map((k) => (
          <button key={k} type="button" role="tab" aria-selected={k === v} className={k === v ? controls.btnPrimary : controls.btnOutline} onClick={() => setParams({ tab: 'garments', view: k })} data-garments-view={k}>{gT(`view.${k}`)}</button>
        ))}
      </div>
      {v === 'styles' && <StylesView ctx={ctx} />}
      {v === 'cutplans' && <CutPlansView ctx={ctx} />}
      {v === 'bundles' && <BundlesView ctx={ctx} />}
      {v === 'cmt' && <CmtView ctx={ctx} />}
      {v === 'karigars' && <KarigarsView ctx={ctx} />}
      {v === 'inverted' && <Suspense fallback={null}><InvertedDutyView onDone={(m, err) => (err ? ctx.error(m) : ctx.changed(m))} /></Suspense>}
      <p className={controls.hint}>{gT('wp')}</p>
    </section>
  );
}
