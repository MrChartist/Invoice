import { useRef, useState, type Ref, type SelectHTMLAttributes } from 'react';
import { nameOf, Popup, preloadPopup, setRef } from './pickers/shell';
import type { PopupSpec } from './pickers/types';

export interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  ref?: Ref<HTMLSelectElement>;
}

/** Set a native select's value and fire the events a user pick fires, so React's `onChange` runs as before. */
function pickNative(select: HTMLSelectElement, value: string) {
  if (select.value === value) return;
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(select, value);
  select.dispatchEvent(new Event('input', { bubbles: true }));
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * iOS pop-up button (docs/theme/IOS-UI.md, Pickers). The real `<select>` stays in the page (its value, `name`, `id`,
 * labels, `data-*`, `onChange` and form behaviour are untouched, and keyboard letters still pick natively); a click,
 * a tap, Space or Alt+Down opens the app's list instead of the browser's: a popover from 600px, a bottom sheet
 * on phones, the current value checkmarked, a search box above 8 options, groups from `<optgroup>`. A `multiple` or
 * `size` list stays a plain native list.
 */
export function SelectField({ ref, ...props }: SelectFieldProps) {
  const el = useRef<HTMLSelectElement | null>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const [open, setOpen] = useState<{ focus: boolean; select: HTMLSelectElement; label: string } | null>(null);
  const plain = props.multiple || (props.size ?? 0) > 1;
  const show = () => {
    const s = el.current;
    if (!s || s.disabled || plain) return;
    s.focus({ preventScroll: true });
    setOpen({ focus: true, select: s, label: nameOf(s, '') });
  };
  const spec: PopupSpec | null = open
    ? {
        kind: 'list',
        anchor: open.select,
        select: open.select,
        label: open.label,
        focus: open.focus,
        onPick: (v) => pickNative(open.select, v),
        onClose: (refocus) => {
          setOpen(null);
          if (refocus) open.select.focus({ preventScroll: true });
        },
      }
    : null;
  if (plain) return <select ref={ref} {...props} />;
  return (
    <>
      <select
        {...props}
        ref={(n) => {
          el.current = n;
          setRef(ref, n);
        }}
        aria-haspopup="listbox"
        aria-expanded={open ? true : undefined}
        onFocus={(e) => {
          preloadPopup();
          props.onFocus?.(e);
        }}
        onMouseDown={(e) => {
          props.onMouseDown?.(e);
          if (e.defaultPrevented || e.button !== 0) return;
          e.preventDefault();
          if (open) setOpen(null);
          else show();
        }}
        onTouchStart={(e) => {
          props.onTouchStart?.(e);
          const t = e.touches[0];
          touch.current = t ? { x: t.clientX, y: t.clientY } : null;
        }}
        onTouchEnd={(e) => {
          props.onTouchEnd?.(e);
          const t0 = touch.current;
          const t = e.changedTouches[0];
          touch.current = null;
          if (!t0 || !t || Math.hypot(t.clientX - t0.x, t.clientY - t0.y) > 10) return;
          // A tap: keep the browser's own picker shut and open the sheet.
          e.preventDefault();
          show();
        }}
        onKeyDown={(e) => {
          props.onKeyDown?.(e);
          if (e.defaultPrevented) return;
          if (e.key === ' ' || (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp'))) {
            e.preventDefault();
            show();
          }
        }}
      />
      <Popup spec={spec} />
    </>
  );
}
