import { useRef, useState, type InputHTMLAttributes, type KeyboardEvent, type PointerEvent, type Ref } from 'react';
import { useT } from '../../i18n';
import { isWholeDate, parseDateInput, parseMonthInput } from '../../lib/date-input';
import { change, nameOf, preloadPopup, setRef } from './pickers/shell';
import { showDay, showMonth } from './pickers/format';
import { Popup } from './pickers/Popup';
import type { DateChip, PickerChange, PopupSpec, RangeSpec } from './pickers/types';

export type { DateChip, PickerChange, RangePreset } from './pickers/types';

export interface DateFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'defaultValue' | 'onChange' | 'type' | 'min' | 'max'> {
  /** Bare `YYYY-MM-DD` (`YYYY-MM` with `mode="month"`), '' when empty. Left out: the field keeps its own value. */
  value?: string | null;
  /** `e.target.value` is the new bare day ('' when cleared), like a native date input. */
  onChange?: (e: PickerChange) => void;
  min?: string;
  max?: string;
  mode?: 'date' | 'month';
  /** Quick chips besides Today / Yesterday (due dates: `['+7', '+15', '+30', '+45']`, `'monthEnd'`, `'fyEnd'`). */
  chips?: DateChip[];
  /** Day the relative chips count from (the invoice date for a due date). */
  chipBase?: string;
  /** Days that cannot be picked besides min / max. */
  isDisabled?: (iso: string) => boolean;
  /** One of a From / To pair: the popup becomes a range calendar with presets. */
  range?: RangeSpec;
  ref?: Ref<HTMLInputElement>;
}

/**
 * Date field (docs/theme/IOS-UI.md, Pickers): shows "30 Oct 2026", accepts typed Indian dates (`30/10/2026`,
 * `30-10-26`, `30 oct`, `today`, `+7`, ISO), and opens the inline calendar on a click, a tap, or Alt+Down: a popover
 * from 600px, a bottom sheet on phones. The value stays a bare local day; `onChange` gets `e.target.value` as before.
 */
export function DateField({ value, onChange, min, max, mode = 'date', chips, chipBase, isDisabled, range, ref, ...rest }: DateFieldProps) {
  useT();
  const el = useRef<HTMLInputElement | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [open, setOpen] = useState<{ focus: boolean; anchor: HTMLElement; label: string } | null>(null);
  const [own, setOwn] = useState('');
  const iso = value === undefined ? own : (value ?? '');
  const month = mode === 'month';
  const shown = month ? showMonth(iso) : showDay(iso);
  const parse = (s: string) => (month ? parseMonthInput(s, { min, max }) : parseDateInput(s, { min, max }));
  const locked = rest.disabled || rest.readOnly;

  const emit = (v: string) => {
    if (v === iso) return;
    setOwn(v);
    onChange?.(change(v, el.current));
  };
  const commit = (text: string | null) => {
    if (text === null || text === shown) return;
    if (!text.trim()) return emit('');
    const v = parse(text);
    if (v) emit(v);
  };
  const show = (focus: boolean) => {
    const a = el.current;
    if (!locked && a) setOpen({ focus, anchor: a, label: nameOf(a, '') });
  };

  const spec: PopupSpec | null = open
    ? {
        kind: month ? 'month' : 'date',
        anchor: open.anchor,
        label: open.label,
        focus: open.focus,
        value: iso,
        min,
        max,
        chips,
        chipBase,
        isDisabled,
        range,
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
        placeholder={month ? 'MM/YYYY' : 'DD/MM/YYYY'}
        autoComplete="off"
        spellCheck={false}
        {...rest}
        ref={(n) => {
          el.current = n;
          setRef(ref, n);
        }}
        type="text"
        data-date-field={mode}
        aria-haspopup="dialog"
        aria-expanded={open ? true : undefined}
        value={draft ?? shown}
        onChange={(e) => {
          const text = e.target.value;
          setDraft(text);
          if (!text.trim()) emit('');
          else if (month ? /^\s*\d{4}-\d{2}\s*$/.test(text) : isWholeDate(text)) {
            const v = parse(text);
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
        onPointerDown={(e: PointerEvent<HTMLInputElement>) => {
          rest.onPointerDown?.(e);
          if (e.button !== 0 || locked) return;
          // A touch opens the sheet without raising the keyboard; a mouse keeps the caret for typing.
          if (e.pointerType === 'touch') {
            e.preventDefault();
            show(true);
          } else show(false);
        }}
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
          rest.onKeyDown?.(e);
          if (e.defaultPrevented) return;
          if ((e.altKey && e.key === 'ArrowDown') || (open && e.key === 'ArrowDown')) {
            e.preventDefault();
            commit(draft);
            setOpen(null);
            requestAnimationFrame(() => show(true));
          } else if (e.key === 'Enter') {
            commit(draft);
            setDraft(null);
          } else if (e.key === 'Escape' && draft !== null && draft !== shown) {
            e.stopPropagation();
            setDraft(shown);
          }
        }}
      />
      <Popup spec={spec} />
    </>
  );
}

export interface DateRangeFieldProps {
  from: string;
  to: string;
  onChange: (range: { from: string; to: string }) => void;
  /** Visible labels of the two ends (defaults: none, then pass aria labels). */
  fromLabel?: string;
  toLabel?: string;
  fromId?: string;
  toId?: string;
  min?: string;
  max?: string;
  presets?: RangeSpec['presets'];
  className?: string;
  inputClassName?: string;
  /** data-* hooks on each end: `data-range-end="from" | "to"`. */
  'aria-label'?: string;
}

/**
 * From / To in one control: two typed day fields sharing one range calendar (two months from 600px, one on phones)
 * with presets (This month, Last month, This quarter, This FY, Last FY, Last 7 / 30 days).
 */
export function DateRangeField({ from, to, onChange, fromLabel, toLabel, fromId, toId, min, max, presets, className, inputClassName, 'aria-label': aria }: DateRangeFieldProps) {
  const onRange = (f: string, t: string) => onChange({ from: f, to: t });
  const end = (edge: 'from' | 'to') => (
    <DateField
      id={edge === 'from' ? fromId : toId}
      className={inputClassName}
      aria-label={(edge === 'from' ? fromLabel : toLabel) ?? edge}
      data-range-end={edge}
      value={edge === 'from' ? from : to}
      min={min}
      max={max}
      onChange={(e) => onChange(edge === 'from' ? { from: e.target.value, to } : { from, to: e.target.value })}
      range={{ from, to, onRange, edge, presets }}
    />
  );
  return (
    <span role="group" aria-label={aria} className={className} data-date-range>
      {end('from')}
      {end('to')}
    </span>
  );
}
