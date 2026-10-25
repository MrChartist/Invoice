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
import { EmptyState } from '../components/ui/EmptyState';
import { Avatar } from '../components/ui/Avatar';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { useToast } from '../components/ui/useToast';
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
import { bulkMarkPaid, canMarkPaid, matchesListFilter, sortInvoices, type SortDir, type SortKey } from '../lib/invoice-list';
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

// The preview pulls in the template engine and QR code; load it only when opened.
const InvoicePreviewModal = lazy(() =>
  import('../components/preview/InvoicePreview').then((m) => ({ default: m.InvoicePreviewModal })),
);

type Filter = 'all' | 'unpaid' | 'overdue' | 'paid' | 'draft';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'unpaid', label: 'Unpaid' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'paid', label: 'Paid' },
  { id: 'draft', label: 'Draft' },
];

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
    default:
      return true;
  }
}

export function Transactions() {
  const navigate = useNavigate();
  const loadInvoice = useInvoiceStore((s) => s.loadInvoice);
  const { notify, toastNode } = useToast();

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
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'date', dir: 'desc' });
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [bulkPay, setBulkPay] = useState<{ method: string; date: string } | null>(null);
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
    const list = invoices
      .filter((inv) => !pendingDelete.has(inv.id))
      .filter((inv) => matchesFilter(inv, filter, now))
      .filter((inv) => matchesListFilter(inv, { docType, from, to }))
      .filter((inv) => docType !== 'SALES_ORDER' || !orderState || orderStates.get(inv.id) === orderState)
      .filter(
        (inv) =>
          !q ||
          [inv.invoice_number, inv.client?.name, inv.client?.company, inv.client?.gstin].some((f) =>
            f?.toLowerCase().includes(q),
          ),
      );
    return sortInvoices(list, sort.key, sort.dir);
  }, [invoices, query, filter, docType, orderState, orderStates, from, to, sort, pendingDelete]); // eslint-disable-line react-hooks/exhaustive-deps

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
    else notify('Could not open this document.', 'error');
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
        balance_due: inv.total,
        late_fee_for: undefined,
        // Files stay with the original document (6.12); custom field values are copied like any other field.
        attachments: undefined,
        // An amendment marker belongs to the amended document only (5.9).
        amends: undefined,
        pos: undefined,
        created_at: undefined,
        updated_at: undefined,
        // A copy is a fresh document: it fulfils no sales order and is not closed.
        sales_order_id: undefined,
        order_closed_on: undefined,
        items: (inv.items ?? []).map(({ order_line_id: _drop, ...item }) => item),
      };
      const saved = localDb.invoices.save(clone);
      reload();
      notify(`Duplicated as ${saved.invoice_number}`);
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

  const handleDelete = (docs: InvoiceRecord[]) => {
    const ids = new Set([...pendingDelete, ...docs.map((d) => d.id)]);
    clearTimeout(deleteTimer.current);
    setPendingDelete(ids);
    setSelected(new Set());
    deleteTimer.current = setTimeout(() => flushDeletes(ids), 6000);
    const label = docs.length === 1 ? docs[0].invoice_number : `${docs.length} documents`;
    notify(`${label} deleted`, 'success', {
      duration: 6000,
      action: {
        label: 'Undo',
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
    const skipped = r.skipped.length ? ` · ${r.skipped.length} skipped (${r.skipped[0].number}: ${r.skipped[0].reason})` : '';
    notify(`${r.paid.length} marked paid (${formatCurrency(r.total)})${skipped}`, r.paid.length ? 'success' : 'info');
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
      i.balance_due,
      effectiveStatus(i, now),
    ]);
    return [header, ...body];
  };

  const exportCsv = (list: InvoiceRecord[] = rows) => {
    downloadText(`invoice-ledger-${todayInput()}.csv`, toCsv(ledgerRows(list)), 'text/csv');
    notify(`Exported ${list.length} row${list.length === 1 ? '' : 's'}`);
  };

  const exportXlsx = async (list: InvoiceRecord[] = rows) => {
    try {
      const { downloadXlsx } = await import('../lib/xlsx');
      await downloadXlsx(`invoice-ledger-${todayInput()}.xlsx`, [{ name: 'Invoices', rows: ledgerRows(list) }]);
      notify(`Exported ${list.length} row${list.length === 1 ? '' : 's'}`);
    } catch {
      notify('Could not build the Excel file', 'error');
    }
  };

  return (
    <div className={surface.page}>
      <PageHeader
        title="Invoices"
        subtitle="Every document you have issued, with payment status."
        actions={
          <>
            <button type="button" className={controls.btnOutline} onClick={() => exportCsv()} disabled={rows.length === 0}>
              <Download size={16} /> Export CSV
            </button>
            <button type="button" className={controls.btnOutline} onClick={() => void exportXlsx()} disabled={rows.length === 0}>
              <Download size={16} /> Export .xlsx
            </button>
            {can('doc.create') && (
              <Link to="/invoice" className={controls.btnPrimary}>
                <FilePlus2 size={16} /> New invoice
              </Link>
            )}
          </>
        }
      />

      <div className={surface.statGrid}>
        <StatCard label="Billed" value={formatCurrency(summary.billed)} icon={FileText} hint={`${summary.count} issued`} />
        <StatCard label="Received" value={formatCurrency(summary.received)} icon={Banknote} tone="profit" />
        <StatCard label="Outstanding" value={formatCurrency(summary.outstanding)} icon={FileText} tone="warning" />
      </div>

      <section className={surface.card}>
        <div className={styles.toolbar}>
          <label className={styles.search}>
            <Search size={16} />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search number, client or GSTIN"
              aria-label="Search invoices"
            />
          </label>
          <div className={controls.segment} role="group" aria-label="Filter by status">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                aria-pressed={filter === f.id}
                className={filter === f.id ? controls.segmentBtnActive : controls.segmentBtn}
                onClick={() => setFilter(f.id)}
              >
                {f.label} <span className={styles.count}>{counts[f.id]}</span>
              </button>
            ))}
          </div>
        </div>

        <div className={styles.filters}>
          <select className={controls.select} aria-label="Document type" value={docType} onChange={(e) => setDocType(e.target.value as DocumentType | '')}>
            <option value="">All types</option>
            {docTypes.map((t) => (
              <option key={t} value={t}>{DOCUMENT_LABELS[t] ?? t}</option>
            ))}
          </select>
          {docType === 'SALES_ORDER' && (
            <select className={controls.select} aria-label="Order status" value={orderState} onChange={(e) => setOrderState(e.target.value as OrderState | '')}>
              <option value="">All orders</option>
              {ORDER_STATES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          )}
          <label className={styles.range}>
            <span>From</span>
            <input type="date" className={controls.input} value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
          </label>
          <label className={styles.range}>
            <span>To</span>
            <input type="date" className={controls.input} value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
          </label>
          {(docType || from || to) && (
            <button type="button" className={controls.btnGhost} onClick={() => { setDocType(''); setFrom(''); setTo(''); }}>
              Clear filters
            </button>
          )}
        </div>

        {visibleSelected.length > 0 && (
          <div className={styles.bulkBar} role="region" aria-label="Bulk actions">
            <strong>{visibleSelected.length} selected</strong>
            {can('payment.record') && (
              <button
                type="button"
                className={controls.btnOutline}
                disabled={!visibleSelected.some(canMarkPaid)}
                onClick={() => setBulkPay({ method: 'Bank Transfer', date: todayInput() })}
              >
                <CheckCheck size={16} /> Mark paid
              </button>
            )}
            <button type="button" className={controls.btnOutline} onClick={() => exportCsv(visibleSelected)}>
              <Download size={16} /> Export CSV
            </button>
            {visibleSelected.some(mayDelete) && (
              <button
                type="button"
                className={controls.btnDanger}
                disabled={visibleSelected.some(isLocked) || !visibleSelected.every(mayDelete)}
                title={
                  visibleSelected.some(isLocked)
                    ? 'Some selected documents are in a locked period'
                    : !visibleSelected.every(mayDelete)
                      ? 'Only the owner can delete issued documents'
                      : undefined
                }
                onClick={() => setDeleting(visibleSelected)}
              >
                <Trash2 size={16} /> Delete
              </button>
            )}
            <button type="button" className={controls.btnGhost} onClick={() => setSelected(new Set())} aria-label="Clear selection">
              <X size={16} />
            </button>
          </div>
        )}

        {invoices.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="Nothing issued yet"
            text="Invoices, quotations and credit notes you save will be listed here, with payment tracking."
            action={
              can('doc.create') ? (
                <Link to="/invoice" className={controls.btnPrimary}>
                  <FilePlus2 size={16} /> Create an invoice
                </Link>
              ) : undefined
            }
          />
        ) : rows.length === 0 ? (
          <EmptyState icon={Search} title="No matches" text="Try a different search or filter." />
        ) : (
          <div className={surface.tableWrap}>
            <table className={cn(surface.table, styles.ledger)} aria-rowcount={virtual.ariaRowCount(1)}>
              <thead>
                <tr aria-rowindex={virtual.enabled ? 1 : undefined}>
                  <th className={styles.cCheck}>
                    <input
                      type="checkbox"
                      aria-label={allSelected ? 'Clear selection' : 'Select all shown'}
                      checked={allSelected}
                      onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))}
                    />
                  </th>
                  {sortHead('number', 'Document')}
                  {sortHead('client', 'Client')}
                  {sortHead('date', 'Date')}
                  <th>Status</th>
                  {sortHead('total', 'Total', true)}
                  {sortHead('balance', 'Balance', true)}
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody {...virtual.bodyProps}>
                {virtual.slots.map((slot) => {
                  if (slot.kind === 'gap') return <VirtualGap key={slot.key} height={slot.height} colSpan={8} />;
                  const inv = rows[slot.index];
                  const status = effectiveStatus(inv, now);
                  const canPay = isRevenueDoc(inv) && (inv.balance_due ?? inv.total) > 0;
                  const locked = isLocked(inv); // period lock: read-only, no edit / delete / payment
                  const lockedTitle = 'Locked period — open the document to view or unlock it';
                  return (
                    <tr key={inv.id} aria-selected={selected.has(inv.id)} {...virtual.rowProps(slot.index)}>
                      <td className={styles.cCheck}>
                        <input type="checkbox" checked={selected.has(inv.id)} onChange={() => toggle(inv.id)} aria-label={`Select ${inv.invoice_number}`} />
                      </td>
                      <td className={styles.cDoc}>
                        <Link to={`/invoice/${inv.id}`} className={styles.docLink}>
                          {inv.invoice_number}
                        </Link>
                        {locked && <Lock size={12} aria-label="Locked period" style={{ marginLeft: 6, verticalAlign: '-1px', color: 'var(--warning)' }} />}
                        <div className={styles.docType}>{DOCUMENT_LABELS[inv.doc_type] ?? 'Invoice'}</div>
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
                          Due {formatDate(inv.due_date) || '—'}
                        </div>
                      </td>
                      <td className={styles.cStatus}>
                        {inv.doc_type === 'QUOTATION' ? (
                          (() => {
                            const q = quoteState(inv, links, now);
                            return <StatusBadge status={q} tone={quoteTone(q)} />;
                          })()
                        ) : inv.doc_type === 'SALES_ORDER' ? (
                          (() => {
                            const o = orderStates.get(inv.id) ?? 'Open';
                            return <StatusBadge status={o} tone={orderTone(o)} />;
                          })()
                        ) : (
                          <StatusBadge status={status} />
                        )}
                      </td>
                      <td className={cn(surface.numeric, styles.cTotal)}>{formatCurrency(inv.total, inv.currency)}</td>
                      <td className={cn(surface.numeric, styles.cBal)}>
                        {isRevenueDoc(inv) ? formatCurrency(inv.balance_due ?? inv.total, inv.currency) : '—'}
                      </td>
                      <td className={styles.cAct}>
                        <div className={surface.rowActions}>
                          {canPay && can('payment.record') && (
                            <button type="button" className={controls.btnIcon} onClick={() => setPayFor(inv)} disabled={locked} title={locked ? lockedTitle : 'Record payment'} aria-label={`Record payment for ${inv.invoice_number}`}>
                              <Banknote size={16} />
                            </button>
                          )}
                          <button type="button" className={controls.btnIcon} onClick={() => handlePreview(inv)} title="Preview / PDF" aria-label={`Preview ${inv.invoice_number}`}>
                            <Eye size={16} />
                          </button>
                          {can('doc.edit') && (
                            <button type="button" className={controls.btnIcon} onClick={() => navigate(`/invoice/${inv.id}`)} disabled={locked} title={locked ? lockedTitle : 'Edit'} aria-label={`Edit ${inv.invoice_number}`}>
                              <Pencil size={16} />
                            </button>
                          )}
                          {can('doc.create') && (
                            <button type="button" className={controls.btnIcon} onClick={() => handleDuplicate(inv)} title="Duplicate" aria-label={`Duplicate ${inv.invoice_number}`}>
                              <Copy size={16} />
                            </button>
                          )}
                          {mayDelete(inv) && (
                            <button type="button" className={controls.btnDanger} onClick={() => setDeleting([inv])} disabled={locked} title={locked ? lockedTitle : 'Delete'} aria-label={`Delete ${inv.invoice_number}`}>
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
        title={deleting && deleting.length > 1 ? `Delete ${deleting.length} documents?` : 'Delete this document?'}
        message={`${deleting && deleting.length > 1 ? 'They' : deleting?.[0]?.invoice_number ?? ''} and their payment history will be removed from this device. You can undo for a few seconds.`}
        confirmLabel="Delete"
        onConfirm={() => deleting && handleDelete(deleting)}
        onClose={() => setDeleting(null)}
      />
      <Modal
        open={!!bulkPay}
        onClose={() => setBulkPay(null)}
        size="sm"
        title={`Mark ${visibleSelected.filter(canMarkPaid).length} as paid`}
        subtitle={`Records the full balance of each (${formatCurrency(visibleSelected.filter(canMarkPaid).reduce((s, i) => s + (Number(i.balance_due ?? i.total) || 0), 0))}).`}
        footer={
          <>
            <button type="button" className={controls.btnOutline} onClick={() => setBulkPay(null)}>Cancel</button>
            <button type="button" className={controls.btnPrimary} onClick={runBulkPay}>Mark paid</button>
          </>
        }
      >
        {bulkPay && (
          <div className={controls.row}>
            <label className={controls.field}>
              <span className={controls.label}>Received on</span>
              <input type="date" className={controls.input} value={bulkPay.date} onChange={(e) => setBulkPay({ ...bulkPay, date: e.target.value })} />
            </label>
            <label className={controls.field}>
              <span className={controls.label}>Method</span>
              <select className={controls.select} value={bulkPay.method} onChange={(e) => setBulkPay({ ...bulkPay, method: e.target.value })}>
                {['Bank Transfer', 'UPI', 'Cash', 'Cheque', 'Card'].map((m) => <option key={m}>{m}</option>)}
              </select>
            </label>
          </div>
        )}
      </Modal>
      {toastNode}
    </div>
  );
}
