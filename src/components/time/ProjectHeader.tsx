import type { Client } from '../../types/invoice';
import type { TimeEntry, TimePrefs } from '../../types/time';
import { PROJECT_STATUSES, saveCostCentre, type CostCentre, type ProjectStatus } from '../../lib/cost-centres';
import { projectBurn, type ProjectBurn, type ProjectTask } from '../../lib/projects';
import { formatMinutes } from '../../lib/timesheets';
import { cn, formatCurrency, todayInput } from '../../lib/utils';
import controls from '../../styles/controls.module.css';
import styles from './service-r3.module.css';
import { svcT } from '../../i18n/areas/service-r3';

const STATUS_LABEL: Record<ProjectStatus, () => string> = {
  active: () => svcT('statusActive'),
  on_hold: () => svcT('statusOnHold'),
  done: () => svcT('statusDone'),
};

export function Bar({ pct }: { pct: number | null }) {
  if (pct === null) return null;
  const w = Math.min(Math.max(pct, 0), 100);
  return (
    <div className={styles.bar} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn(styles.barFill, pct >= 100 ? styles.barOver : pct >= 80 ? styles.barWarn : undefined)} style={{ width: `${w}%` }} />
    </div>
  );
}

export interface ProjectDraft {
  id?: string;
  name: string;
  client_id: string;
  budget_hours: string;
  fee_budget: string;
  start: string;
  due: string;
  status: ProjectStatus;
  rate: string;
}

export const draftOf = (p?: CostCentre): ProjectDraft => ({
  id: p?.id,
  name: p?.name ?? '',
  client_id: p?.client_id ?? '',
  budget_hours: p?.budget_minutes ? String(Math.round((p.budget_minutes / 60) * 100) / 100) : '',
  fee_budget: p?.fee_budget ? String(p.fee_budget) : '',
  start: p?.start ?? '',
  due: p?.due ?? '',
  status: p?.status ?? 'active',
  rate: p?.hourly_rate ? String(p.hourly_rate) : '',
});

/** Save a project draft as a cost centre of kind 'project' (validation errors throw). */
export function saveProjectDraft(d: ProjectDraft, prev?: CostCentre): CostCentre {
  const hours = Number(d.budget_hours) || 0;
  return saveCostCentre({
    ...(prev ?? {}),
    id: d.id,
    name: d.name,
    kind: 'project',
    active: prev ? prev.active : true,
    client_id: d.client_id || undefined,
    budget_minutes: hours > 0 ? Math.round(hours * 60) : undefined,
    fee_budget: Number(d.fee_budget) > 0 ? Number(d.fee_budget) : undefined,
    start: d.start || undefined,
    due: d.due || undefined,
    status: d.status,
    hourly_rate: Number(d.rate) > 0 ? Number(d.rate) : undefined,
  });
}

export function ProjectForm({ value, clients, onChange }: { value: ProjectDraft; clients: readonly Client[]; onChange: (d: ProjectDraft) => void }) {
  const set = <K extends keyof ProjectDraft>(k: K, v: ProjectDraft[K]) => onChange({ ...value, [k]: v });
  return (
    <div className={styles.form}>
      <div className={controls.field}>
        <label className={controls.label} htmlFor="pj-name">{svcT('projectName')}</label>
        <input id="pj-name" className={controls.input} value={value.name} onChange={(e) => set('name', e.target.value)} />
      </div>
      <div className={controls.field}>
        <label className={controls.label} htmlFor="pj-client">{svcT('client')}</label>
        <select id="pj-client" className={controls.select} value={value.client_id} onChange={(e) => set('client_id', e.target.value)}>
          <option value="">{svcT('none')}</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div className={controls.field}>
        <label className={controls.label} htmlFor="pj-hours">{svcT('budgetHours')}</label>
        <input id="pj-hours" type="number" min={0} step="0.25" className={controls.input} value={value.budget_hours} onChange={(e) => set('budget_hours', e.target.value)} />
      </div>
      <div className={controls.field}>
        <label className={controls.label} htmlFor="pj-fee">{svcT('feeBudget')}</label>
        <input id="pj-fee" type="number" min={0} step="1" className={controls.input} value={value.fee_budget} onChange={(e) => set('fee_budget', e.target.value)} />
      </div>
      <div className={controls.field}>
        <label className={controls.label} htmlFor="pj-rate">{svcT('projectRate')}</label>
        <input id="pj-rate" type="number" min={0} step="0.01" className={controls.input} value={value.rate} onChange={(e) => set('rate', e.target.value)} />
      </div>
      <div className={controls.field}>
        <label className={controls.label} htmlFor="pj-start">{svcT('start')}</label>
        <input id="pj-start" type="date" className={controls.input} value={value.start} onChange={(e) => set('start', e.target.value)} />
      </div>
      <div className={controls.field}>
        <label className={controls.label} htmlFor="pj-due">{svcT('due')}</label>
        <input id="pj-due" type="date" className={controls.input} value={value.due} onChange={(e) => set('due', e.target.value)} />
      </div>
      <div className={controls.field}>
        <label className={controls.label} htmlFor="pj-status">{svcT('status')}</label>
        <select id="pj-status" className={controls.select} value={value.status} onChange={(e) => set('status', e.target.value as ProjectStatus)}>
          {PROJECT_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]()}</option>)}
        </select>
      </div>
    </div>
  );
}

/** Hours tracked / budget, billed / unbilled ₹, fee budget used, forecast, and the 80 / 100% warnings. */
export function ProjectHeader({ project, entries, tasks, prefs, live }: {
  project: CostCentre;
  entries: readonly TimeEntry[];
  tasks: readonly ProjectTask[];
  prefs: TimePrefs;
  live: Set<string>;
}) {
  const b: ProjectBurn = projectBurn(project, entries, tasks, prefs, live, todayInput());
  const pct = b.pct === null ? 0 : Math.floor(b.pct);
  const feePct = b.fee_pct === null ? 0 : Math.floor(b.fee_pct);
  return (
    <div className={styles.section} data-project-header>
      <div className={styles.stats}>
        <div className={styles.stat}>
          <span className={styles.statLabel}>{svcT('tracked')}</span>
          <span className={styles.statValue}>{b.budget_minutes ? svcT('trackedOf', { tracked: formatMinutes(b.tracked_minutes), budget: formatMinutes(b.budget_minutes) }) : formatMinutes(b.tracked_minutes)}</span>
          {b.budget_minutes ? <Bar pct={b.pct} /> : <span className={styles.muted}>{svcT('noBudget')}</span>}
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>{svcT('billedAmt')} / {svcT('unbilledAmt')}</span>
          <span className={styles.statValue}>{formatCurrency(b.billed_amount)} / {formatCurrency(b.unbilled_amount)}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>{svcT('feeUsed')}</span>
          <span className={styles.statValue}>{b.fee_pct === null ? '–' : `${feePct}%`}</span>
          <Bar pct={b.fee_pct} />
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>{svcT('forecast')}</span>
          <span className={styles.statValue}>{b.forecast_minutes === null ? '–' : formatMinutes(b.forecast_minutes)}</span>
          {b.forecast_minutes === null && <span className={styles.muted}>{svcT('forecastNone')}</span>}
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>{svcT('estimate')}</span>
          <span className={styles.statValue}>{formatMinutes(b.estimate_minutes)}</span>
        </div>
      </div>
      {b.level === 100 && <p className={styles.over} role="alert">{svcT('warn100', { pct })}</p>}
      {b.level === 80 && <p className={styles.warn} role="status">{svcT('warn80', { pct })}</p>}
      {b.fee_level === 100 && <p className={styles.over} role="alert">{svcT('feeWarn100', { pct: feePct })}</p>}
      {b.fee_level === 80 && <p className={styles.warn} role="status">{svcT('feeWarn80', { pct: feePct })}</p>}
    </div>
  );
}
