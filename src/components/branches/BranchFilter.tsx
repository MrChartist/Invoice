/**
 * Branch filter for reports and lists (WP-9): All branches / one branch / No branch. Renders nothing
 * until a branch exists, so single-location users never see it. Values follow `matchesBranch`
 * ('' = all, `UNASSIGNED` = rows without a branch).
 */
import { useMemo } from 'react';
import { UNASSIGNED, loadBranches } from '../../lib/branch';
import { useT } from '../../i18n';
import { branchT } from '../../i18n/areas/branch-books';
import controls from '../../styles/controls.module.css';

export function BranchFilter({ value, onChange, className, testId }: { value: string; onChange: (v: string) => void; className?: string; testId?: string }) {
  useT();
  const branches = useMemo(() => {
    try {
      return loadBranches();
    } catch {
      return [];
    }
  }, []);
  if (!branches.length) return null;
  return (
    <select className={className ?? controls.select} aria-label={branchT('filterLabel')} value={value} onChange={(e) => onChange(e.target.value)} data-testid={testId}>
      <option value="">{branchT('allBranches')}</option>
      {branches.map((b) => (
        <option key={b.id} value={b.id}>{b.code ? `${b.code} · ${b.name}` : b.name}</option>
      ))}
      <option value={UNASSIGNED}>{branchT('noBranch')}</option>
    </select>
  );
}
