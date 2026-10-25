import { lazy, Suspense, useCallback, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Boxes } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { useToast } from '../components/ui/useToast';
import { stockDb } from '../lib/inventory';
import { liveTrackingInputs } from '../lib/stock-tracking';
import { godownsDb } from '../lib/godowns';
import { can } from '../lib/access';
import { cn } from '../lib/utils';
import { useT } from '../i18n';
import { mfgT } from '../i18n/areas/manufacturing';
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

// Phase 7M: job work / ITC-04 and Rejections In load on demand (own chunk).
const JobWorkTab = lazy(() => import('../components/job-work/JobWorkTab').then((m) => ({ default: m.JobWorkTab })));
const RejectionsInTab = lazy(() => import('../components/job-work/RejectionsInTab').then((m) => ({ default: m.RejectionsInTab })));

type Tab = 'boms' | 'mfg' | 'journal' | 'physical' | 'jobwork' | 'rejections' | 'reorder' | 'reports';
const TABS: Tab[] = ['boms', 'mfg', 'journal', 'physical', 'jobwork', 'rejections', 'reorder', 'reports'];
const LABEL = { boms: 'tabBoms', mfg: 'tabMfg', journal: 'tabSj', physical: 'tabPhysical', jobwork: 'tabJobWork', rejections: 'tabRejections', reorder: 'tabReorder', reports: 'tabReports' } as const;

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
  const setTab = useCallback((t: Tab) => setParams((p) => { p.set('tab', t); p.delete('jw'); return p; }, { replace: true }), [setParams]);
  const tracked = ctx.items.filter((i) => i.track_stock);

  return (
    <div className={surface.page}>
      <PageHeader
        title={mfgT('title')}
        subtitle={mfgT('subtitle')}
        actions={<Link to="/inventory" className={cn(controls.btnOutline, controls.btnSm)}><Boxes size={14} aria-hidden="true" /> {mfgT('inventory')}</Link>}
      />
      <div className={surface.card}>
        <div className={surface.cardBody}>
          <div className={cn(controls.segment, styles.tabs)} role="tablist" aria-label={mfgT('sections')}>
            {TABS.map((k) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? controls.segmentBtnActive : controls.segmentBtn} onClick={() => setTab(k)}>
                {mfgT(LABEL[k])}
              </button>
            ))}
          </div>
          {tracked.length === 0 && tab !== 'reports' ? (
            <p className={styles.notice}>{mfgT('noItems')} <Link to="/inventory">{mfgT('inventory')}</Link></p>
          ) : (
            <>
              {tab === 'boms' && <BomTab ctx={ctx} />}
              {tab === 'mfg' && <MfgJournalTab ctx={ctx} />}
              {tab === 'journal' && <StockJournalTab ctx={ctx} />}
              {tab === 'physical' && <PhysicalStockTab ctx={ctx} />}
              {tab === 'reorder' && <ReorderTab ctx={ctx} />}
              {tab === 'reports' && <StockReportsTab ctx={ctx} />}
              {(tab === 'jobwork' || tab === 'rejections') && (
                <Suspense fallback={<p className={styles.muted}>{mfgT('loading')}</p>}>
                  {tab === 'jobwork' ? <JobWorkTab ctx={ctx} /> : <RejectionsInTab ctx={ctx} />}
                </Suspense>
              )}
            </>
          )}
        </div>
      </div>
      {toastNode}
    </div>
  );
}
