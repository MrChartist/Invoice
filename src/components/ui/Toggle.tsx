import type { InputHTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/utils';
import styles from './Toggle.module.css';

export interface ToggleProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'role' | 'onChange' | 'checked'> {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Visible label: the toggle then sits trailing in a row with it (the whole row is the hit area). */
  label?: ReactNode;
  /** A detail line under the label. */
  hint?: ReactNode;
  /** Class of the row (with a label), e.g. `groups.row` (styles/groups.module.css) inside a grouped list. */
  rowClassName?: string;
}

/**
 * iOS switch (IOS-UI.md 2.3) for a setting that applies at once: a checkbox with `role="switch"`, so a screen reader
 * says "on / off" and `getByRole('switch')` / `getByLabel()` find it. Checkboxes stay for multi-select in lists.
 */
export function Toggle({ checked, onChange, label, hint, rowClassName, className, ...rest }: ToggleProps) {
  const input = (
    <input
      {...rest}
      type="checkbox"
      role="switch"
      checked={checked}
      aria-checked={checked}
      className={cn(styles.toggle, className)}
      onChange={(e) => onChange(e.target.checked)}
    />
  );
  if (label === undefined) return input;
  return (
    <label className={cn(styles.toggleRow, rowClassName)}>
      <span className={styles.toggleText}>
        <span>{label}</span>
        {hint ? <span className={styles.hint}>{hint}</span> : null}
      </span>
      {input}
    </label>
  );
}
