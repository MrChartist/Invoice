/**
 * R20-A (VK18): F10 "List of vouchers" over the current screen — every voucher with its key in the current layout,
 * plain name first, Tally name second, and a letter to pick it (role="menu", so screen readers switch to focus mode).
 * The answer for every key a browser or a Mac will not give us (Ctrl+F4 payroll, F-keys without fn …).
 */
import { useT } from '../../i18n';
import { keysT } from '../../i18n/areas/keys-r20a';
import { can } from '../../lib/access';
import { KEY_ROWS, comboFor, isBuilt } from '../../lib/keys/registry';
import { runKeyRow } from '../../lib/keys/engine';
import { keysLayout } from '../../lib/keys/stub';
import { Modal } from '../ui/Modal';
import { KeyCaps } from './KeysSwitch';
import s from './keys.module.css';

export function VouchersSheet({ onClose }: { onClose: () => void }) {
  useT();
  const layout = keysLayout();
  const rows = KEY_ROWS.filter((r) => r.letter && isBuilt(r) && (!r.need || can(r.need)));
  const pick = (id: string) => {
    onClose();
    // After the dialog left the modal stack (keys and routes act on the page underneath).
    setTimeout(() => runKeyRow(id));
  };
  return (
    <Modal open onClose={onClose} size="sm" title={keysT('vTitle')} subtitle={keysT('vSub')}>
      <div
        role="menu"
        aria-label={keysT('vTitle')}
        className={s.menu}
        onKeyDown={(e) => {
          const hit = !e.ctrlKey && !e.metaKey && !e.altKey && rows.find((r) => r.letter === e.key.toUpperCase());
          if (hit) {
            e.preventDefault();
            pick(hit.id);
          }
        }}
      >
        {rows.map((r) => {
          const combo = comboFor(r, layout);
          return (
            <button key={r.id} type="button" role="menuitem" className={s.item} onClick={() => pick(r.id)} data-testid={`vs-${r.id}`} aria-keyshortcuts={r.letter}>
              <span className={s.letter}>{r.letter}</span>
              <span className={s.itemText}>
                {keysT(r.plain)}
                {r.tally && <small>{keysT(r.tally)}</small>}
              </span>
              {combo && <KeyCaps combo={combo} />}
            </button>
          );
        })}
      </div>
    </Modal>
  );
}
