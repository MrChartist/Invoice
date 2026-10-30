import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/utils';
import { isTopModal, pushModal } from '../../lib/modal-stack';
import { t } from '../../i18n';
import { Modal, PHONE_QUERY } from './Modal';
import styles from './Menu.module.css';

const isPhone = () => typeof matchMedia === 'function' && matchMedia(PHONE_QUERY).matches;

export interface MenuItem {
  label: ReactNode;
  /** A 16px lucide glyph, leading. */
  icon?: ReactNode;
  /** Trailing hint in --label-2 (a key, a short note). */
  hint?: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  title?: string;
  /** Red label; put it last (spec 2.6). */
  destructive?: boolean;
  /** Starts a new group: a hairline above it. */
  separator?: boolean;
  /** data-* hooks on the item. */
  attrs?: Record<`data-${string}`, string | boolean | undefined>;
}

export interface MenuProps {
  /** Accessible name of the menu (and the action sheet's title on phones). */
  label: string;
  items: MenuItem[];
  /** The trigger's content; Menu draws the trigger button itself. Leave out with `at`. */
  trigger?: ReactNode;
  triggerClassName?: string;
  /** Edge of the trigger the menu lines up with. */
  align?: 'start' | 'end';
  /** Context menu: open at this viewport point (right-click); `onClose` is then required. */
  at?: { x: number; y: number };
  onClose?: () => void;
  className?: string;
}

/**
 * Menu, context menu and action sheet in one (docs/theme/IOS-UI.md 2.6). From 600px a regular-material popover anchored
 * to its trigger (or opened at a point, `at`), arrow keys move, Escape closes and returns focus to the trigger; on
 * phones the same items open as an action sheet (the Modal sheet with a separate Cancel). While open it sits on the
 * modal stack, so an Escape closes the menu and not the dialog it was opened from (QA7 G3).
 *
 *   <Menu label="Share" trigger={<><Share2 size={16} /> Share</>} triggerClassName={controls.btnOutline} items={[…]} />
 *   {ctx && <Menu label="Row actions" at={ctx} onClose={() => setCtx(null)} items={[…]} />}
 */
export function Menu({ label, items, trigger, triggerClassName, align = 'end', at, onClose, className }: MenuProps) {
  const [openState, setOpen] = useState(false);
  const open = !!at || openState;
  const [sheet, setSheet] = useState(() => !!at && isPhone());
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  const close = (refocus = true) => {
    setOpen(false);
    onCloseRef.current?.();
    if (refocus) triggerRef.current?.focus({ preventScroll: true });
  };
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });

  useEffect(() => {
    if (!open || sheet) return;
    const token = {};
    const unstack = pushModal(token);
    const list = () => Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []);
    list()[0]?.focus({ preventScroll: true });
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!listRef.current?.contains(t) && !triggerRef.current?.contains(t)) closeRef.current(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (!isTopModal(token)) return;
      if (e.key === 'Escape' || e.key === 'Tab') {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
        }
        closeRef.current(e.key === 'Escape');
        return;
      }
      const items = list();
      const i = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: items.length - 1 }[e.key];
      if (next === undefined || !items.length) return;
      e.preventDefault();
      items[(next + items.length) % items.length].focus();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      unstack();
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, sheet]);

  // Focus the trigger before the action runs, so a dialog the action opens returns focus there.
  const pick = (item: MenuItem) => () => {
    close();
    item.onSelect();
  };

  const rows = items.map((item, i) => (
    <div key={i} className={styles.slot}>
      {item.separator && i > 0 && <div className={styles.sep} role="separator" />}
      <button
        type="button"
        role="menuitem"
        className={cn(styles.item, item.destructive && styles.destructive)}
        disabled={item.disabled}
        title={item.title}
        onClick={pick(item)}
        {...item.attrs}
      >
        {item.icon && <span className={styles.icon} aria-hidden="true">{item.icon}</span>}
        <span className={styles.label}>{item.label}</span>
        {item.hint && <span className={styles.hint}>{item.hint}</span>}
      </button>
    </div>
  ));

  const body = sheet ? (
    <Modal open onClose={() => close()} title={label} size="sm" footer={<button type="button" className="btn full" onClick={() => close()}>{t('common.cancel')}</button>}>
      <div role="menu" aria-label={label} className={styles.sheetList}>{rows}</div>
    </Modal>
  ) : (
    <div
      ref={listRef}
      role="menu"
      id={id}
      aria-label={label}
      className={cn('material', styles.menu, at ? styles.atPoint : styles[align])}
      data-mat="regular"
      style={at ? ({ '--x': `${at.x}px`, '--y': `${at.y}px` } as CSSProperties) : undefined}
    >
      {rows}
    </div>
  );

  if (at) return open ? createPortal(body, document.body) : null;
  return (
    <div className={cn(styles.wrap, className)}>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClassName}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open && !sheet ? id : undefined}
        onClick={() => {
          if (open) return close(false);
          setSheet(isPhone());
          setOpen(true);
        }}
      >
        {trigger}
      </button>
      {open && body}
    </div>
  );
}
