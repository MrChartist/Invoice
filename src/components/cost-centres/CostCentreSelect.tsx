import { COST_CENTRE_KIND_LABELS, costCentreLabel, pickableCentres, type CostCentre } from '../../lib/cost-centres';
import controls from '../../styles/controls.module.css';

interface Props {
  id: string;
  value: string | undefined;
  onChange: (id: string | undefined) => void;
  centres: readonly CostCentre[];
  /** Field label; omitted for a bare select (then `ariaLabel` names it). */
  label?: string;
  ariaLabel?: string;
  /** Text of the empty option. */
  emptyLabel?: string;
  className?: string;
  hint?: string;
}

/**
 * Cost centre / project picker (6.16). Renders nothing until at least one cost centre exists,
 * so the forms stay clean for users who never set one up.
 */
export function CostCentreSelect({ id, value, onChange, centres, label, ariaLabel, emptyLabel = 'Unallocated', className, hint }: Props) {
  if (!centres.length) return null;
  const options = pickableCentres(centres, value);
  const select = (
    <select
      id={id}
      className={className ?? controls.select}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || undefined)}
      aria-label={label ? undefined : ariaLabel ?? 'Cost centre'}
      data-testid={id}
    >
      <option value="">{emptyLabel}</option>
      {options.map((c) => (
        <option key={c.id} value={c.id}>
          {costCentreLabel(c, centres)} · {COST_CENTRE_KIND_LABELS[c.kind]}
          {c.active ? '' : ' (inactive)'}
        </option>
      ))}
    </select>
  );
  if (!label) return select;
  return (
    <div className={controls.field}>
      <label className={controls.label} htmlFor={id}>{label}</label>
      {select}
      {hint && <span className={controls.hint}>{hint}</span>}
    </div>
  );
}
