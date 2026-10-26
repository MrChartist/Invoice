import { isStockDependencyError } from '../lib/stock-timeline';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Download, FilePlus2, Landmark, PiggyBank, Receipt, ScanLine, Search, Tags, Wallet, Zap } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { StatCard } from '../components/ui/StatCard';
import { EmptyState } from '../components/ui/EmptyState';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { useToast } from '../components/ui/useToast';
import { useT } from '../i18n';
import '../i18n/en-pages'; // page strings (5.4)
import { purT, purCategory, purStatus } from '../i18n/areas/purchases';
import { capT } from '../i18n/areas/capture';
import { bsT } from '../i18n/areas/bill-scan';
import { BillModal } from '../components/purchases/BillModal';
import { BranchFilter } from '../components/branches/BranchFilter';
import { branchPredicates } from '../lib/branch';
import { ExpenseModal } from '../components/purchases/ExpenseModal';
import { PurchasePaymentModal } from '../components/purchases/PurchasePaymentModal';
import { PurchasesTable } from '../components/purchases/PurchasesTable';
import { VendorsTab } from '../components/purchases/VendorsTab';
import { MsmeCard } from '../components/purchases/MsmeCard';
import type { BillSeed } from '../lib/purchase-orders';
import { getTable } from '../lib/storage';
import { can } from '../lib/access';
import type { PurchaseOrder } from '../types/purchases';
import type { AttachmentRef } from '../types/attachments';
import { takeShared } from '../lib/share-inbox';
import { releaseAttachments } from '../lib/attachments';
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
import { EXPENSES_TABS, type ExpensesTab } from './page-tabs'; // R6-B1
// R4-C4: "Deleted · Undo" for deletes on this page (restores from the recycle bin) — lazy.
const UndoDeleted = lazy(() => import('../components/trust/UndoDeleted'));

type Tab = ExpensesTab;

// Purchase orders are a separate, rarely-opened tab: load it on demand.
const PurchaseOrdersTab = lazy(() =>
  import('../components/purchases/PurchaseOrdersTab').then((m) => ({ default: m.PurchaseOrdersTab })),
);

// WP-3: purchase returns / supplier notes, receipt notes (GRN) and pending reports — also on demand.
const ReturnsTab = lazy(() => import('../components/purchases/ReturnsTab').then((m) => ({ default: m.ReturnsTab })));
// 8C: capture from the e-invoice QR, documents inbox, draft / recurring bills — on demand.
const InboxTab = lazy(() => import('../components/capture/InboxTab'));
// 8I: "Scan bill" chooser (camera QR / photo / file → capture flow) — on demand.
const ScanBillDialog = lazy(() => import('../components/capture/ScanBillDialog'));
const TAB_PARAMS: readonly Tab[] = EXPENSES_TABS; // R6-B1: list in expenses-tabs.ts ('bills' is the default)

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
  const navigate = useNavigate();
  const [scanOpen, setScanOpen] = useState(false);
  const [tab, setTab] = useState<Tab>(() => TAB_PARAMS.find((x) => x === params.get('tab')) ?? 'bills');
  const [seed, setSeed] = useState<BillSeed | null>(null);
  const [filter, setFilter] = useState<PurchaseFilter>({ kind: 'ALL', status: 'ALL', category: 'ALL' });
  // WP-9: branch filter (own tag, else the only branch in the bill's place-of-supply state).
  const [branch, setBranch] = useState('');
  // F9 / Gateway → Purchase voucher opens the bill form straight away (?new=bill).
  const [billOpen, setBillOpen] = useState(() => params.get('new') === 'bill');
  // 8.23: manifest shortcut "New expense" (?new=expense); a photo / PDF shared into the app adds `shared=1`.
  const [expenseOpen, setExpenseOpen] = useState(() => params.get('new') === 'expense' && params.get('shared') !== '1' && can('books.edit'));
  const [sharedFiles, setSharedFiles] = useState<AttachmentRef[] | null>(null);
  // A Tally key / Gateway link while this page is already open (F9, Ctrl+F9 → ?tab=returns&new=dn)
  // changes only the query: follow it (adjust-state-on-change, no effect).
  const query = params.toString();
  const [seenQuery, setSeenQuery] = useState(query);
  if (seenQuery !== query) {
    setSeenQuery(query);
    const wanted = TAB_PARAMS.find((x) => x === params.get('tab'));
    if (wanted) setTab(wanted);
    if (params.get('new') === 'bill') setBillOpen(true);
    if (params.get('new') === 'expense' && params.get('shared') !== '1' && can('books.edit')) setExpenseOpen(true);
  }
  useEffect(() => {
    const files = params.get('shared') === '1' && can('books.edit') ? takeShared('receipt') : null;
    if (!files) return;
    void import('../lib/attachment-upload').then(async ({ attachFile }) => {
      const refs: AttachmentRef[] = [];
      for (const f of files.slice(0, 10)) {
        try {
          refs.push(await attachFile(f));
        } catch (err) {
          notify(`${f.name}: ${(err as Error).message}`, 'error');
        }
      }
      setSharedFiles(refs);
      setExpenseOpen(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
  const inboxCount = useMemo(() => getTable('purchase_drafts').length + getTable<{ status?: string; draft_id?: string }>('doc_inbox').filter((r) => r.status === 'new' && !r.draft_id).length, [version]);
  const business = useMemo(() => businessContext(), [version]);
  /* eslint-enable react-hooks/exhaustive-deps */

  const today = todayInput();
  const month = today.slice(0, 7);
  const patch = (p: Partial<PurchaseFilter>) => setFilter((f) => ({ ...f, ...p }));

  const inBranch = branchPredicates(branch).purchase;
  const rows = filterPurchases(purchases, filter, today).filter((p) => !branch || inBranch(p));
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
    if (sharedFiles?.length) {
      // Shared files the expense did not keep (form cancelled) are removed; ones a saved record uses stay.
      const ids = sharedFiles.map((r) => r.id);
      setTimeout(() => releaseAttachments(ids), 2000);
    }
    setSharedFiles(null);
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
                <button type="button" className={controls.btnOutline} onClick={() => setScanOpen(true)} data-testid="scan-bill">
                  <ScanLine size={16} aria-hidden /> {bsT('scanBill')}
                </button>
                <button type="button" className={controls.btnPrimary} onClick={() => setBillOpen(true)}>
                  <FilePlus2 size={16} /> {purT('addBill')}
                </button>
              </>
            )}
          </>
        }
      />

      {scanOpen && (
        <Suspense fallback={null}>
          <ScanBillDialog
            onClose={() => setScanOpen(false)}
            onDone={(message, tone, route) => {
              setScanOpen(false);
              reload();
              notify(message, tone);
              if (route) navigate(route);
            }}
          />
        </Suspense>
      )}

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
          <button type="button" role="tab" aria-selected={tab === 'inbox'} className={tab === 'inbox' ? controls.segmentBtnActive : controls.segmentBtn} onClick={() => setTab('inbox')} data-testid="tab-inbox">
            {capT('tabInbox')} {inboxCount > 0 && <span className={styles.count}>{inboxCount}</span>}
          </button>
        </div>
      </div>

      {tab === 'inbox' ? (
        <Suspense fallback={null}>
          <InboxTab
            businessState={business.stateCode}
            focusId={params.get('doc')}
            onPost={openEdit}
            onChanged={(message, tone) => {
              reload();
              if (message) notify(message, tone);
            }}
          />
        </Suspense>
      ) : tab === 'orders' ? (
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
              <BranchFilter value={branch} onChange={setBranch} className={`${controls.select} ${styles.filterSelect}`} testId="pur-branch" />
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
        attachments={sharedFiles ?? undefined}
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
      <Suspense fallback={null}><UndoDeleted /></Suspense>
    </div>
  );
}
