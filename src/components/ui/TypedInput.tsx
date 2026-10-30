import type { InputHTMLAttributes, Ref } from 'react';
import { DateField } from './DateField';
import { TimeField } from './TimeField';
import type { PickerChange } from './pickers/types';

export interface TypedInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> {
  value?: string | number | readonly string[] | null;
  /** `e.target.value` is the typed text, or the bare day / month / time of a picker. */
  onChange?: (e: PickerChange) => void;
  ref?: Ref<HTMLInputElement>;
}

/**
 * For field renderers whose input type comes from data (`type={kind}`): a date / month / time type renders the
 * app's picker field (docs/theme/IOS-UI.md, Pickers), anything else a plain input with the same props.
 */
export function TypedInput({ type, value, min, max, ...rest }: TypedInputProps) {
  const v = value == null ? '' : String(value);
  if (type === 'date' || type === 'month') return <DateField {...rest} mode={type === 'month' ? 'month' : 'date'} value={v} min={min == null ? undefined : String(min)} max={max == null ? undefined : String(max)} />;
  if (type === 'time') return <TimeField {...rest} value={v} />;
  return <input {...rest} type={type} min={min} max={max} value={value ?? undefined} />;
}
