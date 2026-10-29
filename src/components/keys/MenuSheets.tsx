/**
 * R20-D: Go To over the current screen (Alt+G; Ctrl+G = Switch To), the "Back to …" chip, the Company (Alt+K), Data
 * (Alt+Y) and Import (Alt+O) sheets, the company list (F3), Lock now (Ctrl+F3, Y / N), Ctrl+Alt+N (bell), Ctrl+Alt+R
 * (check data) and Ctrl+Alt+B (Help → About). Mounted lazily by the notification bell while Tally keys are on (the bell
 * is always mounted after first paint, so this costs first paint nothing). Rows are the registry's; data in nav-actions.ts.
 */
import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { t, useT } from '../../i18n';
import { keysT } from '../../i18n/areas/keys-r20a';
import { navT } from '../../i18n/areas/keys-r20d';
import { logout } from '../../lib/auth';
import { activeCompanyId, readRegistry, switchCompany } from '../../lib/companies';
import { openHelp } from '../../lib/help-event';
import { comboFor, rowById } from '../../lib/keys/registry';
import { keysLayout } from '../../lib/keys/stub';
import { useKeyActions } from '../../lib/keys/use-key-actions';
import { itemForLetter, menuItems, screenName, type MenuId, type MenuItem } from '../../lib/keys/nav-actions';
import { CommandPalette } from '../command/CommandPalette';
import { Modal } from '../ui/Modal';
import { useToast } from '../ui/useToast';
import { KeyCaps } from './KeysHost';
import s from './keys.module.css';
import n from './nav.module.css';

type Sheet = MenuId | 'switchCo' | 'lock';
interface Back { to: string; name: string; focus?: string }
const TITLE: Record<MenuId, 'menuCompany' | 'menuData' | 'menuImport'> = { company: 'menuCompany', data: 'menuData', import: 'menuImport' };
const onGateway = () => /^\/gateway(\/|$)/.test(location.pathname);

/** ↑ ↓ Home End move between a sheet's buttons (Enter / Space press them natively). */
function roam(e: React.KeyboardEvent<HTMLElement>) {
  const list = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
  const at = list.indexOf(document.activeElement as HTMLButtonElement);
  const to = e.key === 'ArrowDown' ? at + 1 : e.key === 'ArrowUp' ? at - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1 : null;
  if (to === null || !list.length) return false;
  e.preventDefault();
  list[(to + list.length) % list.length].focus();
  return true;
}

export default function MenuSheets({ openBell }: { openBell: () => void }) {
  useT();
  const navigate = useNavigate();
  const loc = useLocation();
  const { notify, toastNode } = useToast();
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [mode, setMode] = useState<'goto' | 'switch' | null>(null);
  const [back, setBack] = useState<Back | null>(null);
  const from = useRef<Back | null>(null);

  const go = (m: 'goto' | 'switch') => {
    if (onGateway()) return false; // the Gateway's own Go To box
    const el = document.activeElement as HTMLElement | null;
    from.current = { to: loc.pathname + loc.search, name: screenName(), focus: el?.dataset.focusKey ?? (el?.id || undefined) };
    setMode(m);
  };
  useKeyActions('global', {
    goto: () => go('goto'),
    switch: () => go('switch'),
    company: () => setSheet('switchCo'),
    lock: () => setSheet('lock'),
    menuCompany: () => setSheet('company'),
    menuData: () => setSheet('data'),
    menuImport: () => setSheet('import'),
    notify: () => openBell(),
    repair: () => navigate('/settings?tab=activity'),
    about: () => openHelp(),
  });

  // "Back to …": the chip returns to the screen Go To was opened over, then puts focus back (or on the page).
  const goBack = () => {
    const b = back;
    if (!b) return;
    setBack(null);
    navigate(b.to.replace(/^\/invoice\?.*$/, '/invoice')); // a ?type= link would start a fresh draft
    let tries = 0;
    const put = () => {
      const el = b.focus && (document.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(b.focus)}"]`) ?? document.getElementById(b.focus));
      if (el) return el.focus();
      if (++tries < 20) return void setTimeout(put, 50);
      document.getElementById('main')?.focus({ preventScroll: true });
    };
    setTimeout(put, 50);
  };

  const run = (m: MenuItem) => {
    setSheet(null);
    setTimeout(() => {
      if (m.act === 'switch') setSheet('switchCo');
      else if (m.act === 'lock') setSheet('lock');
      else if (m.act === 'backup') {
        void import('../../lib/auto-backup')
          .then((b) => b.downloadBackupNow())
          .then((r) => notify(r.ok ? t('shell.backupDownloaded') : r.message, r.ok ? 'success' : 'error'), () => undefined);
      } else if (m.to) navigate(m.to);
    });
  };

  const menu = sheet === 'company' || sheet === 'data' || sheet === 'import' ? menuItems(sheet) : [];
  const reg = sheet === 'switchCo' ? readRegistry() : null;
  const label = (m: MenuItem) => (m.k ? keysT(m.k) : navT(m.n!));
  const caps = (id?: string) => {
    const r = id ? rowById(id) : undefined;
    const c = r ? comboFor(r, keysLayout()) : '';
    return c ? <KeyCaps combo={c} /> : null;
  };

  return createPortal(
    <>
      {mode && (
        <CommandPalette
          open
          mode={mode}
          onClose={() => setMode(null)}
          onNavigate={(href) => {
            const f = from.current;
            setBack(mode === 'goto' && f && f.to !== href ? f : null);
            navigate(href);
          }}
        />
      )}
      {back && loc.pathname + loc.search !== back.to && (
        <button type="button" className={`${n.back} no-print`} onClick={goBack} data-testid="goto-back">
          <ArrowLeft size={14} aria-hidden="true" /> {navT('backTo', { name: back.name || navT('backThis') })}
        </button>
      )}
      {menu.length > 0 && (
        <Modal open onClose={() => setSheet(null)} size="sm" title={keysT(TITLE[sheet as MenuId])} subtitle={navT('pickLetter')}>
          <div
            role="menu"
            aria-label={keysT(TITLE[sheet as MenuId])}
            className={s.menu}
            data-testid={`menu-${sheet}`}
            onKeyDown={(e) => {
              if (roam(e)) return;
              const hit = !e.ctrlKey && !e.metaKey && !e.altKey && itemForLetter(menu, e.key);
              if (hit) {
                e.preventDefault();
                run(hit);
              }
            }}
          >
            {menu.map((m) => (
              <button key={m.letter} type="button" role="menuitem" className={s.item} onClick={() => run(m)} aria-keyshortcuts={m.letter} data-testid={`mi-${m.letter}`}>
                <span className={s.letter}>{m.letter}</span>
                <span className={s.itemText}>{label(m)}</span>
                {caps(m.row)}
              </button>
            ))}
          </div>
        </Modal>
      )}
      {reg && (
        <Modal open onClose={() => setSheet(null)} size="sm" title={keysT('company')} subtitle={reg.list.length < 2 ? navT('noOther') : undefined}>
          <div role="menu" aria-label={keysT('company')} className={s.menu} onKeyDown={roam} data-testid="company-list">
            {reg.list.map((c, i) => (
              <button
                key={c.id}
                type="button"
                role="menuitemradio"
                aria-checked={c.id === activeCompanyId()}
                className={s.item}
                onClick={() => (c.id === activeCompanyId() ? setSheet(null) : switchCompany(c.id))}
              >
                <span className={s.letter}>{i + 1}</span>
                <span className={s.itemText}>{c.name}</span>
              </button>
            ))}
          </div>
        </Modal>
      )}
      {sheet === 'lock' && (
        <Modal open onClose={() => setSheet(null)} size="sm" title={keysT('lock')}>
          <div
            className={s.menu}
            onKeyDown={(e) => {
              const k = e.key.toLowerCase();
              if (k === 'y' || k === 'n') {
                e.preventDefault();
                (e.currentTarget.querySelectorAll('button')[k === 'y' ? 0 : 1] as HTMLButtonElement).click();
              }
            }}
          >
            <p>{navT('lockQ')}</p>
            <button
              type="button"
              className={s.item}
              data-testid="lock-yes"
              onClick={() => {
                logout();
                location.reload();
              }}
            >
              {navT('yes')}
            </button>
            <button type="button" className={s.item} onClick={() => setSheet(null)}>
              {navT('no')}
            </button>
          </div>
        </Modal>
      )}
      {toastNode}
    </>,
    document.body,
  );
}
