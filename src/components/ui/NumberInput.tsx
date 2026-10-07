import { useEffect, useState, type InputHTMLAttributes } from 'react';

export interface NumberInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  value: number;
  onChange: (value: number) => void;
  /** Show an empty field instead of 0 (good for optional amounts). */
  blankZero?: boolean;
}

const parse = (text: string): number => {
  const n = parseFloat(text);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Numeric text field that keeps what the user typed ("1.", "0.0") while still
 * reporting a clean number — a plain `value={n}` input fights the cursor.
 */
export function NumberInput({ value, onChange, blankZero = true, ...rest }: NumberInputProps) {
  const format = (n: number) => (blankZero && n === 0 ? '' : String(n));
  const [text, setText] = useState(format(value));

  // Re-sync only when the outside value genuinely differs from what the text means.
  useEffect(() => {
    if (parse(text) !== value) setText(format(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <input
      {...rest}
      type="text"
      inputMode="decimal"
      value={text}
      onFocus={(e) => {
        e.currentTarget.select();
        rest.onFocus?.(e);
      }}
      onChange={(e) => {
        const next = e.target.value.replace(/[^0-9.]/g, '');
        if ((next.match(/\./g) ?? []).length > 1) return;
        setText(next);
        onChange(parse(next));
      }}
      onBlur={(e) => {
        setText(format(parse(text)));
        rest.onBlur?.(e);
      }}
    />
  );
}
