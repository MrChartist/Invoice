import { useMemo, useState } from 'react';
import { Download, FilePlus2, Landmark, PiggyBank, Receipt, Search, Tags, Wallet, Zap } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { StatCard } from '../components/ui/StatCard';
import { EmptyState } from '../components/ui/EmptyState';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { useToast } from '../components/ui/useToast';
import { BillModal } from '../components/purchases/BillModal';
import { ExpenseModal } from '../components/purchases/ExpenseModal';
import { PurchasePaymentModal } from '../components/purchases/PurchasePaymentModal';
import { PurchasesTable } from '../components/purchases/PurchasesTable';
import { VendorsTab } from '../components/purchases/VendorsTab';
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
import { vendorsDb } from '../lib/vendors';
import { downloadText, toCsv } from '../lib/download';
import { formatCurrency, todayInput } from '../lib/utils';
import { PURCHASE_CATEGORIES, type PurchaseRecord } from '../types/purchases';
import controls from '../styles/controls.module.css';
import surface from '../styles/surface.module.css';
import styles from './Expenses.module.css';

type Tab = 'bills' | 'vendors';

const KINDS: { id: NonNullable<PurchaseFilter['kind']>; label: string }[] = [
  { id: 'ALL', label: 'All' },
  { id: 'PURCHASE', label: 'Bills' },
  { id: 'EXPENSE', label: 'Expenses' },
];

/** Expenses & purchases: supplier bills, quick expenses, payables and vendors. */
export function Expenses() {
  const { notify, toastNode } = useToast();
  const [version, setVersion] = useState(0);
  const [tab, setTab] = useState<Tab>('bills');
  const [filter, setFilter] = useState<PurchaseFilter>({ kind: 'ALL', status: 'ALL', category: 'ALL' });
  const [billOpen, setBillOpen] = useState(false);
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [editing, setEditing] = useState<PurchaseRecord | null>(null);
  const [payFor, setPayFor] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<PurchaseRecord | null>(null);

  const reload = () => setVersion((v) => v + 1);
  /* eslint-disable react-hooks/exhaustive-deps */
  const purchases = useMemo(() => purchasesDb.all(), [version]);
  const vendors = useMemo(() => vendorsDb.all(), [version]);
  const payments = useMemo(() => paymentsDb.all(), [version]);
  const business = useMemo(() => businessContext(), [version]);
  /* eslint-enable react-hooks/exhaustive-deps */

  const today = todayInput();
  const month = today.slice(0, 7);
  const patch = (p: Partial<PurchaseFilter>) => setFilter((f) => ({ ...f, ...p }));

  const rows = filterPurchases(purchases, filter, today);
  const payables = payablesOutstanding(purchases);
  const paidThisMonth = paidInMonth(payments, month);
  const itc = itcTotals(purchases, month);
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
  };
  const saved = (message: string) => {
    reload();
    notify(message);
  };

  const exportCsv = () => {
    downloadText(`purchases-${today}.csv`, toCsv(purchasesToCsvRows(rows, today)), 'text/csv');
    notify(`Exported ${rows.length} row${rows.length === 1 ? '' : 's'}`);
  };

  const remove = (p: PurchaseRecord) => {
    try {
      purchasesDb.remove(p.id);
      reload();
      notify('Entry deleted');
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };

  const hasFilters =
    filter.query || filter.from || filter.to || filter.kind !== 'ALL' || filter.status !== 'ALL' || filter.category !== 'ALL';

  return (
    <div className={surface.page}>
      <PageHeader
        title="Expenses & purchases"
        subtitle="Supplier bills, day-to-day spends, what you owe and the GST you can claim back."
        actions={
          <>
            <button type="button" className={controls.btnOutline} onClick={exportCsv} disabled={tab !== 'bills' || rows.length === 0}>
              <Download size={16} /> Export CSV
            </button>
            <button type="button" className={controls.btnOutline} onClick={() => setExpenseOpen(true)}>
              <Zap size={16} /> Quick expense
            </button>
            <button type="button" className={controls.btnPrimary} onClick={() => setBillOpen(true)}>
              <FilePlus2 size={16} /> Add bill
            </button>
          </>
        }
      />

      <div className={surface.statGrid}>
        <StatCard label="Payables" value={formatCurrency(payables)} icon={Wallet} tone={payables > 0 ? 'warning' : 'default'} hint="Owed to vendors" />
        <StatCard label="Paid this month" value={formatCurrency(paidThisMonth)} icon={Landmark} tone="profit" />
        <StatCard
          label="ITC available"
          value={formatCurrency(itc.total)}
          icon={PiggyBank}
          tone="brand"
          hint={itc.ineligible > 0 ? `${formatCurrency(itc.ineligible)} not claimed` : 'This month'}
        />
        <StatCard
          label="Top category"
          value={topCategory ? topCategory.category : '—'}
          icon={Tags}
          hint={topCategory ? `${formatCurrency(topCategory.total)} this month` : 'Nothing logged this month'}
        />
      </div>

      <div className={styles.tabs}>
        <div className={`${controls.segment} ${styles.touchSeg}`} role="tablist" aria-label="Section">
          <button type="button" role="tab" aria-selected={tab === 'bills'} className={tab === 'bills' ? controls.segmentBtnActive : controls.segmentBtn} onClick={() => setTab('bills')}>
            Bills & expenses <span className={styles.count}>{purchases.length}</span>
          </button>
          <button type="button" role="tab" aria-selected={tab === 'vendors'} className={tab === 'vendors' ? controls.segmentBtnActive : controls.segmentBtn} onClick={() => setTab('vendors')}>
            Vendors <span className={styles.count}>{vendors.length}</span>
          </button>
        </div>
      </div>

      {tab === 'vendors' ? (
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
                  placeholder="Search vendor, bill no or GSTIN"
                  aria-label="Search bills and expenses"
                />
              </label>
              <div className={`${controls.segment} ${styles.touchSeg}`} role="tablist" aria-label="Filter by type">
                {KINDS.map((k) => (
                  <button
                    key={k.id}
                    type="button"
                    role="tab"
                    aria-selected={filter.kind === k.id}
                    className={filter.kind === k.id ? controls.segmentBtnActive : controls.segmentBtn}
                    onClick={() => patch({ kind: k.id })}
                  >
                    {k.label}
                  </button>
                ))}
              </div>
            </div>
            <div className={styles.toolbarRow}>
              <select className={`${controls.select} ${styles.filterSelect}`} value={filter.status} onChange={(e) => patch({ status: e.target.value as PurchaseFilter['status'] })} aria-label="Filter by status">
                <option value="ALL">All statuses</option>
                {PURCHASE_STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <select className={`${controls.select} ${styles.filterSelect}`} value={filter.category} onChange={(e) => patch({ category: e.target.value })} aria-label="Filter by category">
                <option value="ALL">All categories</option>
                {PURCHASE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <label className={styles.dateField}>
                From
                <input type="date" className={controls.input} value={filter.from ?? ''} max={filter.to || undefined} onChange={(e) => patch({ from: e.target.value })} />
              </label>
              <label className={styles.dateField}>
                To
                <input type="date" className={controls.input} value={filter.to ?? ''} min={filter.from || undefined} onChange={(e) => patch({ to: e.target.value })} />
              </label>
              {hasFilters && (
                <button type="button" className={controls.btnGhost} onClick={() => setFilter({ kind: 'ALL', status: 'ALL', category: 'ALL' })}>
                  Clear
                </button>
              )}
            </div>
          </div>

          {purchases.length === 0 ? (
            <EmptyState
              icon={Receipt}
              title="No bills or expenses yet"
              text="Log supplier bills to track payables and claim input tax credit, or quick-add everyday expenses."
              action={
                <button type="button" className={controls.btnPrimary} onClick={() => setBillOpen(true)}>
                  <FilePlus2 size={16} /> Add your first bill
                </button>
              }
            />
          ) : rows.length === 0 ? (
            <EmptyState icon={Search} title="No matches" text="Try a different search or filter." />
          ) : (
            <PurchasesTable rows={rows} today={today} onPay={(p) => setPayFor(p.id)} onEdit={openEdit} onDelete={setDeleting} />
          )}
        </section>
      )}

      <BillModal
        open={billOpen}
        onClose={closeForms}
        purchase={editing?.kind === 'PURCHASE' ? editing : null}
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
        title="Delete this entry?"
        message={`${deleting?.vendor_name ?? ''}${deleting?.bill_number ? ` (${deleting.bill_number})` : ''} and its payment history will be permanently removed from this device.`}
        confirmLabel="Delete"
        onConfirm={() => deleting && remove(deleting)}
        onClose={() => setDeleting(null)}
      />
      {toastNode}
    </div>
  );
}
