import { useState, useEffect } from 'react';
import { localDb } from '../lib/localDb';
import { formatCurrency, formatDate, cn } from '../lib/utils';
import { ArrowDownRight, ArrowUpRight, FileText } from 'lucide-react';
import styles from './InvoiceCreator.module.css';

export function Transactions() {
  const [invoices, setInvoices] = useState<any[]>([]);

  useEffect(() => {
    setInvoices(localDb.invoices.getAll());
  }, []);

  const totalRevenue = invoices.filter(i => i.status === 'Paid').reduce((sum, i) => sum + i.total, 0);
  const pendingRevenue = invoices.filter(i => i.status !== 'Paid' && i.status !== 'Draft').reduce((sum, i) => sum + i.total, 0);

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
              </tr>
            </thead>
            <tbody>
              {invoices.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ padding: '2rem 0', textAlign: 'center', color: 'var(--muted-foreground)' }}>No invoices generated yet.</td>
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
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
