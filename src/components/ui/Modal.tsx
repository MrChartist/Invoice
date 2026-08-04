import { useCallback, useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';
import styles from './Modal.module.css';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Removes the body padding — for full-bleed lists. */
  flush?: boolean;
  footer?: ReactNode;
  children: ReactNode;
}

/**
 * Accessible dialog: labelled by its title, closes on Escape, traps Tab inside
 * itself and returns focus to whatever opened it.
 */
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  size = 'md',
  flush,
  footer,
  children,
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusTo = useRef<HTMLElement | null>(null);
  const titleId = useId();

  const focusables = useCallback(
    () => Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []),
    [],
  );

  useEffect(() => {
    if (!open) return;
    restoreFocusTo.current = document.activeElement as HTMLElement | null;
    // Focus the first control so keyboard users land inside the dialog.
    const first = focusables()[0] ?? dialogRef.current;
    first?.focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      restoreFocusTo.current?.focus?.({ preventScroll: true });
    };
  }, [open, onClose, focusables]);

  if (!open) return null;

  return createPortal(
    <div
      className={cn(styles.backdrop, 'no-print')}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className={cn(styles.dialog, styles[size])}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className={styles.head}>
          <div>
            <h2 className={styles.title} id={titleId}>
              {title}
            </h2>
            {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
          </div>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close dialog">
            <X size={18} />
          </button>
        </div>

        <div className={cn(styles.body, flush && styles.bodyFlush)}>{children}</div>

        {footer && <div className={styles.foot}>{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
