import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { 
  LayoutDashboard, 
  FileText, 
  ArrowRightLeft, 
  Users, 
  Settings, 
  HelpCircle, 
  LogOut,
  X,
  Heart,
  Keyboard,
  Shield,
  ExternalLink
} from 'lucide-react';
import { cn } from '../lib/utils';
import { getUser, logout } from '../lib/auth';
import styles from './DashboardLayout.module.css';

const NAV_ITEMS = [
  { label: 'Dashboard', path: '/', icon: LayoutDashboard },
  { label: 'Transactions', path: '/transactions', icon: ArrowRightLeft },
  { label: 'Invoices', path: '/invoice', icon: FileText },
  { label: 'Clients', path: '/clients', icon: Users },
  { label: 'Settings', path: '/settings', icon: Settings },
];

interface DashboardLayoutProps {
  children: React.ReactNode;
  onLogout?: () => void;
}

export function DashboardLayout({ children, onLogout }: DashboardLayoutProps) {
  const location = useLocation();
  const user = getUser();
  const [helpOpen, setHelpOpen] = useState(false);

  const handleLogout = () => {
    logout();
    onLogout?.();
  };

  return (
    <div className={styles.layout}>
      {/* Sidebar */}
      <aside className={styles.sidebar}>
        <div className={styles.logoArea}>
          <div className={styles.logoIcon}>
            <span>M</span>
          </div>
          <span className={styles.logoText}>MrChartist.</span>
        </div>

        <nav className={styles.nav}>
          {NAV_ITEMS.map((item) => {
            const isActive = location.pathname === item.path || 
                             (item.path === '/invoice' && location.pathname.startsWith('/invoice'));
            
            return (
              <Link 
                key={item.path} 
                to={item.path} 
                className={cn(styles.navItem, isActive && styles.navItemActive)}
              >
                <item.icon className={styles.navIcon} size={18} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className={styles.bottomNav}>
          <button className={styles.navItem} onClick={() => setHelpOpen(true)}>
            <HelpCircle className={styles.navIcon} size={18} />
            <span>Help</span>
          </button>
          <button className={styles.navItem} onClick={handleLogout}>
            <LogOut className={styles.navIcon} size={18} />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className={styles.main}>
        {/* Header */}
        <header className={styles.header}>
          <div className={styles.headerLeft}>
            {/* Header title can be injected via children or context, but for now we leave it empty as the pages will handle their own titles */}
          </div>
          
          <div className={styles.headerRight}>
            <div className={styles.userProfile}>
              <div className={styles.avatar}>
                <img src={`https://api.dicebear.com/7.x/notionists/svg?seed=${user?.name || 'mrchartist'}`} alt="User" />
              </div>
              <span className={styles.userName}>{user?.name || 'User'}</span>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <div className={styles.content}>
          {children}
        </div>
      </main>

      {/* Help Modal */}
      {helpOpen && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          animation: 'fadeIn 200ms ease',
        }} onClick={() => setHelpOpen(false)}>
          <div style={{
            background: 'var(--card)', borderRadius: '16px', width: '100%', maxWidth: '480px',
            boxShadow: 'var(--shadow-xl)', animation: 'scaleIn 250ms ease',
            overflow: 'hidden',
          }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '1.5rem 1.5rem 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 700, fontFamily: 'var(--font-display)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <HelpCircle size={20} /> About & Help
              </h2>
              <button onClick={() => setHelpOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--muted-foreground)', cursor: 'pointer', padding: '0.5rem' }}>
                <X size={18} />
              </button>
            </div>

            <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {/* Brand */}
              <div style={{ textAlign: 'center', padding: '1rem 0' }}>
                <div style={{ width: '56px', height: '56px', borderRadius: '14px', background: 'linear-gradient(135deg, #f07020, #f09040)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 0.75rem', fontSize: '1.5rem', fontWeight: 800, color: '#fff', fontFamily: 'var(--font-display)' }}>
                  M
                </div>
                <h3 style={{ fontSize: '1.125rem', fontWeight: 800, fontFamily: 'var(--font-display)' }}>MrChartist Invoice Creator</h3>
                <p style={{ fontSize: '0.8125rem', color: 'var(--muted-foreground)' }}>v2.0 · Premium Edition</p>
              </div>

              {/* Features */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem 1rem', background: 'var(--card-inner)', borderRadius: '10px' }}>
                  <Shield size={18} color="var(--profit)" />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>100% Offline & Private</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--muted-foreground)' }}>All data stored locally in your browser. Zero tracking.</div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem 1rem', background: 'var(--card-inner)', borderRadius: '10px' }}>
                  <Keyboard size={18} color="var(--primary)" />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>20+ Premium Templates</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--muted-foreground)' }}>Industry-specific designs for every business type.</div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem 1rem', background: 'var(--card-inner)', borderRadius: '10px' }}>
                  <FileText size={18} color="#6366f1" />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>GST-Ready Invoices</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--muted-foreground)' }}>Supports GSTIN, HSN, and Indian financial year numbering.</div>
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div style={{ textAlign: 'center', paddingTop: '0.5rem', borderTop: '1px solid var(--border)' }}>
                <p style={{ fontSize: '0.8125rem', color: 'var(--muted-foreground)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem' }}>
                  Built with <Heart size={13} color="#e74c3c" fill="#e74c3c" /> by MrChartist
                </p>
                <a 
                  href="https://github.com/MrChartist/Invoice" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  style={{ fontSize: '0.75rem', color: 'var(--primary)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.5rem' }}
                >
                  <ExternalLink size={13} /> View on GitHub
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
