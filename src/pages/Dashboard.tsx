import { useState, useEffect } from 'react';
import { localDb } from '../lib/localDb';
import { formatCurrency, formatDate, cn } from '../lib/utils';
import { LayoutDashboard, ArrowUpRight, ArrowDownRight, Clock, FileText, ChevronRight, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import styles from './InvoiceCreator.module.css';

export function Dashboard() {
  const [invoices, setInvoices] = useState<any[]>([]);

  useEffect(() => {
    setInvoices(localDb.invoices.getAll().reverse());
  }, []);

  const totalRevenue = invoices.filter(i => i.status === 'Paid').reduce((sum, i) => sum + i.total, 0);
  const pendingRevenue = invoices.filter(i => i.status !== 'Paid' && i.status !== 'Draft').reduce((sum, i) => sum + i.total, 0);
  const recentInvoices = invoices.slice(0, 5);

  return (
    <div className={styles.container}>
      <div className={styles.header} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 className={styles.title} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <LayoutDashboard size={24} /> Dashboard Overview
        </h1>
        <Link to="/invoice" className={cn(styles.btn, styles.btnPrimary)} style={{ padding: '0.75rem 1.5rem', fontSize: '0.9375rem', textDecoration: 'none' }}>
          <Plus size={18} /> New Invoice
        </Link>
      </div>

      {/* Stats Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
        <div className={styles.card} style={{ padding: '1.5rem', background: 'linear-gradient(135deg, rgba(37,160,90,0.05) 0%, rgba(37,160,90,0) 100%)' }}>
          <div style={{ color: 'var(--muted-foreground)', fontSize: '0.875rem', fontWeight: 600, textTransform: 'uppercase', marginBottom: '0.75rem' }}>
            Total Revenue Collected
          </div>
          <div style={{ fontSize: '2.5rem', fontWeight: 700, color: 'var(--profit)', display: 'flex', alignItems: 'center', gap: '0.5rem', fontFamily: 'var(--font-display)' }}>
            <ArrowDownRight size={28} /> {formatCurrency(totalRevenue)}
          </div>
        </div>

        <div className={styles.card} style={{ padding: '1.5rem', background: 'linear-gradient(135deg, rgba(230,154,6,0.05) 0%, rgba(230,154,6,0) 100%)' }}>
          <div style={{ color: 'var(--muted-foreground)', fontSize: '0.875rem', fontWeight: 600, textTransform: 'uppercase', marginBottom: '0.75rem' }}>
            Pending Balances
          </div>
          <div style={{ fontSize: '2.5rem', fontWeight: 700, color: 'var(--warning)', display: 'flex', alignItems: 'center', gap: '0.5rem', fontFamily: 'var(--font-display)' }}>
            <ArrowUpRight size={28} /> {formatCurrency(pendingRevenue)}
          </div>
        </div>

        <div className={styles.card} style={{ padding: '1.5rem', background: 'linear-gradient(135deg, rgba(240,112,32,0.05) 0%, rgba(240,112,32,0) 100%)' }}>
          <div style={{ color: 'var(--muted-foreground)', fontSize: '0.875rem', fontWeight: 600, textTransform: 'uppercase', marginBottom: '0.75rem' }}>
            Total Invoices Issued
          </div>
          <div style={{ fontSize: '2.5rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem', fontFamily: 'var(--font-display)' }}>
            <FileText size={28} /> {invoices.length}
          </div>
        </div>
      </div>

      {/* Recent Activity */}
      <div className={styles.card}>
        <div className={styles.cardHeader} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Clock size={18} /> Recent Invoices
          </div>
          <Link to="/transactions" style={{ fontSize: '0.875rem', color: 'var(--primary)', fontWeight: 600, display: 'flex', alignItems: 'center' }}>
            View All Ledger <ChevronRight size={16} />
          </Link>
        </div>
        
        <div style={{ padding: '0 1.5rem' }}>
          {recentInvoices.length === 0 ? (
            <div style={{ padding: '3rem 0', textAlign: 'center', color: 'var(--muted-foreground)' }}>
              No invoices generated yet. Create your first invoice!
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {recentInvoices.map((inv, idx) => (
                <div key={idx} style={{ 
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', 
                  padding: '1.25rem 0', borderBottom: idx !== recentInvoices.length - 1 ? '1px solid var(--border)' : 'none' 
                }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                    <div style={{ fontWeight: 600, fontSize: '1rem' }}>{inv.client?.name || 'Unknown Client'}</div>
                    <div style={{ color: 'var(--muted-foreground)', fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ color: 'var(--primary)', fontWeight: 600 }}>{inv.invoice_number}</span>
                      <span>•</span>
                      <span>{formatDate(inv.issue_date)}</span>
                    </div>
                  </div>
                  
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
                    <div style={{ fontWeight: 700, fontSize: '1.125rem', fontFamily: 'var(--font-mono)' }}>
                      {formatCurrency(inv.total, inv.currency)}
                    </div>
                    <span className={cn(
                      styles.badge, 
                      inv.status === 'Draft' ? styles.badgeDraft : 
                      inv.status === 'Paid' ? styles.badgePaid : 
                      inv.status === 'Overdue' ? styles.badgeOverdue : styles.badgeSent
                    )} style={{ minWidth: '80px', textAlign: 'center' }}>
                      {inv.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
