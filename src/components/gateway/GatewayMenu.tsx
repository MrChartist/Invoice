import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { formatCombo, isTypingTarget } from '../../hooks/useHotkeys';
import { useCan } from '../../hooks/useCan';
import { gwT, type GwKey } from '../../i18n/areas/gateway';
import { useT } from '../../i18n';
import { formatDate, cn } from '../../lib/utils';
import { setTallyTerms } from '../../lib/gateway/period';
import {
  accelIndex,
  entryForKey,
  entryRoute,
  filterGoto,
  flattenMenu,
  isScreenId,
  resolveScreen,
  screenEntries,
  type GotoItem,
  type MenuAction,
  type MenuEntry,
  type ScreenId,
} from '../../lib/gateway/menu';
import { useGateway, useGatewaySession, useScreenKeys, useTallyTerms } from './context';
import { ButtonBar } from './ButtonBar';
import { KeysSwitch } from '../keys/KeysHost';
import { CreateLedgerDialog } from './CreateLedgerDialog';
import { ariaKeys } from './keymap';
import controls from '../../styles/controls.module.css';
import styles from './Gateway.module.css';

type LedgerKindAction = Exclude<MenuAction, 'date' | 'period'>;

/** Selected row per menu screen, so Esc back to a menu lands where you left it. */
const selection = new Map<ScreenId, number>();

function Label({ text, accel }: { text: string; accel: string }) {
  const i = accelIndex(text, accel);
  if (i < 0) {
    return (
      <span>
        <span className={styles.accelBadge} aria-hidden="true">{accel.toUpperCase()}</span>
        {text}
      </span>
    );
  }
  return (
    <span>
      {text.slice(0, i)}
      <span className={styles.accel}>{text[i]}</span>
      {text.slice(i + 1)}
    </span>
  );
}

export function GatewayMenu() {
  const { lang } = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const { can, role } = useCan();
  const { openDate, openPeriod, notify } = useGateway();
  const session = useGatewaySession();
  const terms = useTallyTerms();

  const m: ScreenId = isScreenId(params.get('m')) ? (params.get('m') as ScreenId) : 'root';
  const screen = useMemo(() => resolveScreen(m, can), [m, role]); // eslint-disable-line react-hooks/exhaustive-deps
  const entries = useMemo(() => screenEntries(screen), [screen]);
  const [sel, setSel] = useState(() => selection.get(m) ?? 0);
  const [query, setQuery] = useState('');
  const [resultSel, setResultSel] = useState(0);
  const [creating, setCreating] = useState<LedgerKindAction | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const gotoRef = useRef<HTMLInputElement>(null);

  const label = (k: GwKey) => gwT(k);
  const other = (k: GwKey) => (lang === 'hi' ? gwT.en[k] : gwT.hi[k]);
  const all = useMemo(() => flattenMenu({ can, label, alt: other, terms }), [role, lang, terms]); // eslint-disable-line react-hooks/exhaustive-deps
  const results = useMemo(() => filterGoto(all, query), [all, query]);

  // New screen: restore its selection and focus it.
  const [shown, setShown] = useState(m);
  if (shown !== m) {
    setShown(m);
    setSel(selection.get(m) ?? 0);
  }
  useEffect(() => {
    itemRefs.current[Math.min(selection.get(m) ?? 0, entries.length - 1)]?.focus();
  }, [m]); // eslint-disable-line react-hooks/exhaustive-deps

  // Alt+G / Ctrl+G from anywhere lands here with state { tally: 'goto' }.
  const tally = (location.state as { tally?: string } | null)?.tally;
  useEffect(() => {
    if (tally !== 'goto') return;
    gotoRef.current?.focus();
    navigate(location.pathname + location.search, { replace: true, state: null });
  }, [tally]); // eslint-disable-line react-hooks/exhaustive-deps

  const title = (e: MenuEntry) => gwT(terms && e.tally ? e.tally : e.label);

  const activate = (e: MenuEntry, from: ScreenId) => {
    const t = e.target;
    if ('unavailable' in t) return notify(gwT('notAvailable'), 'info');
    if ('action' in t) {
      if (t.action === 'date') return openDate();
      if (t.action === 'period') return openPeriod();
      return setCreating(t.action);
    }
    const route = entryRoute(t, from);
    if (!route) return;
    selection.set(m, Math.max(0, entries.indexOf(e)));
    navigate(route, 'screen' in t ? { state: { gw: true } } : undefined);
  };

  const goBack = () => {
    if (m === 'root') return false;
    if ((location.state as { gw?: boolean } | null)?.gw) navigate(-1);
    else navigate(entryRoute({ screen: screen?.parent ?? 'root' }, m) ?? '/gateway', { replace: true });
    return true;
  };

  const move = (i: number) => {
    if (!entries.length) return;
    const next = (i + entries.length) % entries.length;
    setSel(next);
    selection.set(m, next);
    itemRefs.current[next]?.focus();
  };

  useScreenKeys((e) => {
    const inGoto = e.target === gotoRef.current;
    const k = e.key;
    if ((k === 'g' || k === 'G') && (e.altKey || e.ctrlKey || e.metaKey)) {
      gotoRef.current?.focus();
      gotoRef.current?.select();
      return true;
    }
    if (inGoto) {
      if (k === 'ArrowDown' || k === 'ArrowUp') {
        if (results.length) setResultSel((s) => (s + (k === 'ArrowDown' ? 1 : -1) + results.length) % results.length);
        return true;
      }
      if (k === 'Enter' && results[resultSel]) {
        activate(results[resultSel].entry, results[resultSel].screen);
        return true;
      }
      if (k === 'Escape') {
        if (query) setQuery('');
        else move(sel);
        return true;
      }
      return false;
    }
    if (isTypingTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey) return false;
    if (k === 'ArrowDown') return move(sel + 1), true;
    if (k === 'ArrowUp') return move(sel - 1), true;
    if (k === 'Home') return move(0), true;
    if (k === 'End') return move(entries.length - 1), true;
    if (k === 'Escape') return goBack();
    if (k === '/') {
      gotoRef.current?.focus();
      return true;
    }
    const hit = entryForKey(screen, k);
    if (hit) {
      activate(hit, m);
      return true;
    }
    return false;
  });

  let index = -1;
  return (
    <>
      {/* PL: the title and subtitle are the page's (src/pages/Gateway.tsx); this row keeps the menu's switches. */}
      <div className={styles.head}>
        <label className={styles.toggle} title={gwT('termsHint')}>
          <input type="checkbox" role="switch" checked={terms} onChange={(e) => setTallyTerms(e.target.checked)} />
          {gwT('termsLabel')}
        </label>
        <KeysSwitch />
      </div>
      <ButtonBar />
      <div className={styles.layout}>
        <section className={cn(styles.card, styles.info)} aria-label={gwT('bbPeriod')}>
          <div>
            <span className={styles.infoLabel}>{gwT('bbPeriod')}</span>
            <button type="button" className={styles.chip} onClick={openPeriod} aria-keyshortcuts="Alt+F2">
              <span className={styles.infoValue}>{gwT('periodRange', { from: formatDate(session.period.start), to: formatDate(session.period.end) })}</span>
              <kbd className={styles.fkey}>{formatCombo('alt+f2').join('+')}</kbd>
            </button>
          </div>
          <div>
            <span className={styles.infoLabel}>{gwT('dateLabel')}</span>
            <button type="button" className={styles.chip} onClick={openDate} aria-keyshortcuts="F2">
              <span className={styles.infoValue}>{formatDate(session.voucherDate)}</span>
              <kbd className={styles.fkey}>F2</kbd>
            </button>
          </div>
          <p className={styles.sub}>{gwT('caNote')}</p>
        </section>

        <nav className={cn(styles.card, styles.menu)} aria-label={gwT('menu')}>
          <div className={styles.menuHead}>{gwT(screen?.title ?? 'title')}</div>
          <div className={styles.goto}>
            <label className={styles.infoLabel} htmlFor="gw-goto">
              {gwT('goto')} <kbd className={styles.fkey}>{formatCombo('alt+g').join('+')}</kbd>
            </label>
            <input
              id="gw-goto"
              ref={gotoRef}
              className={cn(controls.input, styles.gotoInput)}
              placeholder={gwT('gotoPlaceholder')}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setResultSel(0);
              }}
              role="combobox"
              aria-expanded={!!query}
              aria-controls="gw-goto-list"
              aria-activedescendant={results[resultSel] ? `gw-r-${results[resultSel].entry.id}` : undefined}
              aria-keyshortcuts="Alt+G Control+G"
              autoComplete="off"
            />
          </div>
          {query ? (
            results.length ? (
              <ul id="gw-goto-list" className={styles.list} role="listbox" aria-label={gwT('results')}>
                {results.map((r: GotoItem, i) => (
                  <li
                    key={r.entry.id}
                    id={`gw-r-${r.entry.id}`}
                    role="option"
                    aria-selected={i === resultSel}
                    className={cn(styles.item, i === resultSel && styles.itemActive)}
                    onMouseDown={(ev) => ev.preventDefault()}
                    onClick={() => activate(r.entry, r.screen)}
                  >
                    <span>
                      {r.label}
                      {r.path.length > 0 && <span className={styles.path}>{r.path.join(' › ')}</span>}
                    </span>
                    {r.entry.fkey && <span className={styles.fkey}>{formatCombo(r.entry.fkey).join('+')}</span>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.empty} role="status">{gwT('noMatches', { q: query })}</p>
            )
          ) : (
            <>
              {screen?.sections.map((sec, si) => (
                <div key={si} className={styles.section}>
                  {sec.title && m === 'root' && <h2 className={styles.sectionTitle}>{gwT(sec.title)}</h2>}
                  <ul className={styles.list}>
                    {sec.entries.map((e) => {
                      index += 1;
                      const i = index;
                      const unavailable = 'unavailable' in e.target;
                      return (
                        <li key={e.id}>
                          <button
                            ref={(el) => {
                              itemRefs.current[i] = el;
                            }}
                            type="button"
                            className={cn(styles.item, i === sel && styles.itemActive)}
                            tabIndex={i === sel ? 0 : -1}
                            onFocus={() => setSel(i)}
                            onClick={() => activate(e, m)}
                            aria-keyshortcuts={[e.accel.toUpperCase(), e.fkey ? ariaKeys(e.fkey) : ''].filter(Boolean).join(' ')}
                            aria-disabled={unavailable || undefined}
                            data-testid={`gw-${e.id}`}
                          >
                            <Label text={title(e)} accel={e.accel} />
                            {e.fkey && <span className={styles.fkey}>{formatCombo(e.fkey).join('+')}</span>}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
              {m !== 'root' && (
                <button type="button" className={cn(controls.btnGhost, styles.back)} onClick={goBack} aria-keyshortcuts="Escape">
                  {gwT('back')} (Esc)
                </button>
              )}
            </>
          )}
        </nav>
      </div>
      {creating && (
        <CreateLedgerDialog
          kind={creating === 'createCustomer' ? 'customer' : creating === 'createVendor' ? 'vendor' : 'account'}
          terms={terms}
          onClose={() => setCreating(null)}
          onCreated={(o) => {
            setCreating(null);
            notify(gwT('cCreated', { name: o.name }));
          }}
        />
      )}
    </>
  );
}

export default GatewayMenu;
