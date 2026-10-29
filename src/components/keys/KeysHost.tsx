/**
 * R20-A5: mounted lazily by DashboardLayout while Tally keys are on (or on /gateway). It loads the engine, handles the
 * global rows that need the shell (F10 vouchers sheet, Ctrl+F1 help), draws the per-screen Key bar (role="toolbar",
 * one tab stop, roving arrows, collapsible; phones get a "Keys" pill and a sheet) and the key chips of
 * `[data-key-row]` buttons (`data-key-chip`, drawn by CSS; the button gets `aria-keyshortcuts`).
 */
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ChevronDown, Keyboard } from 'lucide-react';
import { useT } from '../../i18n';
import { cn } from '../../lib/utils';
import { keysT } from '../../i18n/areas/keys-r20a';
import { openHelp } from '../../lib/help-event';
import { readRaw } from '../../lib/storage';
import { formatCombo } from '../../hooks/useHotkeys';
import { ariaCombo, comboFor, rowById, type KeyRow } from '../../lib/keys/registry';
import { runKeyRow, screenRows } from '../../lib/keys/engine';
import { keysLayout, keysMode, setKeysMode } from '../../lib/keys/stub';
import { useKeyActions, useKeysState } from '../../lib/keys/use-key-actions';
import { Modal } from '../ui/Modal';
import { KeyCaps } from './KeysSwitch';
import { VouchersSheet } from './VouchersSheet';
import s from './keys.module.css';

const label = (r: KeyRow) => keysT(readRaw('mrchartist_tally_terms') === '1' && r.tally ? r.tally : r.plain);

export default function KeysHost() {
  useT();
  const { pathname } = useLocation();
  const [on, layout] = useKeysState();
  const [sheet, setSheet] = useState(false);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [phone, setPhone] = useState(() => matchMedia('(max-width: 900px)').matches);
  useKeyActions('global', { vouchers: () => setSheet(true), 'help.ctx': () => openHelp() });

  useEffect(() => {
    const mq = matchMedia('(max-width: 900px)');
    const f = () => setPhone(mq.matches);
    mq.addEventListener('change', f);
    return () => mq.removeEventListener('change', f);
  }, []);

  // Key chips on `[data-key-row]` buttons while the mode is on.
  useEffect(() => {
    const root = document.documentElement;
    if (!on) return;
    root.dataset.tallyKeys = '';
    let raf = 0;
    const paint = () => {
      raf = 0;
      document.querySelectorAll<HTMLElement>('[data-key-row]').forEach((el) => {
        const row = rowById(el.dataset.keyRow ?? '');
        const c = row ? comboFor(row, keysLayout()) : '';
        if (!c) return;
        el.dataset.keyChip = formatCombo(c).join('+');
        el.setAttribute('aria-keyshortcuts', ariaCombo(c));
      });
    };
    paint();
    const mo = new MutationObserver(() => (raf ||= requestAnimationFrame(paint)));
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      mo.disconnect();
      cancelAnimationFrame(raf);
      delete root.dataset.tallyKeys;
    };
  }, [on, layout]);

  const rows = on && !/^\/(gateway|pos)(\/|$)/.test(pathname) ? screenRows(pathname) : [];
  const collapsed = keysMode() === 'on:collapsed';
  const run = (id: string) => runKeyRow(id);

  return (
    <>
      {rows.length > 0 && (phone ? (
        <button type="button" className={s.pill} onClick={() => setPhoneOpen(true)} aria-haspopup="dialog" data-testid="keys-pill">
          <Keyboard size={16} aria-hidden="true" /> {keysT('keysBtn')}
        </button>
      ) : collapsed ? (
        <button type="button" className={cn(s.pill, s.pillDesk)} onClick={() => setKeysMode('on')} aria-expanded={false} data-testid="keys-expand">
          <Keyboard size={16} aria-hidden="true" /> {keysT('keysBtn')}
        </button>
      ) : (
        <KeyBar rows={rows} layout={layout} onRun={run} />
      ))}
      {phoneOpen && (
        <Modal open onClose={() => setPhoneOpen(false)} size="sm" title={keysT('bar')}>
          <div className={s.menu}>
            {rows.map((r) => (
              <button key={r.id} type="button" className={s.item} onClick={() => { setPhoneOpen(false); setTimeout(() => run(r.id)); }}>
                <span className={s.itemText}>{label(r)}</span>
                <KeyCaps combo={comboFor(r, layout)} />
              </button>
            ))}
          </div>
        </Modal>
      )}
      {sheet && <VouchersSheet onClose={() => setSheet(false)} />}
    </>
  );
}

function KeyBar({ rows, layout, onRun }: { rows: KeyRow[]; layout: ReturnType<typeof keysLayout>; onRun: (id: string) => void }) {
  const [at, setAt] = useState(0);
  const cur = Math.min(at, rows.length);
  return (
    <div
      role="toolbar"
      aria-label={keysT('bar')}
      className={cn(s.bar, 'no-print')}
      data-testid="key-bar"
      onKeyDown={(e) => {
        const n = rows.length + 1;
        const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        const to = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : (cur + d + n) % n;
        if (!d && e.key !== 'Home' && e.key !== 'End') return;
        e.preventDefault();
        setAt(to);
        (e.currentTarget.children[to] as HTMLElement | undefined)?.focus();
      }}
    >
      {rows.map((r, i) => {
        const c = comboFor(r, layout);
        return (
          <button key={r.id} type="button" className={s.barBtn} tabIndex={i === cur ? 0 : -1} onClick={() => onRun(r.id)} aria-keyshortcuts={ariaCombo(c)} data-testid={`kb-${r.id}`}>
            <KeyCaps combo={c} />
            <span>{label(r)}</span>
          </button>
        );
      })}
      <button type="button" className={s.barBtn} tabIndex={cur === rows.length ? 0 : -1} onClick={() => setKeysMode('on:collapsed')} aria-label={keysT('hideBar')} title={keysT('hideBar')}>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
