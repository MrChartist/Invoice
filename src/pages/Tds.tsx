import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { fyQuarterOf, loadChallans, loadManualDeductions, loadPayrollTdsChallans, loadReturnMarks, tdsDeductions, type TdsQuarter } from '../lib/tds-payables';
import { tcsCollections } from '../lib/tds-returns';
import { purchasesDb, paymentsDb } from '../lib/purchases';
import { vendorsDb } from '../lib/vendors';
import { getTable } from '../lib/storage';
import { todayInput } from '../lib/utils';
import type { InvoiceRecord } from '../types/invoice';
import { PageHeader } from '../components/ui/PageHeader';
import { useToast } from '../components/ui/useToast';
import { useCan } from '../hooks/useCan';
import { ChallansTab, DeductionsTab, Form16aTab, OverviewTab, ReturnsTab, type TdsData } from '../components/tds/TdsTabs';
import { useT } from '../i18n';
import { tdsT, type TdsKey } from '../i18n/areas/tds';
import { r7T } from '../i18n/areas/gst-tds-7r';
import { ita25T } from '../i18n/areas/ita2025';
import { ITA2025_FROM } from '../lib/ita2025';

// 7R (7.120): Form 27Q (non-residents) and the TRACES justification import — loaded when their tab opens.
const Form27qTab = lazy(() => import('../components/tds/Tds7rTabs').then((m) => ({ default: m.Form27qTab })));
const TracesTab = lazy(() => import('../components/tds/Tds7rTabs').then((m) => ({ default: m.TracesTab })));
import surface from '../styles/surface.module.css';
import controls from '../styles/controls.module.css';
import styles from './Books.module.css';

const TABS: readonly { id: string; key?: TdsKey; label?: () => string }[] = [
  { id: 'overview', key: 'tabOverview' },
  { id: 'deductions', key: 'tabDeductions' },
  { id: 'challans', key: 'tabChallans' },
  { id: 'returns', key: 'tabReturns' },
  { id: '27q', label: () => r7T('tab27q') },
  { id: 'f16a', key: 'tab16a' },
  { id: 'traces', label: () => r7T('tabTraces') },
];
const tabText = (t: (typeof TABS)[number]) => (t.key ? tdsT(t.key) : t.label?.() ?? t.id);

function loadData(): TdsData {
  return {
    rows: tdsDeductions({ purchases: purchasesDb.all(), payments: paymentsDb.all(), manual: loadManualDeductions(), vendors: vendorsDb.all(), returns: getTable('purchase_returns') }),
    tcs: tcsCollections(getTable<InvoiceRecord>('invoices')),
    challans: [...loadChallans(), ...loadPayrollTdsChallans()], // 7P: + payroll TDS (192), read-only
    marks: loadReturnMarks(),
    manual: loadManualDeductions(),
  };
}

/** TDS & TCS (Tally parity): deductions, challans, interest, due dates, 26Q / 27EQ / 16A papers. */
export function Tds() {
  useT();
  const [params, setParams] = useSearchParams();
  const tabParam = params.get('tab');
  const tab = TABS.some((t) => t.id === tabParam) ? (tabParam as string) : 'overview';
  const today = todayInput();
  const now = fyQuarterOf(today)!;
  const [fy, setFy] = useState(now.fy);
  const [quarter, setQuarter] = useState<TdsQuarter>(now.quarter);
  const [data, setData] = useState<TdsData>(() => loadData());
  const { notify, toastNode } = useToast();
  const canEdit = useCan().can('books.edit');
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const refresh = useCallback(() => setData(loadData()), []);

  useEffect(() => {
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [refresh]);

  const years = useMemo(() => {
    const set = new Set<number>([now.fy, now.fy - 1]);
    for (const r of [...data.rows, ...data.tcs]) set.add(r.fy);
    return [...set].sort((a, b) => b - a);
  }, [data, now.fy]);

  const select = (id: string) => {
    const next = new URLSearchParams(params);
    next.set('tab', id);
    setParams(next, { replace: true });
  };

  return (
    <div className={surface.page}>
      <PageHeader title={tdsT('title')} subtitle={tdsT('subtitle')} />
      <div className={`${styles.tabs} no-print`}>
        <label className={controls.field}>
          <span className={controls.label}>{tdsT('fy')}</span>
          <select className={controls.select} value={fy} onChange={(e) => setFy(Number(e.target.value))}>
            {years.map((y) => <option key={y} value={y}>FY {y}-{String(y + 1).slice(2)}</option>)}
          </select>
        </label>
        {(tab === 'returns' || tab === 'f16a' || tab === '27q') && (
          <label className={controls.field}>
            <span className={controls.label}>{tdsT('quarter')}</span>
            <select className={controls.select} value={quarter} onChange={(e) => setQuarter(Number(e.target.value) as TdsQuarter)}>
              {[1, 2, 3, 4].map((q) => <option key={q} value={q}>Q{q}</option>)}
            </select>
          </label>
        )}
      </div>
      <div className={`${styles.tabs} no-print`} role="tablist" aria-label={tdsT('title')}>
        {TABS.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              tabRefs.current[t.id] = el;
            }}
            id={`tds-tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            aria-controls={`tds-panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            className={tab === t.id ? styles.tabActive : styles.tab}
            onClick={() => select(t.id)}
            onKeyDown={(e) => {
              const n = e.key === 'ArrowRight' ? (i + 1) % TABS.length : e.key === 'ArrowLeft' ? (i - 1 + TABS.length) % TABS.length : -1;
              if (n < 0) return;
              e.preventDefault();
              select(TABS[n].id);
              tabRefs.current[TABS[n].id]?.focus();
            }}
          >
            {tabText(t)}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`tds-panel-${tab}`} aria-labelledby={`tds-tab-${tab}`} tabIndex={0} className={styles.panel}>
        {!canEdit && tab !== 'overview' && <p className={controls.hint}>{tdsT('readOnly')}</p>}
        {`${fy + 1}-03-31` >= ITA2025_FROM && <p className={controls.hint} data-ita2025-note>{ita25T('note')}</p>}
        {tab === 'overview' && <OverviewTab data={data} fy={fy} today={today} />}
        {tab === 'deductions' && <DeductionsTab data={data} fy={fy} today={today} canEdit={canEdit} onChanged={refresh} notify={notify} />}
        {tab === 'challans' && <ChallansTab data={data} canEdit={canEdit} onChanged={refresh} notify={notify} />}
        {tab === 'returns' && <ReturnsTab data={data} fy={fy} quarter={quarter} canEdit={canEdit} onChanged={refresh} notify={notify} />}
        {tab === 'f16a' && <Form16aTab data={data} fy={fy} quarter={quarter} />}
        {(tab === '27q' || tab === 'traces') && (
          <Suspense fallback={<p className={controls.hint}>{r7T('loading')}</p>}>
            {tab === '27q' ? <Form27qTab data={data} fy={fy} quarter={quarter} canEdit={canEdit} onChanged={refresh} notify={notify} /> : <TracesTab data={data} canEdit={canEdit} notify={notify} />}
          </Suspense>
        )}
      </div>
      {toastNode}
    </div>
  );
}
