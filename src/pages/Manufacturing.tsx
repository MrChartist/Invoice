import { lazy, Suspense, useCallback, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Boxes } from 'lucide-react';
import { Page } from '../components/ui/Page';
import { useToast } from '../components/ui/useToast';
import { stockDb } from '../lib/inventory';
import { liveTrackingInputs } from '../lib/stock-tracking';
import { godownsDb } from '../lib/godowns';
import { can } from '../lib/access';
import { cn } from '../lib/utils';
import { useT } from '../i18n';
import { mfgT } from '../i18n/areas/manufacturing';
import { defineArea } from '../i18n/area';
import type { MfgContext } from '../components/manufacturing/context';
import { BomTab } from '../components/manufacturing/BomTab';
import { MfgJournalTab } from '../components/manufacturing/MfgJournalTab';
import { StockJournalTab } from '../components/manufacturing/StockJournalTab';
import { PhysicalStockTab } from '../components/manufacturing/PhysicalStockTab';
import { ReorderTab } from '../components/manufacturing/ReorderTab';
import { StockReportsTab } from '../components/manufacturing/StockReportsTab';
import surface from '../styles/surface.module.css';
import controls from '../styles/controls.module.css';
import styles from '../components/manufacturing/manufacturing.module.css';
import { MFG_PACK_TABS, MFG_TABS, type MfgPackTab, type MfgTab } from './page-tabs'; // R6-B1; R13 desks
import { localDb } from '../lib/localDb';
import { visibleTabs } from '../lib/industry-packs';

// Phase 7M: job work / ITC-04 and Rejections In load on demand (own chunk).
const JobWorkTab = lazy(() => import('../components/job-work/JobWorkTab').then((m) => ({ default: m.JobWorkTab })));
// 7S: production plan / material requirement (own chunk).
const MrpTab = lazy(() => import('../components/manufacturing/MrpTab').then((m) => ({ default: m.MrpTab })));
const RejectionsInTab = lazy(() => import('../components/job-work/RejectionsInTab').then((m) => ({ default: m.RejectionsInTab })));
// R4-A: production orders, order costing, batch trace & recall, QC desk, landed-cost voucher (each its own chunk).
const OrdersTab = lazy(() => import('../components/production/tabs').then((m) => ({ default: m.OrdersTab })));
const CostingTab = lazy(() => import('../components/production/tabs').then((m) => ({ default: m.CostingTab })));
const TraceTab = lazy(() => import('../components/production/tabs').then((m) => ({ default: m.TraceTab })));
const QcTab = lazy(() => import('../components/production/tabs').then((m) => ({ default: m.QcTab })));
const LandedVoucherTab = lazy(() => import('../components/production/tabs').then((m) => ({ default: m.LandedVoucherTab })));
// R4-B5: store replenishment from the warehouse, under Reorder Status (own chunk).
const ReplenishTab = lazy(() => import('../components/retail/ReplenishTab'));
// R13: manufacturing desks (one lazy chunk each; MF-A's floor desk, stubs for MF-B / C / D that they replace in place).
const DESKS = {
  floor: lazy(() => import('../components/mfg/FloorDesk')),
  shop: lazy(() => import('../components/mfg/ShopDesk')),
  moulding: lazy(() => import('../components/mfg/MouldingDesk')),
  press: lazy(() => import('../components/mfg/PressDesk')),
  garments: lazy(() => import('../components/mfg/GarmentsDesk')),
  food: lazy(() => import('../components/mfg/FoodDesk')),
  statutory: lazy(() => import('../components/mfg/StatutoryDesk')),
} as const;
const deskT = defineArea(
  { floor: 'Floor', shop: 'Shop', moulding: 'Moulding', press: 'Press', garments: 'Garments', food: 'Food', statutory: 'Statutory' } as const,
  { floor: 'फ़्लोर', shop: 'शॉप', moulding: 'मोल्डिंग', press: 'प्रेस', garments: 'गारमेंट', food: 'खाद्य', statutory: 'वैधानिक' },
);
const R4A_TABS =['orders', 'costing', 'trace', 'qc', 'landed'] as const;
// Tab labels only (inline, so the page does not load the production catalogue before a tab is opened).
const r4aTabT = defineArea(
  { orders: 'Production orders', costing: 'Order costing', trace: 'Trace & recall', qc: 'QC desk', landed: 'Landed cost' } as const,
  { orders: 'उत्पादन ऑर्डर', costing: 'ऑर्डर लागत', trace: 'ट्रेस और रिकॉल', qc: 'QC डेस्क', landed: 'लैंडेड कॉस्ट' },
);

type R4aTab = (typeof R4A_TABS)[number];
type Tab = MfgTab | MfgPackTab;
const TABS: readonly Tab[] = [...MFG_TABS, ...MFG_PACK_TABS.map((t) => t.id)]; // R6-B1: list in page-tabs.ts; R13 desks
const isDesk = (t: Tab): t is MfgPackTab => t in DESKS;
const isR4a = (t: Tab): t is R4aTab => (R4A_TABS as readonly string[]).includes(t);
const LABEL = { boms: 'tabBoms', mfg: 'tabMfg', journal: 'tabSj', physical: 'tabPhysical', jobwork: 'tabJobWork', rejections: 'tabRejections', plan: 'tabPlan', reorder: 'tabReorder', reports: 'tabReports' } as const;

/** /manufacturing — Tally-style manufacturing and stock vouchers (Phase 7). */
export function Manufacturing() {
  useT(); // re-render when the interface language changes
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab') as Tab | null;
  const tab: Tab = raw && TABS.includes(raw) ? raw : 'mfg';
  const [version, setVersion] = useState(0);
  const { notify, toastNode } = useToast();

  const ctx = useMemo((): MfgContext => {
    void version;
    return {
      items: stockDb.items(),
      godowns: godownsDb.list(),
      inputs: liveTrackingInputs(),
      version,
      changed: (m: string) => {
        setVersion((v) => v + 1);
        notify(m);
      },
      error: (m: string) => notify(m, 'error'),
      canBooks: can('books.edit'),
      canMasters: can('master.edit'),
    };
  }, [version, notify]);
  const setTab = useCallback((t: Tab) => setParams((p) => { p.set('tab', t); p.delete('jw'); p.delete('order'); p.delete('view'); return p; }, { replace: true }), [setParams]);
  const tracked = ctx.items.filter((i) => i.track_stock);

  return (
    <Page
      title={mfgT('title')}
      subtitle={mfgT('subtitle')}
      actions={<Link to="/inventory" className={cn(controls.btnOutline, controls.btnSm)}><Boxes size={14} aria-hidden="true" /> {mfgT('inventory')}</Link>}
    >
      <div className={surface.card}>
        <div className={surface.cardBody}>
          <div className={cn(controls.segment, styles.tabs)} role="tablist" aria-label={mfgT('sections')}>
            {[...MFG_TABS, ...visibleTabs(MFG_PACK_TABS, localDb.settings.get(), tab).map((t) => t.id)].map((k) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? controls.segmentBtnActive : controls.segmentBtn} onClick={() => setTab(k)} data-mfg-tab={k}>
                {isDesk(k) ? deskT(k) : isR4a(k) ? r4aTabT(k) : mfgT(LABEL[k])}
              </button>
            ))}
          </div>
          {isDesk(tab) ? (
            <Suspense fallback={<p className={styles.muted}>{mfgT('loading')}</p>}>
              {(() => { const Desk = DESKS[tab]; return <Desk view={params.get('view') ?? undefined} ctx={ctx} />; })()}
            </Suspense>
          ) : tracked.length === 0 && tab !== 'reports' ? (
            <p className={styles.notice}>{mfgT('noItems')} <Link to="/inventory">{mfgT('inventory')}</Link></p>
          ) : (
            <>
              {tab === 'boms' && <BomTab ctx={ctx} />}
              {tab === 'mfg' && <MfgJournalTab ctx={ctx} />}
              {tab === 'journal' && <StockJournalTab ctx={ctx} />}
              {tab === 'physical' && <PhysicalStockTab ctx={ctx} />}
              {tab === 'reorder' && <ReorderTab ctx={ctx} />}
              {tab === 'reorder' && ctx.godowns.length > 1 && <Suspense fallback={null}><ReplenishTab ctx={ctx} /></Suspense>}{/* R4-B5 */}
              {tab === 'reports' && <StockReportsTab ctx={ctx} />}
              {(tab === 'jobwork' || tab === 'rejections' || tab === 'plan') && (
                <Suspense fallback={<p className={styles.muted}>{mfgT('loading')}</p>}>
                  {tab === 'jobwork' ? <JobWorkTab ctx={ctx} /> : tab === 'plan' ? <MrpTab ctx={ctx} /> : <RejectionsInTab ctx={ctx} />}
                </Suspense>
              )}
              {isR4a(tab) && (
                <Suspense fallback={<p className={styles.muted}>{mfgT('loading')}</p>}>
                  {tab === 'orders' ? <OrdersTab ctx={ctx} /> : tab === 'costing' ? <CostingTab ctx={ctx} /> : tab === 'trace' ? <TraceTab ctx={ctx} /> : tab === 'qc' ? <QcTab ctx={ctx} /> : <LandedVoucherTab ctx={ctx} />}
                </Suspense>
              )}
            </>
          )}
        </div>
      </div>
      {toastNode}
    </Page>
  );
}
