import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, IndianRupee, Percent, ReceiptText, Wallet } from 'lucide-react';
import {
  cashBook,
  buildVouchers,
  gstSummary,
  inPeriod,
  loadBooksData,
  periodForPreset,
  profitAndLoss,
  type BooksData,
  type Period,
  type PeriodPreset,
} from '../lib/books';
import { isoDay } from '../lib/dates';
import { round2 } from '../lib/invoice-calc';
import { buildItemIndex, loadPositions, type StockPosition } from '../lib/inventory';
import { localDb } from '../lib/localDb';
import { getTable } from '../lib/storage';
import type { RestockLink } from '../lib/credit-restock';
import {
  concentration,
  expenseReport,
  paymentModes,
  salesByCustomer,
  salesDocs,
  taxByRate,
} from '../lib/sales-reports';
import { summarize } from '../lib/stats';
import { formatMoney } from '../lib/utils';
import { PageHeader } from '../components/ui/PageHeader';
import { StatCard } from '../components/ui/StatCard';
import { PeriodBar } from '../components/books/PeriodBar';
import { CrossChecks, type CrossCheck } from '../components/reports/CrossChecks';
import { CustomersTab, ItemsTab, MonthlyTab, TopCustomersTab } from '../components/reports/SalesTabs';
import { ExpensesTab, PaymentsTab, TaxTab } from '../components/reports/MoneyTabs';
import { ItemProfitTab, PartyProfitTab } from '../components/reports/ProfitabilityTabs';
import { itemProfitability, partyProfitability } from '../lib/profitability';
import surface from '../styles/surface.module.css';
import report from '../components/reports/reports.module.css';
import styles from './Reports.module.css';
import { useT } from '../i18n';
import { repT } from '../i18n/areas/reports';
import { plural } from '../i18n/areas/plural';

// 8.109: saved views + month-end packs (own chunk).
const ReportViewsBar = lazy(() => import('../components/invoicing-ux/ReportViewsBar'));

const TABS = [
  { id: 'customers', label: 'tabCustomers' },
  { id: 'items', label: 'tabItems' },
  { id: 'monthly', label: 'tabMonthly' },
  { id: 'top', label: 'tabTop' },
  { id: 'tax', label: 'tabTax' },
  { id: 'payments', label: 'tabPayments' },
  { id: 'expenses', label: 'tabExpenses' },
  { id: 'profit', label: 'tabProfit' },
  { id: 'party', label: 'tabParty' },
] as const;
type TabId = (typeof TABS)[number]['id'];

const inr = (v: string | undefined) => (v || 'INR').toUpperCase() === 'INR';

export function Reports() {
  const { lang } = useT();
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab');
  const tab: TabId = TABS.some((t) => t.id === requested) ? (requested as TabId) : 'customers';

  const [preset, setPreset] = useState<PeriodPreset>('this_fy');
  const [period, setPeriod] = useState<Period>(() => periodForPreset('this_fy'));
  const [version, setVersion] = useState(0);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    const refresh = () => setVersion((v) => v + 1);
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);

  /* eslint-disable react-hooks/exhaustive-deps */
  const invoices = useMemo(() => localDb.invoices.getAll(), [version]);
  const books: BooksData = useMemo(() => loadBooksData(), [version]);
  const positions: StockPosition[] = useMemo(() => {
    try {
      return loadPositions();
    } catch {
      return [];
    }
  }, [version]);
  /* eslint-enable react-hooks/exhaustive-deps */

  const { docs, excludedForeign } = useMemo(() => salesDocs(invoices), [invoices]);
  // Stock items by name: sales-by-item reads alternate-unit lines (2 BOX of 12) in the item's base unit.
  const itemIndex = useMemo(() => buildItemIndex(positions.map((p) => p.item)), [positions]);
  const customers = useMemo(() => salesByCustomer(docs, period), [docs, period]);
  const conc = useMemo(() => concentration(customers), [customers]);
  const taxRep = useMemo(() => taxByRate(docs, period), [docs, period]);
  const modes = useMemo(() => paymentModes(books.transactions, invoices, period), [books.transactions, invoices, period]);
  const expenses = useMemo(() => expenseReport(books.purchases, books.vendors, period), [books, period]);
  const profitInput = useMemo(
    () => ({ invoices, purchases: books.purchases, vendors: books.vendors, positions, clients: localDb.clients.getAll(), links: getTable<RestockLink>('doc_links') }),
    [invoices, books, positions],
  );
  const itemProfit = useMemo(() => itemProfitability(profitInput, period), [profitInput, period]);
  const partyProfit = useMemo(() => partyProfitability(profitInput, period), [profitInput, period]);

  /* Cross-checks: the same period through Dashboard maths and Books (rupee documents only). */
  const checks: CrossCheck[] = useMemo(() => {
    const foreign = new Set(invoices.filter((i) => !inr(i.currency)).map((i) => i.id));
    const inrBooks: BooksData = {
      ...books,
      invoices: books.invoices.filter((i) => inr(i.currency)),
      transactions: books.transactions.filter((t) => !foreign.has(t.invoice_id)),
    };
    const inPeriodInr = invoices.filter((i) => inr(i.currency) && inPeriod(isoDay(i.issue_date), period));
    const dash = summarize(inPeriodInr);
    const pl = profitAndLoss(inrBooks, period, 'accrual');
    const gst = gstSummary(inrBooks, period);
    const vouchers = buildVouchers(inrBooks);
    const received = round2(cashBook(vouchers, [], 'cash', period).totalReceipts + cashBook(vouchers, [], 'bank', period).totalReceipts);
    return [
      { label: repT('ccBilled'), report: customers.totals.total, other: dash.billed, source: repT('srcDashboard') },
      { label: repT('ccIncome'), report: customers.totals.income, other: pl.income, source: repT('srcPl') },
      { label: repT('ccGst'), report: round2(taxRep.totals.cgst + taxRep.totals.sgst + taxRep.totals.igst), other: gst.outputTotal, source: repT('srcGst') },
      { label: repT('ccReceived'), report: modes.total, other: received, source: repT('srcCash') },
      { label: repT('ccPurchases'), report: expenses.totals.cost, other: pl.totalExpenses, source: repT('srcPl') },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `lang` re-labels the rows
  }, [invoices, books, period, customers, taxRep, modes, expenses, lang]);

  const selectTab = (id: TabId) => {
    const next = new URLSearchParams(params);
    next.set('tab', id);
    setParams(next, { replace: true });
  };
  const onTabKey = (e: React.KeyboardEvent, index: number) => {
    const target: Record<string, number> = {
      ArrowRight: (index + 1) % TABS.length,
      ArrowLeft: (index - 1 + TABS.length) % TABS.length,
      Home: 0,
      End: TABS.length - 1,
    };
    const n = target[e.key];
    if (n === undefined) return;
    e.preventDefault();
    selectTab(TABS[n].id);
    tabRefs.current[TABS[n].id]?.focus();
  };

  const t = customers.totals;
  return (
    <div className={surface.page}>
      <PageHeader
        title={repT('title')}
        subtitle={repT('subtitle')}
      />

      <Suspense fallback={null}>
        <ReportViewsBar
          current={{ route: '/reports', tab, preset, period }}
          initialViewId={params.get('view')}
          openPacks={params.get('packs') === '1'}
          initialMonth={params.get('month')}
          onApply={(v) => {
            setPreset(v.preset);
            setPeriod(v.preset === 'custom' && v.period ? v.period : periodForPreset(v.preset));
            if (TABS.some((t) => t.id === v.tab)) selectTab(v.tab as TabId);
          }}
        />
      </Suspense>

      <PeriodBar
        preset={preset}
        period={period}
        onChange={(p, range) => {
          setPreset(p);
          setPeriod(range);
        }}
      />

      <div className={surface.statGrid}>
        <StatCard label={repT('statNetSales')} icon={IndianRupee} value={`₹${formatMoney(t.taxable)}`} hint={repT('statNetSalesHint')} />
        <StatCard label={repT('statBilled')} icon={ReceiptText} value={`₹${formatMoney(t.total)}`} hint={`${plural(repT, 'invoicesOne', 'invoicesMany', t.count)}${t.creditNotes ? ` · ${plural(repT, 'creditNotesOne', 'creditNotesMany', t.creditNotes)}` : ''}`} />
        <StatCard label={repT('statReceived')} icon={Wallet} tone="profit" value={`₹${formatMoney(modes.total)}`} hint={plural(repT, 'receiptsOne', 'receiptsMany', modes.count)} />
        <StatCard
          label={repT('statTop3')}
          icon={Percent}
          tone={conc.level === 'high' ? 'loss' : conc.level === 'moderate' ? 'warning' : 'default'}
          value={conc.customers ? `${conc.top3Share.toFixed(1)}%` : '—'}
          hint={conc.customers ? plural(repT, 'customersOne', 'customersMany', conc.customers) : repT('noSalesYet')}
        />
      </div>

      {excludedForeign > 0 && (
        <div className={report.noticeWarn} role="note">
          <AlertTriangle size={16} className={report.noticeIcon} aria-hidden="true" />
          <span>{plural(repT, 'foreignOne', 'foreignMany', excludedForeign)}</span>
        </div>
      )}

      <div className={styles.tabs} role="tablist" aria-label={repT('tablist')}>
        {TABS.map((x, i) => (
          <button
            key={x.id}
            ref={(el) => {
              tabRefs.current[x.id] = el;
            }}
            id={`rep-tab-${x.id}`}
            type="button"
            role="tab"
            aria-selected={tab === x.id}
            aria-controls={`rep-panel-${x.id}`}
            tabIndex={tab === x.id ? 0 : -1}
            className={tab === x.id ? styles.tabActive : styles.tab}
            onClick={() => selectTab(x.id)}
            onKeyDown={(e) => onTabKey(e, i)}
          >
            {repT(x.label)}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`rep-panel-${tab}`} aria-labelledby={`rep-tab-${tab}`} tabIndex={0} className={styles.panel}>
        {tab === 'customers' && <CustomersTab report={customers} period={period} />}
        {tab === 'items' && <ItemsTab docs={docs} period={period} index={itemIndex} />}
        {tab === 'monthly' && <MonthlyTab docs={docs} period={period} />}
        {tab === 'top' && <TopCustomersTab report={customers} period={period} />}
        {tab === 'tax' && <TaxTab rep={taxRep} period={period} />}
        {tab === 'payments' && <PaymentsTab rep={modes} period={period} />}
        {tab === 'expenses' && <ExpensesTab rep={expenses} period={period} />}
        {tab === 'profit' && <ItemProfitTab rep={itemProfit} period={period} />}
        {tab === 'party' && <PartyProfitTab rep={partyProfit} period={period} />}
      </div>

      <CrossChecks checks={checks} />
    </div>
  );
}
