import { useEffect, useRef, useState, type InputHTMLAttributes } from 'react';
import { EXPRESSION_CHARS, evalExpression, isExpression } from '../../lib/calc-expr';

export interface NumberInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  value: number;
  onChange: (value: number) => void;
  /** Show an empty field instead of 0 (good for optional amounts). */
  blankZero?: boolean;
  /** Accept simple sums ("120*3+40", "1000+18%"), worked out as you type (8.25). Default on. */
  calculator?: boolean;
}

const parse = (text: string): number => {
  const n = parseFloat(text);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Numeric text field that keeps what the user typed ("1.", "0.0") while still
 * reporting a clean number — a plain `value={n}` input fights the cursor.
 *
 * Calculator (8.25): a typed sum is evaluated by a small parser (`calc-expr.ts`, no eval) and
 * reported as soon as it is complete; on blur or Enter the field shows the result. An incomplete or
 * negative result is not reported (the last good value stands) and is put back on blur.
 */
export function NumberInput({ value, onChange, blankZero = true, calculator = true, ...rest }: NumberInputProps) {
  const format = (n: number) => (blankZero && n === 0 ? '' : String(n));
  const [text, setText] = useState(format(value));
  // The last number this field reported: a different `value` prop came from outside (a "fill the rest"
  // button, a clamp in the parent) and replaces the text; our own reports never do.
  const reported = useRef(value);

  useEffect(() => {
    if (value !== reported.current) {
      reported.current = value;
      setText(format(value));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const emit = (n: number) => {
    reported.current = n;
    onChange(n);
  };

  /** Value of a sum, or null while it is incomplete / would be negative. */
  const sum = (t: string): number | null => {
    const v = evalExpression(t);
    return v !== null && v >= 0 ? v : null;
  };

  const commit = () => {
    if (calculator && isExpression(text)) {
      const v = sum(text);
      setText(format(v ?? value));
      if (v !== null && v !== reported.current) emit(v);
      return;
    }
    setText(format(parse(text)));
  };

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
        if (calculator) {
          const next = e.target.value.replace(EXPRESSION_CHARS, '');
          if (isExpression(next)) {
            setText(next);
            const v = sum(next);
            if (v !== null) emit(v);
            return;
          }
        }
        const next = e.target.value.replace(/[^0-9.]/g, '');
        if ((next.match(/\./g) ?? []).length > 1) return;
        setText(next);
        emit(parse(next));
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && calculator && isExpression(text)) commit();
        rest.onKeyDown?.(e);
      }}
      onBlur={(e) => {
        commit();
        rest.onBlur?.(e);
      }}
    />
  );
}
