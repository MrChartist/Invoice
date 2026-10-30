import { useRef, type ReactNode } from 'react';
import { allGroups, type UserGroup } from '../../lib/ledger';
import { useT } from '../../i18n';
import { mastersT } from '../../i18n/areas/masters';
import { useMasterKeys, type MasterKeyHandlers } from './useMasterKeys';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './masters.module.css';
import { SelectField } from '../ui/SelectField';

/** Framed Tally-like screen with the key bindings wired to its body. */
export function MasterFrame({
  title,
  keys,
  actions,
  children,
}: {
  title: string;
  keys: MasterKeyHandlers;
  actions?: ReactNode;
  children: ReactNode;
}) {
  useT();
  const ref = useRef<HTMLDivElement>(null);
  useMasterKeys(ref, keys);
  return (
    <section className={surface.card} aria-label={title}>
      <div className={surface.cardHead}>
        <div className={styles.head} style={{ width: '100%' }}>
          <h2 className={styles.title}>{title}</h2>
          <span className={styles.keys}>{mastersT('keysHint')}</span>
        </div>
      </div>
      <div className={surface.cardBody} ref={ref}>
        <div className={styles.screen}>
          {children}
          {actions && <div className={styles.actions}>{actions}</div>}
        </div>
      </div>
    </section>
  );
}

/** Group picker: primaries and user groups, indented by depth. */
export function GroupSelect({
  id,
  value,
  onChange,
  userGroups,
  exclude,
  only,
  disabled,
  label,
}: {
  id: string;
  value: string;
  onChange: (id: string) => void;
  userGroups: readonly UserGroup[];
  exclude?: ReadonlySet<string>;
  /** Limit to groups under these primaries. */
  only?: ReadonlySet<string>;
  disabled?: boolean;
  label?: string;
}) {
  const list = allGroups(userGroups).filter((g) => !exclude?.has(g.id) && (!only || only.has(g.primary ?? g.id)));
  return (
    <SelectField id={id} className={controls.select} value={value} disabled={disabled} aria-label={label} data-create="group" onChange={(e) => onChange(e.target.value)}>
      {list.map((g) => (
        <option key={g.id} value={g.id}>
          {'  '.repeat(g.depth ?? 0)}
          {g.label}
          {g.system ? ` (${mastersT('primary')})` : ''}
        </option>
      ))}
    </SelectField>
  );
}

/** Rupee amount + Dr / Cr picker. `value` is debit-positive rupees text handling left to the caller. */
export function DrCrAmount({
  id,
  amount,
  side,
  onAmount,
  onSide,
  disabled,
  label,
}: {
  id: string;
  amount: string;
  side: 'Dr' | 'Cr';
  onAmount: (v: string) => void;
  onSide: (v: 'Dr' | 'Cr') => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <div className={styles.inline}>
      <input
        id={id}
        className={`${controls.input} ${styles.amount}`}
        inputMode="decimal"
        value={amount}
        disabled={disabled}
        placeholder="0.00"
        onChange={(e) => onAmount(e.target.value)}
      />
      <SelectField className={`${controls.select} ${styles.drcr}`} aria-label={`${label} Dr / Cr`} value={side} disabled={disabled} onChange={(e) => onSide(e.target.value === 'Cr' ? 'Cr' : 'Dr')}>
        <option value="Dr">{mastersT('dr')}</option>
        <option value="Cr">{mastersT('cr')}</option>
      </SelectField>
    </div>
  );
}

