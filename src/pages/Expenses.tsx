import { isStockDependencyError } from '../lib/stock-timeline';
import { lazy, Suspense, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download, FilePlus2, Landmark, PiggyBank, Receipt, Search, Tags, Wallet, Zap } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { StatCard } from '../components/ui/StatCard';
import { EmptyState } from '../components/ui/EmptyState';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { useToast } from '../components/ui/useToast';
import { useT } from '../i18n';
import '../i18n/en-pages'; // page strings (5.4)
import { purT, purCategory, purStatus } from '../i18n/areas/purchases';
import { BillModal } from '../components/purchases/BillModal';
import { ExpenseModal } from '../components/purchases/ExpenseModal';
import { PurchasePaymentModal } from '../components/purchases/PurchasePaymentModal';
import { PurchasesTable } from '../components/purchases/PurchasesTable';
import { VendorsTab } from '../components/purchases/VendorsTab';
import { MsmeCard } from '../components/purchases/MsmeCard';
import type { BillSeed } from '../lib/purchase-orders';
import { getTable } from '../lib/storage';
import { can } from '../lib/access';
import type { PurchaseOrder } from '../types/purchases';
import {
  PURCHASE_STATUSES,
  categorySummary,
  filterPurchases,
  itcTotals,
  paidInMonth,
  paymentsDb,
  payablesOutstanding,
  purchasesDb,
  purchasesToCsvRows,
  type PurchaseFilter,
} from '../lib/purchases';
import { businessContext } from '../lib/purchases-context';
import { localDb } from '../lib/localDb';
import { vendorsDb } from '../lib/vendors';
import { downloadText, toCsv } from '../lib/download';
import { formatCurrency, todayInput } from '../lib/utils';
import { PURCHASE_CATEGORIES, type PurchaseRecord } from '../types/purchases';
import controls from '../styles/controls.module.css';
import surface from '../styles/surface.module.css';
import styles from './Expenses.module.css';

type Tab = 'bills' | 'orders' | 'vendors' | 'returns';

// Purchase orders are a separate, rarely-opened tab: load it on demand.
const PurchaseOrdersTab = lazy(() =>
  import('../components/purchases/PurchaseOrdersTab').then((m) => ({ default: m.PurchaseOrdersTab })),
);

// WP-3: purchase returns / supplier notes, receipt notes (GRN) and pending reports — also on demand.
const ReturnsTab = lazy(() => import('../components/purchases/ReturnsTab').then((m) => ({ default: m.ReturnsTab })));
const TAB_PARAMS: readonly Tab[] = ['orders', 'vendors', 'returns'];

const KINDS: { id: NonNullable<PurchaseFilter['kind']>; label: 'kindAll' | 'kindBills' | 'kindExpenses' }[] = [
  { id: 'ALL', label: 'kindAll' },
  { id: 'PURCHASE', label: 'kindBills' },
  { id: 'EXPENSE', label: 'kindExpenses' },
];

/** Expenses & purchases: supplier bills, quick expenses, payables and vendors. */
export function Expenses() {
  const { notify, toastNode } = useToast();
  const { t } = useT();
  const [version, setVersion] = useState(0);
  const [params] = useSearchParams();
  const [tab, setTab] = useState<Tab>(() => TAB_PARAMS.find((x) => x === params.get('tab')) ?? 'bills');
  const [seed, setSeed] = useState<BillSeed | null>(null);
  const [filter, setFilter] = useState<PurchaseFilter>({ kind: 'ALL', status: 'ALL', category: 'ALL' });
  // F9 / Gateway → Purchase voucher opens the bill form straight away (?new=bill).
  const [billOpen, setBillOpen] = useState(() => params.get('new') === 'bill');
  // A Tally key / Gateway link while this page is already open (F9, Ctrl+F9 → ?tab=returns&new=dn)
  // changes only the query: follow it (adjust-state-on-change, no effect).
  const query = params.toString();
  const [seenQuery, setSeenQuery] = useState(query);
  if (seenQuery !== query) {
    setSeenQuery(query);
    const wanted = TAB_PARAMS.find((x) => x === params.get('tab'));
    if (wanted) setTab(wanted);
    if (params.get('new') === 'bill') setBillOpen(true);
  }
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [editing, setEditing] = useState<PurchaseRecord | null>(null);
  const [payFor, setPayFor] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<PurchaseRecord | null>(null);

  const reload = () => setVersion((v) => v + 1);
  /* eslint-disable react-hooks/exhaustive-deps */
  const purchases = useMemo(() => purchasesDb.all(), [version]);
  const vendors = useMemo(() => vendorsDb.all(), [version]);
  const payments = useMemo(() => paymentsDb.all(), [version]);
  // Read straight from the table so the PO library stays in the lazy tab's chunk.
  const orders = useMemo(() => getTable<PurchaseOrder>('purchase_orders'), [version]);
  const business = useMemo(() => businessContext(), [version]);
  /* eslint-enable react-hooks/exhaustive-deps */

  const today = todayInput();
  const month = today.slice(0, 7);
  const patch = (p: Partial<PurchaseFilter>) => setFilter((f) => ({ ...f, ...p }));

  const rows = filterPurchases(purchases, filter, today);
  const payables = payablesOutstanding(purchases);
  const paidThisMonth = paidInMonth(payments, month);
  const itc = itcTotals(purchases, month);
  // A composition dealer cannot claim ITC (Sec 10(4)): the GST on bills is a cost. The data stays as entered.
  const composition = useMemo(() => localDb.settings.activeProfile()?.gst_scheme === 'composition', []);
  const topCategory = categorySummary(purchases.filter((p) => p.date.startsWith(month)))[0];

  const openEdit = (p: PurchaseRecord) => {
    setEditing(p);
    if (p.kind === 'EXPENSE') setExpenseOpen(true);
    else setBillOpen(true);
  };
  const closeForms = () => {
    setBillOpen(false);
    setExpenseOpen(false);
    setEditing(null);
    setSeed(null);
  };
  const saved = (message: string) => {
    reload();
    notify(message);
  };

  const exportCsv = () => {
    downloadText(`purchases-${today}.csv`, toCsv(purchasesToCsvRows(rows, today)), 'text/csv');
    notify(purT(rows.length === 1 ? 'exportedOne' : 'exportedMany', { n: rows.length }));
  };

  const remove = (p: PurchaseRecord, confirmStock = false) => {
    try {
      purchasesDb.remove(p.id, { confirmStock });
      reload();
      notify(purT('entryDeleted'));
    } catch (err) {
      // Later sales used this bill's stock: ask before letting it go negative (serial conflicts never confirm).
      if (isStockDependencyError(err) && err.confirmable && window.confirm(`${err.message}\n\nDelete the bill anyway?`)) return remove(p, true);
      notify((err as Error).message, 'error');
    }
  };

  const hasFilters =
    filter.query || filter.from || filter.to || filter.kind !== 'ALL' || filter.status !== 'ALL' || filter.category !== 'ALL';

  return (
    <div className={surface.page}>
      <PageHeader
        title={purT('title')}
        subtitle={purT('subtitle')}
        actions={
          <>
            <button type="button" className={controls.btnOutline} onClick={exportCsv} disabled={tab !== 'bills' || rows.length === 0}>
              <Download size={16} /> {purT('exportCsv')}
            </button>
            {/* Local roles (6.21): a viewer cannot record bills; the data layer refuses it too. */}
            {can('books.edit') && (
              <>
                <button type="button" className={controls.btnOutline} onClick={() => setExpenseOpen(true)}>
                  <Zap size={16} /> {purT('quickExpense')}
                </button>
                <button type="button" className={controls.btnPrimary} onClick={() => setBillOpen(true)}>
                  <FilePlus2 size={16} /> {purT('addBill')}
                </button>
              </>
            )}
          </>
        }
      />

      <div className={surface.statGrid}>
        <StatCard label={purT('statPayables')} value={formatCurrency(payables)} icon={Wallet} tone={payables > 0 ? 'warning' : 'default'} hint={purT('statPayablesHint')} />
        <StatCard label={purT('statPaidMonth')} value={formatCurrency(paidThisMonth)} icon={Landmark} tone="profit" />
        <StatCard
          label={composition ? purT('statGstNoItc') : purT('statItc')}
          value={formatCurrency(itc.total)}
          icon={PiggyBank}
          tone={composition ? 'default' : 'brand'}
          hint={composition ? purT('statCompositionHint') : itc.ineligible > 0 ? purT('statNotClaimed', { amount: formatCurrency(itc.ineligible) }) : purT('statThisMonth')}
        />
        <StatCard
          label={purT('statTopCategory')}
          value={topCategory ? purCategory(topCategory.category) : '—'}
          icon={Tags}
          hint={topCategory ? purT('statAmountThisMonth', { amount: formatCurrency(topCategory.total) }) : purT('statNothingMonth')}
        />
      </div>

      <MsmeCard purchases={purchases} vendors={vendors} payments={payments} today={today} />

      <div className={styles.tabs}>
        <div className={`${controls.segment} ${styles.touchSeg}`} role="tablist" aria-label={purT('section')}>
          <button type="button" role="tab" aria-selected={tab === 'bills'} className={tab === 'bills' ? controls.segmentBtnActive : controls.segmentBtn} onClick={() => setTab('bills')}>
            {purT('tabBills')} <span className={styles.count}>{purchases.length}</span>
          </button>
          <button type="button" role="tab" aria-selected={tab === 'orders'} className={tab === 'orders' ? controls.segmentBtnActive : controls.segmentBtn} onClick={() => setTab('orders')}>
            {purT('tabOrders')} <span className={styles.count}>{orders.length}</span>
          </button>
          <button type="button" role="tab" aria-selected={tab === 'vendors'} className={tab === 'vendors' ? controls.segmentBtnActive : controls.segmentBtn} onClick={() => setTab('vendors')}>
            {purT('tabVendors')} <span className={styles.count}>{vendors.length}</span>
          </button>
          <button type="button" role="tab" aria-selected={tab === 'returns'} className={tab === 'returns' ? controls.segmentBtnActive : controls.segmentBtn} onClick={() => setTab('returns')}>
            {purT('tabReturns')}
          </button>
        </div>
      </div>

      {tab === 'orders' ? (
        <Suspense fallback={null}>
          <PurchaseOrdersTab
            orders={orders}
            vendors={vendors}
            purchases={purchases}
            businessState={business.stateCode}
            onVendorCreated={reload}
            onConvert={(s) => {
              setEditing(null);
              setSeed(s);
              setBillOpen(true);
            }}
            onChanged={(message, tone) => {
              reload();
              if (message) notify(message, tone);
            }}
          />
        </Suspense>
      ) : tab === 'returns' ? (
        <Suspense fallback={null}>
          <ReturnsTab
            key={params.get('new') ?? ''}
            purchases={purchases}
            vendors={vendors}
            orders={orders}
            onVendorCreated={reload}
            onConvert={(s) => {
              setEditing(null);
              setSeed(s);
              setBillOpen(true);
            }}
            onChanged={(message, tone) => {
              reload();
              if (message) notify(message, tone);
            }}
          />
        </Suspense>
      ) : tab === 'vendors' ? (
        <VendorsTab
          vendors={vendors}
          purchases={purchases}
          onChanged={(message, tone) => {
            reload();
            if (message) notify(message, tone);
          }}
        />
      ) : (
        <section className={surface.card}>
          <div className={styles.toolbar}>
            <div className={styles.toolbarRow}>
              <label className={styles.search}>
                <Search size={16} />
                <input
                  type="search"
                  value={filter.query ?? ''}
                  onChange={(e) => patch({ query: e.target.value })}
                  placeholder={purT('searchPlaceholder')}
                  aria-label={purT('searchLabel')}
                />
              </label>
              <div className={`${controls.segment} ${styles.touchSeg}`} role="tablist" aria-label={purT('filterType')}>
                {KINDS.map((k) => (
                  <button
                    key={k.id}
                    type="button"
                    role="tab"
                    aria-selected={filter.kind === k.id}
                    className={filter.kind === k.id ? controls.segmentBtnActive : controls.segmentBtn}
                    onClick={() => patch({ kind: k.id })}
                  >
                    {purT(k.label)}
                  </button>
                ))}
              </div>
            </div>
            <div className={styles.toolbarRow}>
              <select className={`${controls.select} ${styles.filterSelect}`} value={filter.status} onChange={(e) => patch({ status: e.target.value as PurchaseFilter['status'] })} aria-label={purT('filterStatus')}>
                <option value="ALL">{purT('allStatuses')}</option>
                {PURCHASE_STATUSES.map((s) => (
                  <option key={s} value={s}>{purStatus(s)}</option>
                ))}
              </select>
              <select className={`${controls.select} ${styles.filterSelect}`} value={filter.category} onChange={(e) => patch({ category: e.target.value })} aria-label={purT('filterCategory')}>
                <option value="ALL">{purT('allCategories')}</option>
                {PURCHASE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{purCategory(c)}</option>
                ))}
              </select>
              <label className={styles.dateField}>
                {purT('from')}
                <input type="date" className={controls.input} value={filter.from ?? ''} max={filter.to || undefined} onChange={(e) => patch({ from: e.target.value })} />
              </label>
              <label className={styles.dateField}>
                {purT('to')}
                <input type="date" className={controls.input} value={filter.to ?? ''} min={filter.from || undefined} onChange={(e) => patch({ to: e.target.value })} />
              </label>
              {hasFilters && (
                <button type="button" className={controls.btnGhost} onClick={() => setFilter({ kind: 'ALL', status: 'ALL', category: 'ALL' })}>
                  {purT('clear')}
                </button>
              )}
            </div>
          </div>

          {purchases.length === 0 ? (
            <EmptyState
              icon={Receipt}
              title={t('list.expEmptyTitle')}
              text={t('list.expEmptyText')}
              action={
                <button type="button" className={controls.btnPrimary} onClick={() => setBillOpen(true)}>
                  <FilePlus2 size={16} /> {t('list.expAddFirst')}
                </button>
              }
            />
          ) : rows.length === 0 ? (
            <EmptyState icon={Search} title={t('common.noMatches')} text={t('common.tryOtherSearchFilter')} />
          ) : (
            <PurchasesTable rows={rows} today={today} onPay={(p) => setPayFor(p.id)} onEdit={openEdit} onDelete={setDeleting} />
          )}
        </section>
      )}

      <BillModal
        open={billOpen}
        onClose={closeForms}
        purchase={editing?.kind === 'PURCHASE' ? editing : null}
        seed={seed}
        vendors={vendors}
        onVendorCreated={reload}
        businessState={business.stateCode}
        onSaved={saved}
      />
      <ExpenseModal
        open={expenseOpen}
        onClose={closeForms}
        expense={editing?.kind === 'EXPENSE' ? editing : null}
        vendors={vendors}
        businessState={business.stateCode}
        onSaved={saved}
      />
      <PurchasePaymentModal
        purchaseId={payFor}
        onClose={() => setPayFor(null)}
        onChanged={(message) => {
          reload();
          if (message) notify(message);
        }}
      />
      <ConfirmDialog
        open={!!deleting}
        destructive
        title={purT('deleteTitle')}
        message={purT('deleteMessage', { name: `${deleting?.vendor_name ?? ''}${deleting?.bill_number ? ` (${deleting.bill_number})` : ''}` })}
        confirmLabel={purT('delete')}
        onConfirm={() => deleting && remove(deleting)}
        onClose={() => setDeleting(null)}
      />
      {toastNode}
    </div>
  );
}
