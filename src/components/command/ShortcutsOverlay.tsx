import { Modal } from '../ui/Modal';
import { GLOBAL_SHORTCUTS, formatCombo, type ShortcutInfo } from '../../hooks/useHotkeys';
import styles from './ShortcutsOverlay.module.css';

export interface ShortcutsOverlayProps {
  open: boolean;
  onClose: () => void;
  /** Extra shortcuts (e.g. page-specific ones) appended to the built-in list. */
  extra?: ShortcutInfo[];
}

/** Press `?` anywhere (outside inputs) to see every keyboard shortcut. */
export function ShortcutsOverlay({ open, onClose, extra = [] }: ShortcutsOverlayProps) {
  const all = [...GLOBAL_SHORTCUTS, ...extra];
  const groups = Array.from(new Set(all.map((s) => s.group)));

  return (
    <Modal open={open} onClose={onClose} title="Keyboard shortcuts" subtitle="Work faster without leaving the keyboard" size="md">
      <div className={styles.grid}>
        {groups.map((group) => (
          <section key={group} aria-labelledby={`sc-${group.replace(/\s+/g, '-')}`}>
            <h3 className={styles.groupTitle} id={`sc-${group.replace(/\s+/g, '-')}`}>
              {group}
            </h3>
            <ul className={styles.list}>
              {all
                .filter((s) => s.group === group)
                .map((s) => (
                  <li key={s.combo} className={styles.row}>
                    <span className={styles.label}>
                      {s.label}
                      {s.external && <span className={styles.note}> (in editor)</span>}
                    </span>
                    <span className={styles.keys} aria-label={formatCombo(s.combo).join(' ')}>
                      {formatCombo(s.combo).map((k, i) =>
                        k === 'then' ? (
                          <span key={i} className={styles.then}>then</span>
                        ) : (
                          <kbd key={i} className={styles.kbd}>{k}</kbd>
                        ),
                      )}
                    </span>
                  </li>
                ))}
            </ul>
          </section>
        ))}
      </div>
    </Modal>
  );
}

export default ShortcutsOverlay;
