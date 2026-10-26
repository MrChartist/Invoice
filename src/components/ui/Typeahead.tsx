import { useId, useMemo, useState, type InputHTMLAttributes, type KeyboardEvent } from 'react';
import { autoHighlight, type Suggestion } from '../../lib/suggest';
import styles from './Typeahead.module.css';

export interface TypeaheadProps<T> extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'onSelect'> {
  value: string;
  onChange: (value: string) => void;
  /** Ranked suggestions for the current text (called on each render while open). */
  getSuggestions: (query: string) => Suggestion<T>[];
  onPick: (row: T) => void;
}

/** Last ranking per suggestion source: onChange (auto-highlight) and the render rank the same text once (PERF-2). */
const lastRank = new WeakMap<object, { q: string; list: unknown[] }>();
function rank<T>(fn: (query: string) => Suggestion<T>[], q: string): Suggestion<T>[] {
  const hit = lastRank.get(fn);
  if (hit && hit.q === q) return hit.list as Suggestion<T>[];
  const list = fn(q);
  lastRank.set(fn, { q, list });
  return list;
}

/**
 * Text input with an inline suggestion list (ARIA combobox). ↑/↓ move, Enter picks,
 * Esc closes. Keys are only swallowed while the list is open, so the editor's own
 * shortcuts (Enter for a new line, Esc to leave) keep working otherwise.
 */
export function Typeahead<T>({ value, onChange, getSuggestions, onPick, onKeyDown, onBlur, onFocus, ...input }: TypeaheadProps<T>) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const list = useMemo(() => (open ? rank(getSuggestions, value) : []), [open, value, getSuggestions]);
  const shown = open && list.length > 0;

  const pick = (s: Suggestion<T>) => {
    onPick(s.row);
    setOpen(false);
    setActive(-1);
  };

  const keyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (shown) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        const n = list.length;
        setActive((i) => (e.key === 'ArrowDown' ? (i + 1) % n : (i <= 0 ? n - 1 : i - 1)));
        return;
      }
      if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && active >= 0 && list[active]) {
        e.preventDefault();
        e.stopPropagation();
        pick(list[active]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        return;
      }
    }
    onKeyDown?.(e);
  };

  return (
    <div className={styles.wrap}>
      <input
        {...input}
        value={value}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={shown}
        aria-controls={shown ? `${id}-list` : undefined}
        aria-activedescendant={shown && active >= 0 ? `${id}-opt-${active}` : undefined}
        autoComplete="off"
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(autoHighlight(e.target.value, rank(getSuggestions, e.target.value)));
        }}
        onFocus={(e) => {
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setOpen(false);
          onBlur?.(e);
        }}
        onKeyDown={keyDown}
      />
      {shown && (
        <ul className={styles.list} role="listbox" id={`${id}-list`}>
          {list.map((s, i) => (
            <li
              key={i}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={i === active}
              className={styles.option}
              // mousedown, not click: the input's blur would close the list first.
              onMouseDown={(e) => {
                e.preventDefault();
                pick(s);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <span className={styles.label}>{s.label}</span>
              {s.sub && <span className={styles.sub}>{s.sub}</span>}
            </li>
          ))}
          <li className={styles.hint} aria-hidden="true">↑↓ to choose · Enter to fill · Esc to close</li>
        </ul>
      )}
    </div>
  );
}
