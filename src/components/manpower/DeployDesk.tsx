/**
 * R17 Deploy desk (`/time?tab=deploy&view=`, packs `manpower` / `security`): A's view `sites` (sites, posts, rates,
 * client flags, deployed staff, regime chip) is in this chunk; B (`muster`, `bills`), C (`compliance`, `profit`) and
 * D (`statutory`) add one lazy entry each in their block of `VIEWS`. Nothing is read until the tab opens.
 * Working papers — verify with your CA.
 */
import { Suspense, type ComponentType, type LazyExoticComponent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useT } from '../../i18n';
import { mpT } from '../../i18n/areas/manpower-r17a';
import { mbT } from '../../i18n/areas/manpower-r17b';
import { mcT } from '../../i18n/areas/manpower-r17c';
import { mdT } from '../../i18n/areas/manpower-r17d';
import controls from '../../styles/controls.module.css';
import SitesView from './SitesView';
import MusterView from './MusterView';
import BillsView from './BillsView';
import ComplianceView from './ComplianceView';
import ProfitView from './ProfitView';
import StatutoryView from './StatutoryView';
import type { MpViewProps } from './mp-ui';

type View = { label: () => string; C: ComponentType<MpViewProps> | LazyExoticComponent<ComponentType<MpViewProps>> };
const VIEWS: Record<string, View> = {
  // R17-A
  sites: { label: () => mpT('sites'), C: SitesView },
  // R17-B: the duty register (+ payroll push) and the month's bills (static: one desk chunk, as R15-C measured)
  muster: { label: () => mpT('muster'), C: MusterView },
  bills: { label: () => mbT('bills'), C: BillsView },
  // R17-C: the client compliance pack (+ minimum-wage checks) and the site P&L
  compliance: { label: () => mpT('compliance'), C: ComplianceView },
  profit: { label: () => mcT('profit'), C: ProfitView },
  // R17-D: arrears debit notes, TDS receivable, licences and renewals
  statutory: { label: () => mdT('statutory'), C: StatutoryView },
};

export default function DeployDesk({ view, notify }: MpViewProps & { view?: string }) {
  useT();
  const [, setParams] = useSearchParams();
  const ids = Object.keys(VIEWS);
  const v = ids.includes(view ?? '') ? view! : 'sites';
  const C = VIEWS[v].C;
  return (
    <section data-deploy-desk>
      <div className={controls.segment} role="tablist" style={{ marginBottom: '0.75rem' }}>
        {ids.map((k) => (
          <button key={k} type="button" role="tab" aria-selected={k === v} className={k === v ? controls.segmentBtnActive : controls.segmentBtn} onClick={() => setParams({ tab: 'deploy', view: k }, { replace: true })} data-mp-view={k}>{VIEWS[k].label()}</button>
        ))}
      </div>
      <Suspense fallback={null}><C notify={notify} /></Suspense>
      <p className={controls.hint}>{mpT('wp')}</p>
    </section>
  );
}
