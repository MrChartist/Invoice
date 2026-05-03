import { useState, useEffect } from 'react';
import { localDb, setTable, getTable, generateId } from '../lib/localDb';
import { formatCurrency, formatDate, cn } from '../lib/utils';
import { ArrowDownRight, ArrowUpRight, FileText, Eye, CheckCircle, Trash2, Copy } from 'lucide-react';
import { useInvoiceStore } from '../store/useInvoiceStore';
import { InvoicePreviewModal } from '../components/preview/InvoicePreview';
import { Toast } from '../components/ui/Toast';
import styles from './InvoiceCreator.module.css';

export function Transactions() {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const store = useInvoiceStore();

  const reload = () => setInvoices(localDb.invoices.getAll());

  useEffect(() => { reload(); }, []);

  const totalRevenue = invoices.filter(i => i.status === 'Paid').reduce((sum, i) => sum + i.total, 0);
  const pendingRevenue = invoices.filter(i => i.status !== 'Paid' && i.status !== 'Draft').reduce((sum, i) => sum + i.total, 0);

  const handlePreview = (inv: any) => {
    store.loadInvoice(inv.id);
    setPreviewOpen(true);
  };

  const handleMarkPaid = (inv: any) => {
    const all = getTable('invoices');
    const idx = all.findIndex((i: any) => i.id === inv.id);
    if (idx >= 0) {
      all[idx].status = all[idx].status === 'Paid' ? 'Sent' : 'Paid';
      setTable('invoices', all);
      reload();
      setToastMsg(all[idx].status === 'Paid' ? 'Marked as Paid ✓' : 'Reverted to Sent');
    }
  };

  const handleDelete = (inv: any) => {
    const all = getTable('invoices').filter((i: any) => i.id !== inv.id);
    setTable('invoices', all);
    reload();
    setToastMsg('Invoice deleted');
  };

  const handleDuplicate = (inv: any) => {
    const clone = {
      ...inv,
      id: generateId(),
      invoice_number: '', // will be auto-generated
      status: 'Draft',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    localDb.invoices.save(clone);
    reload();
    setToastMsg(`Duplicated as ${clone.invoice_number || 'new draft'}`);
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>Transactions Ledger</h1>
      </div>

      {/* Stats Row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '2rem', marginBottom: '2rem' }}>
        <div className={styles.card} style={{ padding: '1.5rem' }}>
          <div style={{ color: 'var(--muted-foreground)', fontSize: '0.875rem', fontWeight: 600, textTransform: 'uppercase', marginBottom: '0.5rem' }}>Total Received</div>
          <div style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--profit)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <ArrowDownRight size={24} /> {formatCurrency(totalRevenue)}
          </div>
        </div>
        <div className={styles.card} style={{ padding: '1.5rem' }}>
          <div style={{ color: 'var(--muted-foreground)', fontSize: '0.875rem', fontWeight: 600, textTransform: 'uppercase', marginBottom: '0.5rem' }}>Pending Invoices</div>
          <div style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--warning)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <ArrowUpRight size={24} /> {formatCurrency(pendingRevenue)}
          </div>
        </div>
        <div className={styles.card} style={{ padding: '1.5rem' }}>
          <div style={{ color: 'var(--muted-foreground)', fontSize: '0.875rem', fontWeight: 600, textTransform: 'uppercase', marginBottom: '0.5rem' }}>Total Invoices</div>
          <div style={{ fontSize: '2rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <FileText size={24} /> {invoices.length}
          </div>
        </div>
      </div>

      {/* Invoices Table */}
      <div className={styles.card}>
        <div className={styles.cardHeader} style={{ paddingBottom: '1.5rem', borderBottom: '1px solid var(--border)' }}>
          Recent Invoices
        </div>
        <div style={{ padding: '0 1.5rem' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--muted-foreground)', fontSize: '0.75rem', textTransform: 'uppercase' }}>
                <th style={{ padding: '1rem 0', fontWeight: 600 }}>Invoice Number</th>
                <th style={{ padding: '1rem 0', fontWeight: 600 }}>Client</th>
                <th style={{ padding: '1rem 0', fontWeight: 600 }}>Date</th>
                <th style={{ padding: '1rem 0', fontWeight: 600 }}>Status</th>
                <th style={{ padding: '1rem 0', fontWeight: 600, textAlign: 'right' }}>Amount</th>
                <th style={{ padding: '1rem 0', fontWeight: 600, textAlign: 'center' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {invoices.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: '2rem 0', textAlign: 'center', color: 'var(--muted-foreground)' }}>No invoices generated yet.</td>
                </tr>
              ) : (
                invoices.map((inv, idx) => (
                  <tr key={idx} style={{ borderBottom: '1px solid var(--border)', fontSize: '0.875rem' }}>
                    <td style={{ padding: '1rem 0', fontWeight: 600, color: 'var(--primary)' }}>{inv.invoice_number}</td>
                    <td style={{ padding: '1rem 0' }}>{inv.client?.name || 'Unknown Client'}</td>
                    <td style={{ padding: '1rem 0' }}>{formatDate(inv.issue_date)}</td>
                    <td style={{ padding: '1rem 0' }}>
                      <span className={cn(
                        styles.badge, 
                        inv.status === 'Draft' ? styles.badgeDraft : 
                        inv.status === 'Paid' ? styles.badgePaid : 
                        inv.status === 'Overdue' ? styles.badgeOverdue : styles.badgeSent
                      )}>
                        {inv.status}
                      </span>
                    </td>
                    <td style={{ padding: '1rem 0', textAlign: 'right', fontWeight: 600 }}>{formatCurrency(inv.total, inv.currency)}</td>
                    <td style={{ padding: '1rem 0', textAlign: 'center' }}>
                      <div style={{ display: 'inline-flex', gap: '0.25rem', alignItems: 'center' }}>
                        <button onClick={() => handlePreview(inv)} className={styles.btnGhost} style={{ color: 'var(--primary)', padding: '0.4rem' }} title="Preview & Download">
                          <Eye size={15} />
                        </button>
                        <button onClick={() => handleMarkPaid(inv)} className={styles.btnGhost} style={{ color: inv.status === 'Paid' ? 'var(--profit)' : 'var(--muted-foreground)', padding: '0.4rem' }} title={inv.status === 'Paid' ? 'Mark Unpaid' : 'Mark as Paid'}>
                          <CheckCircle size={15} />
                        </button>
                        <button onClick={() => handleDuplicate(inv)} className={styles.btnGhost} style={{ color: 'var(--muted-foreground)', padding: '0.4rem' }} title="Duplicate Invoice">
                          <Copy size={15} />
                        </button>
                        <button onClick={() => handleDelete(inv)} className={styles.btnGhost} style={{ color: 'var(--destructive)', padding: '0.4rem' }} title="Delete Invoice">
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <InvoicePreviewModal isOpen={previewOpen} onClose={() => setPreviewOpen(false)} />
      {toastMsg && <Toast message={toastMsg} onClose={() => setToastMsg(null)} />}
    </div>
  );
}
