import { useState, useEffect } from 'react';
import { localDb } from '../lib/localDb';
import { formatCurrency, formatDate, cn } from '../lib/utils';
import { LayoutDashboard, ArrowUpRight, ArrowDownRight, Clock, FileText, ChevronRight, Plus, Sparkles, TrendingUp, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { getUser } from '../lib/auth';
import styles from './InvoiceCreator.module.css';

export function Dashboard() {
  const [invoices, setInvoices] = useState<any[]>([]);
  const user = getUser();

  useEffect(() => {
    setInvoices(localDb.invoices.getAll().reverse());
  }, []);

  const totalRevenue = invoices.filter(i => i.status === 'Paid').reduce((sum, i) => sum + i.total, 0);
  const pendingRevenue = invoices.filter(i => i.status !== 'Paid' && i.status !== 'Draft').reduce((sum, i) => sum + i.total, 0);
  const clientCount = localDb.clients.getAll().length;
  const recentInvoices = invoices.slice(0, 5);

  return (
    <div className={styles.container} style={{ animation: 'fadeInUp 400ms ease' }}>
      <div className={styles.header} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 className={styles.title} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.25rem' }}>
            <LayoutDashboard size={24} /> Dashboard
          </h1>
          <p style={{ color: 'var(--muted-foreground)', fontSize: '0.875rem', margin: 0 }}>
            Welcome back, <strong style={{ color: 'var(--foreground)' }}>{user?.name || 'User'}</strong> 👋
          </p>
        </div>
        <Link to="/invoice" className={cn(styles.btn, styles.btnPrimary)} style={{ padding: '0.75rem 1.5rem', fontSize: '0.9375rem', textDecoration: 'none' }}>
          <Plus size={18} /> New Invoice
        </Link>
      </div>

      {/* Stats Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1.25rem', marginBottom: '2rem' }}>
        <div className={styles.card} style={{ padding: '1.25rem 1.5rem', background: 'linear-gradient(135deg, rgba(37,160,90,0.06) 0%, rgba(37,160,90,0) 100%)', transition: 'transform 200ms ease, box-shadow 200ms ease' }}
          onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = 'var(--shadow-md)'; }}
          onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'var(--shadow-card)'; }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
            <div style={{ color: 'var(--muted-foreground)', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Revenue</div>
            <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(37,160,90,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <ArrowDownRight size={16} color="var(--profit)" />
            </div>
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--profit)', fontFamily: 'var(--font-display)' }}>
            {formatCurrency(totalRevenue)}
          </div>
        </div>

        <div className={styles.card} style={{ padding: '1.25rem 1.5rem', background: 'linear-gradient(135deg, rgba(230,154,6,0.06) 0%, rgba(230,154,6,0) 100%)', transition: 'transform 200ms ease, box-shadow 200ms ease' }}
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

        <div className={styles.card} style={{ padding: '1.25rem 1.5rem', background: 'linear-gradient(135deg, rgba(240,112,32,0.06) 0%, rgba(240,112,32,0) 100%)', transition: 'transform 200ms ease, box-shadow 200ms ease' }}
          onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = 'var(--shadow-md)'; }}
          onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'var(--shadow-card)'; }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
            <div style={{ color: 'var(--muted-foreground)', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Invoices</div>
            <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(240,112,32,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <FileText size={16} color="var(--primary)" />
            </div>
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 800, fontFamily: 'var(--font-display)' }}>
            {invoices.length}
          </div>
        </div>

        <div className={styles.card} style={{ padding: '1.25rem 1.5rem', background: 'linear-gradient(135deg, rgba(99,102,241,0.06) 0%, rgba(99,102,241,0) 100%)', transition: 'transform 200ms ease, box-shadow 200ms ease' }}
          onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = 'var(--shadow-md)'; }}
          onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'var(--shadow-card)'; }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
            <div style={{ color: 'var(--muted-foreground)', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Clients</div>
            <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(99,102,241,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Users size={16} color="#6366f1" />
            </div>
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 800, fontFamily: 'var(--font-display)' }}>
            {clientCount}
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', marginBottom: '2rem' }}>
        <Link to="/invoice" style={{ textDecoration: 'none' }}>
          <div className={styles.card} style={{ padding: '1.25rem 1.5rem', cursor: 'pointer', transition: 'transform 200ms ease, box-shadow 200ms ease', display: 'flex', alignItems: 'center', gap: '1rem' }}
            onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = 'var(--shadow-md)'; }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'var(--shadow-card)'; }}
          >
            <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: 'linear-gradient(135deg, #f07020, #f09040)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Plus size={20} color="#fff" />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: '0.9375rem' }}>Create Invoice</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--muted-foreground)' }}>New document</div>
            </div>
          </div>
        </Link>
        <Link to="/clients" style={{ textDecoration: 'none' }}>
          <div className={styles.card} style={{ padding: '1.25rem 1.5rem', cursor: 'pointer', transition: 'transform 200ms ease, box-shadow 200ms ease', display: 'flex', alignItems: 'center', gap: '1rem' }}
            onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = 'var(--shadow-md)'; }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'var(--shadow-card)'; }}
          >
            <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: 'linear-gradient(135deg, #6366f1, #818cf8)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Users size={20} color="#fff" />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: '0.9375rem' }}>Client CRM</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--muted-foreground)' }}>Manage contacts</div>
            </div>
          </div>
        </Link>
        <Link to="/settings" style={{ textDecoration: 'none' }}>
          <div className={styles.card} style={{ padding: '1.25rem 1.5rem', cursor: 'pointer', transition: 'transform 200ms ease, box-shadow 200ms ease', display: 'flex', alignItems: 'center', gap: '1rem' }}
            onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = 'var(--shadow-md)'; }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'var(--shadow-card)'; }}
          >
            <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: 'linear-gradient(135deg, #10b981, #34d399)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <TrendingUp size={20} color="#fff" />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: '0.9375rem' }}>Settings</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--muted-foreground)' }}>Profiles & bank</div>
            </div>
          </div>
        </Link>
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
            <div style={{ padding: '4rem 2rem', textAlign: 'center' }}>
              <div style={{ width: '80px', height: '80px', borderRadius: '20px', background: 'linear-gradient(135deg, rgba(240,112,32,0.1), rgba(240,112,32,0.05))', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem' }}>
                <Sparkles size={36} color="var(--primary)" />
              </div>
              <h3 style={{ fontSize: '1.125rem', fontWeight: 700, fontFamily: 'var(--font-display)', marginBottom: '0.5rem' }}>
                No invoices yet
              </h3>
              <p style={{ color: 'var(--muted-foreground)', fontSize: '0.875rem', marginBottom: '1.5rem', maxWidth: '360px', margin: '0 auto 1.5rem' }}>
                Create your first professional invoice in seconds. Choose from 20+ premium templates.
              </p>
              <Link to="/invoice" className={cn(styles.btn, styles.btnPrimary)} style={{ textDecoration: 'none', padding: '0.75rem 2rem' }}>
                <Plus size={18} /> Create First Invoice
              </Link>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {recentInvoices.map((inv, idx) => (
                <div key={idx} style={{ 
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', 
                  padding: '1.25rem 0', borderBottom: idx !== recentInvoices.length - 1 ? '1px solid var(--border)' : 'none',
                  transition: 'background 150ms ease',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: 'var(--card-inner)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '0.875rem', fontFamily: 'var(--font-display)', color: 'var(--primary)' }}>
                      {(inv.client?.name || 'U')[0].toUpperCase()}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                      <div style={{ fontWeight: 600, fontSize: '0.9375rem' }}>{inv.client?.name || 'Unknown Client'}</div>
                      <div style={{ color: 'var(--muted-foreground)', fontSize: '0.8125rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ color: 'var(--primary)', fontWeight: 600 }}>{inv.invoice_number}</span>
                        <span>•</span>
                        <span>{formatDate(inv.issue_date)}</span>
                      </div>
                    </div>
                  </div>
                  
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
                    <div style={{ fontWeight: 700, fontSize: '1rem', fontFamily: 'var(--font-mono)' }}>
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
