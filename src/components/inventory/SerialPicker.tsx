import { useId, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { serialKey } from '../../lib/stock-tracking';
import { useT } from '../../i18n';
import { invT } from '../../i18n/areas/inventory';
import controls from '../../styles/controls.module.css';
import styles from './inventory.module.css';

export interface SerialPickerProps {
  label: string;
  /** Serials that may be picked (in stock, or sold for a return). */
  options: string[];
  value: string[];
  onChange: (next: string[]) => void;
  /** Exact number wanted (shown as "2 of 3"); omit for free count. */
  want?: number;
  disabled?: boolean;
}

/**
 * Pick serial / IMEI numbers from a known list: scan or type one and press Enter, or tick it in
 * the list. Only listed serials can be picked, so a sold or unknown number never gets on a line.
 */
export function SerialPicker({ label, options, value, onChange, want, disabled }: SerialPickerProps) {
  useT(); // re-render on a language switch (5.4)
  const [query, setQuery] = useState('');
  const [miss, setMiss] = useState('');
  const uid = useId();
  const picked = useMemo(() => new Set(value.map(serialKey)), [value]);
  const q = serialKey(query);
  const shown = useMemo(() => {
    const list = q ? options.filter((s) => serialKey(s).includes(q)) : options;
    return list.slice(0, 200);
  }, [options, q]);

  const toggle = (s: string) => {
    setMiss('');
    if (picked.has(serialKey(s))) onChange(value.filter((v) => serialKey(v) !== serialKey(s)));
    else onChange([...value, s]);
  };

  const addTyped = () => {
    if (!q) return;
    const hit = options.find((s) => serialKey(s) === q);
    if (!hit) {
      setMiss(invT('notAvailable', { serial: query.trim() }));
      return;
    }
    if (!picked.has(q)) onChange([...value, hit]);
    setQuery('');
    setMiss('');
  };

  return (
    <div className={styles.serialBox}>
      <div className={styles.serialHead}>
        <label className={controls.label} htmlFor={`${uid}-scan`}>{label}</label>
        <span className={want !== undefined && value.length !== want ? styles.out : styles.muted}>
          {want !== undefined ? invT('nOfWant', { n: value.length, want }) : invT('nPicked', { n: value.length })}
        </span>
      </div>
      {value.length > 0 && (
        <div className={styles.serialChips}>
          {value.map((s) => (
            <span key={s} className={styles.serialChip}>
              {s}
              <button type="button" onClick={() => toggle(s)} aria-label={invT('removeSerial', { serial: s })} disabled={disabled}>
                <X size={12} aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        id={`${uid}-scan`}
        className={controls.input}
        value={query}
        disabled={disabled}
        placeholder={options.length ? invT('pickerPh') : invT('noSerials')}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            addTyped();
          }
        }}
        autoComplete="off"
      />
      {miss && <span className={controls.error} role="alert">{miss}</span>}
      {shown.length > 0 && (
        <div className={styles.serialList} role="group" aria-label={invT('availableSerials', { label })}>
          {shown.map((s) => (
            <label key={s} className={controls.check}>
              <input type="checkbox" checked={picked.has(serialKey(s))} onChange={() => toggle(s)} disabled={disabled} />
              <span className={styles.mono}>{s}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
