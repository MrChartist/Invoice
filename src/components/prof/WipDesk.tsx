/**
 * PS-A3 / A4 WIP desk (`/time?tab=wip&view=`, pack `practice`): WIP with ageing and write-offs, the pre-bill (write-ups /
 * write-downs, billing models), realisation, utilisation, profitability, the year-end unbilled-work paper and (R16-B1)
 * unrecovered disbursements. One lazy
 * chunk; nothing is read until the tab opens. Working papers — verify with your CA.
 */
import { lazy, Suspense } from 'react';
import { useT } from '../../i18n';
import { pwT } from '../../i18n/areas/prof-r14a-wip';
import { psT } from '../../i18n/areas/prof-r14-common';
import controls from '../../styles/controls.module.css';
import { Views } from './ps-ui';
import type { PsDeskProps } from './ps-run';
import WipView from './WipView';
import PreBillView from './PreBillView';
import RealisationView from './RealisationView';
import UtilisationView from './UtilisationView';
import ProfitView from './ProfitView';
import YearEndWipView from './YearEndWipView';

// R16-B1: unrecovered disbursements (lazy; reads nothing until the view opens).
const DisbView = lazy(() => import('./DisbView'));

const VIEWS = ['wip', 'prebill', 'realisation', 'utilisation', 'profit', 'yearend', 'disb'] as const;
type View = (typeof VIEWS)[number];

export default function WipDesk({ view, notify }: PsDeskProps) {
  useT();
  const v: View = (VIEWS as readonly string[]).includes(view ?? '') ? (view as View) : 'wip';
  return (
    <section data-wip-desk>
      <Views tab="wip" views={VIEWS} value={v} label={(k) => pwT(`v.${k}`)} />
      {v === 'wip' && <WipView notify={notify} />}
      {v === 'prebill' && <PreBillView notify={notify} />}
      {v === 'realisation' && <RealisationView />}
      {v === 'utilisation' && <UtilisationView notify={notify} />}
      {v === 'profit' && <ProfitView />}
      {v === 'yearend' && <YearEndWipView notify={notify} />}
      {v === 'disb' && <Suspense fallback={null}><DisbView notify={notify} /></Suspense>}
      <p className={controls.hint}>{psT('wp')}</p>
    </section>
  );
}
