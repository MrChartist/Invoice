import { lazy, Suspense, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Banknote,
  Copy,
  Download,
  Eye,
  FilePlus2,
  FileText,
  Pencil,
  Search,
  Trash2,
} from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { StatCard } from '../components/ui/StatCard';
import { StatusBadge } from '../components/ui/StatusBadge';
import { EmptyState } from '../components/ui/EmptyState';
import { Avatar } from '../components/ui/Avatar';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { useToast } from '../components/ui/useToast';

import { PaymentModal } from '../components/modals/PaymentModal';
import { localDb, generateId } from '../lib/localDb';
import { useInvoiceStore } from '../store/useInvoiceStore';
import { effectiveStatus } from '../lib/invoice-status';
import { getTable } from '../lib/storage';
import type { CreditLink } from '../lib/stats';
import { isRevenueDoc, summarize } from '../lib/stats';
import { downloadText, toCsv } from '../lib/download';
import { addDaysInput, cn, formatCurrency, formatDate, todayInput } from '../lib/utils';
import { DOCUMENT_LABELS, type InvoiceRecord } from '../types/invoice';
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
  const [filter, setFilter] = useState<Filter>('all');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [payFor, setPayFor] = useState<InvoiceRecord | null>(null);
  const [deleting, setDeleting] = useState<InvoiceRecord | null>(null);

  const reload = () => setVersion((v) => v + 1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const invoices = useMemo(() => localDb.invoices.getAll(), [version]);
  const now = new Date();
  const summary = useMemo(() => summarize(invoices, now, getTable<CreditLink>('doc_links')), [invoices]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return invoices
      .filter((inv) => matchesFilter(inv, filter, now))
      .filter(
        (inv) =>
          !q ||
          [inv.invoice_number, inv.client?.name, inv.client?.company, inv.client?.gstin].some((f) =>
            f?.toLowerCase().includes(q),
          ),
      )
      .sort((a, b) => (b.issue_date || '').localeCompare(a.issue_date || '') || (b.created_at || '').localeCompare(a.created_at || ''));
  }, [invoices, query, filter]); // eslint-disable-line react-hooks/exhaustive-deps

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
        created_at: undefined,
        updated_at: undefined,
      };
      const saved = localDb.invoices.save(clone);
      reload();
      notify(`Duplicated as ${saved.invoice_number}`);
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };

  const handleDelete = (inv: InvoiceRecord) => {
    try {
      localDb.invoices.remove(inv.id);
      reload();
      notify(`${inv.invoice_number} deleted`);
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };

  const exportCsv = () => {
    const header = ['Number', 'Type', 'Date', 'Due date', 'Client', 'GSTIN', 'Taxable', 'CGST', 'SGST', 'IGST', 'Total', 'Paid', 'Balance', 'Status'];
    const body = rows.map((i) => [
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
    downloadText(`invoice-ledger-${todayInput()}.csv`, toCsv([header, ...body]), 'text/csv');
    notify(`Exported ${rows.length} row${rows.length === 1 ? '' : 's'}`);
  };

  return (
    <div className={surface.page}>
      <PageHeader
        title="Invoices"
        subtitle="Every document you have issued, with payment status."
        actions={
          <>
            <button type="button" className={controls.btnOutline} onClick={exportCsv} disabled={rows.length === 0}>
              <Download size={16} /> Export CSV
            </button>
            <Link to="/invoice" className={controls.btnPrimary}>
              <FilePlus2 size={16} /> New invoice
            </Link>
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

        {invoices.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="Nothing issued yet"
            text="Invoices, quotations and credit notes you save will be listed here, with payment tracking."
            action={
              <Link to="/invoice" className={controls.btnPrimary}>
                <FilePlus2 size={16} /> Create an invoice
              </Link>
            }
          />
        ) : rows.length === 0 ? (
          <EmptyState icon={Search} title="No matches" text="Try a different search or filter." />
        ) : (
          <div className={surface.tableWrap}>
            <table className={cn(surface.table, styles.ledger)}>
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Client</th>
                  <th>Date</th>
                  <th>Status</th>
                  <th className={surface.numeric}>Total</th>
                  <th className={surface.numeric}>Balance</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {rows.map((inv) => {
                  const status = effectiveStatus(inv, now);
                  const canPay = isRevenueDoc(inv) && (inv.balance_due ?? inv.total) > 0;
                  return (
                    <tr key={inv.id}>
                      <td className={styles.cDoc}>
                        <Link to={`/invoice/${inv.id}`} className={styles.docLink}>
                          {inv.invoice_number}
                        </Link>
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
                        <StatusBadge status={status} />
                      </td>
                      <td className={cn(surface.numeric, styles.cTotal)}>{formatCurrency(inv.total, inv.currency)}</td>
                      <td className={cn(surface.numeric, styles.cBal)}>
                        {isRevenueDoc(inv) ? formatCurrency(inv.balance_due ?? inv.total, inv.currency) : '—'}
                      </td>
                      <td className={styles.cAct}>
                        <div className={surface.rowActions}>
                          {canPay && (
                            <button type="button" className={controls.btnIcon} onClick={() => setPayFor(inv)} title="Record payment" aria-label={`Record payment for ${inv.invoice_number}`}>
                              <Banknote size={16} />
                            </button>
                          )}
                          <button type="button" className={controls.btnIcon} onClick={() => handlePreview(inv)} title="Preview / PDF" aria-label={`Preview ${inv.invoice_number}`}>
                            <Eye size={16} />
                          </button>
                          <button type="button" className={controls.btnIcon} onClick={() => navigate(`/invoice/${inv.id}`)} title="Edit" aria-label={`Edit ${inv.invoice_number}`}>
                            <Pencil size={16} />
                          </button>
                          <button type="button" className={controls.btnIcon} onClick={() => handleDuplicate(inv)} title="Duplicate" aria-label={`Duplicate ${inv.invoice_number}`}>
                            <Copy size={16} />
                          </button>
                          <button type="button" className={controls.btnDanger} onClick={() => setDeleting(inv)} title="Delete" aria-label={`Delete ${inv.invoice_number}`}>
                            <Trash2 size={16} />
                          </button>
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
        title="Delete this document?"
        message={`${deleting?.invoice_number ?? ''} and its payment history will be permanently removed from this device. Export a backup first if you may need it.`}
        confirmLabel="Delete"
        onConfirm={() => deleting && handleDelete(deleting)}
        onClose={() => setDeleting(null)}
      />
      {toastNode}
    </div>
  );
}
