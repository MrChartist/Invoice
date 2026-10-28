/**
 * R19-A2 writes of `lg_jobs` (`doc.create`, numbered from `JOB`, period-locked by `date`, audited row by row). A row
 * removed by `setTable` goes to the recycle bin (its JOB number stays used). The job and its series counter are written
 * under one `withTablesRollback`. Pure rules live in `lg-job.ts`. At the R19-A cap (PRD §3) the lane rate sheets (cut 2;
 * the table `lg_rate_sheets` is not registered; its type stays declared) and the CSV / XLSX job import (cut 3) were cut.
 */
import './lg-registry';
import { generateId, getTable, setTable, KEYS } from '../storage';
import { requireAccess } from '../access';
import { assertUnlocked } from '../period-lock';
import { recordSeries } from '../series-counters';
import { withTablesRollback } from '../table-txn';
import { lgT } from '../../i18n/areas/logistics-r19a';
import type { LgJob, LgStatus } from '../../types/logistics-r19';
import { cleanJob, nextJobNumber, validateJob } from './lg-job';
import { LG_TABLES } from './lg-shared';

export const loadJobs = (): LgJob[] => getTable<LgJob>(LG_TABLES.jobs).filter((j) => j && typeof j.id === 'string' && typeof j.number === 'string');
const lockOf = (j: Pick<LgJob, 'id' | 'date' | 'number'>) => ({ id: j.id, issue_date: j.date, invoice_number: j.number });

/** Add / edit a job (`doc.create`). Throws the first error; returns the job and its hints. A closed job is re-opened by `setJobStatus`. */
export function saveJob(input: Omit<LgJob, 'id' | 'number' | 'updated_at'> & { id?: string }, prefix?: string): { job: LgJob; hints: string[] } {
  requireAccess('doc.create');
  const all = loadJobs();
  const prev = input.id ? all.find((j) => j.id === input.id) : undefined;
  if (prev) assertUnlocked(lockOf(prev), 'edit');
  const id = prev?.id ?? generateId();
  const job = cleanJob({ ...prev, ...input, id, number: prev?.number ?? nextJobNumber(input.date, all, prefix), updated_at: new Date().toISOString() } as LgJob);
  const { errors, hints } = validateJob(job, all);
  if (errors.length) throw new Error(errors[0]);
  assertUnlocked(lockOf(job), prev ? 'edit' : 'create');
  return withTablesRollback([LG_TABLES.jobs, 'series_counters'], () => {
    setTable(LG_TABLES.jobs, prev ? all.map((j) => (j.id === id ? job : j)) : [...all, job]);
    recordSeries(job.number);
    return { job, hints };
  });
}

/** Status change (close stamps `closed_on`; re-opening a closed job clears it — both audited by the watched table). */
export function setJobStatus(id: string, status: LgStatus, today: string): LgJob {
  requireAccess('doc.create');
  const all = loadJobs();
  const j = all.find((x) => x.id === id);
  if (!j) throw new Error(lgT('eNoJob'));
  assertUnlocked(lockOf(j), 'edit');
  const next: LgJob = { ...j, status, closed_on: status === 'closed' ? today : undefined, updated_at: new Date().toISOString() };
  setTable(LG_TABLES.jobs, all.map((x) => (x.id === id ? next : x)));
  return next;
}

/** Delete a job that no live document names (`lg.job_id`); the row goes to the recycle bin. */
export function deleteJob(id: string): void {
  requireAccess('doc.create');
  const all = loadJobs();
  const j = all.find((x) => x.id === id);
  if (!j) return;
  if (getTable<{ lg?: { job_id?: string }; status?: string }>(KEYS.invoices).some((r) => r?.lg?.job_id === id && r.status !== 'Cancelled')) throw new Error(lgT('eBilled'));
  assertUnlocked(lockOf(j), 'delete');
  setTable(LG_TABLES.jobs, all.filter((x) => x.id !== id));
}
