import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  buildVouchers,
  loadBooksData,
  periodForPreset,
  saveOpening,
  toIsoDate,
  type BooksData,
  type CashAccount,
  type Period,
  type PeriodPreset,
} from '../lib/books';
import { StorageWriteError } from '../lib/storage';
import { useToast } from '../components/ui/useToast';
import { PageHeader } from '../components/ui/PageHeader';
import { PeriodBar } from '../components/books/PeriodBar';
import { DayBookTab } from '../components/books/DayBookTab';
import { CashBankTab } from '../components/books/CashBankTab';
import { ProfitLossTab } from '../components/books/ProfitLossTab';
import { OpeningBalanceModal } from '../components/books/OpeningBalanceModal';
import type { LedgerTabId } from '../components/books/ledger/LedgerPanel';
import surface from '../styles/surface.module.css';
import styles from './Books.module.css';
import { useT } from '../i18n';
import { booksT } from '../i18n/areas/books';

// The double-entry tabs (6.1–6.4) live in their own lazy chunk with the ledger engine.
const LedgerPanel = lazy(() => import('../components/books/ledger/LedgerPanel'));
// Cash-flow forecast (6.18) and exchange gain/loss (6.19): their own small lazy chunks.
const ForecastTab = lazy(() => import('../components/books/planning/ForecastTab'));
const FxTab = lazy(() => import('../components/books/planning/FxTab'));
// Tally parity: bill-wise payables, voucher registers, ratio analysis (their own lazy chunk).
const TallyPanel = lazy(() => import('../components/books/tally/TallyPanel'));

const TABS = [
  { id: 'day', label: 'tabDay' },
  { id: 'cash', label: 'tabCash' },
  { id: 'vch', label: 'tabVch' },
  { id: 'ledger', label: 'tabLedger' },
  { id: 'tb', label: 'tabTb' },
  { id: 'pnl', label: 'tabPnl' },
  { id: 'bs', label: 'tabBs' },
  { id: 'cf', label: 'tabCf' },
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
const LEDGER_TABS = new Set<TabId>(['vch', 'ledger', 'tb', 'bs', 'cf', 'coa', 'proj', 'budget']);

export function Books() {
  useT();
  const [params, setParams] = useSearchParams();
  const tabParam = params.get('tab');
  const tab: TabId = TABS.some((t) => t.id === tabParam) ? (tabParam as TabId) : 'day';

  const [preset, setPreset] = useState<PeriodPreset>('this_fy');
  const [period, setPeriod] = useState<Period>(() => periodForPreset('this_fy'));
  const [data, setData] = useState<BooksData>(() => loadBooksData());
  const [openingOpen, setOpeningOpen] = useState(false);
  const { notify, toastNode } = useToast();
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

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
      />

      <div className="no-print">
      <PeriodBar
        preset={preset}
        period={period}
        onChange={(p, range) => {
          setPreset(p);
          setPeriod(range);
        }}
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
        id={`books-panel-${tab}`}
        aria-labelledby={`books-tab-${tab}`}
        tabIndex={0}
        className={styles.panel}
      >
        {tab === 'day' && <DayBookTab vouchers={vouchers} period={period} />}
        {tab === 'cash' && (
          <CashBankTab
            vouchers={vouchers}
            openings={data.openings}
            period={period}
            onEditOpening={() => setOpeningOpen(true)}
          />
        )}
        {tab === 'pnl' && <ProfitLossTab data={data} period={period} />}
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
