import { useEffect, useMemo, useRef, useState } from 'react';
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
import { loadPositions, type StockPosition } from '../lib/inventory';
import { localDb } from '../lib/localDb';
import {
  concentration,
  expenseReport,
  paymentModes,
  profitByItem,
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
import { ExpensesTab, PaymentsTab, ProfitTab, TaxTab } from '../components/reports/MoneyTabs';
import surface from '../styles/surface.module.css';
import report from '../components/reports/reports.module.css';
import styles from './Reports.module.css';

const TABS = [
  { id: 'customers', label: 'By customer' },
  { id: 'items', label: 'By item' },
  { id: 'monthly', label: 'By month' },
  { id: 'top', label: 'Top customers' },
  { id: 'tax', label: 'Tax by rate' },
  { id: 'payments', label: 'Payment modes' },
  { id: 'expenses', label: 'Expenses' },
  { id: 'profit', label: 'Item profit' },
] as const;
type TabId = (typeof TABS)[number]['id'];

const inr = (v: string | undefined) => (v || 'INR').toUpperCase() === 'INR';

export function Reports() {
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
  const customers = useMemo(() => salesByCustomer(docs, period), [docs, period]);
  const conc = useMemo(() => concentration(customers), [customers]);
  const taxRep = useMemo(() => taxByRate(docs, period), [docs, period]);
  const modes = useMemo(() => paymentModes(books.transactions, invoices, period), [books.transactions, invoices, period]);
  const expenses = useMemo(() => expenseReport(books.purchases, books.vendors, period), [books, period]);
  const profit = useMemo(() => profitByItem(docs, positions, period), [docs, positions, period]);

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
      { label: 'Billed (incl. GST, net of credit notes)', report: customers.totals.total, other: dash.billed, source: 'Dashboard' },
      { label: 'Income (excl. GST)', report: customers.totals.income, other: pl.income, source: 'Books P&L' },
      { label: 'GST collected', report: round2(taxRep.totals.cgst + taxRep.totals.sgst + taxRep.totals.igst), other: gst.outputTotal, source: 'Books GST' },
      { label: 'Money received', report: modes.total, other: received, source: 'Books cash & bank' },
      { label: 'Purchases & expenses', report: expenses.totals.cost, other: pl.totalExpenses, source: 'Books P&L' },
    ];
  }, [invoices, books, period, customers, taxRep, modes, expenses]);

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
        title="Sales & purchase reports"
        subtitle="Who buys what, when, and how they pay — reconciled to your Dashboard and Books."
      />

      <PeriodBar
        preset={preset}
        period={period}
        onChange={(p, range) => {
          setPreset(p);
          setPeriod(range);
        }}
      />

      <div className={surface.statGrid}>
        <StatCard label="Net sales" icon={IndianRupee} value={`₹${formatMoney(t.taxable)}`} hint="excl. GST, net of credit notes" />
        <StatCard label="Billed" icon={ReceiptText} value={`₹${formatMoney(t.total)}`} hint={`${t.count} invoice${t.count === 1 ? '' : 's'}${t.creditNotes ? ` · ${t.creditNotes} credit note${t.creditNotes === 1 ? '' : 's'}` : ''}`} />
        <StatCard label="Received" icon={Wallet} tone="profit" value={`₹${formatMoney(modes.total)}`} hint={`${modes.count} receipt${modes.count === 1 ? '' : 's'}`} />
        <StatCard
          label="Top-3 customer share"
          icon={Percent}
          tone={conc.level === 'high' ? 'loss' : conc.level === 'moderate' ? 'warning' : 'default'}
          value={conc.customers ? `${conc.top3Share.toFixed(1)}%` : '—'}
          hint={conc.customers ? `${conc.customers} customer${conc.customers === 1 ? '' : 's'}` : 'no sales yet'}
        />
      </div>

      {excludedForeign > 0 && (
        <div className={report.noticeWarn} role="note">
          <AlertTriangle size={16} className={report.noticeIcon} aria-hidden="true" />
          <span>
            {excludedForeign} document{excludedForeign === 1 ? ' is' : 's are'} in a foreign currency and left out — amounts in different currencies are never added together. See the invoice list for those.
          </span>
        </div>
      )}

      <div className={styles.tabs} role="tablist" aria-label="Reports">
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
            {x.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`rep-panel-${tab}`} aria-labelledby={`rep-tab-${tab}`} tabIndex={0} className={styles.panel}>
        {tab === 'customers' && <CustomersTab report={customers} period={period} />}
        {tab === 'items' && <ItemsTab docs={docs} period={period} />}
        {tab === 'monthly' && <MonthlyTab docs={docs} period={period} />}
        {tab === 'top' && <TopCustomersTab report={customers} period={period} />}
        {tab === 'tax' && <TaxTab rep={taxRep} period={period} />}
        {tab === 'payments' && <PaymentsTab rep={modes} period={period} />}
        {tab === 'expenses' && <ExpensesTab rep={expenses} period={period} />}
        {tab === 'profit' && <ProfitTab rep={profit} period={period} hasStock={positions.some((p) => p.item.track_stock)} />}
      </div>

      <CrossChecks checks={checks} />
    </div>
  );
}
