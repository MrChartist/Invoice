/** R3-B1 helpers shared by the timer and the time-entry form: rate-card masters, pickers, source label. */
import { costCentreLabel } from '../../lib/cost-centres';
import { pickableWorkTypes, type RateSource, type WorkType } from '../../lib/rate-cards';
import type { RateMasters } from './rate-masters';
import controls from '../../styles/controls.module.css';
import styles from './service-r3.module.css';
import { svcT } from '../../i18n/areas/service-r3';

export function RateSourceTag({ source }: { source: RateSource | 'manual' }) {
  return <span className={styles.source} data-rate-source={source}>{svcT(`src.${source}` as const)}</span>;
}

export function WorkTypeSelect({ id, workTypes, value, onChange }: { id: string; workTypes: readonly WorkType[]; value: string; onChange: (id: string) => void }) {
  const list = pickableWorkTypes(workTypes, value);
  if (!list.length) return null;
  return (
    <div className={controls.field}>
      <label className={controls.label} htmlFor={id}>{svcT('workType')}</label>
      <select id={id} className={controls.select} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{svcT('noWorkType')}</option>
        {list.map((w) => <option key={w.id} value={w.id}>{w.name}{w.rate ? ` · ₹${w.rate}` : ''}{w.inactive ? ' (inactive)' : ''}</option>)}
      </select>
    </div>
  );
}

/** Tasks of active projects (optionally of the client), grouped by project. */
export function TaskSelect({ id, masters, clientId, value, onChange }: { id: string; masters: RateMasters; clientId?: string; value: string; onChange: (taskId: string) => void }) {
  const projects = masters.centres.filter((c) => c.kind === 'project' && (c.active || masters.tasks.some((t) => t.id === value && t.cost_centre_id === c.id)) && (!clientId || !c.client_id || c.client_id === clientId));
  const groups = projects.map((p) => ({ p, tasks: masters.tasks.filter((t) => t.cost_centre_id === p.id) })).filter((g) => g.tasks.length);
  if (!groups.length) return null;
  return (
    <div className={controls.field}>
      <label className={controls.label} htmlFor={id}>{svcT('task')}</label>
      <select id={id} className={controls.select} value={value} onChange={(e) => onChange(e.target.value)} title={svcT('taskPickHint')}>
        <option value="">{svcT('noTask')}</option>
        {groups.map((g) => (
          <optgroup key={g.p.id} label={costCentreLabel(g.p, masters.centres)}>
            {g.tasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
          </optgroup>
        ))}
      </select>
    </div>
  );
}
