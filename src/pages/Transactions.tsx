import { useState, useEffect } from 'react';
import { localDb, setTable, getTable, generateId } from '../lib/localDb';
import { formatCurrency, formatDate, cn } from '../lib/utils';
import { ArrowDownRight, ArrowUpRight, FileText, Eye, CheckCircle, Trash2, Copy, ReceiptText, Plus } from 'lucide-react';
import { useInvoiceStore } from '../store/useInvoiceStore';
import { InvoicePreviewModal } from '../components/preview/InvoicePreview';
import { Toast } from '../components/ui/Toast';
import { Link } from 'react-router-dom';
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
    <div className={styles.container} style={{ animation: 'fadeInUp 400ms ease' }}>
      <div className={styles.header}>
        <h1 className={styles.title}>Transactions Ledger</h1>
      </div>

      {/* Stats Row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1.25rem', marginBottom: '2rem' }}>
        <div className={styles.card} style={{ padding: '1.25rem 1.5rem', transition: 'transform 200ms ease, box-shadow 200ms ease' }}
          onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = 'var(--shadow-md)'; }}
          onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'var(--shadow-card)'; }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
            <div style={{ color: 'var(--muted-foreground)', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total Received</div>
            <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(37,160,90,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <ArrowDownRight size={16} color="var(--profit)" />
            </div>
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--profit)', fontFamily: 'var(--font-display)' }}>
            {formatCurrency(totalRevenue)}
          </div>
        </div>
        <div className={styles.card} style={{ padding: '1.25rem 1.5rem', transition: 'transform 200ms ease, box-shadow 200ms ease' }}
          onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = 'var(--shadow-md)'; }}
          onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'var(--shadow-card)'; }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
            <div style={{ color: 'var(--muted-foreground)', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Pending</div>
            <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(230,154,6,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <ArrowUpRight size={16} color="var(--warning)" />
            </div>
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--warning)', fontFamily: 'var(--font-display)' }}>
            {formatCurrency(pendingRevenue)}
          </div>
        </div>
        <div className={styles.card} style={{ padding: '1.25rem 1.5rem', transition: 'transform 200ms ease, box-shadow 200ms ease' }}
          onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = 'var(--shadow-md)'; }}
          onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'var(--shadow-card)'; }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
            <div style={{ color: 'var(--muted-foreground)', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total Invoices</div>
            <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(240,112,32,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <FileText size={16} color="var(--primary)" />
            </div>
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 800, fontFamily: 'var(--font-display)' }}>
            {invoices.length}
          </div>
        </div>
      </div>

      {/* Invoices Table */}
      <div className={styles.card}>
        <div className={styles.cardHeader} style={{ paddingBottom: '1.5rem', borderBottom: '1px solid var(--border)' }}>
          Recent Invoices
        </div>
        <div style={{ padding: '0 1.5rem' }}>
          {invoices.length === 0 ? (
            <div style={{ padding: '4rem 2rem', textAlign: 'center' }}>
              <div style={{ width: '80px', height: '80px', borderRadius: '20px', background: 'linear-gradient(135deg, rgba(240,112,32,0.1), rgba(240,112,32,0.05))', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem' }}>
                <ReceiptText size={36} color="var(--primary)" />
              </div>
              <h3 style={{ fontSize: '1.125rem', fontWeight: 700, fontFamily: 'var(--font-display)', marginBottom: '0.5rem' }}>
                No transactions yet
              </h3>
              <p style={{ color: 'var(--muted-foreground)', fontSize: '0.875rem', maxWidth: '360px', margin: '0 auto 1.5rem' }}>
                Once you create and send invoices, they'll appear here as transactions. Track payments, mark as paid, and more.
              </p>
              <Link to="/invoice" className={cn(styles.btn, styles.btnPrimary)} style={{ textDecoration: 'none', padding: '0.75rem 2rem' }}>
                <Plus size={18} /> Create Invoice
              </Link>
            </div>
          ) : (
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
                {invoices.map((inv, idx) => (
                  <tr key={idx} style={{ borderBottom: '1px solid var(--border)', fontSize: '0.875rem', transition: 'background 150ms ease' }}>
                    <td style={{ padding: '1rem 0', fontWeight: 600, color: 'var(--primary)' }}>{inv.invoice_number}</td>
                    <td style={{ padding: '1rem 0' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <div style={{ width: '28px', height: '28px', borderRadius: '6px', background: 'var(--card-inner)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.75rem', color: 'var(--primary)' }}>
                          {(inv.client?.name || 'U')[0].toUpperCase()}
                        </div>
                        {inv.client?.name || 'Unknown Client'}
                      </div>
                    </td>
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
                    <td style={{ padding: '1rem 0', textAlign: 'right', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{formatCurrency(inv.total, inv.currency)}</td>
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
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <InvoicePreviewModal isOpen={previewOpen} onClose={() => setPreviewOpen(false)} />
      {toastMsg && <Toast message={toastMsg} onClose={() => setToastMsg(null)} />}
    </div>
  );
}
