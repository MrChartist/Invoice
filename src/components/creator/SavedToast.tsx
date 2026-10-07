import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle, X } from 'lucide-react';
import controls from '../../styles/controls.module.css';
import styles from '../audit/audit.module.css';

export interface SavedToastProps {
  message: string;
  /** Hint about numbers a manually typed serial skipped, e.g. "Skipped INV/…/0003 – 0005". */
  gapHint?: string;
  onView: () => void;
  onShare: () => void;
  onNew: () => void;
  onClose: () => void;
  duration?: number;
}

/** Toast shown after a successful save: View / Share / New. */
export function SavedToast({ message, gapHint, onView, onShare, onNew, onClose, duration = 10000 }: SavedToastProps) {
  useEffect(() => {
    const t = setTimeout(onClose, duration);
    return () => clearTimeout(t);
  }, [duration, onClose]);

  const node = (
    <div className={`${styles.saved} no-print`} role="status" aria-live="polite">
      <div className={styles.savedTop}>
        <CheckCircle size={18} aria-hidden="true" />
        <span className={styles.savedMsg}>
          {message}
          {gapHint && <span className={styles.savedGap}>{gapHint}</span>}
        </span>
        <button type="button" className={controls.btnIcon} onClick={onClose} aria-label="Dismiss">
          <X size={14} />
        </button>
      </div>
      <div className={styles.savedActions}>
        <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => { onView(); onClose(); }}>
          View
        </button>
        <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => { onShare(); onClose(); }}>
          Share
        </button>
        <button type="button" className={`${controls.btnPrimary} ${controls.btnSm}`} onClick={() => { onNew(); onClose(); }}>
          New
        </button>
      </div>
    </div>
  );
  return document.body ? createPortal(node, document.body) : null;
}
