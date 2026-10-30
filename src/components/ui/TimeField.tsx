import { useRef, useState, type InputHTMLAttributes, type Ref } from 'react';
import { useT } from '../../i18n';
import { parseTimeInput } from '../../lib/date-input';
import { change, hour12, nameOf, Popup, preloadPopup, setRef, showTime } from './pickers/shell';
import type { PickerChange, PopupSpec } from './pickers/types';

export interface TimeFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'defaultValue' | 'onChange' | 'type'> {
  /** `HH:MM` (24h), '' when empty. */
  value: string | null | undefined;
  onChange?: (e: PickerChange) => void;
  ref?: Ref<HTMLInputElement>;
}

/**
 * Time field (docs/theme/IOS-UI.md, Pickers): shows "9:30 am" (12h where the language writes am / pm), accepts typed
 * `9:30`, `930`, `9.30 pm`, `21:30`, and opens hour / minute wheels on a click, a tap, or Alt+Down.
 */
export function TimeField({ value, onChange, ref, ...rest }: TimeFieldProps) {
  useT();
  const el = useRef<HTMLInputElement | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [open, setOpen] = useState<{ focus: boolean; anchor: HTMLElement; label: string } | null>(null);
  const show = (focus: boolean) => {
    const a = el.current;
    if (a) setOpen({ focus, anchor: a, label: nameOf(a, '') });
  };
  const hm = (value ?? '').slice(0, 5);
  const shown = showTime(hm);
  const locked = rest.disabled || rest.readOnly;
  const emit = (v: string) => {
    if (v !== hm) onChange?.(change(v, el.current));
  };
  const commit = (text: string | null) => {
    if (text === null || text === shown) return;
    if (!text.trim()) return emit('');
    const v = parseTimeInput(text);
    if (v) emit(v);
  };
  const spec: PopupSpec | null = open
    ? {
        kind: 'time',
        anchor: open.anchor,
        label: open.label,
        focus: open.focus,
        value: hm,
        h12: hour12(),
        clearable: !rest.required,
        onPick: (v) => {
          setDraft(null);
          emit(v);
        },
        onClose: (refocus) => {
          setOpen(null);
          if (refocus) el.current?.focus({ preventScroll: true });
        },
      }
    : null;
  return (
    <>
      <input
        placeholder="HH:MM"
        autoComplete="off"
        spellCheck={false}
        {...rest}
        ref={(n) => {
          el.current = n;
          setRef(ref, n);
        }}
        type="text"
        data-time-field=""
        aria-haspopup="dialog"
        aria-expanded={open ? true : undefined}
        value={draft ?? shown}
        onChange={(e) => {
          const text = e.target.value;
          setDraft(text);
          if (!text.trim()) emit('');
          else if (/^\s*\d{2}:\d{2}\s*$/.test(text)) {
            const v = parseTimeInput(text);
            if (v) emit(v);
          }
        }}
        onFocus={(e) => {
          preloadPopup();
          setDraft(shown);
          const t = e.currentTarget;
          requestAnimationFrame(() => document.activeElement === t && t.select());
          rest.onFocus?.(e);
        }}
        onBlur={(e) => {
          commit(draft);
          setDraft(null);
          rest.onBlur?.(e);
        }}
        onPointerDown={(e) => {
          rest.onPointerDown?.(e);
          if (e.button !== 0 || locked) return;
          if (e.pointerType === 'touch') {
            e.preventDefault();
            show(true);
          } else show(false);
        }}
        onKeyDown={(e) => {
          rest.onKeyDown?.(e);
          if (e.defaultPrevented || locked) return;
          if ((e.altKey && e.key === 'ArrowDown') || (open && e.key === 'ArrowDown')) {
            e.preventDefault();
            commit(draft);
            setOpen(null);
            requestAnimationFrame(() => show(true));
          } else if (e.key === 'Enter') {
            commit(draft);
            setDraft(null);
          }
        }}
      />
      <Popup spec={spec} />
    </>
  );
}
