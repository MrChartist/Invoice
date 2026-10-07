import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  FilePlus2,
  FileText,
  HelpCircle,
  LayoutDashboard,
  Lock,
  Menu,
  Moon,
  Settings,
  Sun,
  Users,
  X,
} from 'lucide-react';
import { Logo } from '../components/brand/Logo';
import { HelpModal } from '../components/layout/HelpModal';
import { Avatar } from '../components/ui/Avatar';
import { cn } from '../lib/utils';
import { getUser, logout } from '../lib/auth';
import { useTheme } from '../hooks/useTheme';
import styles from './DashboardLayout.module.css';

const NAV_ITEMS = [
  { label: 'Dashboard', path: '/', icon: LayoutDashboard, end: true },
  { label: 'New invoice', path: '/invoice', icon: FilePlus2, end: false },
  { label: 'Invoices', path: '/transactions', icon: FileText, end: false },
  { label: 'Clients', path: '/clients', icon: Users, end: false },
  { label: 'Settings', path: '/settings', icon: Settings, end: false },
];

export function DashboardLayout({ onLogout }: { onLogout?: () => void }) {
  const location = useLocation();
  const user = getUser();
  const { theme, toggle } = useTheme();
  const [helpOpen, setHelpOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => setMenuOpen(false), [location.pathname]);

  const handleLock = () => {
    logout();
    onLogout?.();
  };

  const themeLabel = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';

  return (
    <div className={styles.layout}>
      <header className={cn(styles.topbar, 'no-print')}>
        <button
          type="button"
          className={styles.iconBtn}
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
        >
          {menuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
        <Link to="/" aria-label="Mr. Chartist Invoice home">
          <Logo height={30} product={false} />
        </Link>
        <button type="button" className={styles.iconBtn} aria-label={themeLabel} onClick={toggle}>
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </header>

      {menuOpen && <div className={styles.scrim} onClick={() => setMenuOpen(false)} aria-hidden="true" />}

      <aside className={cn(styles.sidebar, menuOpen && styles.sidebarOpen, 'no-print')}>
        <Link to="/" className={styles.brand} aria-label="Mr. Chartist Invoice home">
          <Logo height={40} />
        </Link>

        <nav className={styles.nav} aria-label="Primary">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.end}
              className={({ isActive }) => cn(styles.navItem, isActive && styles.navItemActive)}
            >
              <item.icon className={styles.navIcon} size={18} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className={styles.bottom}>
          <button type="button" className={styles.navItem} onClick={() => setHelpOpen(true)}>
            <HelpCircle className={styles.navIcon} size={18} />
            <span>Help &amp; about</span>
          </button>
          <button type="button" className={cn(styles.navItem, styles.themeBtn)} onClick={toggle}>
            {theme === 'dark' ? <Sun className={styles.navIcon} size={18} /> : <Moon className={styles.navIcon} size={18} />}
            <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
          </button>

          <div className={styles.userCard}>
            <Avatar name={user?.name || 'User'} size={34} />
            <div className={styles.userMeta}>
              <span className={styles.userName}>{user?.name || 'User'}</span>
              <span className={styles.userSub}>Stored on this device</span>
            </div>
            <button type="button" className={styles.iconBtn} onClick={handleLock} aria-label="Lock app" title="Lock app">
              <Lock size={16} />
            </button>
          </div>
        </div>
      </aside>

      <main className={styles.main} id="main">
        <div className={styles.content} key={location.pathname.startsWith('/invoice') ? 'invoice' : location.pathname}>
          <Outlet />
        </div>
      </main>

      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}
