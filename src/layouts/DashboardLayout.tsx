import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  BookOpen,
  Boxes,
  FileDown,
  FilePlus2,
  FileSpreadsheet,
  FileText,
  HelpCircle,
  Keyboard,
  LayoutDashboard,
  Lock,
  Menu,
  Moon,
  Palette,
  Receipt,
  Repeat,
  Scale,
  Search,
  Settings,
  Sun,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Logo } from '../components/brand/Logo';
import { HelpModal } from '../components/layout/HelpModal';
import { Avatar } from '../components/ui/Avatar';
import { useToast } from '../components/ui/useToast';
import { CommandPalette, type PaletteAction } from '../components/command/CommandPalette';
import { NotificationBell } from '../components/command/NotificationBell';
import { ShortcutsOverlay } from '../components/command/ShortcutsOverlay';
import { InstallPrompt } from '../components/pwa/InstallPrompt';
import { UpdateToast } from '../components/pwa/UpdateToast';
import { BackupNudge } from '../components/pwa/BackupNudge';
import { AutoBackupRunner } from '../components/pwa/AutoBackupRunner';
import { useRecurringRunner } from '../hooks/useRecurringRunner';
import { formatCombo, useHotkeys } from '../hooks/useHotkeys';
import { cn } from '../lib/utils';
import { getUser, logout } from '../lib/auth';
import { backupFilename, buildBackup, markBackupDone } from '../lib/backup';
import { downloadText } from '../lib/download';
import { useTheme } from '../hooks/useTheme';
import styles from './DashboardLayout.module.css';

interface NavEntry {
  label: string;
  path: string;
  icon: LucideIcon;
  end?: boolean;
}

const NAV_GROUPS: { title?: string; items: NavEntry[] }[] = [
  { items: [{ label: 'Dashboard', path: '/', icon: LayoutDashboard, end: true }] },
  {
    title: 'Sales',
    items: [
      { label: 'New invoice', path: '/invoice', icon: FilePlus2 },
      { label: 'Invoices', path: '/transactions', icon: FileText },
      { label: 'Clients', path: '/clients', icon: Users },
      { label: 'Recurring', path: '/recurring', icon: Repeat },
      { label: 'Receivables', path: '/receivables', icon: Scale },
    ],
  },
  {
    title: 'Purchases & stock',
    items: [
      { label: 'Expenses', path: '/expenses', icon: Receipt },
      { label: 'Inventory', path: '/inventory', icon: Boxes },
    ],
  },
  {
    title: 'Accounts & GST',
    items: [
      { label: 'Books', path: '/books', icon: BookOpen },
      { label: 'GST reports', path: '/gst-reports', icon: FileSpreadsheet },
      { label: 'Exports', path: '/exports', icon: FileDown },
    ],
  },
  {
    title: 'Setup',
    items: [
      { label: 'Design studio', path: '/design', icon: Palette },
      { label: 'Settings', path: '/settings', icon: Settings },
    ],
  },
];

const NAV_ITEMS = NAV_GROUPS.flatMap((g) => g.items);

export function DashboardLayout({ onLogout }: { onLogout?: () => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  const user = getUser();
  const { theme, toggle } = useTheme();
  const { notify, toastNode } = useToast();
  const [helpOpen, setHelpOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const asideRef = useRef<HTMLElement>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 900px)').matches);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)');
    const onChange = () => {
      setIsMobile(mq.matches);
      if (!mq.matches) setMenuOpen(false);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => setMenuOpen(false), [location.pathname]);

  // Mobile drawer: focus trap, Esc to close, scroll lock, focus restore.
  const drawerActive = isMobile && menuOpen;
  useEffect(() => {
    if (!drawerActive) return;
    const aside = asideRef.current;
    const opener = menuBtnRef.current;
    const focusables = () =>
      Array.from(aside?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') ?? []).filter((el) => el.offsetParent !== null);
    focusables()[0]?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setMenuOpen(false);
        return;
      }
      if (e.key !== 'Tab') return;
      // The open drawer covers the opener, so the trap cycles through the drawer only.
      const items = focusables();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || !items.includes(active as HTMLElement))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      opener?.focus();
    };
  }, [drawerActive]);

  // Recurring schedules create their due invoices once per session start / tab focus.
  const { generated, dismiss, message } = useRecurringRunner();
  useEffect(() => {
    if (generated.length) {
      notify(message, 'info');
      dismiss();
    }
  }, [generated, message, notify, dismiss]);

  const handleLock = () => {
    logout();
    onLogout?.();
  };

  useHotkeys({
    'mod+k': () => setPaletteOpen(true),
    '/': () => setPaletteOpen(true),
    '?': () => setShortcutsOpen(true),
    'g d': () => navigate('/'),
    'g i': () => navigate('/invoice'),
    'g t': () => navigate('/transactions'),
    'g c': () => navigate('/clients'),
    'g s': () => navigate('/settings'),
  });

  const actions = useMemo<PaletteAction[]>(
    () => [
      { id: 'new-invoice', title: 'New invoice', keywords: ['create', 'bill', 'sale'], run: () => navigate('/invoice') },
      { id: 'new-quotation', title: 'New quotation', keywords: ['estimate', 'quote'], run: () => navigate('/invoice?type=QUOTATION') },
      { id: 'add-client', title: 'Add client', keywords: ['customer', 'party'], run: () => navigate('/clients?new=1') },
      { id: 'add-expense', title: 'Add expense or purchase bill', keywords: ['bill', 'vendor'], run: () => navigate('/expenses') },
      { id: 'record-payment', title: 'Record a payment', keywords: ['receipt', 'received'], run: () => navigate('/transactions') },
      { id: 'gst', title: 'Open GST reports', keywords: ['gstr', 'return'], run: () => navigate('/gst-reports') },
      { id: 'settings', title: 'Go to Settings', run: () => navigate('/settings') },
      { id: 'theme', title: theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode', keywords: ['dark', 'light', 'theme'], run: toggle },
      {
        id: 'backup',
        title: 'Download backup',
        keywords: ['export', 'save'],
        run: () => {
          downloadText(backupFilename(), JSON.stringify(buildBackup(), null, 2), 'application/json');
          markBackupDone();
          notify('Backup downloaded');
        },
      },
      { id: 'lock', title: 'Lock app', run: handleLock },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [navigate, theme],
  );

  const themeLabel = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';

  return (
    <div className={styles.layout}>
      <a href="#main" className={cn(styles.skipLink, 'no-print')} onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus(); }}>
        Skip to content
      </a>
      <header className={cn(styles.topbar, 'no-print')}>
        <button
          ref={menuBtnRef}
          type="button"
          className={styles.iconBtn}
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={menuOpen}
          aria-controls="app-sidebar"
          onClick={() => setMenuOpen((o) => !o)}
        >
          {menuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
        <Link to="/" aria-label="Mr. Chartist Invoice home">
          <Logo height={30} product={false} />
        </Link>
        <div className={styles.topActions}>
          <button type="button" className={styles.iconBtn} aria-label="Search" onClick={() => setPaletteOpen(true)}>
            <Search size={18} />
          </button>
          <NotificationBell onNavigate={navigate} />
        </div>
      </header>

      {menuOpen && <div className={styles.scrim} onClick={() => setMenuOpen(false)} aria-hidden="true" />}

      <aside
        id="app-sidebar"
        ref={asideRef}
        className={cn(styles.sidebar, menuOpen && styles.sidebarOpen, 'no-print')}
        inert={isMobile && !menuOpen}
      >
        <Link to="/" className={styles.brand} aria-label="Mr. Chartist Invoice home">
          <Logo height={40} />
        </Link>

        <nav className={styles.nav} aria-label="Primary">
          {NAV_GROUPS.map((group, gi) => (
            <div key={group.title ?? gi} className={styles.group}>
              {group.title && <div className={styles.groupTitle}>{group.title}</div>}
              {group.items.map((item) => (
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
            </div>
          ))}
        </nav>

        <div className={styles.bottom}>
          <InstallPrompt variant="button" />
          <button type="button" className={cn(styles.navItem, styles.mobileOnly)} onClick={toggle}>
            {theme === 'dark' ? <Sun className={styles.navIcon} size={18} /> : <Moon className={styles.navIcon} size={18} />}
            <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
          </button>
          <button type="button" className={cn(styles.navItem, styles.mobileOnly)} onClick={() => setHelpOpen(true)}>
            <HelpCircle className={styles.navIcon} size={18} />
            <span>Help &amp; about</span>
          </button>
          <button type="button" className={cn(styles.navItem, styles.mobileOnly)} onClick={() => setShortcutsOpen(true)}>
            <Keyboard className={styles.navIcon} size={18} />
            <span>Keyboard shortcuts</span>
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

      <main className={cn(styles.main, drawerActive && styles.mainLocked)} id="main" tabIndex={-1}>
        <div className={cn(styles.utilBar, 'no-print')}>
          <button type="button" className={styles.searchBtn} onClick={() => setPaletteOpen(true)}>
            <Search size={15} />
            <span>Search invoices, clients, pages…</span>
            <kbd>{formatCombo('mod+k')}</kbd>
          </button>
          <div className={styles.utilActions}>
            <button type="button" className={styles.iconBtn} onClick={() => setHelpOpen(true)} aria-label="Help and about" title="Help & about">
              <HelpCircle size={18} />
            </button>
            <button type="button" className={styles.iconBtn} onClick={() => setShortcutsOpen(true)} aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)">
              <Keyboard size={18} />
            </button>
            <button type="button" className={styles.iconBtn} onClick={toggle} aria-label={themeLabel} title={themeLabel}>
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <NotificationBell onNavigate={navigate} />
          </div>
        </div>
        <div className={styles.content} key={location.pathname.startsWith('/invoice') ? 'invoice' : location.pathname}>
          <BackupNudge onResult={(r) => notify(r.ok ? `Backup saved (${r.filename})` : r.message, r.ok ? 'success' : 'error')} />
          <Outlet />
        </div>
      </main>

      <AutoBackupRunner />
      <UpdateToast />
      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
      <ShortcutsOverlay open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        navItems={NAV_ITEMS.map((n) => ({ label: n.label, to: n.path, icon: n.icon }))}
        actions={actions}
        onNavigate={navigate}
      />
      {toastNode}
    </div>
  );
}

