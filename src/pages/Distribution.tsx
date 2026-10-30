import { lazy, Suspense, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { FilePlus2, Truck } from 'lucide-react';
import { Page } from '../components/ui/Page';
import { useToast } from '../components/ui/useToast';
import { useT } from '../i18n';
import { distT } from '../i18n/areas/distribution';
import surface from '../styles/surface.module.css';
import controls from '../styles/controls.module.css';
import own from '../components/distribution/dist.module.css';
import { visiblePackTabs } from '../lib/industry-packs'; // R5-B, R8-C (alsoPacks)
import { localDb } from '../lib/localDb';
import { defineArea } from '../i18n/area';
import { DISTRIBUTION_TABS, type DistributionTab } from './page-tabs'; // R6-B1
import { EmptyState } from '../components/ui/EmptyState';
import { LearnMore, distributionEmpty } from '../components/discover';
import { getTable } from '../lib/storage';
import { discoverT } from '../i18n/areas/discover-r6';
import { trT as r8T } from '../i18n/areas/trade-r8c';

const DistMasters = lazy(() => import('../components/distribution/DistMasters'));
const DistReports = lazy(() => import('../components/distribution/DistReports'));
const DistVan = lazy(() => import('../components/distribution/DistVan'));
const DistOrders = lazy(() => import('../components/distribution/DistOrders'));
const CreditPolicyCard = lazy(() => import('../components/distribution/CreditPolicyCard'));
// R5-B: transport pack (LRs, freight bills, trips, vehicles, GTA option) — listed only with the pack on; its URL still opens it.
const TransportTab = lazy(() => import('../components/transport/TransportTab'));
const trT = defineArea({ tab: 'Transport' } as const, { tab: 'ट्रांसपोर्ट' });
// R8: trading packs (A: claims, packaging; B: mandi, brokers; C: agency). Listed only with a pack on; URLs still open.
const ClaimsTab = lazy(() => import('../components/trade/ClaimsTab'));
const PackagingTab = lazy(() => import('../components/trade/PackagingTab'));
const MandiTab = lazy(() => import('../components/trade/MandiTab'));
const BrokersTab = lazy(() => import('../components/trade/BrokersTab'));
const AgencyTab = lazy(() => import('../components/trade/AgencyTab'));
const R8_TABS: ReadonlySet<string> = new Set(['claims', 'packaging', 'mandi', 'brokers', 'agency']);

type Tab = DistributionTab;
const TABS = DISTRIBUTION_TABS; // R6-B1: list in distribution-tabs.ts
const IDS: readonly string[] = TABS.map((t) => t.id);

/** Distribution (8F): areas / beats / routes, salesman reports, beat plan, van sales, order-pad import, credit control. */
export function Distribution() {
  useT();
  const [params, setParams] = useSearchParams();
  const asked = params.get('tab') as Tab | null;
  const [tab, setTabState] = useState<Tab>(asked && IDS.includes(asked) ? asked : 'masters');
  const { notify, toastNode } = useToast();
  const setTab = (t: Tab) => {
    setTabState(t);
    const next = new URLSearchParams(params);
    next.set('tab', t);
    setParams(next, { replace: true });
  };
  const onDone = (msg: string, error?: boolean) => notify(msg, error ? 'error' : undefined);
  const shown = useMemo(() => visiblePackTabs(TABS, localDb.settings.get(), tab), [tab]);
  return (
    <Page
      title={distT('title')}
      subtitle={distT('subtitle')}
      actions={<Link to="/order-pad" className={controls.btnOutline}><FilePlus2 size={16} aria-hidden="true" /> {distT('orderPad')}</Link>}
      data-distribution
    >
      <div className={own.stack}>
        <div className={controls.segment} role="tablist" aria-label={distT('title')}>
          {shown.map(({ id: t }) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? controls.segmentBtnActive : controls.segmentBtn} onClick={() => setTab(t)}>
              {t === 'transport' ? trT('tab') : R8_TABS.has(t) ? r8T(`tab.${t}` as 'tab.agency') : distT(`tab_${t as 'masters'}`)}
            </button>
          ))}
        </div>
        {/* R6-B3: no area / beat / route yet — what beats are for, and where to start. */}
        {tab === 'masters' && distributionEmpty(getTable('dist_areas').length, getTable('dist_beats').length, getTable('dist_routes').length) && (
          <EmptyState
            icon={Truck}
            title={discoverT('distTitle')}
            text={discoverT('distText')}
            action={
              <div className={surface.pageActions} style={{ justifyContent: 'center' }} data-dist-empty>
                <button type="button" className={controls.btnPrimary} onClick={() => document.querySelector<HTMLElement>('[data-distribution] section input')?.focus()}>
                  {discoverT('distAdd')}
                </button>
                <LearnMore topic="distribution" />
              </div>
            }
          />
        )}
        <section className={surface.card}>
          <div className={surface.cardBody}>
            <Suspense fallback={null}>
              {tab === 'masters' && <DistMasters onDone={onDone} />}
              {(tab === 'reports' || tab === 'plan') && <DistReports view={tab} />}
              {tab === 'van' && <DistVan onDone={onDone} />}
              {tab === 'orders' && <DistOrders onDone={onDone} />}
              {tab === 'credit' && <CreditPolicyCard onDone={onDone} />}
              {tab === 'transport' && <TransportTab onDone={onDone} />}
              {tab === 'claims' && <ClaimsTab onDone={onDone} />}
              {tab === 'packaging' && <PackagingTab onDone={onDone} />}
              {tab === 'mandi' && <MandiTab onDone={onDone} />}
              {tab === 'brokers' && <BrokersTab onDone={onDone} />}
              {tab === 'agency' && <AgencyTab onDone={onDone} />}
            </Suspense>
          </div>
        </section>
      </div>
      {toastNode}
    </Page>
  );
}
