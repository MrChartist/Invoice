/**
 * PS-A2 Matters desk (`/time?tab=matters&view=`, pack `practice`): matters (project cost centres with matter fields),
 * engagements, conflict checks and engagement letters. The desk and its views are ONE lazy chunk; nothing is read
 * until the tab opens. PS-B adds its `stages` view here. Working papers — verify with your CA.
 */
import { useT } from '../../i18n';
import { pmT } from '../../i18n/areas/prof-r14a-matters';
import { psT } from '../../i18n/areas/prof-r14-common';
import controls from '../../styles/controls.module.css';
import { Views } from './ps-ui';
import type { PsDeskProps } from './ps-run';
import MattersView from './MattersView';
import EngagementsView from './EngagementsView';
import ConflictsView from './ConflictsView';
import LettersView from './LettersView';

const VIEWS = ['matters', 'engagements', 'conflicts', 'letters'] as const;
type View = (typeof VIEWS)[number];

export default function MattersDesk({ view, notify }: PsDeskProps) {
  useT();
  const v: View = (VIEWS as readonly string[]).includes(view ?? '') ? (view as View) : 'matters';
  return (
    <section data-matters-desk>
      <Views tab="matters" views={VIEWS} value={v} label={(k) => pmT(`v.${k}`)} />
      {v === 'matters' && <MattersView notify={notify} />}
      {v === 'engagements' && <EngagementsView notify={notify} />}
      {v === 'conflicts' && <ConflictsView notify={notify} />}
      {v === 'letters' && <LettersView notify={notify} />}
      <p className={controls.hint}>{psT('wp')}</p>
    </section>
  );
}
