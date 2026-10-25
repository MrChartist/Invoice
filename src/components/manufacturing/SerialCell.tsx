import { useState } from 'react';
import { num } from '../../lib/invoice-calc';
import { parseSerials } from '../../lib/stock-tracking';
import { s7T } from '../../i18n/areas/inventory-7s';
import controls from '../../styles/controls.module.css';
import styles from './manufacturing.module.css';

/**
 * 7S: serial numbers of one voucher / job-work line (one per unit). Outgoing lines can fill the first serials in
 * stock in the line's godown (`pool`); incoming lines are typed or scanned (one per line, or comma-separated).
 */
export function SerialCell({ serials, qty, label, pool, onChange, disabled }: {
  serials?: string[];
  qty: number;
  label: string;
  /** Serials in stock where the line takes from (outgoing lines only). */
  pool?: () => string[];
  onChange: (serials: string[] | undefined) => void;
  disabled?: boolean;
}) {
  const [text, setText] = useState((serials ?? []).join('\n'));
  const [empty, setEmpty] = useState(false);
  const have = (serials ?? []).length;
  const want = Math.max(Math.round(num(qty)), 0);
  const set = (value: string) => {
    setText(value);
    const list = parseSerials(value);
    onChange(list.length ? list : undefined);
  };
  return (
    <div className={styles.serialCell}>
      <textarea
        className={controls.textarea} rows={Math.min(Math.max(want, 1), 4)} disabled={disabled} aria-label={label}
        placeholder={s7T('serialsPh')} value={text} onChange={(e) => set(e.target.value)}
      />
      <span className={have === want ? styles.muted : styles.warnText}>{s7T('serialsCount', { have, want })}</span>
      {pool && !disabled && (
        <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => {
          const list = pool().filter((s) => !(serials ?? []).includes(s));
          const next = [...(serials ?? []), ...list].slice(0, want);
          setEmpty(list.length === 0);
          set(next.join('\n'));
        }}>{s7T('fillSerials')}</button>
      )}
      {empty && <span className={styles.warnText} role="status">{s7T('noSerialsInStock')}</span>}
    </div>
  );
}
