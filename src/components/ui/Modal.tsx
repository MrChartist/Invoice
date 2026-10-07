import { useCallback, useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';
import styles from './Modal.module.css';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Tracks the last control focused outside a dialog, so closing returns focus to whatever opened it. */
let lastOutsideFocus: HTMLElement | null = null;
if (typeof document !== 'undefined') {
  document.addEventListener(
    'focusin',
    (e) => {
      const t = e.target;
      if (t instanceof HTMLElement && !t.closest('[role="dialog"]') && t !== document.body) lastOutsideFocus = t;
    },
    true,
  );
}

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
  const backdropRef = useRef<HTMLDivElement>(null);
  const restoreFocusTo = useRef<HTMLElement | null>(null);
  const titleId = useId();
  // Keep the latest onClose without re-running the focus effect (inline callbacks would steal focus on every render).
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  const focusables = useCallback(
    () => Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []),
    [],
  );

  useEffect(() => {
    if (!open) return;
    // An autoFocus child may already hold focus by now, so use the last element focused outside any dialog.
    restoreFocusTo.current = lastOutsideFocus ?? (document.activeElement as HTMLElement | null);
    // Focus the first control so keyboard users land inside the dialog.
    // Prefer an explicit [autofocus]/[data-autofocus] target, then the first form field in the body
    // (so pickers land in their search box), and only then the header's close button.
    const body = dialogRef.current?.querySelector<HTMLElement>('[data-modal-body]');
    const initial =
      dialogRef.current?.querySelector<HTMLElement>('[data-autofocus], [autofocus]') ??
      body?.querySelector<HTMLElement>('input:not([disabled]):not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea:not([disabled]), select:not([disabled])') ??
      body?.querySelector<HTMLElement>(FOCUSABLE) ??
      focusables()[0] ??
      dialogRef.current;
    initial?.focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCloseRef.current();
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

    // Make everything behind the dialog inert so screen readers and Tab cannot reach it.
    const inerted: HTMLElement[] = [];
    for (const el of Array.from(document.body.children)) {
      if (el instanceof HTMLElement && el !== backdropRef.current && !el.hasAttribute('inert') && el.tagName !== 'SCRIPT') {
        el.setAttribute('inert', '');
        inerted.push(el);
      }
    }

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      inerted.forEach((el) => el.removeAttribute('inert'));
      document.removeEventListener('keydown', onKeyDown, true);
      const target = restoreFocusTo.current;
      setTimeout(() => {
        if (target?.isConnected) target.focus({ preventScroll: true });
      }, 0);
    };
  }, [open, focusables]);

  if (!open) return null;

  return createPortal(
    <div
      ref={backdropRef}
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

        <div data-modal-body className={cn(styles.body, flush && styles.bodyFlush)}>{children}</div>

        {footer && <div className={styles.foot}>{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
