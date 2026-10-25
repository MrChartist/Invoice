import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Banknote,
  BarChart3,
  BookOpen,
  Boxes,
  ScanBarcode,
  FileDown,
  FilePlus2,
  FileSpreadsheet,
  FileText,
  HelpCircle,
  Keyboard,
  Landmark,
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
  Timer,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Logo } from '../components/brand/Logo';
import { CompanySwitcher } from '../components/companies/CompanySwitcher';
import { Avatar } from '../components/ui/Avatar';
import { useToast } from '../components/ui/useToast';
import { storageFailure, subscribeStorageFailure } from '../lib/storage';
import type { PaletteAction } from '../components/command/CommandPalette';
import { NotificationBell } from '../components/command/NotificationBell';
import { InstallPrompt } from '../components/pwa/InstallPrompt';
import { UpdateToast } from '../components/pwa/UpdateToast';
import { BackupNudge } from '../components/pwa/BackupNudge';
import { CrossTabNotice } from '../components/pwa/CrossTabNotice';
import { AutoBackupRunner } from '../components/pwa/AutoBackupRunner';
import { SyncRunner } from '../components/sync/SyncRunner';
import { TimerPill } from '../components/time/TimerPill';
import { useRecurringRunner } from '../hooks/useRecurringRunner';
import { formatCombo, useHotkeys } from '../hooks/useHotkeys';
import { cn } from '../lib/utils';
import { getCurrentUser, getUser, logout } from '../lib/auth';
import { ROLE_LABELS, type AccessAction } from '../lib/access';
import { useCan } from '../hooks/useCan';
import type { DeniedState } from '../components/security/RequireAccess';
import { useTheme } from '../hooks/useTheme';
import styles from './DashboardLayout.module.css';

// Overlays that only appear on demand are split out of the entry chunk and mounted on first use.
const HelpModal = lazy(() => import('../components/layout/HelpModal').then((m) => ({ default: m.HelpModal })));
const ShortcutsOverlay = lazy(() => import('../components/command/ShortcutsOverlay').then((m) => ({ default: m.ShortcutsOverlay })));
const CommandPalette = lazy(() => import('../components/command/CommandPalette').then((m) => ({ default: m.CommandPalette })));

interface NavEntry {
  label: string;
  path: string;
  icon: LucideIcon;
  end?: boolean;
  /** Overrides route matching, e.g. editing an existing invoice belongs under "Invoices". */
  match?: (pathname: string) => boolean;
  /** Local roles (6.21): hidden unless the signed-in user may do this. */
  need?: AccessAction;
}

const NAV_GROUPS: { title?: string; items: NavEntry[] }[] = [
  { items: [{ label: 'Dashboard', path: '/', icon: LayoutDashboard, end: true }] },
  {
    title: 'Sales',
    items: [
      { label: 'New invoice', path: '/invoice', icon: FilePlus2, end: true, need: 'doc.create' },
      { label: 'POS', path: '/pos', icon: ScanBarcode, need: 'doc.create' },
      { label: 'Invoices', path: '/transactions', icon: FileText, match: (p) => p.startsWith('/transactions') || /^\/invoice\/.+/.test(p) },
      { label: 'Clients', path: '/clients', icon: Users },
      { label: 'Recurring', path: '/recurring', icon: Repeat, need: 'books.edit' },
      { label: 'Time', path: '/time', icon: Timer, need: 'books.edit' },
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
      { label: 'Reconcile', path: '/reconcile', icon: Landmark, need: 'books.edit' },
      { label: 'Cheques', path: '/cheques', icon: Banknote, need: 'books.edit' },
      { label: 'Reports', path: '/reports', icon: BarChart3 },
      { label: 'GST reports', path: '/gst-reports', icon: FileSpreadsheet },
      { label: 'Exports', path: '/exports', icon: FileDown },
    ],
  },
  {
    title: 'Setup',
    items: [{ label: 'Design studio', path: '/design', icon: Palette, need: 'settings.manage' }],
  },
];

// Settings is pinned beside the profile card so it is reachable at any window height.
const SETTINGS_ENTRY: NavEntry = { label: 'Settings', path: '/settings', icon: Settings };

const NAV_ITEMS = [...NAV_GROUPS.flatMap((g) => g.items), SETTINGS_ENTRY];

export function DashboardLayout({ onLogout }: { onLogout?: () => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  // Local roles (6.21): the signed-in user (owner, clerk or viewer); the owner record for older sessions.
  const current = getCurrentUser();
  const user = current ?? getUser();
  const { can, role } = useCan();
  const navGroups = useMemo(
    () => NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => !i.need || can(i.need)) })).filter((g) => g.items.length > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [role],
  );
  const { theme, toggle } = useTheme();
  const { notify, toastNode } = useToast();
  const [helpOpen, setHelpOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // Bumped by "Refresh" on the cross-tab notice to remount the page with fresh data.
  const [refreshKey, setRefreshKey] = useState(0);
  const [loaded, setLoaded] = useState({ help: false, palette: false, shortcuts: false });
  const openHelp = () => { setLoaded((l) => ({ ...l, help: true })); setHelpOpen(true); };
  const openPalette = () => { setLoaded((l) => ({ ...l, palette: true })); setPaletteOpen(true); };
  const openShortcuts = () => { setLoaded((l) => ({ ...l, shortcuts: true })); setShortcutsOpen(true); };

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

  // Phones / small tablets: a bottom tab bar for the daily screens. The editor has its own
  // save bar, so the tabs step aside there. Its height is published for toasts and padding.
  const onEditor = location.pathname.startsWith('/invoice');
  const showTabs = isMobile && !onEditor;
  useEffect(() => {
    const root = document.documentElement;
    if (showTabs) root.style.setProperty('--tab-bar-h', '3.75rem');
    else root.style.removeProperty('--tab-bar-h');
    return () => {
      root.style.removeProperty('--tab-bar-h');
    };
  }, [showTabs]);

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

  // A save that the screen accepted but IndexedDB refused (e.g. disk full): say so, loudly and for long.
  useEffect(
    () =>
      subscribeStorageFailure(() => {
        const failure = storageFailure();
        if (failure) notify(`Not saved: ${failure.message}`, 'error', { duration: 60_000 });
      }),
    [notify],
  );

  // A route refused for this role (RequireAccess) says why.
  const denied = (location.state as DeniedState | null)?.denied;
  useEffect(() => {
    if (!denied) return;
    notify(denied, 'error');
    navigate(location.pathname + location.search, { replace: true, state: null });
  }, [denied]); // eslint-disable-line react-hooks/exhaustive-deps

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
    'mod+k': () => openPalette(),
    '/': () => openPalette(),
    '?': () => openShortcuts(),
    'g d': () => navigate('/'),
    'g i': () => navigate('/invoice'),
    'g t': () => navigate('/transactions'),
    'g c': () => navigate('/clients'),
    'g s': () => navigate('/settings'),
  });

  const actions = useMemo<PaletteAction[]>(
    () => ([
      { id: 'new-invoice', title: 'New invoice', keywords: ['create', 'bill', 'sale'], run: () => navigate('/invoice'), need: 'doc.create' },
      { id: 'new-quotation', title: 'New quotation', keywords: ['estimate', 'quote'], run: () => navigate('/invoice?type=QUOTATION'), need: 'doc.create' },
      { id: 'new-sales-order', title: 'New sales order', keywords: ['order', 'so', 'booking'], run: () => navigate('/invoice?type=SALES_ORDER'), need: 'doc.create' },
      { id: 'sales-orders', title: 'Open sales orders', keywords: ['order', 'pending', 'backorder'], run: () => navigate('/transactions?type=SALES_ORDER') },
      { id: 'purchase-orders', title: 'Purchase orders', keywords: ['po', 'order', 'vendor', 'supplier'], run: () => navigate('/expenses?tab=orders') },
      { id: 'add-client', title: 'Add client', keywords: ['customer', 'party'], run: () => navigate('/clients?new=1'), need: 'master.edit' },
      { id: 'add-expense', title: 'Add expense or purchase bill', keywords: ['bill', 'vendor'], run: () => navigate('/expenses'), need: 'books.edit' },
      { id: 'record-payment', title: 'Record a payment', keywords: ['receipt', 'received'], run: () => navigate('/transactions?filter=unpaid&pay=1'), need: 'payment.record' },
      { id: 'gst', title: 'Open GST reports', keywords: ['gstr', 'return'], run: () => navigate('/gst-reports') },
      { id: 'brs', title: 'Bank reconciliation statement', keywords: ['bank', 'brs', 'reconcile', 'statement'], run: () => navigate('/reconcile?tab=brs'), need: 'books.edit' },
      { id: 'top-customers', title: 'Top customers report', keywords: ['sales', 'customers', 'concentration'], run: () => navigate('/reports?tab=top') },
      { id: 'settings', title: 'Go to Settings', run: () => navigate('/settings') },
      { id: 'theme', title: theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode', keywords: ['dark', 'light', 'theme'], run: toggle },
      {
        id: 'backup',
        title: 'Download backup',
        keywords: ['export', 'save'],
        need: 'data.backup',
        run: async () => {
          // Same path as Settings → Automatic backups, so a stored backup passphrase is honoured.
          const { downloadBackupNow } = await import('../lib/auto-backup');
          const r = await downloadBackupNow();
          notify(r.ok ? 'Backup downloaded' : r.message, r.ok ? 'success' : 'error');
        },
      },
      { id: 'lock', title: 'Lock app', run: handleLock },
    ] as Array<PaletteAction & { need?: AccessAction }>)
      // Local roles (6.21): the palette offers only what this role may do.
      .filter((a) => !a.need || can(a.need))
      .map(({ need: _need, ...a }) => a),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [navigate, theme, role],
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
          <TimerPill />
          <button type="button" className={styles.iconBtn} aria-label="Search" onClick={() => openPalette()}>
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
        <CompanySwitcher />

        <nav className={styles.nav} aria-label="Primary">
          {navGroups.map((group, gi) => (
            <div key={group.title ?? gi} className={styles.group}>
              {group.title && <div className={styles.groupTitle}>{group.title}</div>}
              {group.items.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  end={item.end}
                  className={({ isActive }) =>
                    cn(styles.navItem, (item.match ? item.match(location.pathname) : isActive) && styles.navItemActive)
                  }
                >
                  <item.icon className={styles.navIcon} size={18} />
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className={styles.bottom}>
          <NavLink
            to={SETTINGS_ENTRY.path}
            className={({ isActive }) => cn(styles.navItem, isActive && styles.navItemActive)}
          >
            <SETTINGS_ENTRY.icon className={styles.navIcon} size={18} />
            <span>{SETTINGS_ENTRY.label}</span>
          </NavLink>
          <InstallPrompt variant="button" />
          <button type="button" className={cn(styles.navItem, styles.mobileOnly)} onClick={toggle}>
            {theme === 'dark' ? <Sun className={styles.navIcon} size={18} /> : <Moon className={styles.navIcon} size={18} />}
            <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
          </button>
          <button type="button" className={cn(styles.navItem, styles.mobileOnly)} onClick={() => openHelp()}>
            <HelpCircle className={styles.navIcon} size={18} />
            <span>Help &amp; about</span>
          </button>
          <button type="button" className={cn(styles.navItem, styles.mobileOnly)} onClick={() => openShortcuts()}>
            <Keyboard className={styles.navIcon} size={18} />
            <span>Keyboard shortcuts</span>
          </button>

          <div className={styles.userCard}>
            <Avatar name={user?.name || 'User'} size={34} />
            <div className={styles.userMeta}>
              <span className={styles.userName}>{user?.name || 'User'}</span>
              <span className={styles.userSub}>
                {!current || current.role === 'owner' ? 'Stored on this device' : `${ROLE_LABELS[current.role]} · shared device`}
              </span>
            </div>
            <button type="button" className={styles.iconBtn} onClick={handleLock} aria-label="Lock app" title="Lock app">
              <Lock size={16} />
            </button>
          </div>
        </div>
      </aside>

      <main className={cn(styles.main, drawerActive && styles.mainLocked)} id="main" tabIndex={-1}>
        <div className={cn(styles.utilBar, 'no-print')}>
          <button type="button" className={styles.searchBtn} onClick={() => openPalette()}>
            <Search size={15} />
            <span>Search invoices, clients, pages…</span>
            <kbd>{formatCombo('mod+k')}</kbd>
          </button>
          <div className={styles.utilActions}>
            <TimerPill />
            <button type="button" className={styles.iconBtn} onClick={() => openHelp()} aria-label="Help and about" title="Help & about">
              <HelpCircle size={18} />
            </button>
            <button type="button" className={styles.iconBtn} onClick={() => openShortcuts()} aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)">
              <Keyboard size={18} />
            </button>
            <button type="button" className={styles.iconBtn} onClick={toggle} aria-label={themeLabel} title={themeLabel}>
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <NotificationBell onNavigate={navigate} />
          </div>
        </div>
        <div className={styles.content} key={`${location.pathname.startsWith('/invoice') ? 'invoice' : location.pathname}#${refreshKey}`}>
          <CrossTabNotice onRefresh={() => setRefreshKey((k) => k + 1)} />
          {can('data.backup') && <BackupNudge onResult={(r) => notify(r.ok ? `Backup saved (${r.filename})` : r.message, r.ok ? 'success' : 'error')} />}
          <Outlet />
        </div>
      </main>

      {showTabs && (
        <nav className={cn(styles.tabBar, 'no-print')} aria-label="Quick navigation">
          <NavLink to="/" end className={({ isActive }) => cn(styles.tab, isActive && styles.tabActive)}>
            <LayoutDashboard size={20} aria-hidden="true" />
            <span>Home</span>
          </NavLink>
          <NavLink to="/transactions" className={({ isActive }) => cn(styles.tab, isActive && styles.tabActive)}>
            <FileText size={20} aria-hidden="true" />
            <span>Invoices</span>
          </NavLink>
          {can('doc.create') && (
            <Link to="/invoice" className={cn(styles.tab, styles.tabNew)} aria-label="New invoice">
              <FilePlus2 size={22} aria-hidden="true" />
              <span>New</span>
            </Link>
          )}
          <NavLink to="/clients" className={({ isActive }) => cn(styles.tab, isActive && styles.tabActive)}>
            <Users size={20} aria-hidden="true" />
            <span>Clients</span>
          </NavLink>
          <button type="button" className={styles.tab} onClick={() => setMenuOpen(true)} aria-expanded={menuOpen} aria-controls="app-sidebar">
            <Menu size={20} aria-hidden="true" />
            <span>More</span>
          </button>
        </nav>
      )}

      <AutoBackupRunner />
      <SyncRunner />
      <UpdateToast />
      <Suspense fallback={null}>
        {loaded.help && <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />}
        {loaded.shortcuts && <ShortcutsOverlay open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />}
        {loaded.palette && (
          <CommandPalette
            open={paletteOpen}
            onClose={() => setPaletteOpen(false)}
            navItems={NAV_ITEMS.filter((n) => !n.need || can(n.need)).map((n) => ({ label: n.label, to: n.path, icon: n.icon }))}
            actions={actions}
            onNavigate={navigate}
          />
        )}
      </Suspense>
      {toastNode}
    </div>
  );
}

