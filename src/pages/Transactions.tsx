import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowDown,
  ArrowUp,
  Banknote,
  CheckCheck,
  Copy,
  Download,
  Eye,
  FilePlus2,
  FileText,
  Lock,
  Pencil,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { StatCard } from '../components/ui/StatCard';
import { StatusBadge } from '../components/ui/StatusBadge';
import { wireT } from '../i18n/areas/wiring';
import { BranchFilter } from '../components/branches/BranchFilter';
import { branchPredicates } from '../lib/branch';
import { EmptyState } from '../components/ui/EmptyState';
import { Avatar } from '../components/ui/Avatar';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { useToast } from '../components/ui/useToast';
import { useT } from '../i18n';
import '../i18n/en-pages'; // page strings (5.4)
import { salesT, stateLabel } from '../i18n/areas/sales';
import { docLabel, methodLabel } from '../i18n/labels';
import { Modal } from '../components/ui/Modal';
import { VirtualGap } from '../components/ui/VirtualGap';
import { useVirtualRows } from '../hooks/useVirtualRows';

import { PaymentModal } from '../components/modals/PaymentModal';
import { localDb, generateId, isIssued } from '../lib/localDb';
import { useCan } from '../hooks/useCan';
import { isLocked } from '../lib/period-lock';
import { useInvoiceStore } from '../store/useInvoiceStore';
import { quoteState, quoteTone } from '../lib/quote-status';
import { buildOrderIndex, fulfilmentFromIndex, ORDER_STATES, orderTone, type OrderState } from '../lib/sales-orders';
import { amountDue, linkedCredits } from '../lib/amount-due';
import { bulkMarkPaid, bulkPaidTotal, canMarkPaid, matchesListFilter, sortInvoices, type SortDir, type SortKey } from '../lib/invoice-list';
import { effectiveStatus } from '../lib/invoice-status';
import { getTable } from '../lib/storage';
import type { CreditLink } from '../lib/stats';
import { isRevenueDoc, summarize } from '../lib/stats';
import { downloadText, toCsv } from '../lib/download';
import { addDaysInput, cn, formatCurrency, formatDate, todayInput } from '../lib/utils';
import { DOCUMENT_LABELS, type DocumentType, type InvoiceRecord } from '../types/invoice';
import controls from '../styles/controls.module.css';
import surface from '../styles/surface.module.css';
import styles from './Transactions.module.css';
import { receivableBalance, receivableTotal } from '../lib/rcm';

// The preview pulls in the template engine and QR code; load it only when opened.
const InvoicePreviewModal = lazy(() =>
  import('../components/preview/InvoicePreview').then((m) => ({ default: m.InvoicePreviewModal })),
);

// Batch PDF / ZIP (WP-4): the PDF stack and template engine load only when used.
const BatchPdfModal = lazy(() => import('../components/preview/BatchPdfModal').then((m) => ({ default: m.BatchPdfModal })));

type Filter = 'all' | 'unpaid' | 'overdue' | 'paid' | 'draft' | 'approval';

const FILTERS: { id: Filter; label: () => string }[] = [
  { id: 'all', label: () => salesT('tx.fAll') },
  { id: 'unpaid', label: () => salesT('tx.fUnpaid') },
  { id: 'overdue', label: () => salesT('tx.fOverdue') },
  { id: 'paid', label: () => salesT('tx.fPaid') },
  { id: 'draft', label: () => salesT('tx.fDraft') },
  // WP-9 maker-checker: shown only while some document waits for approval (or the filter is chosen).
  { id: 'approval', label: () => wireT('pendingApproval') },
];

const isPendingApproval = (inv: InvoiceRecord) => inv.approval?.state === 'pending';

function matchesFilter(inv: InvoiceRecord, filter: Filter, now: Date): boolean {
  const status = effectiveStatus(inv, now);
  // Quotations, challans etc. never carry a receivable, so they only appear under All / Draft.
  if ((filter === 'unpaid' || filter === 'overdue' || filter === 'paid') && !isRevenueDoc(inv)) return false;
  switch (filter) {
    case 'unpaid':
      return status === 'Sent' || status === 'Partially Paid' || status === 'Overdue';
    case 'overdue':
      return status === 'Overdue';
    case 'paid':
      return status === 'Paid';
    case 'draft':
      return status === 'Draft';
    case 'approval':
      return isPendingApproval(inv);
    default:
      return true;
  }
}

export function Transactions() {
  const navigate = useNavigate();
  const loadInvoice = useInvoiceStore((s) => s.loadInvoice);
  const { notify, toastNode } = useToast();
  const { t, lang } = useT();

  const [version, setVersion] = useState(0);
  const [query, setQuery] = useState('');
  const [params] = useSearchParams();
  // Local roles (6.21): a viewer only views / prints / exports; a clerk cannot delete issued documents.
  const { can } = useCan();
  const mayDelete = (inv: InvoiceRecord) => can(isIssued(inv) ? 'doc.deleteIssued' : 'doc.deleteDraft');
  const [filter, setFilter] = useState<Filter>(() => {
    const f = params.get('filter') as Filter | null;
    return f && FILTERS.some((x) => x.id === f) ? f : 'all';
  });
  const [previewOpen, setPreviewOpen] = useState(false);
  // "Record a payment" from the command palette (?pay=1): with a single unpaid document, open it directly.
  const [payFor, setPayFor] = useState<InvoiceRecord | null>(() => {
    if (params.get('pay') !== '1') return null;
    const today = new Date();
    const open = localDb.invoices.getAll().filter((i) => matchesFilter(i, 'unpaid', today) && !isLocked(i));
    return open.length === 1 ? open[0] : null;
  });
  const [deleting, setDeleting] = useState<InvoiceRecord[] | null>(null);
  const [docType, setDocType] = useState<DocumentType | ''>(() => {
    const t = params.get('type');
    return t && t in DOCUMENT_LABELS ? (t as DocumentType) : '';
  });
  // Sales orders only: Open / Partly fulfilled / Fulfilled / Closed.
  const [orderState, setOrderState] = useState<OrderState | ''>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  // WP-9: branch filter (own tag, else the branch inferred from the sender profile / GSTIN).
  const [branch, setBranch] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'date', dir: 'desc' });
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [bulkPay, setBulkPay] = useState<{ method: string; date: string } | null>(null);
  const [batchPdf, setBatchPdf] = useState<InvoiceRecord[] | null>(null);
  // Deletes wait a few seconds behind an Undo toast before they touch storage.
  const [pendingDelete, setPendingDelete] = useState<Set<string>>(() => new Set());
  const deleteTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pendingRef = useRef<Set<string>>(pendingDelete);
  useEffect(() => {
    pendingRef.current = pendingDelete;
  }, [pendingDelete]);

  const reload = () => setVersion((v) => v + 1);

  useEffect(() => {
    window.addEventListener('focus', reload);
    return () => window.removeEventListener('focus', reload);
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const invoices = useMemo(() => localDb.invoices.getAll(), [version]);
  const now = new Date();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const links = useMemo(() => getTable<CreditLink & { relation: string }>('doc_links'), [version]);
  const summary = useMemo(() => summarize(invoices, now, links, 'INR'), [invoices, links]); // eslint-disable-line react-hooks/exhaustive-deps
  // Amount due per row is net of linked credit notes (src/lib/amount-due.ts).
  const credits = useMemo(() => linkedCredits(links, invoices), [invoices, links]);
  // One pass over every document gives each sales order its fulfilment state.
  const orderStates = useMemo(() => {
    const out = new Map<string, OrderState>();
    if (!invoices.some((i) => i.doc_type === 'SALES_ORDER')) return out;
    const index = buildOrderIndex(invoices, links);
    for (const so of invoices) if (so.doc_type === 'SALES_ORDER') out.set(so.id, fulfilmentFromIndex(so, index).state);
    return out;
  }, [invoices, links]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const inBranch = branchPredicates(branch).invoice;
    const list = invoices
      .filter((inv) => !pendingDelete.has(inv.id))
      .filter((inv) => matchesFilter(inv, filter, now))
      .filter((inv) => matchesListFilter(inv, { docType, from, to }))
      .filter((inv) => !branch || inBranch(inv))
      .filter((inv) => docType !== 'SALES_ORDER' || !orderState || orderStates.get(inv.id) === orderState)
      .filter(
        (inv) =>
          !q ||
          [inv.invoice_number, inv.client?.name, inv.client?.company, inv.client?.gstin].some((f) =>
            f?.toLowerCase().includes(q),
          ),
      );
    return sortInvoices(list, sort.key, sort.dir);
  }, [invoices, query, filter, docType, orderState, orderStates, from, to, branch, sort, pendingDelete]); // eslint-disable-line react-hooks/exhaustive-deps

  // Long lists mount only the rows in view (see useVirtualRows); 100 rows or fewer render as before.
  const rowKeys = useMemo(() => rows.map((r) => r.id), [rows]);
  const virtual = useVirtualRows(rowKeys, { estimate: 66 });

  const docTypes = useMemo(() => {
    const set = new Set(invoices.map((i) => i.doc_type));
    if (docType) set.add(docType); // a ?type= link keeps its option even before the first such document
    return [...set];
  }, [invoices, docType]);
  const visibleSelected = rows.filter((r) => selected.has(r.id));
  const allSelected = rows.length > 0 && visibleSelected.length === rows.length;
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const sortBy = (key: SortKey) =>
    setSort((prev) => ({ key, dir: prev.key === key ? (prev.dir === 'asc' ? 'desc' : 'asc') : key === 'client' || key === 'number' ? 'asc' : 'desc' }));
  const ariaSort = (key: SortKey) => (sort.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none');
  const sortHead = (k: SortKey, label: string, numeric = false) => (
    <th className={numeric ? surface.numeric : undefined} aria-sort={ariaSort(k)}>
      <button type="button" className={styles.sortBtn} onClick={() => sortBy(k)}>
        {label}
        {sort.key === k && (sort.dir === 'asc' ? <ArrowUp size={12} aria-hidden="true" /> : <ArrowDown size={12} aria-hidden="true" />)}
      </button>
    </th>
  );

  const counts = useMemo(
    () => Object.fromEntries(FILTERS.map((f) => [f.id, invoices.filter((i) => matchesFilter(i, f.id, now)).length])) as Record<Filter, number>,
    [invoices], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const handlePreview = (inv: InvoiceRecord) => {
    if (loadInvoice(inv.id)) setPreviewOpen(true);
    else notify(salesT('tx.openFailed'), 'error');
  };

  const handleDuplicate = (inv: InvoiceRecord) => {
    try {
      const issue = todayInput();
      const clone: InvoiceRecord = {
        ...inv,
        id: generateId(),
        invoice_number: '',
        status: 'Draft',
        issue_date: issue,
        due_date: addDaysInput(localDb.settings.get().defaultDueDays, issue),
        amount_paid: 0,
        branch_transfer_id: undefined, // a copy is an ordinary sale, never a Sec 25(4) transfer invoice
        // A duplicate is a new document: on reverse charge its tax stays out of the total (src/lib/rcm.ts).
        ...(inv.reverse_charge ? { rcm_tax_excluded: true, total: receivableTotal(inv) } : {}),
        balance_due: receivableTotal(inv),
        late_fee_for: undefined,
        party_balance_snapshot: undefined, // 8.5: a copy takes its own balance when issued
        // Files stay with the original document (6.12); custom field values are copied like any other field.
        attachments: undefined,
        // An amendment marker belongs to the amended document only (5.9).
        amends: undefined,
        pos: undefined,
        // A new shipment: vehicle / LR / e-Way numbers belong to the original (P1-24).
        transport: undefined,
        created_at: undefined,
        updated_at: undefined,
        // A copy is a fresh document: it fulfils no sales order and is not closed.
        sales_order_id: undefined,
        order_closed_on: undefined,
        items: (inv.items ?? []).map(({ order_line_id: _drop, ...item }) => item),
      };
      const saved = localDb.invoices.save(clone);
      reload();
      notify(salesT('tx.duplicated', { number: saved.invoice_number }));
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };

  /** Actually remove whatever is waiting; errors (e.g. a lock set meanwhile) are reported, the rest still go. */
  const flushDeletes = (ids: Set<string>) => {
    clearTimeout(deleteTimer.current);
    const failed: string[] = [];
    for (const id of ids) {
      try {
        localDb.invoices.remove(id);
      } catch (err) {
        failed.push((err as Error).message);
      }
    }
    setPendingDelete(new Set());
    reload();
    if (failed.length) notify(failed[0], 'error');
  };

  // Leaving the page commits any delete still waiting for its Undo window.
  useEffect(() => () => {
    if (pendingRef.current.size) flushDeletes(pendingRef.current);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDelete = async (docs: InvoiceRecord[]) => {
    // Deleting a goods-returning credit note takes its goods out of stock again: refuse when a later
    // document resold its serials, and ask when later documents used its quantities.
    const notes = docs.filter((d) => d.doc_type === 'CREDIT_NOTE' && d.status !== 'Draft' && d.status !== 'Cancelled');
    if (notes.length) {
      const { liveRemovalIssues } = await import('../lib/stock-timeline');
      for (const n of notes) {
        const issues = liveRemovalIssues({ refType: 'invoice', refId: n.id });
        if (issues.errors.length) return notify(`${n.invoice_number}: ${issues.errors[0]}`, 'error');
        if (issues.warnings.length && !window.confirm(`${n.invoice_number}: ${issues.warnings.join(' ')}\n\nDelete anyway?`)) return;
      }
    }
    const ids = new Set([...pendingDelete, ...docs.map((d) => d.id)]);
    clearTimeout(deleteTimer.current);
    setPendingDelete(ids);
    setSelected(new Set());
    deleteTimer.current = setTimeout(() => flushDeletes(ids), 6000);
    const label = docs.length === 1 ? docs[0].invoice_number : salesT('tx.nDocuments', { n: docs.length });
    notify(salesT('tx.deleted', { label }), 'success', {
      duration: 6000,
      action: {
        label: salesT('tx.undo'),
        onClick: () => {
          clearTimeout(deleteTimer.current);
          setPendingDelete(new Set());
        },
      },
    });
  };

  const runBulkPay = () => {
    if (!bulkPay) return;
    const r = bulkMarkPaid(visibleSelected.map((i) => i.id), bulkPay);
    setBulkPay(null);
    setSelected(new Set());
    reload();
    const skipped = r.skipped.length ? salesT('tx.bulkSkipped', { n: r.skipped.length, number: r.skipped[0].number, reason: r.skipped[0].reason }) : '';
    notify(salesT('tx.bulkPaid', { n: r.paid.length, amount: formatCurrency(r.total) }) + skipped, r.paid.length ? 'success' : 'info');
  };

  const ledgerRows = (list: InvoiceRecord[]) => {
    const header = ['Number', 'Type', 'Date', 'Due date', 'Client', 'GSTIN', 'Taxable', 'CGST', 'SGST', 'IGST', 'Total', 'Paid', 'Balance', 'Status'];
    const body = list.map((i) => [
      i.invoice_number,
      DOCUMENT_LABELS[i.doc_type] ?? 'Invoice',
      i.issue_date,
      i.due_date,
      i.client?.name,
      i.client?.gstin,
      i.taxable_value,
      i.cgst_amount,
      i.sgst_amount,
      i.igst_amount,
      i.total,
      i.amount_paid,
      receivableBalance(i),
      effectiveStatus(i, now),
    ]);
    return [header, ...body];
  };

  const exportCsv = (list: InvoiceRecord[] = rows) => {
    downloadText(`invoice-ledger-${todayInput()}.csv`, toCsv(ledgerRows(list)), 'text/csv');
    notify(list.length === 1 ? salesT('exportedOne') : salesT('exportedMany', { n: list.length }));
  };

  const exportXlsx = async (list: InvoiceRecord[] = rows) => {
    try {
      const { downloadXlsx } = await import('../lib/xlsx');
      await downloadXlsx(`invoice-ledger-${todayInput()}.xlsx`, [{ name: 'Invoices', rows: ledgerRows(list) }]);
      notify(list.length === 1 ? salesT('exportedOne') : salesT('exportedMany', { n: list.length }));
    } catch {
      notify(salesT('xlsxFailed'), 'error');
    }
  };

  return (
    <div className={surface.page}>
      <PageHeader
        title={salesT('tx.title')}
        subtitle={salesT('tx.subtitle')}
        actions={
          <>
            <button type="button" className={controls.btnOutline} onClick={() => exportCsv()} disabled={rows.length === 0}>
              <Download size={16} /> {salesT('exportCsv')}
            </button>
            <button type="button" className={controls.btnOutline} onClick={() => void exportXlsx()} disabled={rows.length === 0}>
              <Download size={16} /> {salesT('exportXlsx')}
            </button>
            {can('doc.create') && (
              <Link to="/invoice" className={controls.btnPrimary}>
                <FilePlus2 size={16} /> {salesT('tx.newInvoice')}
              </Link>
            )}
          </>
        }
      />

      <div className={surface.statGrid}>
        <StatCard label={salesT('tx.billed')} value={formatCurrency(summary.billed)} icon={FileText} hint={salesT('tx.issued', { n: summary.count })} />
        <StatCard label={salesT('tx.received')} value={formatCurrency(summary.received)} icon={Banknote} tone="profit" />
        <StatCard label={salesT('tx.outstanding')} value={formatCurrency(summary.outstanding)} icon={FileText} tone="warning" />
      </div>

      <section className={surface.card}>
        <div className={styles.toolbar}>
          <label className={styles.search}>
            <Search size={16} />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={salesT('tx.searchPh')}
              aria-label={salesT('tx.searchAria')}
            />
          </label>
          <div className={controls.segment} role="group" aria-label={salesT('tx.filterAria')}>
            {FILTERS.filter((f) => f.id !== 'approval' || counts.approval > 0 || filter === 'approval').map((f) => (
              <button
                key={f.id}
                type="button"
                aria-pressed={filter === f.id}
                className={filter === f.id ? controls.segmentBtnActive : controls.segmentBtn}
                onClick={() => setFilter(f.id)}
              >
                {f.label()} <span className={styles.count}>{counts[f.id]}</span>
              </button>
            ))}
          </div>
        </div>

        <div className={styles.filters}>
          <select className={controls.select} aria-label={salesT('tx.docType')} value={docType} onChange={(e) => setDocType(e.target.value as DocumentType | '')}>
            <option value="">{salesT('tx.allTypes')}</option>
            {docTypes.map((t) => (
              <option key={t} value={t}>{t in DOCUMENT_LABELS ? docLabel(t) : t}</option>
            ))}
          </select>
          {docType === 'SALES_ORDER' && (
            <select className={controls.select} aria-label={salesT('tx.orderStatus')} value={orderState} onChange={(e) => setOrderState(e.target.value as OrderState | '')}>
              <option value="">{salesT('tx.allOrders')}</option>
              {ORDER_STATES.map((s) => (
                <option key={s} value={s}>{stateLabel(s)}</option>
              ))}
            </select>
          )}
          <label className={styles.range}>
            <span>{salesT('tx.from')}</span>
            <input type="date" className={controls.input} value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} aria-label={salesT('tx.fromDate')} />
          </label>
          <label className={styles.range}>
            <span>{salesT('tx.to')}</span>
            <input type="date" className={controls.input} value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} aria-label={salesT('tx.toDate')} />
          </label>
          <BranchFilter value={branch} onChange={setBranch} testId="tx-branch" />
          {(docType || from || to || branch) && (
            <button type="button" className={controls.btnGhost} onClick={() => { setDocType(''); setFrom(''); setTo(''); setBranch(''); }}>
              {salesT('tx.clearFilters')}
            </button>
          )}
        </div>

        {visibleSelected.length > 0 && (
          <div className={styles.bulkBar} role="region" aria-label={salesT('tx.bulkActions')}>
            <strong>{salesT('tx.selected', { n: visibleSelected.length })}</strong>
            {can('payment.record') && (
              <button
                type="button"
                className={controls.btnOutline}
                disabled={!visibleSelected.some((i) => canMarkPaid(i, credits))}
                onClick={() => setBulkPay({ method: 'Bank Transfer', date: todayInput() })}
              >
                <CheckCheck size={16} /> {salesT('tx.markPaid')}
              </button>
            )}
            <button type="button" className={controls.btnOutline} onClick={() => exportCsv(visibleSelected)}>
              <Download size={16} /> {salesT('exportCsv')}
            </button>
            <button type="button" className={controls.btnOutline} onClick={() => setBatchPdf(visibleSelected)}>
              <FileText size={16} /> PDF / ZIP
            </button>
            {visibleSelected.some(mayDelete) && (
              <button
                type="button"
                className={controls.btnDanger}
                disabled={visibleSelected.some(isLocked) || !visibleSelected.every(mayDelete)}
                title={
                  visibleSelected.some(isLocked)
                    ? salesT('tx.someLocked')
                    : !visibleSelected.every(mayDelete)
                      ? salesT('tx.ownerOnly')
                      : undefined
                }
                onClick={() => setDeleting(visibleSelected)}
              >
                <Trash2 size={16} /> {salesT('delete')}
              </button>
            )}
            <button type="button" className={controls.btnGhost} onClick={() => setSelected(new Set())} aria-label={salesT('tx.clearSelection')}>
              <X size={16} />
            </button>
          </div>
        )}

        {invoices.length === 0 ? (
          <EmptyState
            icon={FileText}
            title={t('list.txEmptyTitle')}
            text={t('list.txEmptyText')}
            action={
              can('doc.create') ? (
                <Link to="/invoice" className={controls.btnPrimary}>
                  <FilePlus2 size={16} /> {t('common.createInvoice')}
                </Link>
              ) : undefined
            }
          />
        ) : rows.length === 0 ? (
          <EmptyState icon={Search} title={t('common.noMatches')} text={t('common.tryOtherSearchFilter')} />
        ) : (
          <div className={surface.tableWrap}>
            <table className={cn(surface.table, styles.ledger)} aria-rowcount={virtual.ariaRowCount(1)}>
              <thead>
                <tr aria-rowindex={virtual.enabled ? 1 : undefined}>
                  <th className={styles.cCheck}>
                    <input
                      type="checkbox"
                      aria-label={allSelected ? salesT('tx.clearSelection') : salesT('tx.selectAll')}
                      checked={allSelected}
                      onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))}
                    />
                  </th>
                  {sortHead('number', salesT('tx.colDocument'))}
                  {sortHead('client', salesT('tx.colClient'))}
                  {sortHead('date', salesT('tx.colDate'))}
                  <th>{salesT('tx.colStatus')}</th>
                  {sortHead('total', salesT('tx.colTotal'), true)}
                  {sortHead('balance', salesT('tx.colBalance'), true)}
                  <th aria-label={salesT('actions')} />
                </tr>
              </thead>
              <tbody {...virtual.bodyProps}>
                {virtual.slots.map((slot) => {
                  if (slot.kind === 'gap') return <VirtualGap key={slot.key} height={slot.height} colSpan={8} />;
                  const inv = rows[slot.index];
                  const status = effectiveStatus(inv, now);
                  const due = isRevenueDoc(inv) ? amountDue(inv, credits.get(inv.id)) : 0;
                  const canPay = due > 0;
                  const locked = isLocked(inv); // period lock: read-only, no edit / delete / payment
                  const lockedTitle = salesT('tx.lockedTitle');
                  const num = { number: inv.invoice_number };
                  return (
                    <tr key={inv.id} aria-selected={selected.has(inv.id)} {...virtual.rowProps(slot.index)}>
                      <td className={styles.cCheck}>
                        <input type="checkbox" checked={selected.has(inv.id)} onChange={() => toggle(inv.id)} aria-label={salesT('tx.select', num)} />
                      </td>
                      <td className={styles.cDoc}>
                        <Link to={`/invoice/${inv.id}`} className={styles.docLink}>
                          {inv.invoice_number}
                        </Link>
                        {locked && <Lock size={12} aria-label={salesT('tx.lockedPeriod')} style={{ marginLeft: 6, verticalAlign: '-1px', color: 'var(--warning)' }} />}
                        <div className={styles.docType}>{docLabel(inv.doc_type in DOCUMENT_LABELS ? inv.doc_type : 'INVOICE')}</div>
                      </td>
                      <td className={styles.cClient}>
                        <div className={styles.client}>
                          <Avatar name={inv.client?.name || '?'} size={28} square />
                          <span>{inv.client?.name || '—'}</span>
                        </div>
                      </td>
                      <td className={cn(styles.nowrap, styles.cDate)}>
                        {formatDate(inv.issue_date)}
                        <div className={cn(styles.docType, status === 'Overdue' && styles.overdueText)}>
                          {salesT('tx.due', { date: formatDate(inv.due_date) || '—' })}
                        </div>
                      </td>
                      <td className={styles.cStatus}>
                        {inv.doc_type === 'QUOTATION' ? (
                          (() => {
                            const q = quoteState(inv, links, now);
                            return <StatusBadge status={stateLabel(q)} tone={quoteTone(q)} />;
                          })()
                        ) : inv.doc_type === 'SALES_ORDER' ? (
                          (() => {
                            const o = orderStates.get(inv.id) ?? 'Open';
                            return <StatusBadge status={stateLabel(o)} tone={orderTone(o)} />;
                          })()
                        ) : isPendingApproval(inv) ? (
                          <StatusBadge status={wireT('pendingApproval')} tone="partial" />
                        ) : inv.approval?.state === 'rejected' && status === 'Draft' ? (
                          <StatusBadge status={wireT('rejectedApproval')} tone="overdue" />
                        ) : (
                          <StatusBadge status={status} />
                        )}
                      </td>
                      <td className={cn(surface.numeric, styles.cTotal)}>{formatCurrency(inv.total, inv.currency)}</td>
                      <td className={cn(surface.numeric, styles.cBal)}>
                        {isRevenueDoc(inv) ? formatCurrency(due, inv.currency) : '—'}
                      </td>
                      <td className={styles.cAct}>
                        <div className={surface.rowActions}>
                          {canPay && can('payment.record') && (
                            <button type="button" className={controls.btnIcon} onClick={() => setPayFor(inv)} disabled={locked} title={locked ? lockedTitle : salesT('tx.recordPayment')} aria-label={salesT('tx.recordPaymentFor', num)}>
                              <Banknote size={16} />
                              <span className={styles.payLabel} aria-hidden>₹ {salesT('tx.received')}</span>
                            </button>
                          )}
                          <button type="button" className={controls.btnIcon} onClick={() => handlePreview(inv)} title={salesT('tx.previewPdf')} aria-label={salesT('tx.previewOf', num)}>
                            <Eye size={16} />
                          </button>
                          {can('doc.edit') && (
                            <button type="button" className={controls.btnIcon} onClick={() => navigate(`/invoice/${inv.id}`)} disabled={locked} title={locked ? lockedTitle : salesT('edit')} aria-label={salesT('tx.editOf', num)}>
                              <Pencil size={16} />
                            </button>
                          )}
                          {can('doc.create') && (
                            <button type="button" className={controls.btnIcon} onClick={() => handleDuplicate(inv)} title={salesT('tx.duplicate')} aria-label={salesT('tx.duplicateOf', num)}>
                              <Copy size={16} />
                            </button>
                          )}
                          {mayDelete(inv) && (
                            <button type="button" className={controls.btnDanger} onClick={() => setDeleting([inv])} disabled={locked} title={locked ? lockedTitle : salesT('delete')} aria-label={salesT('tx.deleteOf', num)}>
                              <Trash2 size={16} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {previewOpen && (
        <Suspense fallback={null}>
          <InvoicePreviewModal isOpen={previewOpen} onClose={() => setPreviewOpen(false)} />
        </Suspense>
      )}
      <PaymentModal
        invoice={payFor}
        onClose={() => setPayFor(null)}
        onChanged={(message) => {
          reload();
          if (message) notify(message);
        }}
      />
      <ConfirmDialog
        open={!!deleting}
        destructive
        title={deleting && deleting.length > 1 ? salesT('tx.deleteManyTitle', { n: deleting.length }) : salesT('tx.deleteOneTitle')}
        message={deleting && deleting.length > 1 ? salesT('tx.deleteManyMsg') : salesT('tx.deleteOneMsg', { number: deleting?.[0]?.invoice_number ?? '' })}
        confirmLabel={salesT('delete')}
        onConfirm={() => deleting && handleDelete(deleting)}
        onClose={() => setDeleting(null)}
      />
      {batchPdf && (
        <Suspense fallback={null}>
          <BatchPdfModal invoices={batchPdf} onClose={() => setBatchPdf(null)} />
        </Suspense>
      )}
      <Modal
        open={!!bulkPay}
        onClose={() => setBulkPay(null)}
        size="sm"
        title={salesT('tx.bulkTitle', { n: visibleSelected.filter((i) => canMarkPaid(i, credits)).length })}
        subtitle={salesT('tx.bulkSub', { amount: formatCurrency(bulkPaidTotal(visibleSelected, credits)) })}
        footer={
          <>
            <button type="button" className={controls.btnOutline} onClick={() => setBulkPay(null)}>{salesT('cancel')}</button>
            <button type="button" className={controls.btnPrimary} onClick={runBulkPay}>{salesT('tx.markPaid')}</button>
          </>
        }
      >
        {bulkPay && (
          <div className={controls.row}>
            <label className={controls.field}>
              <span className={controls.label}>{salesT('tx.receivedOn')}</span>
              <input type="date" className={controls.input} value={bulkPay.date} onChange={(e) => setBulkPay({ ...bulkPay, date: e.target.value })} />
            </label>
            <label className={controls.field}>
              <span className={controls.label}>{salesT('tx.method')}</span>
              <select className={controls.select} value={bulkPay.method} onChange={(e) => setBulkPay({ ...bulkPay, method: e.target.value })}>
                {['Bank Transfer', 'UPI', 'Cash', 'Cheque', 'Card'].map((m) => <option key={m} value={m}>{m === 'Bank Transfer' && lang === 'en' ? m : methodLabel(m === 'Bank Transfer' ? 'Bank transfer' : m)}</option>)}
              </select>
            </label>
          </div>
        )}
      </Modal>
      {toastNode}
    </div>
  );
}
