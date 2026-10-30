/**
 * R20-A4: the keyboard cheat sheet (`?` / Ctrl+/ anywhere, the header's keyboard button). Bilingual (plain name ·
 * Tally name · key), searchable (English, Hindi, Tally names, "f5"), "This screen" or "All", with the Tally keys
 * switch and layout picker in its header, and a one-column A4 print of what is shown. Tally rows show dimmed with
 * "Switch on Tally keys to use" while the mode is off; "Not in a browser" lists what to use instead.
 */
import { useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Printer, Search } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { useT } from '../../i18n';
import { keysT } from '../../i18n/areas/keys-r20a';
import { formatCombo, isApplePlatform } from '../../hooks/useHotkeys';
import { openHelp } from '../../lib/help-event';
import { NEVER_CLAIM, comboFor, type KeyGroup, type KeyRow } from '../../lib/keys/registry';
import { rowMatches, sheetRows } from '../../lib/keys/cheat';
import { activeScopes } from '../../lib/keys/engine';
import { useKeysState } from '../../lib/keys/use-key-actions';
import { KeyCaps, KeysSwitch } from '../keys/KeysHost';
import { cn } from '../../lib/utils';
import controls from '../../styles/controls.module.css';
import styles from './ShortcutsOverlay.module.css';

export interface ShortcutsOverlayProps {
  open: boolean;
  onClose: () => void;
}

const GROUPS: KeyGroup[] = ['goto', 'vouchers', 'entry', 'reports', 'company', 'app'];

export function ShortcutsOverlay({ open, onClose }: ShortcutsOverlayProps) {
  const { lang } = useT();
  const { pathname } = useLocation();
  const [on, layout] = useKeysState();
  const [q, setQ] = useState('');
  const here = useMemo(() => sheetRows(pathname, activeScopes()), [pathname]);
  const [tab, setTab] = useState<'screen' | 'all'>(() => (here.some((r) => r.scope !== 'global') ? 'screen' : 'all'));
  const [hiTick, setHi] = useState(0);
  const gw = /^\/gateway(\/|$)/.test(pathname);
  const other = layout === 'prime' ? 'erp9' : 'prime';

  const search = (v: string) => {
    setQ(v);
    // Hindi typed on an English screen: fetch the Hindi labels once, then search them too.
    if (/[ऀ-ॿ]/.test(v) && lang !== 'hi') void keysT.load().then(() => setHi((n) => n + 1), () => undefined);
  };

  const rows = useMemo(() => {
    const seen = new Set<string>();
    return (tab === 'screen' ? here : sheetRows(null)).filter((r) => {
      const c = comboFor(r, layout) || comboFor(r, other);
      const k = `${r.plain}|${c}`;
      if (!c || seen.has(k) || !rowMatches(r, q)) return false;
      seen.add(k);
      return true;
    });
  }, [tab, here, layout, other, q, lang, hiTick]); // eslint-disable-line react-hooks/exhaustive-deps

  const never = NEVER_CLAIM.filter((n) => n.say && (!q || keysT(n.say).toLowerCase().includes(q.trim().toLowerCase())));
  const line = (r: KeyRow) => {
    const c = comboFor(r, layout);
    const o = comboFor(r, other);
    const dim = r.mode === 'tally' && !on && !(r.gw && gw);
    return (
      <li key={r.id} className={cn(styles.row, dim && styles.dim)}>
        <span className={styles.label}>
          {keysT(r.plain)}
          {r.tally && <span className={styles.tally}>{keysT(r.tally)}</span>}
          {dim && <span className={styles.note}>{keysT('needOn')}</span>}
          {o !== c && <span className={styles.note}>{keysT('other', { layout: keysT(other), key: o ? formatCombo(o).join('+') : '-' })}</span>}
        </span>
        {c ? <KeyCaps combo={c} /> : <span className={styles.note}>F10</span>}
      </li>
    );
  };

  return (
    <Modal open={open} onClose={onClose} title={keysT('title')} subtitle={keysT('sub')} size="lg">
      <div className={styles.sheet} data-testid="cheat-sheet">
        <div className={cn(styles.tools, styles.noPrint)}>
          <KeysSwitch />
          <span className={styles.toolBtns}>
            <button type="button" className={cn(controls.btnOutline, controls.btnSm)} onClick={() => window.print()}>
              <Printer size={14} aria-hidden="true" /> {keysT('printBtn')}
            </button>
            <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={() => { onClose(); openHelp('tally-keys'); }}>
              {keysT('help')}
            </button>
          </span>
        </div>
        <div className={cn(styles.tools, styles.noPrint)}>
          <label className={styles.search}>
            <Search size={15} aria-hidden="true" />
            <input className={controls.input} type="search" value={q} onChange={(e) => search(e.target.value)} placeholder={keysT('find')} aria-label={keysT('find')} data-testid="cheat-search" />
          </label>
          <span role="tablist" className={styles.tabs}>
            {(['screen', 'all'] as const).map((t) => (
              <button key={t} type="button" role="tab" aria-selected={tab === t} className={cn(styles.tab, tab === t && styles.tabOn)} onClick={() => setTab(t)}>
                {keysT(t)}
              </button>
            ))}
          </span>
        </div>
        {!on && <p className={cn(styles.note, styles.noPrint)}>{keysT('reload')}</p>}
        {isApplePlatform() && <p className={styles.note}>{keysT('fn')}</p>}
        <div className={styles.grid}>
          {GROUPS.map((g) => {
            const list = rows.filter((r) => r.group === g);
            return list.length ? (
              <section key={g} aria-label={keysT(`g_${g}`)}>
                <h3 className={styles.groupTitle}>{keysT(`g_${g}`)}</h3>
                <ul className={styles.list}>{list.map(line)}</ul>
              </section>
            ) : null;
          })}
          {tab === 'all' && never.length > 0 && (
            <section aria-label={keysT('g_never')}>
              <h3 className={styles.groupTitle}>{keysT('g_never')}</h3>
              <ul className={styles.list}>
                {never.map((n) => (
                  <li key={n.combo} className={styles.row}>
                    <span className={styles.label}>{keysT(n.say!)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {!rows.length && <p className={styles.note}>{keysT('none')}</p>}
        </div>
      </div>
    </Modal>
  );
}

export default ShortcutsOverlay;
