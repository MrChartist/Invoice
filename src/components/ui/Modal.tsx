import { useCallback, useEffect, useId, useRef, useState, type HTMLAttributes, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { isTopModal, pushModal } from '../../lib/modal-stack';
import styles from './Modal.module.css';

export const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Phone width (spec 3.1: under 600px a dialog is a sheet with a grabber). Same value as Modal.module.css. */
export const PHONE_QUERY = '(max-width: 37.4375em)';

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

/** Attributes passed through to the dialog element (data-* hooks for tests and styling). */
export type ModalDialogProps = HTMLAttributes<HTMLDivElement> & { [data: `data-${string}`]: string | boolean | undefined };

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
  /**
   * 'sheet' (default): a centred dialog from 600px, a bottom sheet with a grabber on phones (spec 2.6).
   * 'alert': a small centred confirm card on every screen, above any sheet (`--z-alert`), with no close button.
   */
  kind?: 'sheet' | 'alert';
  /** Phone sheet height: 'medium' (half the screen, drag up for more), 'large' (full) or omitted (fits the content). */
  detent?: 'medium' | 'large';
  /** Extra attributes on the dialog element. */
  dialogProps?: ModalDialogProps;
}

const isPhone = () => typeof matchMedia === 'function' && matchMedia(PHONE_QUERY).matches;

/**
 * Accessible dialog: labelled by its title, closes on Escape, traps Tab inside itself and returns focus to whatever
 * opened it. The one sheet / dialog of the app (docs/theme/IOS-UI.md 2.6): a centred card from 600px, a centred form
 * sheet on small tablets, and on phones a bottom sheet whose grabber (or header) drags down to dismiss.
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
  kind = 'sheet',
  detent,
  dialogProps,
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const restoreFocusTo = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const [expanded, setExpanded] = useState(false);
  const [scrolls, setScrolls] = useState(false);
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

    const token = {};
    const unstack = pushModal(token);
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isTopModal(token)) return; // QA7 G3: a dialog underneath ignores keys meant for the top one
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
      unstack();
      setExpanded(false);
      inerted.forEach((el) => el.removeAttribute('inert'));
      document.removeEventListener('keydown', onKeyDown, true);
      const target = restoreFocusTo.current;
      setTimeout(() => {
        // Only when focus was lost with the dialog: never steal it from whatever opened next (a preview, a sheet).
        const lost = !document.activeElement || document.activeElement === document.body;
        if (target?.isConnected && lost) target.focus({ preventScroll: true });
      }, 0);
    };
  }, [open, focusables]);

  // The footer draws its hairline only while the body scrolls under it (spec 2.6).
  useEffect(() => {
    const body = bodyRef.current;
    if (!open || !body || !footer || typeof ResizeObserver === 'undefined') return;
    const check = () => setScrolls(body.scrollHeight > body.clientHeight + 1);
    const ro = new ResizeObserver(check);
    ro.observe(body);
    if (body.firstElementChild) ro.observe(body.firstElementChild);
    return () => ro.disconnect();
  }, [open, footer]);

  // Phone sheet: drag the grabber or the header down to dismiss, up to reach the large detent.
  const drag = useRef<{ y0: number; t0: number; dy: number } | null>(null);
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (kind === 'alert' || e.button !== 0 || !isPhone()) return;
    const t = e.target as HTMLElement;
    if (!t.closest('[data-grab]') || t.closest('button, a, input, select, textarea')) return;
    drag.current = { y0: e.clientY, t0: e.timeStamp, dy: 0 };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const el = dialogRef.current;
    if (!d || !el) return;
    d.dy = e.clientY - d.y0;
    el.style.transition = 'none';
    el.style.transform = `translateY(${Math.max(0, d.dy)}px)`;
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const el = dialogRef.current;
    drag.current = null;
    if (!d || !el) return;
    const speed = d.dy / Math.max(1, e.timeStamp - d.t0); // px per ms
    el.style.transition = 'transform var(--dur-3) var(--spring-soft)';
    el.style.transform = '';
    if (d.dy > el.offsetHeight * 0.25 || (d.dy > 24 && speed > 0.5)) onCloseRef.current();
    else if (d.dy < -24 && detent === 'medium') setExpanded(true);
  };

  if (!open) return null;

  const alert = kind === 'alert';
  const sheetDetent = expanded ? 'large' : detent;

  return createPortal(
    <div
      ref={backdropRef}
      className={cn(styles.backdrop, alert && styles.alertLayer, 'no-print')}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        {...dialogProps}
        ref={dialogRef}
        className={cn(styles.dialog, alert ? styles.alert : styles[size], !alert && sheetDetent && styles[sheetDetent], !footer && styles.noFoot, dialogProps?.className)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {!alert && <div className={styles.grabber} data-grab aria-hidden="true" />}
        <div className={styles.head} data-grab>
          <div className={styles.headText}>
            <h2 className={styles.title} id={titleId}>
              {title}
            </h2>
            {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
          </div>
          {!alert && (
            <button type="button" className={cn('btn quiet icon sm', styles.close)} onClick={onClose} aria-label="Close dialog">
              <X size={18} />
            </button>
          )}
        </div>

        <div ref={bodyRef} data-modal-body className={cn(styles.body, flush && styles.bodyFlush)}>{children}</div>

        {footer && <div className={cn(styles.foot, scrolls && styles.footRule)}>{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
