/**
 * Branch / location picker for document, bill and voucher forms (WP-9 wiring). Renders nothing until
 * at least one branch exists, so single-location users never see it. Empty value = automatic
 * (the branch is inferred from the sender profile / GSTIN or the bill's state, `branch.ts`).
 */
import { useMemo } from 'react';
import { loadBranches } from '../../lib/branch';
import { useT } from '../../i18n';
import { wireT } from '../../i18n/areas/wiring';
import controls from '../../styles/controls.module.css';
import { SelectField } from '../ui/SelectField';

export function BranchSelect({ id, value, onChange }: { id: string; value?: string; onChange: (branchId: string | undefined) => void }) {
  useT();
  const branches = useMemo(() => {
    try {
      return loadBranches().filter((b) => !b.inactive || b.id === value);
    } catch {
      return [];
    }
  }, [value]);
  if (!branches.length) return null;
  return (
    <div className={controls.field}>
      <label className={controls.label} htmlFor={id}>{wireT('branch')}</label>
      <SelectField id={id} className={controls.select} value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)}>
        <option value="">{wireT('branchAuto')}</option>
        {branches.map((b) => (
          <option key={b.id} value={b.id}>{b.code ? `${b.code} · ${b.name}` : b.name}</option>
        ))}
      </SelectField>
    </div>
  );
}
