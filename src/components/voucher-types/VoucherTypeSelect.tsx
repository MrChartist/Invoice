/**
 * Voucher-type picker (P1-13) for the invoice editor and the voucher editors. Lazy: the hosts render it
 * only when at least one user type exists for the base (or the record already carries one), so the
 * default single-series user never downloads it. Choosing "Default" keeps the built-in Indian-FY series.
 */
import { useMemo } from 'react';
import { useT } from '../../i18n';
import { vtT } from '../../i18n/areas/voucher-types';
import { BUILT_IN_PREFIX, loadVoucherTypes, typesForBase, type VoucherBase, type VoucherType } from '../../lib/voucher-types';
import controls from '../../styles/controls.module.css';
import { SelectField } from '../ui/SelectField';

export interface VoucherTypeSelectProps {
  id: string;
  base: VoucherBase;
  value?: string;
  onChange: (type: VoucherType | undefined) => void;
  disabled?: boolean;
  /** Bare select (the host renders its own label). */
  compact?: boolean;
}

export function VoucherTypeSelect({ id, base, value, onChange, disabled, compact }: VoucherTypeSelectProps) {
  useT();
  const types = useMemo(() => {
    try {
      return typesForBase(base, loadVoucherTypes(), value);
    } catch {
      return [];
    }
  }, [base, value]);
  if (!types.length) return null;
  const select = (
    <SelectField
      id={id}
      className={controls.select}
      value={value ?? ''}
      disabled={disabled}
      onChange={(e) => onChange(types.find((t) => t.id === e.target.value))}
      data-testid={`${id}-select`}
      aria-label={compact ? vtT('voucherType') : undefined}
    >
      <option value="">{vtT('defaultType', { prefix: BUILT_IN_PREFIX[base] })}</option>
      {types.map((t) => (
        <option key={t.id} value={t.id}>{t.name}</option>
      ))}
    </SelectField>
  );
  if (compact) return select;
  return (
    <div className={controls.field}>
      <label className={controls.label} htmlFor={id}>{vtT('voucherType')}</label>
      {select}
    </div>
  );
}

export default VoucherTypeSelect;
