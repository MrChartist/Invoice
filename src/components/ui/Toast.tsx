import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle, Info, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import styles from './Toast.module.css';

export type ToastTone = 'success' | 'error' | 'info';

export interface ToastProps {
  message: string;
  tone?: ToastTone;
  duration?: number;
  /**
   * Optional button, e.g. Undo. Clicking it (or Alt+Z) runs `onClick` and closes the toast. R4-C4: a toast with an
   * action never auto-dismisses; `onDismiss` runs when it is closed without the action (× or replaced).
   */
  action?: { label: string; onClick: () => void; onDismiss?: () => void };
  onClose: () => void;
}

const TONE = {
  success: CheckCircle,
  error: AlertTriangle,
  info: Info,
} as const;

export function Toast({ message, tone = 'success', duration = 3200, action, onClose }: ToastProps) {
  const [visible, setVisible] = useState(false);
  // R4-C4: `done` once closed by the user / the action; `live` while mounted (a StrictMode re-mount is not a dismissal).
  const st = useRef({ done: false, live: false }).current;
  const close = (fn?: () => void) => {
    st.done = true;
    fn?.();
    setVisible(false);
    setTimeout(onClose, 260);
  };

  useEffect(() => {
    st.live = true;
    // One frame in the hidden state so the entrance transition actually runs.
    const raf = requestAnimationFrame(() => setVisible(true));
    const timer = action ? 0 : setTimeout(close, duration);
    const key = (e: KeyboardEvent) => {
      if (e.altKey && e.code === 'KeyZ' && !st.done) close(action!.onClick);
    };
    if (action) addEventListener('keydown', key);
    return () => {
      st.live = false;
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      removeEventListener('keydown', key);
      // Replaced by the next toast: not undone (the deleted rows stay in the recycle bin).
      setTimeout(() => st.live || st.done || ((st.done = true), action?.onDismiss?.()));
    };
  }, [duration, onClose, action]); // eslint-disable-line react-hooks/exhaustive-deps

  const Icon = TONE[tone];

  // Spec 2.6: a thin material capsule (top centre on desktop, above the tab bar on phones); the glyph carries the
  // meaning colour and the text stays --label, so colour is never alone.
  const node = (
    <div
      role="status"
      aria-live={tone === 'error' ? 'assertive' : 'polite'}
      className={cn('material', styles.toast, message.length > 60 && styles.long, 'no-print')}
      data-mat="thin"
      data-tone={tone}
      data-visible={visible || undefined}
    >
      <Icon size={18} className={styles.glyph} aria-hidden="true" />
      <span className={styles.message}>{message}</span>
      {action && (
        <button type="button" className="btn quiet sm" onClick={() => close(action.onClick)}>
          {action.label}
        </button>
      )}
      <button type="button" className="btn quiet icon xs" aria-label="Dismiss notification" onClick={() => close(action?.onDismiss)}>
        <X size={14} />
      </button>
    </div>
  );

  return document.body ? createPortal(node, document.body) : null;
}
