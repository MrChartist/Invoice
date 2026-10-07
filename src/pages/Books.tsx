import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { BalanceSheetTab } from '../components/books/BalanceSheetTab';
import { OpeningBalanceModal } from '../components/books/OpeningBalanceModal';
import surface from '../styles/surface.module.css';
import styles from './Books.module.css';

const TABS = [
  { id: 'day', label: 'Day book' },
  { id: 'cash', label: 'Cash & bank' },
  { id: 'pnl', label: 'Profit & loss' },
  { id: 'bs', label: 'Balance sheet' },
] as const;
type TabId = (typeof TABS)[number]['id'];

export function Books() {
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
      notify('Opening balances saved');
    } catch (err) {
      notify(err instanceof StorageWriteError ? err.message : 'Could not save opening balances', 'error');
    }
  };

  return (
    <div className={surface.page}>
      <PageHeader
        title="Books"
        subtitle="Day book, cash & bank, profit & loss and balance sheet — built from your invoices, receipts and purchases."
      />

      <PeriodBar
        preset={preset}
        period={period}
        onChange={(p, range) => {
          setPreset(p);
          setPeriod(range);
        }}
      />

      <div className={styles.tabs} role="tablist" aria-label="Books reports">
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
            {t.label}
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
        {tab === 'bs' && <BalanceSheetTab data={data} asOf={asOf} />}
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
