/**
 * R19-B3 purchase-bill row (lazy, packs `logistics` / `customs` / `courier` / `warehouse`): the job a supplier bill is
 * costed to (`PurchaseRecord.lg.job_id`; the other `lg` fields — C's disbursement marks — are kept). The one job picker
 * of the bill form: C / D reuse it. Lists the open jobs, newest first (and the bill's own job).
 */
import { useMemo } from 'react';
import { useT } from '../../i18n';
import { lgT } from '../../i18n/areas/logistics-r19a';
import { getTable } from '../../lib/storage';
import { LG_TABLES } from '../../lib/logistics/lg-shared';
import type { LgJob } from '../../types/logistics-r19';
import type { PurchaseRecord } from '../../types/purchases';
import controls from '../../styles/controls.module.css';
import { SelectField } from '../ui/SelectField';

type Tag = PurchaseRecord['lg'];

export default function JobPick({ value, onChange }: { value: Tag; onChange: (v: Tag) => void }) {
  useT();
  const jobs = useMemo(() => getTable<LgJob>(LG_TABLES.jobs).filter((j) => j?.id && (j.status !== 'cancelled' && j.status !== 'closed') || j.id === value?.job_id).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 300), [value?.job_id]);
  if (!jobs.length && !value) return null;
  return (
    <label className={controls.field}><span className={controls.label}>{lgT('job')}</span>
      <SelectField className={controls.select} value={value?.job_id ?? ''} onChange={(e) => onChange(e.target.value ? { ...value, job_id: e.target.value } : undefined)} data-lg-bill-job-pick>
        <option value="">-</option>
        {jobs.map((j) => <option key={j.id} value={j.id}>{j.number} · {j.origin} → {j.destination}</option>)}
      </SelectField>
    </label>
  );
}
