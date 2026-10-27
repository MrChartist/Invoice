/**
 * PS-A2 Matters desk (`/time?tab=matters&view=`, pack `practice`): matters (project cost centres with matter fields),
 * engagements, conflict checks and engagement letters. The desk and its views are ONE lazy chunk; nothing is read
 * until the tab opens. PS-B adds its `stages` view here. Working papers — verify with your CA.
 */
import { useT } from '../../i18n';
import { pmT } from '../../i18n/areas/prof-r14a-matters';
import { psT } from '../../i18n/areas/prof-r14-common';
import { psbT } from '../../i18n/areas/prof-r14b';
import controls from '../../styles/controls.module.css';
import { Views } from './ps-ui';
import type { PsDeskProps } from './ps-run';
import MattersView from './MattersView';
import EngagementsView from './EngagementsView';
import ConflictsView from './ConflictsView';
import LettersView from './LettersView';
import { lazy, Suspense } from 'react';
import { localDb } from '../../lib/localDb';

// PS-B4: the design stages view (pack `design`) — its own lazy chunk.
const StagesView = lazy(() => import('./StagesView'));
const VIEWS = ['matters', 'engagements', 'conflicts', 'letters', 'stages'] as const;
type View = (typeof VIEWS)[number];

export default function MattersDesk({ view, notify }: PsDeskProps) {
  useT();
  const design = ((s: { industry_packs?: unknown }) => Array.isArray(s.industry_packs) && s.industry_packs.includes('design'))(localDb.settings.get() as never);
  const views = design ? VIEWS : VIEWS.filter((k) => k !== 'stages');
  const v: View = (views as readonly string[]).includes(view ?? '') ? (view as View) : 'matters';
  return (
    <section data-matters-desk>
      <Views tab="matters" views={views} value={v} label={(k) => (k === 'stages' ? psbT('st.stage') : pmT(`v.${k}`))} />
      {v === 'matters' && <MattersView notify={notify} />}
      {v === 'engagements' && <EngagementsView notify={notify} />}
      {v === 'conflicts' && <ConflictsView notify={notify} />}
      {v === 'letters' && <LettersView notify={notify} />}
      {v === 'stages' && <Suspense fallback={null}><StagesView notify={notify} /></Suspense>}
      <p className={controls.hint}>{psT('wp')}</p>
    </section>
  );
}
