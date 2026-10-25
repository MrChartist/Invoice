import { useEffect } from 'react';
import { Trash2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { heldLineCount, type HeldCart } from '../../lib/pos-hold';
import { formatCurrency } from '../../lib/utils';
import { useT } from '../../i18n';
import { posT } from '../../i18n/areas/pos';
import controls from '../../styles/controls.module.css';
import styles from './counter.module.css';

/** Recall list for bills on hold (8.21): Recall / Drop, keys 1–9 recall that slot. */
export function HeldBills({ open, list, onClose, onRecall, onDrop }: {
  open: boolean;
  list: readonly HeldCart[];
  onClose: () => void;
  onRecall: (id: string) => void;
  onDrop: (id: string) => void;
}) {
  useT();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || !/^[1-9]$/.test(e.key)) return;
      const cart = list[Number(e.key) - 1];
      if (!cart) return;
      e.preventDefault();
      onRecall(cart.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, list, onRecall]);

  return (
    <Modal open={open} onClose={onClose} size="sm" title={posT('heldTitle')} subtitle={posT('heldNote')}>
      {list.length === 0 ? (
        <p>{posT('heldEmpty')}</p>
      ) : (
        <ul className={styles.heldList} data-pos-held-list>
          {list.map((c, i) => (
            <li key={c.id} className={styles.heldRow}>
              <span className={styles.heldKey} aria-hidden="true">{i + 1}</span>
              <span className={styles.heldMain}>
                <strong>{posT('heldLine', { who: c.client?.name || c.name || posT('heldWalkIn'), n: heldLineCount(c), total: formatCurrency(c.total) })}</strong>
                <span className={styles.upiSmall}>{posT('heldAt', { time: new Date(c.held_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })}</span>
              </span>
              <button type="button" className={`${controls.btnPrimary} ${controls.btnSm}`} onClick={() => onRecall(c.id)}>{posT('recall')}</button>
              <button type="button" className={controls.btnIcon} onClick={() => onDrop(c.id)} aria-label={posT('dropOf', { n: i + 1 })} title={posT('drop')}>
                <Trash2 size={14} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
