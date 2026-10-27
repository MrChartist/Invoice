/**
 * SV-D1 workshop job cards — a thin layer over RT-D4 (`retail/rt-service-jobs.ts`, table `service_jobs`, `SVC/FY…`):
 * the job is taken by `addJob` (kind `vehicle` / `appliance`) and the SV-D fields (asset, odometer, fuel, customer voice,
 * checklist, promised time, bay, technicians, site visit, AMC) are added to the same row. Moves use RT-D4's `canMove`
 * (with the workshop steps). A site visit books an appointment (kind `job`) for the first technician. Delivering an AMC
 * job logs the AMC visit (`visitFromJob`). Never forks the engine.
 */
import './sv-registry';
import '../retail/rt-registry';
import type { ServiceJob, ServiceStatus } from '../../types/retail-r9';
import type { ServiceAsset } from '../../types/services-r10';
import { addJob, canMove, loadJobs, moveJob, SERVICE_TABLE } from '../retail/rt-service-jobs';
import { setTable } from '../storage';
import { requireAccess } from '../access';
import { amcDb, visitFromJob } from '../amc';
import { saveAppointment } from './sv-appointments';
import { loadAssets, odometerIssue, saveAsset, withReading } from './sv-assets';

export const ALL_STATUSES: readonly ServiceStatus[] = ['received', 'diagnosed', 'estimate_sent', 'awaiting_insurer', 'approved', 'in_repair', 'awaiting_parts', 'quality_check', 'ready', 'delivered', 'returned'];
export const movesFrom = (s: ServiceStatus): ServiceStatus[] => ALL_STATUSES.filter((t) => t !== 'returned' && canMove(s, t));
export const isWorkshopJob = (j: Pick<ServiceJob, 'kind' | 'asset_id'>): boolean => !!j.asset_id || j.kind === 'vehicle';
export const loadWorkshopJobs = (): ServiceJob[] => loadJobs().filter(isWorkshopJob);

export interface WorkshopJobInput {
  date: string;
  asset: ServiceAsset;
  complaints: string[];
  odometer?: number;
  fuel?: string;
  checklist?: string[];
  promised?: string;
  bay?: string;
  technicians?: string[];
  visit_at?: string;
  site?: string;
  amc_id?: string;
  estimate?: number;
  advance_id?: string;
}

/** Write SV-D fields onto a job (refused once billed, except approvals / clocks / claim / parts issued). */
export function patchJob(id: string, patch: Partial<ServiceJob>, afterBill = false): ServiceJob {
  requireAccess('doc.create');
  const all = loadJobs();
  const j = all.find((x) => x.id === id);
  if (!j) throw new Error('Job card not found.');
  if (!afterBill && (j.invoice_id || j.billed_on)) throw new Error(`${j.number} is billed; edit the bill instead.`);
  const next: ServiceJob = { ...j, ...patch, updated_at: new Date().toISOString() };
  setTable(SERVICE_TABLE, all.map((x) => (x.id === id ? next : x)));
  return next;
}

/** Take a vehicle / appliance in. Returns the job and a warning (odometer below the last reading), if any. */
export function openJob(i: WorkshopJobInput): { job: ServiceJob; warning: string } {
  const a = i.asset;
  const complaints = i.complaints.map((c) => c.trim()).filter(Boolean);
  const warning = odometerIssue(a, i.odometer);
  const base = addJob({
    date: i.date, kind: a.kind, customer: a.owner_name, client_id: a.client_id, phone: a.phone, complaint: complaints.join('; ') || 'Service',
    asset: { model: [a.make, a.model, a.variant].filter(Boolean).join(' '), ...(a.reg_no ? { reg_no: a.reg_no } : {}), ...(a.serial ? { serial: a.serial } : {}), ...(i.odometer ? { odometer: i.odometer } : {}) },
    estimate: i.estimate, advance_id: i.advance_id, technician: i.technicians?.join(', '), due: i.promised?.slice(0, 10) || undefined,
  });
  const extra: Partial<ServiceJob> = { asset_id: a.id, complaints };
  for (const k of ['fuel', 'checklist', 'promised', 'bay', 'technicians', 'visit_at', 'site', 'amc_id'] as const) if (i[k]?.length) Object.assign(extra, { [k]: i[k] });
  if (i.odometer) extra.odometer_in = i.odometer;
  if (i.visit_at) {
    extra.appointment_id = saveAppointment({ date: i.visit_at.slice(0, 10), start: i.visit_at.slice(11, 16) || '10:00', minutes: 60, client_id: a.client_id, client_name: a.owner_name, phone: a.phone, services: [], staff_id: i.technicians?.[0], kind: 'job', source: 'call', notes: `${base.number} · ${i.site || a.site || ''}` }).id;
  }
  if (i.odometer) saveAsset(withReading(a, i.date, i.odometer));
  return { job: patchJob(base.id, extra), warning };
}

/** Warning before *In repair* without a logged approval (never a block). */
export const approvalIssue = (j: Pick<ServiceJob, 'approvals' | 'amc_id'>): string => (!j.amc_id && !j.approvals?.length ? 'No estimate approval is logged on this job.' : '');

/** Move a job (RT-D4 rules). Delivery records the odometer out and an AMC visit. Returns the job and a warning. */
export function moveWorkshopJob(id: string, to: ServiceStatus, day: string, odometerOut?: number): { job: ServiceJob; warning: string } {
  const before = loadJobs().find((x) => x.id === id);
  const warning = to === 'in_repair' && before ? approvalIssue(before) : '';
  let job = moveJob(id, to, day);
  if (to === 'delivered') {
    const a = loadAssets().find((x) => x.id === job.asset_id);
    if (a && odometerOut) {
      saveAsset(withReading(a, day, odometerOut));
      job = patchJob(id, { odometer_out: odometerOut }, true);
    }
    const c = job.amc_id ? amcDb.all().find((x) => x.id === job.amc_id) : undefined;
    if (c && !c.visits?.some((v) => v.job_id === job.id)) amcDb.recordVisit(c.id, visitFromJob(job, day));
  }
  return { job, warning };
}

/** Board columns: open jobs by status, with age in days for the colour. */
export function board(jobs: readonly ServiceJob[], today: string): Partial<Record<ServiceStatus, (ServiceJob & { age: number })[]>> {
  const out: Partial<Record<ServiceStatus, (ServiceJob & { age: number })[]>> = {};
  for (const j of jobs) {
    if (j.status === 'delivered' || j.status === 'returned') continue;
    (out[j.status] ??= []).push({ ...j, age: Math.max(0, Math.round((Date.parse(`${today}T00:00:00`) - Date.parse(`${j.date}T00:00:00`)) / 864e5)) });
  }
  return out;
}
