import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { 
  LayoutDashboard, 
  FileText, 
  ArrowRightLeft, 
  Users, 
  Settings, 
  HelpCircle, 
  LogOut 
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
          <button className={styles.navItem}>
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
    </div>
  );
}
