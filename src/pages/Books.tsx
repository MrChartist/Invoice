import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  buildVouchers,
  loadBooksData,
  saveOpening,
  toIsoDate,
  type BooksData,
  type CashAccount,
} from '../lib/books';
import { setPeriodContext, usePeriodContext } from '../lib/period-context';
import { getAllReportPrefs, setAllReportPrefs } from '../lib/report-prefs';
import { StorageWriteError } from '../lib/storage';
import { useToast } from '../components/ui/useToast';
import { PageHeader } from '../components/ui/PageHeader';
import { PeriodBar } from '../components/books/PeriodBar';
import { CashBankTab } from '../components/books/CashBankTab';
import { OpeningBalanceModal } from '../components/books/OpeningBalanceModal';
import type { LedgerTabId } from '../components/books/ledger/LedgerPanel';
import surface from '../styles/surface.module.css';
import styles from './Books.module.css';
import { useT } from '../i18n';
import { booksT } from '../i18n/areas/books';
import { wireT } from '../i18n/areas/wiring';
import { useCan } from '../hooks/useCan';
import controls from '../styles/controls.module.css';

// The double-entry tabs (6.1–6.4) live in their own lazy chunk with the ledger engine.
const LedgerPanel = lazy(() => import('../components/books/ledger/LedgerPanel'));
// Cash-flow forecast (6.18) and exchange gain/loss (6.19): their own small lazy chunks.
const ForecastTab = lazy(() => import('../components/books/planning/ForecastTab'));
const FxTab = lazy(() => import('../components/books/planning/FxTab'));
// Tally parity: bill-wise payables, voucher registers, ratio analysis (their own lazy chunk).
// 8.109: saved views (period + tab + every report's F12 options) and month-end packs.
const ReportViewsBar = lazy(() => import('../components/invoicing-ux/ReportViewsBar'));
const TallyPanel = lazy(() => import('../components/books/tally/TallyPanel'));
// WP-7 entry points (also in Settings → Data and the Gateway): `?open=yearend` / `?open=tally`.
const TallyImport = lazy(() => import('../components/import/TallyImport').then((m) => ({ default: m.TallyImport })));
const YearEndWizard = lazy(() => import('../components/year-end/YearEndWizard').then((m) => ({ default: m.YearEndWizard })));

const TABS = [
  { id: 'day', label: 'tabDay' },
  { id: 'cash', label: 'tabCash' },
  { id: 'vch', label: 'tabVch' },
  { id: 'ledger', label: 'tabLedger' },
  { id: 'tb', label: 'tabTb' },
  { id: 'pnl', label: 'tabPnl' },
  { id: 'bs', label: 'tabBs' },
  { id: 'cf', label: 'tabCf' },
  { id: 'rpt', label: 'tabRpt' },
  { id: 'proj', label: 'tabProj' },
  { id: 'budget', label: 'tabBudget' },
  { id: 'coa', label: 'tabCoa' },
  { id: 'fcst', label: 'tabFcst' },
  { id: 'fx', label: 'tabFx' },
  { id: 'billwise', label: 'tabBillwise' },
  { id: 'vreg', label: 'tabVreg' },
  { id: 'ratio', label: 'tabRatio' },
] as const;
type TabId = (typeof TABS)[number]['id'];
// Day book and P&L read the ledger too (WP-2: one accounting truth); `rpt` = group summary, ratios, registers …
const LEDGER_TABS = new Set<TabId>(['day', 'pnl', 'rpt', 'vch', 'ledger', 'tb', 'bs', 'cf', 'coa', 'proj', 'budget']);

export function Books() {
  useT();
  const [params, setParams] = useSearchParams();
  const tabParam = params.get('tab');
  const tab: TabId = TABS.some((t) => t.id === tabParam) ? (tabParam as TabId) : 'day';

  // Shared report period (Alt+F2), remembered on this device for every ledger report.
  const { preset, period } = usePeriodContext();
  // 8.109: re-mount the report after a saved view restores its F12 options.
  const [viewTick, setViewTick] = useState(0);
  const [data, setData] = useState<BooksData>(() => loadBooksData());
  const [openingOpen, setOpeningOpen] = useState(false);
  const { notify, toastNode } = useToast();
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const { can } = useCan();
  const openParam = params.get('open');
  const wizard = openParam === 'yearend' && can('books.edit') ? 'yearend' : openParam === 'tally' && can('data.restore') ? 'tally' : null;
  const setWizard = (w: 'yearend' | 'tally' | null) => {
    const next = new URLSearchParams(params);
    if (w) next.set('open', w);
    else next.delete('open');
    setParams(next, { replace: true });
    if (!w) setData(loadBooksData());
  };

  // Re-read on mount/focus so edits made on other pages show up.
  useEffect(() => {
    const refresh = () => setData(loadBooksData());
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);

  const vouchers = useMemo(() => buildVouchers(data), [data]);

  const todayIso = toIsoDate(new Date());
  const asOf = period.end > todayIso ? todayIso : period.end;

  const selectTab = useCallback(
    (id: TabId) => {
      const next = new URLSearchParams(params);
      next.set('tab', id);
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  /** Drill-down: open an account (optionally one party of a control account) in the Ledger tab. */
  const openAccount = useCallback(
    (id: string, party?: string) => {
      const next = new URLSearchParams(params);
      next.set('tab', 'ledger');
      next.set('acct', id);
      if (party) next.set('party', party);
      else next.delete('party');
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  const onTabKey = (e: React.KeyboardEvent, index: number) => {
    const target: Record<string, number> = {
      ArrowRight: (index + 1) % TABS.length,
      ArrowLeft: (index - 1 + TABS.length) % TABS.length,
      Home: 0,
      End: TABS.length - 1,
    };
    const next = target[e.key];
    if (next === undefined) return;
    e.preventDefault();
    selectTab(TABS[next].id);
    tabRefs.current[TABS[next].id]?.focus();
  };

  const saveOpenings = (values: Record<CashAccount, { amount: number; as_of: string }>) => {
    try {
      saveOpening('cash', values.cash.amount, values.cash.as_of);
      saveOpening('bank', values.bank.amount, values.bank.as_of);
      setData(loadBooksData());
      setOpeningOpen(false);
      notify(booksT('openingSaved'));
    } catch (err) {
      notify(err instanceof StorageWriteError ? err.message : booksT('openingSaveFailed'), 'error');
    }
  };

  return (
    <div className={surface.page}>
      <PageHeader
        title={booksT('title')}
        subtitle={booksT('subtitle')}
        actions={
          <>
            {can('books.edit') && (
              <button type="button" className={controls.btnOutline} onClick={() => setWizard('yearend')}>{wireT('startNewYear')}</button>
            )}
            {can('data.restore') && (
              <button type="button" className={controls.btnGhost} onClick={() => setWizard('tally')}>{wireT('importTally')}</button>
            )}
          </>
        }
      />
      {wizard && (
        <Suspense fallback={null}>
          {wizard === 'tally' ? (
            <TallyImport open onClose={() => setWizard(null)} notify={notify} />
          ) : (
            <YearEndWizard open onClose={() => setWizard(null)} notify={notify} />
          )}
        </Suspense>
      )}

      <div className="no-print">
      <Suspense fallback={null}>
        <ReportViewsBar
          current={{ route: '/books', tab, preset, period, prefs: getAllReportPrefs() }}
          initialViewId={params.get('view')}
          onApply={(v) => {
            if (v.prefs) setAllReportPrefs(v.prefs);
            setPeriodContext(v.preset, v.preset === 'custom' ? v.period : undefined);
            if (TABS.some((t) => t.id === v.tab)) selectTab(v.tab as TabId);
            setViewTick((n) => n + 1);
          }}
        />
      </Suspense>

      <PeriodBar
        preset={preset}
        period={period}
        onChange={(p, range) => setPeriodContext(p, range)}
      />
      </div>

      <div className={`${styles.tabs} no-print`} role="tablist" aria-label={booksT('tablist')}>
        {TABS.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              tabRefs.current[t.id] = el;
            }}
            id={`books-tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            aria-controls={`books-panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            className={tab === t.id ? styles.tabActive : styles.tab}
            onClick={() => selectTab(t.id)}
            onKeyDown={(e) => onTabKey(e, i)}
          >
            {booksT(t.label)}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        key={viewTick}
        id={`books-panel-${tab}`}
        aria-labelledby={`books-tab-${tab}`}
        tabIndex={0}
        className={styles.panel}
      >
        {tab === 'cash' && (
          <CashBankTab
            vouchers={vouchers}
            openings={data.openings}
            period={period}
            onEditOpening={() => setOpeningOpen(true)}
          />
        )}
        {(tab === 'fcst' || tab === 'fx') && (
          <Suspense fallback={<p className={styles.loading} role="status">{booksT('loading')}</p>}>
            {tab === 'fcst' ? (
              <ForecastTab data={data} />
            ) : (
              <FxTab data={data} period={period} onChanged={() => setData(loadBooksData())} notify={(m) => notify(m)} />
            )}
          </Suspense>
        )}
        {(tab === 'billwise' || tab === 'vreg' || tab === 'ratio') && (
          <Suspense fallback={<p className={styles.loading} role="status">Loading…</p>}>
            <TallyPanel tab={tab} data={data} period={period} asOf={asOf} onOpenAccount={openAccount} onChanged={() => setData(loadBooksData())} notify={notify} />
          </Suspense>
        )}
        {LEDGER_TABS.has(tab) && (
          <Suspense fallback={<p className={styles.loading} role="status">{booksT('loadingLedger')}</p>}>
            <LedgerPanel
              tab={tab as LedgerTabId}
              data={data}
              period={period}
              asOf={asOf}
              account={params.get('acct') ?? 'bank'}
              party={params.get('party') ?? ''}
              onOpenAccount={openAccount}
              notify={notify}
            />
          </Suspense>
        )}
      </div>

      <OpeningBalanceModal
        open={openingOpen}
        onClose={() => setOpeningOpen(false)}
        openings={data.openings}
        onSave={saveOpenings}
        defaultAsOf={period.start}
      />
      {toastNode}
    </div>
  );
}
