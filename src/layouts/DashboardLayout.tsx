import { lazy, Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Banknote,
  BarChart3,
  BookOpen,
  Boxes,
  ScanBarcode,
  Store,
  FileDown,
  FilePlus2,
  FileSpreadsheet,
  FileText,
  FolderTree,
  HandCoins,
  HelpCircle,
  IdCard,
  Keyboard,
  Landmark,
  Layers,
  Truck,
  Eye,
  Building2,
  LayoutDashboard,
  Lock,
  Menu,
  Moon,
  Palette,
  Percent,
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
import { readRaw, storageFailure, subscribeStorageFailure } from '../lib/storage';
import type { PaletteAction } from '../components/command/CommandPalette';
import { NotificationBellSlot } from '../components/command/NotificationBellSlot';
import { InstallPrompt } from '../components/pwa/InstallPrompt';
import { UpdateToast } from '../components/pwa/UpdateToast';
import { BackupNudge } from '../components/pwa/BackupNudge';
import { CrossTabNotice } from '../components/pwa/CrossTabNotice';
import { AutoBackupRunner } from '../components/pwa/AutoBackupRunner';
import { SyncRunner } from '../components/sync/SyncRunner';
import { TimerPill } from '../components/time/TimerPill';
import { useRecurringRunner } from '../hooks/useRecurringRunner';
import { formatCombo, useHotkeys } from '../hooks/useHotkeys';
import { installKeysStub, keysOn, loadKeyEngine, subscribeKeys } from '../lib/keys/stub';
import { cn } from '../lib/utils';
import { getCurrentUser, getUser, logout } from '../lib/auth';
import type { AccessAction } from '../lib/access';
import { useCan } from '../hooks/useCan';
import type { DeniedState } from '../components/security/RequireAccess';
import { useTheme } from '../hooks/useTheme';
import { getLanguage, setLanguage, useT, type MessageKey } from '../i18n';
import { localDb } from '../lib/localDb';
import { enabledModules, impliedPacks, isPathVisible, SHOP_MODE_EVENT } from '../lib/shop-mode';
import { OPEN_HELP_EVENT } from '../lib/help-event';
import { pushRoute } from '../lib/route-trail';
import { realCompanies } from '../lib/companies';
import { roleLabel } from '../i18n/labels';
import { plT } from '../i18n/areas/layout-pl';
import { ShellNoticesProvider } from '../components/ui/Page';
import { useMedia } from '../hooks/useMedia';
import styles from './DashboardLayout.module.css';

// Device classes in em (docs/theme/IOS-UI.md 3.1), so a larger text size switches layouts earlier.
// Phone shell: narrow, or a short landscape phone. Small tablet: the rail expands as an overlay.
const PHONE_MEDIA = '(width < 37.5em), (height < 31.25em) and (width < 74.6875em)';
const SMALL_TABLET_MEDIA = '(37.5em <= width < 52.125em)';
/** Device-local: the sidebar collapsed to its icon rail on tablets and up ('rail'), else full. */
const SIDEBAR_KEY = 'mrchartist_sidebar';
const readRail = () => {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === 'rail';
  } catch {
    return false;
  }
};

// Overlays that only appear on demand are split out of the entry chunk and mounted on first use.
const HelpModal = lazy(() => import('../components/layout/HelpModal').then((m) => ({ default: m.HelpModal })));
const ShortcutsOverlay = lazy(() => import('../components/command/ShortcutsOverlay').then((m) => ({ default: m.ShortcutsOverlay })));
const QuickCreateSheet = lazy(() => import('../components/layout/QuickCreateSheet').then((m) => ({ default: m.QuickCreateSheet })));
const CommandPalette = lazy(() => import('../components/command/CommandPalette').then((m) => ({ default: m.CommandPalette })));
// R20-A5: Key bar, F10 vouchers sheet and key chips — only while Tally keys are on, or on the Gateway.
const KeysHost = lazy(() => loadKeyEngine().then((m) => m.loadKeysHost()));

interface NavEntry {
  /** Catalogue key of the label (5.4). */
  label: MessageKey;
  path: string;
  icon: LucideIcon;
  end?: boolean;
  /** Overrides route matching, e.g. editing an existing invoice belongs under "Invoices". */
  match?: (pathname: string, search: string) => boolean;
  /** Local roles (6.21): hidden unless the signed-in user may do this. */
  need?: AccessAction;
}

const NAV_GROUPS: { title?: MessageKey; items: NavEntry[] }[] = [
  { items: [{ label: 'nav.dashboard', path: '/', icon: LayoutDashboard, end: true }] },
  {
    title: 'nav.groupSales',
    items: [
      { label: 'nav.newInvoice', path: '/invoice', icon: FilePlus2, end: true, need: 'doc.create' },
      { label: 'nav.pos', path: '/pos', icon: ScanBarcode, need: 'doc.create' },
      { label: 'nav.tables', path: '/tables', icon: Store, need: 'doc.create' }, // R3-A
      { label: 'nav.invoices', path: '/transactions', icon: FileText, match: (p) => p.startsWith('/transactions') || /^\/invoice\/.+/.test(p) },
      { label: 'nav.clients', path: '/clients', icon: Users },
      { label: 'nav.recurring', path: '/recurring', icon: Repeat, need: 'books.edit' },
      { label: 'nav.time', path: '/time', icon: Timer, need: 'books.edit' },
      { label: 'nav.receivables', path: '/receivables', icon: Scale },
      { label: 'nav.distribution', path: '/distribution', icon: Truck }, // R6-B2
    ],
  },
  {
    title: 'nav.groupPurchases',
    items: [
      { label: 'nav.expenses', path: '/expenses', icon: Receipt },
      { label: 'nav.inventory', path: '/inventory', icon: Boxes },
      { label: 'nav.manufacturing', path: '/manufacturing', icon: Layers }, // R6-B2
    ],
  },
  {
    title: 'nav.groupAccounts',
    items: [
      { label: 'nav.gateway', path: '/gateway', icon: Keyboard },
      // WP-1 "Accounts Info" (masters menu inside Books → Chart of accounts).
      { label: 'nav.accountsInfo', path: '/books?tab=coa&m=menu', icon: FolderTree, match: (p, s) => p === '/books' && /[?&]m=/.test(s) },
      { label: 'nav.books', path: '/books', icon: BookOpen, match: (p, s) => p.startsWith('/books') && !/[?&]m=/.test(s) },
      { label: 'nav.reconcile', path: '/reconcile', icon: Landmark, need: 'books.edit' },
      { label: 'nav.cheques', path: '/cheques', icon: Banknote, need: 'books.edit' },
      { label: 'nav.tds', path: '/tds', icon: Percent },
      { label: 'nav.loans', path: '/loans', icon: HandCoins },
      { label: 'nav.payroll', path: '/payroll', icon: IdCard, need: 'payroll.view' },
      { label: 'nav.reports', path: '/reports', icon: BarChart3 },
      { label: 'nav.gstReports', path: '/gst-reports', icon: FileSpreadsheet },
      { label: 'nav.exports', path: '/exports', icon: FileDown },
    ],
  },
  {
    title: 'nav.groupSetup',
    items: [
      { label: 'nav.designStudio', path: '/design', icon: Palette, need: 'settings.manage' },
      { label: 'nav.practice', path: '/practice', icon: Building2, need: 'settings.manage' }, // R3-C6
    ],
  },
];

// Settings is pinned beside the profile card so it is reachable at any window height.
const SETTINGS_ENTRY: NavEntry = { label: 'nav.settings', path: '/settings', icon: Settings };

const NAV_ITEMS = [...NAV_GROUPS.flatMap((g) => g.items), SETTINGS_ENTRY];

export function DashboardLayout({ onLogout }: { onLogout?: () => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  // Local roles (6.21): the signed-in user (owner, clerk or viewer); the owner record for older sessions.
  const current = getCurrentUser();
  const user = current ?? getUser();
  const { can, role } = useCan();
  // Shop mode (8H): the company's modules narrow the sidebar; Ctrl+K and URLs still reach everything.
  const [modeTick, setModeTick] = useState(0);
  useEffect(() => {
    const bump = () => setModeTick((n) => n + 1);
    window.addEventListener(SHOP_MODE_EVENT, bump);
    return () => window.removeEventListener(SHOP_MODE_EVENT, bump);
  }, []);
  // Finer user rights (8H): load the rules for a clerk / viewer who has some (document writes wait for them).
  const hasRights = !!current?.rights;
  useEffect(() => {
    // Once the rules are in, re-filter the sidebar (POS-only cashier, per-document rights).
    if (hasRights) void import('../lib/user-rights').then(() => setModeTick((n) => n + 1)).catch(() => undefined);
  }, [hasRights]);
  const [navGroups, hidden] = useMemo(() => {
    const s = localDb.settings.get();
    const modules = enabledModules(s);
    // R6-B2: a route hosting an active pack's tab stays; the practice desk (a CA tool) needs several companies or "full".
    const packs = impliedPacks(s);
    const practice = !s.business_type || s.business_type === 'full' || realCompanies().length > 1; // QA7 G7: the Demo company does not count
    const posOnly = !!current && current.role !== 'owner' && !!current.rights?.pos_only;
    // R6-B2 "N more features": entries this role may use that shop mode hides.
    let hidden = 0;
    const show = (i: NavEntry) => {
      if (i.need && !can(i.need)) return false;
      if (!isPathVisible(i.path, modules, packs)) return !++hidden;
      return (practice || i.path !== '/practice') && (!posOnly || i.path === '/' || i.path === '/pos');
    };
    // R7-A: a hotel's /tables row reads "Front desk"
    const groups = NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter(show).map((i) => (i.path === '/tables' && s.business_type === 'hotel' ? { ...i, label: 'nav.frontDesk' as const } : i)) })).filter((g) => g.items.length > 0);
    return [groups, posOnly || role === 'viewer' ? 0 : hidden] as const;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, modeTick]);
  // QA-3 F26: a kirana shop bills at the counter, so its phone tab bar offers POS in place of Invoices.
  const posTab = useMemo(() => {
    const s = localDb.settings.get();
    return s.business_type === 'kirana' && can('doc.create') && isPathVisible('/pos', enabledModules(s));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, modeTick]);
  const { theme, toggle } = useTheme();
  const { t, lang } = useT();
  const { notify, toastNode } = useToast();
  const [helpOpen, setHelpOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  // Bumped by "Refresh" on the cross-tab notice to remount the page with fresh data.
  const [refreshKey, setRefreshKey] = useState(0);
  const [loaded, setLoaded] = useState({ help: false, palette: false, shortcuts: false });
  const openHelp = () => { setLoaded((l) => ({ ...l, help: true })); setHelpOpen(true); };
  // R20-A6: the Ctrl+K actions of Tally keys (switch, layout, cheat sheet) load with the palette.
  const [keysActs, setKeysActs] = useState<Awaited<ReturnType<typeof loadKeyEngine>> | null>(null);
  const openPalette = () => {
    setLoaded((l) => ({ ...l, palette: true }));
    setPaletteOpen(true);
    if (!keysActs) void loadKeyEngine().then(setKeysActs, () => undefined);
  };
  const openShortcuts = () => { setLoaded((l) => ({ ...l, shortcuts: true })); setShortcutsOpen(true); };

  const asideRef = useRef<HTMLElement>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const isMobile = useMedia(PHONE_MEDIA);
  const smallTablet = useMedia(SMALL_TABLET_MEDIA) && !isMobile;
  // D7: tablets and up keep a sidebar; the rail (icons only) is the small tablet's resting state and a remembered
  // choice from 52.125em up. The phone drawer / rail overlay closes when the device class changes.
  const [railPref, setRailPref] = useState(readRail);
  useEffect(() => setMenuOpen(false), [isMobile, smallTablet]);
  const overlay = smallTablet && menuOpen;
  const rail = !isMobile && (smallTablet ? !menuOpen : railPref);
  const toggleRail = () => {
    if (smallTablet) return setMenuOpen((o) => !o);
    const next = !railPref;
    setRailPref(next);
    try {
      localStorage.setItem(SIDEBAR_KEY, next ? 'rail' : 'full');
    } catch {
      /* private mode: the choice lasts this visit */
    }
  };

  // Phones / small tablets: a bottom tab bar for the daily screens. The editor has its own
  // save bar, so the tabs step aside there. Its height is published for toasts and padding.
  const onEditor = location.pathname.startsWith('/invoice');
  const showTabs = isMobile && !onEditor;
  useEffect(() => {
    const root = document.documentElement;
    // The bar's size follows the device class in CSS (49px, 40px in phone landscape).
    root.style.setProperty('--tab-bar-h', showTabs ? 'var(--tab-bar-size)' : '0px');
    return () => {
      root.style.removeProperty('--tab-bar-h');
    };
  }, [showTabs]);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => setMenuOpen(false), [location.pathname]);
  // R6-A5 route trail (for "Report a problem").
  useEffect(() => pushRoute(location), [location]);
  // R6-B2: empty states and tips open Help through a window event (`help-event.ts`).
  useEffect(() => {
    const on = () => openHelp();
    window.addEventListener(OPEN_HELP_EVENT, on);
    return () => window.removeEventListener(OPEN_HELP_EVENT, on);
  }, []);

  // Mobile drawer / expanded rail: focus trap, Esc to close, scroll lock, focus restore.
  const drawerActive = (isMobile || smallTablet) && menuOpen;
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
        if (failure) notify(t('common.notSaved', { message: failure.message }), 'error', { duration: 60_000 });
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
    'mod+/': () => openShortcuts(),
    'g d': () => navigate('/'),
    'g i': () => navigate('/invoice'),
    'g t': () => navigate('/transactions'),
    'g c': () => navigate('/clients'),
    'g s': () => navigate('/settings'),
    // 8E (8.146): Alt+P opens the POS counter from anywhere (even while typing in a field).
    'alt+p': { handler: () => navigate('/pos'), allowInInput: true }, // the route itself needs doc.create
    // R6-B2: F1 opens Help (R6-A2's "On this screen"), except on the POS counter (F1 = recall held bills there); R20-A:
    // also on the Gateway. Never while typing in a field (useHotkeys skips plain keys in inputs).
    // QA7 G3: F1 does nothing while a dialog is open (Help stacked over a form lost it on Escape).
    ...(/^\/pos(\/|$)/.test(location.pathname) ? {} : { f1: () => { if (!document.querySelector('[aria-modal]')) openHelp(); } }),
  });
  // R20-A1: Tally keys — the claim stub (mode flag + claimed combos); the lazy engine runs them. Off by default on a
  // fresh device (F5 reloads); always on /gateway.
  const tallyOn = useSyncExternalStore(subscribeKeys, keysOn);
  useEffect(() => installKeysStub((to, state) => navigate(to, state ? { state } : undefined)), [navigate]);

  const actions = useMemo<PaletteAction[]>(
    () => ([
      { id: 'new-invoice', title: t('palette.newInvoice'), keywords: ['create', 'bill', 'sale'], run: () => navigate('/invoice'), need: 'doc.create' },
      { id: 'new-quotation', title: t('palette.newQuotation'), keywords: ['estimate', 'quote'], run: () => navigate('/invoice?type=QUOTATION'), need: 'doc.create' },
      { id: 'new-sales-order', title: t('palette.newSalesOrder'), keywords: ['order', 'so', 'booking'], run: () => navigate('/invoice?type=SALES_ORDER'), need: 'doc.create' },
      { id: 'sales-orders', title: t('palette.salesOrders'), keywords: ['order', 'pending', 'backorder'], run: () => navigate('/transactions?type=SALES_ORDER') },
      { id: 'purchase-orders', title: t('palette.purchaseOrders'), keywords: ['po', 'order', 'vendor', 'supplier'], run: () => navigate('/expenses?tab=orders') },
      { id: 'add-client', title: t('palette.addClient'), keywords: ['customer', 'party'], run: () => navigate('/clients?new=1'), need: 'master.edit' },
      { id: 'add-expense', title: t('palette.addExpense'), keywords: ['bill', 'vendor'], run: () => navigate('/expenses'), need: 'books.edit' },
      { id: 'record-payment', title: t('palette.recordPayment'), keywords: ['receipt', 'received'], run: () => navigate('/transactions?filter=unpaid&pay=1'), need: 'payment.record' },
      { id: 'gst', title: t('palette.gst'), keywords: ['gstr', 'return'], run: () => navigate('/gst-reports') },
      { id: 'brs', title: t('palette.brs'), keywords: ['bank', 'brs', 'reconcile', 'statement'], run: () => navigate('/reconcile?tab=brs'), need: 'books.edit' },
      { id: 'top-customers', title: t('palette.topCustomers'), keywords: ['sales', 'customers', 'concentration'], run: () => navigate('/reports?tab=top') },
      { id: 'settings', title: t('palette.settings'), run: () => navigate('/settings') },
      { id: 'language', title: t('palette.language'), keywords: ['language', 'hindi', 'english', 'भाषा', 'हिन्दी'], run: () => void setLanguage(getLanguage() === 'en' ? 'hi' : 'en').catch(() => undefined) },
      { id: 'theme', title: theme === 'dark' ? t('shell.switchLight') : t('shell.switchDark'), keywords: ['dark', 'light', 'theme'], run: toggle },
      {
        id: 'backup',
        title: t('palette.backup'),
        keywords: ['export', 'save'],
        need: 'data.backup',
        run: async () => {
          // Same path as Settings → Automatic backups, so a stored backup passphrase is honoured.
          const { downloadBackupNow } = await import('../lib/auto-backup');
          const r = await downloadBackupNow();
          notify(r.ok ? t('shell.backupDownloaded') : r.message, r.ok ? 'success' : 'error');
        },
      },
      { id: 'lock', title: t('shell.lock'), run: handleLock },
      ...(keysActs?.paletteActions(openShortcuts, notify) ?? []),
    ] as Array<PaletteAction & { need?: AccessAction }>)
      // Local roles (6.21): the palette offers only what this role may do.
      .filter((a) => !a.need || can(a.need))
      .map(({ need: _need, ...a }) => a),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [navigate, theme, role, lang, keysActs],
  );

  const themeLabel = theme === 'dark' ? t('shell.switchLight') : t('shell.switchDark');
  // Private beta marker next to the logo (the visible word is short; the label says what it means).
  const beta = (
    <span className={styles.beta} role="img" aria-label={t('shell.betaAria')} title={t('shell.betaAria')}>
      {t('shell.beta')}
    </span>
  );

  return (
    <div className={cn(styles.layout, overlay && styles.overlayOpen)}>
      <a href="#main" className={cn(styles.skipLink, 'no-print')} onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus(); }}>
        {t('shell.skip')}
      </a>
      <header className={cn(styles.topbar, 'no-print')}>
        <button
          ref={menuBtnRef}
          type="button"
          className={styles.iconBtn}
          aria-label={menuOpen ? t('shell.closeMenu') : t('shell.openMenu')}
          aria-expanded={menuOpen}
          aria-controls="app-sidebar"
          onClick={() => setMenuOpen((o) => !o)}
        >
          {menuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
        <span className={styles.brandRow}>
          <Link to="/" aria-label={t('shell.home')}>
            <Logo height={30} product={false} />
          </Link>
          {beta}
        </span>
        <div className={styles.topActions}>
          <TimerPill />
          <button type="button" className={styles.iconBtn} aria-label={t('shell.search')} onClick={() => openPalette()}>
            <Search size={18} />
          </button>
          <NotificationBellSlot onNavigate={navigate} />
        </div>
      </header>

      {drawerActive && <div className={styles.scrim} onClick={() => setMenuOpen(false)} aria-hidden="true" />}

      <aside
        id="app-sidebar"
        ref={asideRef}
        className={cn(styles.sidebar, isMobile && menuOpen && styles.sidebarOpen, rail && styles.rail, overlay && styles.sidebarOverlay, 'no-print')}
        inert={isMobile && !menuOpen}
      >
        <div className={styles.brandRow}>
          <Link to="/" className={styles.brand} aria-label={t('shell.home')}>
            <Logo height={40} />
          </Link>
          {beta}
        </div>
        <div className={styles.company}>
          <CompanySwitcher />
        </div>

        <nav className={styles.nav} aria-label={t('nav.primary')}>
          {navGroups.map((group, gi) => (
            <div key={group.title ?? gi} className={styles.group}>
              {group.title && <div className={styles.groupTitle}>{t(group.title)}</div>}
              {group.items.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  end={item.end}
                  title={rail ? t(item.label) : undefined}
                  className={({ isActive }) =>
                    cn(styles.navItem, (item.match ? item.match(location.pathname, location.search) : isActive) && styles.navItemActive)
                  }
                >
                  <item.icon className={styles.navIcon} size={18} />
                  <span>{t(item.label)}</span>
                </NavLink>
              ))}
            </div>
          ))}
          {hidden > 0 && (
            <Link to="/settings?tab=features" className={styles.navItem}>
              <Eye className={styles.navIcon} size={18} />
              <span>{t('nav.moreFeatures', { n: hidden })}</span>
            </Link>
          )}
        </nav>

        <div className={styles.bottom}>
          <NavLink
            to={SETTINGS_ENTRY.path}
            title={rail ? t(SETTINGS_ENTRY.label) : undefined}
            className={({ isActive }) => cn(styles.navItem, isActive && styles.navItemActive)}
          >
            <SETTINGS_ENTRY.icon className={styles.navIcon} size={18} />
            <span>{t(SETTINGS_ENTRY.label)}</span>
          </NavLink>
          <div className={styles.install}>
            <InstallPrompt variant="button" />
          </div>
          <button type="button" className={cn(styles.navItem, styles.mobileOnly)} onClick={toggle}>
            {theme === 'dark' ? <Sun className={styles.navIcon} size={18} /> : <Moon className={styles.navIcon} size={18} />}
            <span>{theme === 'dark' ? t('shell.lightMode') : t('shell.darkMode')}</span>
          </button>
          <button type="button" className={cn(styles.navItem, styles.mobileOnly)} onClick={() => openHelp()}>
            <HelpCircle className={styles.navIcon} size={18} />
            <span>{t('shell.help')}</span>
          </button>
          <button type="button" className={cn(styles.navItem, styles.mobileOnly)} onClick={() => openShortcuts()}>
            <Keyboard className={styles.navIcon} size={18} />
            <span>{t('shell.shortcuts')}</span>
          </button>

          <div className={styles.userCard}>
            <Avatar name={user?.name || t('shell.user')} size={34} />
            <div className={styles.userMeta}>
              <span className={styles.userName}>{user?.name || t('shell.user')}</span>
              <span className={styles.userSub}>
                {!current || current.role === 'owner' ? t('shell.storedOnDevice') : t('shell.sharedDevice', { role: roleLabel(current.role) })}
              </span>
            </div>
            <button type="button" className={styles.iconBtn} onClick={handleLock} aria-label={t('shell.lock')} title={t('shell.lock')}>
              <Lock size={16} />
            </button>
          </div>
        </div>
      </aside>

      <main className={cn(styles.main, drawerActive && styles.mainLocked)} id="main" tabIndex={-1}>
        <div className={cn(styles.utilBar, 'no-print')}>
          <div className={styles.utilLead}>
            <button
              type="button"
              className={styles.iconBtn}
              onClick={toggleRail}
              aria-label={rail ? plT('railShow') : plT('railHide')}
              title={rail ? plT('railShow') : plT('railHide')}
              aria-expanded={!rail}
              aria-controls="app-sidebar"
              data-rail-toggle
            >
              <Menu size={18} />
            </button>
            <button type="button" className={styles.searchBtn} onClick={() => openPalette()}>
              <Search size={15} />
              <span>{t('shell.searchPlaceholder')}</span>
              <kbd>{formatCombo('mod+k')}</kbd>
            </button>
          </div>
          <div className={styles.utilActions}>
            <TimerPill />
            <button type="button" className={styles.iconBtn} onClick={() => openHelp()} aria-label={t('shell.helpAria')} title={t('shell.help')}>
              <HelpCircle size={18} />
            </button>
            <button type="button" className={styles.iconBtn} onClick={() => openShortcuts()} aria-label={t('shell.shortcuts')} title={t('shell.shortcutsTitle')}>
              <Keyboard size={18} />
            </button>
            <button type="button" className={styles.iconBtn} onClick={toggle} aria-label={themeLabel} title={themeLabel}>
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <NotificationBellSlot onNavigate={navigate} />
          </div>
        </div>
        <div className={styles.content} key={`${location.pathname.startsWith('/invoice') ? 'invoice' : location.pathname}#${refreshKey}`}>
          {/* The shell's notices show in the page's notices slot, below its title (one title position everywhere). */}
          <ShellNoticesProvider
            value={
              <>
                <CrossTabNotice onRefresh={() => setRefreshKey((k) => k + 1)} />
                {can('data.backup') && <BackupNudge onResult={(r) => notify(r.ok ? t('shell.backupSaved', { file: r.filename }) : r.message, r.ok ? 'success' : 'error')} />}
              </>
            }
          >
            <Outlet />
          </ShellNoticesProvider>
        </div>
        {(tallyOn || location.pathname.startsWith('/gateway')) && <Suspense fallback={null}><KeysHost /></Suspense>}
      </main>

      {showTabs && (
        <nav className={cn(styles.tabBar, 'no-print')} aria-label={t('shell.quickNav')}>
          <NavLink to="/" end className={({ isActive }) => cn(styles.tab, isActive && styles.tabActive)}>
            <LayoutDashboard size={20} aria-hidden="true" />
            <span>{t('shell.tabHome')}</span>
          </NavLink>
          {posTab ? (
            <NavLink to="/pos" className={({ isActive }) => cn(styles.tab, isActive && styles.tabActive)} data-tab-pos>
              <ScanBarcode size={20} aria-hidden="true" />
              <span>{t('nav.pos')}</span>
            </NavLink>
          ) : (
            <NavLink to="/transactions" className={({ isActive }) => cn(styles.tab, isActive && styles.tabActive)}>
              <FileText size={20} aria-hidden="true" />
              <span>{t('nav.invoices')}</span>
            </NavLink>
          )}
          {can('doc.create') && (
            // 8H: "+" opens the quick-create sheet; the device preference `PLUS_ONE_TAP_KEY` keeps the old one tap.
            <button
              type="button"
              className={cn(styles.tab, styles.tabNew)}
              aria-label={t('shell.tabNew')}
              aria-haspopup="dialog"
              onClick={() => (readRaw('mrchartist_plus_one_tap') === '1' ? navigate('/invoice') : setQuickOpen(true))}
            >
              <FilePlus2 size={22} aria-hidden="true" />
              <span>{t('shell.tabNew')}</span>
            </button>
          )}
          <NavLink to="/clients" className={({ isActive }) => cn(styles.tab, isActive && styles.tabActive)}>
            <Users size={20} aria-hidden="true" />
            <span>{t('nav.clients')}</span>
          </NavLink>
          <button type="button" className={styles.tab} onClick={() => setMenuOpen(true)} aria-expanded={menuOpen} aria-controls="app-sidebar">
            <Menu size={20} aria-hidden="true" />
            <span>{t('shell.tabMore')}</span>
          </button>
        </nav>
      )}

      <AutoBackupRunner />
      <SyncRunner />
      <UpdateToast />
      <Suspense fallback={null}>
        {quickOpen && <QuickCreateSheet onClose={() => setQuickOpen(false)} />}
        {loaded.help && <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />}
        {loaded.shortcuts && <ShortcutsOverlay open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />}
        {loaded.palette && (
          <CommandPalette
            open={paletteOpen}
            onClose={() => setPaletteOpen(false)}
            navItems={NAV_ITEMS.filter((n) => !n.need || can(n.need)).map((n) => ({ label: t(n.label), to: n.path, icon: n.icon }))}
            actions={actions}
            onNavigate={navigate}
          />
        )}
      </Suspense>
      {toastNode}
    </div>
  );
}

