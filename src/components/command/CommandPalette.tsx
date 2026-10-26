import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, Banknote, BookOpen, Building2, CornerDownLeft, FileText, History, Package, Receipt, Search, Truck, Users, Zap } from 'lucide-react';
import { cn } from '../../lib/utils';
import { companyDbName, readRegistry } from '../../lib/company-registry';
import {
  GROUP_LABELS,
  clearRecentSearches,
  getRecentSearches,
  groupResults,
  pushRecentSearch,
  searchAll,
  searchIndex,
  searchPeek,
  type Range,
  type SearchGroup,
  type SearchResult,
  type StaticEntry,
} from '../../lib/search';
import { formatCombo } from '../../hooks/useHotkeys';
import { tallyDestinations } from './tally-destinations';
import { distDestinations } from './dist-destinations';
import { r2cDestinations } from './r2c-destinations'; // R2-C
import { salesR2Destinations } from './sales-r2-destinations'; // R2-B
import { serviceR3Destinations } from './service-r3-destinations'; // R3-B
import { sfT } from '../../i18n/areas/smart-find';
import styles from './CommandPalette.module.css';

export interface PaletteAction {
  id: string;
  title: string;
  subtitle?: string;
  /** Custom icon; defaults to a lightning bolt. */
  icon?: ReactNode;
  /** Extra words the fuzzy search should match, e.g. ['dark', 'light'] for "Toggle theme". */
  keywords?: string[];
  /** Combo string shown as a hint, e.g. 'mod+shift+n'. */
  shortcut?: string;
  run: () => void;
}

export interface PaletteNavItem {
  label: string;
  to: string;
  icon?: ComponentType<{ size?: number; className?: string }>;
  keywords?: string[];
}

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  /** Sidebar entries, searched as "Pages". */
  navItems?: PaletteNavItem[];
  /** Quick actions injected by the shell. */
  actions?: PaletteAction[];
  /** Called with an href for page / invoice / client results. */
  onNavigate: (href: string) => void;
}

interface Option {
  key: string;
  kind: 'result' | 'recent';
  result?: SearchResult;
  text?: string;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

function Highlighted({ text, ranges }: { text: string; ranges: Range[] }) {
  if (!ranges.length) return <>{text}</>;
  const parts: ReactNode[] = [];
  let at = 0;
  ranges.forEach(([s, e], i) => {
    if (s > at) parts.push(text.slice(at, s));
    parts.push(<mark key={i} className={styles.mark}>{text.slice(s, e)}</mark>);
    at = e;
  });
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}

function iconFor(r: SearchResult, action?: PaletteAction, nav?: PaletteNavItem): ReactNode {
  if (action?.icon) return action.icon;
  if (nav?.icon) {
    const Nav = nav.icon;
    return <Nav size={16} />;
  }
  switch (r.icon) {
    case 'invoice':
      return <FileText size={16} />;
    case 'client':
      return <Users size={16} />;
    case 'item':
      return <Package size={16} />;
    case 'action':
      return <Zap size={16} />;
    case 'bill':
      return <Receipt size={16} />;
    case 'vendor':
      return <Truck size={16} />;
    case 'payment':
    case 'cheque':
      return <Banknote size={16} />;
    case 'voucher':
      return <BookOpen size={16} />;
    case 'company':
      return <Building2 size={16} />;
    default:
      return <ArrowRight size={16} />;
  }
}

export function CommandPalette({ open, onClose, navItems = [], actions = [], onNavigate }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [recents, setRecents] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const uid = useId();
  const listId = `${uid}-list`;
  const optionId = (i: number) => `${uid}-opt-${i}`;

  // 8.103: the SmartFind index is built once per storage version (cached in search.ts) — typing never
  // re-parses storage. Warm it on open so the first keystroke is instant.
  useMemo(() => (open ? searchIndex() : null), [open]);
  // All companies (read-only peek), offered only when the device has more than one company.
  const multiCompany = useMemo(() => open && readRegistry().list.length > 1, [open]);
  const [allCompanies, setAllCompanies] = useState(false);
  const [peeked, setPeeked] = useState<{ id: string; name: string; data: Parameters<typeof searchPeek>[2] }[] | null>(null);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (!allCompanies || peeked) return;
    let live = true;
    import('../../lib/company-peek').then((m) => m.peekOtherCompanies(readRegistry(), companyDbName)).then((rows) => {
      if (live) setPeeked(rows);
    }).catch(() => live && setPeeked([]));
    return () => {
      live = false;
    };
  }, [allCompanies, peeked]);

  const pageEntries = useMemo<StaticEntry[]>(
    () =>
      navItems.map((n) => ({
        id: `nav:${n.to}`,
        title: n.label,
        subtitle: 'Go to page',
        icon: 'page',
        href: n.to,
        keywords: n.keywords,
      })),
    [navItems],
  );
  const actionEntries = useMemo<StaticEntry[]>(
    () =>
      actions.map((a) => ({
        id: `act:${a.id}`,
        title: a.title,
        subtitle: a.subtitle,
        icon: 'action',
        actionId: a.id,
        keywords: a.keywords,
      })),
    [actions],
  );
  // Tally-parity screens (Phase 7): searchable, not listed on the empty palette.
  const tallyEntries = useMemo<StaticEntry[]>(() => (open ? [...tallyDestinations(), ...distDestinations()] : []), [open]); // + 8F
  // R2-C: books & output destinations (annual pack, deferrals, IMS, labels, display, package types)
  const r2cEntries = useMemo<StaticEntry[]>(() => (open ? r2cDestinations() : []), [open]);
  // R2-B: round-2 sales screens (batch invoices, backorders)
  const r2bEntries = useMemo<StaticEntry[]>(() => (open ? salesR2Destinations() : []), [open]);
  // R3-B: Projects / Retainers / work types, customers gone quiet
  const r3bEntries = useMemo<StaticEntry[]>(() => (open ? serviceR3Destinations() : []), [open]);
  const actionById = useMemo(() => new Map(actions.map((a) => [a.id, a])), [actions]);
  const navByHref = useMemo(() => new Map(navItems.map((n) => [n.to, n])), [navItems]);

  const options = useMemo<Option[]>(() => {
    if (!open) return [];
    const q = query.trim();
    if (!q) {
      const base: Option[] = recents.map((text) => ({ key: `recent:${text}`, kind: 'recent', text }));
      const staticRows: SearchResult[] = [
        ...actionEntries.map((e) => ({ ...e, group: 'actions' as SearchGroup, score: 0, ranges: [] as Range[] })),
        ...pageEntries.map((e) => ({ ...e, group: 'pages' as SearchGroup, score: 0, ranges: [] as Range[] })),
      ];
      return [...base, ...staticRows.map((r) => ({ key: r.id, kind: 'result' as const, result: r }))];
    }
    const found = searchAll(q, {
      data: { pages: [...pageEntries, ...tallyEntries, ...r2cEntries, ...r2bEntries, ...r3bEntries], actions: actionEntries },
      perGroup: 6,
    });
    if (allCompanies && peeked) for (const c of peeked) found.push(...searchPeek(q, c, c.data));
    // Render order follows group relevance, so flatten through groupResults.
    return groupResults(found).flatMap((g) =>
      g.items.map((r) => ({ key: r.id, kind: 'result' as const, result: r })),
    );
  }, [open, query, recents, pageEntries, tallyEntries, r2cEntries, r2bEntries, r3bEntries, actionEntries, allCompanies, peeked]);

  // Reset on open; remember and restore focus.
  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQuery('');
    setActive(0);
    setRecents(getRecentSearches());
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      cancelAnimationFrame(raf);
      restoreRef.current?.focus?.({ preventScroll: true });
    };
  }, [open]);

  const clampedActive = options.length ? Math.min(active, options.length - 1) : 0;

  useEffect(() => {
    if (!open) return;
    document.getElementById(optionId(clampedActive))?.scrollIntoView({ block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clampedActive, open, options]);

  const choose = useCallback(
    (opt: Option | undefined) => {
      if (!opt) return;
      if (opt.kind === 'recent') {
        setQuery(opt.text ?? '');
        setActive(0);
        inputRef.current?.focus();
        return;
      }
      const r = opt.result!;
      if (query.trim()) pushRecentSearch(query);
      if (r.company) {
        // Read-only peek: another company's record cannot open here.
        const name = readRegistry().list.find((c) => c.id === r.company)?.name ?? '';
        setNotice(sfT('switchTo', { name }));
        return;
      }
      if (r.actionId) {
        const action = actionById.get(r.actionId);
        onClose();
        // Let focus restore before the action (e.g. a navigation or a dialog) runs.
        setTimeout(() => action?.run(), 0);
      } else if (r.href) {
        onClose();
        onNavigate(r.href);
      }
    },
    [query, actionById, onClose, onNavigate],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (options.length) setActive((clampedActive + 1) % options.length);
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (options.length) setActive((clampedActive - 1 + options.length) % options.length);
        break;
      case 'Home':
        if (e.target === inputRef.current && !query) {
          e.preventDefault();
          setActive(0);
        }
        break;
      case 'End':
        if (e.target === inputRef.current && !query) {
          e.preventDefault();
          setActive(Math.max(0, options.length - 1));
        }
        break;
      case 'Enter':
        e.preventDefault();
        choose(options[clampedActive]);
        break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        onClose();
        break;
      case 'Tab': {
        // Focus trap: keep focus inside the dialog.
        const items = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
        if (!items.length) break;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
        break;
      }
    }
  };

  if (!open) return null;

  // Build grouped view over the flat option list (indices stay global).
  const sections: { label: string; id: string; rows: { opt: Option; index: number }[] }[] = [];
  options.forEach((opt, index) => {
    const label = opt.kind === 'recent' ? 'Recent searches' : GROUP_LABELS[opt.result!.group];
    const last = sections[sections.length - 1];
    if (last && last.label === label) last.rows.push({ opt, index });
    else sections.push({ label, id: `${uid}-g${sections.length}`, rows: [{ opt, index }] });
  });

  return createPortal(
    <div
      className={cn(styles.backdrop, 'no-print')}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onKeyDown={onKeyDown}
      >
        <div className={styles.searchRow}>
          <Search size={18} className={styles.searchIcon} aria-hidden="true" />
          <input
            ref={inputRef}
            className={styles.input}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={options.length ? optionId(clampedActive) : undefined}
            aria-label="Search invoices, bills, parties, payments, amounts, pages and actions"
            placeholder="Find anything: invoices, bills, parties, UTR, ₹12.5k, >50k…"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
          />
          <kbd className={styles.kbd}>Esc</kbd>
        </div>
        {multiCompany && (
          <label className={styles.emptyHint} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', padding: '0.25rem 1rem' }}>
            <input type="checkbox" checked={allCompanies} onChange={(e) => setAllCompanies(e.target.checked)} /> {sfT('allCompanies')}
          </label>
        )}
        {notice && <p className={styles.emptyHint} role="status" style={{ padding: '0 1rem' }}>{notice}</p>}

        <div ref={listRef} id={listId} className={styles.list} role="listbox" aria-label="Results">
          {options.length === 0 && (
            <div className={styles.empty} role="presentation">
              <p className={styles.emptyTitle}>No matches for “{query.trim()}”</p>
              <p className={styles.emptyHint}>
                Try an invoice number like <code>0007</code>, a party, a GSTIN / PAN / UTR, an amount like <code>12.5k</code> or <code>&gt;50k</code>.
              </p>
            </div>
          )}

          {sections.map((section) => (
            <div key={section.id} role="group" aria-labelledby={section.id} className={styles.group}>
              <div className={styles.groupHead} id={section.id}>
                <span>{section.label}</span>
                {section.label === 'Recent searches' && (
                  <button
                    type="button"
                    className={styles.clearBtn}
                    onClick={() => {
                      clearRecentSearches();
                      setRecents([]);
                      inputRef.current?.focus();
                    }}
                  >
                    Clear
                  </button>
                )}
              </div>
              {section.rows.map(({ opt, index }) => {
                const isActive = index === clampedActive;
                const r = opt.result;
                const action = r?.actionId ? actionById.get(r.actionId) : undefined;
                const nav = r?.href ? navByHref.get(r.href) : undefined;
                return (
                  <div
                    key={opt.key}
                    id={optionId(index)}
                    role="option"
                    aria-selected={isActive}
                    className={cn(styles.option, isActive && styles.optionActive)}
                    onMouseMove={() => index !== clampedActive && setActive(index)}
                    onClick={() => choose(opt)}
                  >
                    <span className={styles.optIcon} aria-hidden="true">
                      {opt.kind === 'recent' ? <History size={16} /> : iconFor(r!, action, r!.group === 'pages' ? nav : undefined)}
                    </span>
                    <span className={styles.optText}>
                      <span className={styles.optTitle}>
                        {opt.kind === 'recent' ? opt.text : <Highlighted text={r!.title} ranges={r!.ranges} />}
                      </span>
                      {r?.subtitle && <span className={styles.optSub}>{r.subtitle}</span>}
                    </span>
                    {action?.shortcut && (
                      <span className={styles.optKeys} aria-hidden="true">
                        {formatCombo(action.shortcut).map((k, i) => (
                          <kbd key={i} className={styles.kbd}>{k}</kbd>
                        ))}
                      </span>
                    )}
                    {isActive && <CornerDownLeft size={14} className={styles.enterHint} aria-hidden="true" />}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        <div className={styles.footer} aria-hidden="true">
          <span><kbd className={styles.kbd}>↑</kbd><kbd className={styles.kbd}>↓</kbd> navigate</span>
          <span><kbd className={styles.kbd}>Enter</kbd> select</span>
          <span><kbd className={styles.kbd}>?</kbd> shortcuts</span>
        </div>
        <div className={styles.srOnly} role="status" aria-live="polite">
          {query.trim() ? `${options.length} result${options.length === 1 ? '' : 's'}` : ''}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default CommandPalette;
