import { lazy, Suspense, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Smartphone } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { useToast } from '../components/ui/useToast';
import { useT } from '../i18n';
import { distT } from '../i18n/areas/distribution';
import surface from '../styles/surface.module.css';
import controls from '../styles/controls.module.css';
import own from '../components/distribution/dist.module.css';

const DistMasters = lazy(() => import('../components/distribution/DistMasters'));
const DistReports = lazy(() => import('../components/distribution/DistReports'));
const DistVan = lazy(() => import('../components/distribution/DistVan'));
const DistOrders = lazy(() => import('../components/distribution/DistOrders'));
const CreditPolicyCard = lazy(() => import('../components/distribution/CreditPolicyCard'));

type Tab = 'masters' | 'reports' | 'plan' | 'van' | 'orders' | 'credit';
const TABS: Tab[] = ['masters', 'reports', 'plan', 'van', 'orders', 'credit'];

/** Distribution (8F): areas / beats / routes, salesman reports, beat plan, van sales, order-pad import, credit control. */
export function Distribution() {
  useT();
  const [params, setParams] = useSearchParams();
  const asked = params.get('tab') as Tab | null;
  const [tab, setTabState] = useState<Tab>(asked && TABS.includes(asked) ? asked : 'masters');
  const { notify, toastNode } = useToast();
  const setTab = (t: Tab) => {
    setTabState(t);
    const next = new URLSearchParams(params);
    next.set('tab', t);
    setParams(next, { replace: true });
  };
  const onDone = (msg: string, error?: boolean) => notify(msg, error ? 'error' : undefined);
  return (
    <div className={surface.page} data-distribution>
      <PageHeader
        title={distT('title')}
        subtitle={distT('subtitle')}
        actions={<Link to="/order-pad" className={controls.btnOutline}><Smartphone size={16} aria-hidden="true" /> {distT('orderPad')}</Link>}
      />
      <div className={own.stack}>
        <div className={controls.segment} role="tablist" aria-label={distT('title')}>
          {TABS.map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? controls.segmentBtnActive : controls.segmentBtn} onClick={() => setTab(t)}>
              {distT(`tab_${t}`)}
            </button>
          ))}
        </div>
        <section className={surface.card}>
          <div className={surface.cardBody}>
            <Suspense fallback={null}>
              {tab === 'masters' && <DistMasters onDone={onDone} />}
              {(tab === 'reports' || tab === 'plan') && <DistReports view={tab} />}
              {tab === 'van' && <DistVan onDone={onDone} />}
              {tab === 'orders' && <DistOrders onDone={onDone} />}
              {tab === 'credit' && <CreditPolicyCard onDone={onDone} />}
            </Suspense>
          </div>
        </section>
      </div>
      {toastNode}
    </div>
  );
}
