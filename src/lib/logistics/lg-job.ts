/**
 * R19-A2 job files (pure; family `f-logistics`): the `JOB` series with a branch prefix, validation (errors block, hints
 * never do), the ISO 6346 container check digit, filters and totals for the jobs view. A job is a row of `lg_jobs`, never
 * a cost centre (PRD §8 Q3). Writers live in `lg-save.ts`.
 */
import { nextSeriesNumberFor } from '../series-counters';
import { getIndianFY } from '../invoice-number';
import { shiftDay } from '../dates';
import { lgT } from '../../i18n/areas/logistics-r19a';
import type { LgContainer, LgContainerSize, LgDir, LgJob, LgMode, LgStatus } from '../../types/logistics-r19';
import { LG_SERIES } from './lg-shared';

export const LG_STATUSES: readonly LgStatus[] = ['enquiry', 'booked', 'in_transit', 'arrived', 'delivered', 'closed', 'cancelled'];
export const LG_DIRS: readonly LgDir[] = ['export', 'import', 'domestic', 'cross_trade'];
export const LG_MODES: readonly LgMode[] = ['sea_fcl', 'sea_lcl', 'air', 'road', 'rail', 'multimodal', 'courier'];
export const LG_SIZES: readonly LgContainerSize[] = ['20', '40', '40HC', '45', 'LCL'];
const TEU: Record<LgContainerSize, number> = { '20': 1, '40': 2, '40HC': 2, '45': 2.25, LCL: 0 };

/** Series prefix: `JOB`, or a branch prefix such as `JOB-BOM` (letters, digits, hyphen). */
export const jobPrefix = (p?: string): string => String(p ?? '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '') || LG_SERIES.jobs;
export const nextJobNumber = (date: string, rows: readonly Pick<LgJob, 'number'>[], prefix?: string): string => nextSeriesNumberFor(jobPrefix(prefix), date, rows.map((j) => j.number));

/** ISO 6346: owner code (3 letters + U / J / Z), 6 digits, check digit. `shape` false = not 4 letters + 7 digits. */
export function containerCheck(no: string): { shape: boolean; digit: boolean } {
  const s = no.replace(/\s/g, '').toUpperCase();
  if (!/^[A-Z]{4}\d{7}$/.test(s)) return { shape: false, digit: false };
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const c = s.charCodeAt(i);
    let v = i < 4 ? c - 55 : c - 48;
    if (i < 4) v += Math.floor((v - 1) / 10); // letter values skip 11, 22, 33
    sum += v * 2 ** i;
  }
  return { shape: true, digit: (sum % 11) % 10 === Number(s[10]) };
}

const house = (j: Pick<LgJob, 'refs'>) => [j.refs?.hbl, j.refs?.hawb].map((x) => (x ?? '').trim().toUpperCase()).filter(Boolean);
const isDay = (d?: string) => /^\d{4}-\d{2}-\d{2}$/.test(d ?? '');

/** Problems of a job: `errors` stop the save; `hints` are shown (container check digit, SB / BOE date, client KYC …). */
export function validateJob(j: LgJob, all: readonly LgJob[]): { errors: string[]; hints: string[] } {
  const errors: string[] = [];
  const hints: string[] = [];
  if (!isDay(j.date)) errors.push(lgT('eDate'));
  if (!j.client_id) errors.push(lgT('eClient'));
  if (!j.origin?.trim() || !j.destination?.trim()) errors.push(lgT('ePorts'));
  if (j.dir === 'export' && /^(sea|air)/.test(j.mode) && !/^[A-Z]{2}$/.test(j.dest_country ?? '')) errors.push(lgT('eCountry'));
  for (const c of j.containers ?? []) {
    const k = containerCheck(c.no);
    if (!k.shape) errors.push(lgT('eBox', { c: c.no }));
    else if (!k.digit) hints.push(lgT('hDigit', { c: c.no }));
  }
  const mine = house(j);
  const clash = all.find((x) => x.id !== j.id && house(x).some((h) => mine.includes(h)));
  if (clash) errors.push(lgT('eHouse', { n: clash.number }));
  for (const d of [j.refs?.sb_date, j.refs?.boe_date]) if (isDay(d) && isDay(j.date) && d! < shiftDay(j.date, -30)) hints.push(lgT('hDoc'));
  return { errors, hints };
}

/** Trimmed, upper-cased references and container numbers; blank refs dropped. */
export function cleanJob(j: LgJob): LgJob {
  const refs = Object.fromEntries(Object.entries(j.refs ?? {}).map(([k, v]) => [k, String(v ?? '').trim()]).filter(([, v]) => v)) as LgJob['refs'];
  const containers = (j.containers ?? []).map((c): LgContainer => ({ ...c, no: c.no.replace(/\s/g, '').toUpperCase() })).filter((c) => c.no);
  return { ...j, origin: j.origin.trim().toUpperCase(), destination: j.destination.trim().toUpperCase(), dest_country: j.dest_country?.toUpperCase() || undefined, refs, containers };
}

export interface JobFilter { fy?: string; status?: string; mode?: string; dir?: string; client?: string; agent?: string; salesperson?: string; branch?: string }

/** The jobs of one FY (label `26-27`) matching the filter, newest first. */
export function filterJobs(jobs: readonly LgJob[], f: JobFilter): LgJob[] {
  return jobs
    .filter((j) => (!f.fy || getIndianFY(j.date).label === f.fy) && (!f.status || j.status === f.status) && (!f.mode || j.mode === f.mode) && (!f.dir || j.dir === f.dir)
      && (!f.client || j.client_id === f.client) && (!f.agent || j.agent_id === f.agent) && (!f.salesperson || j.salesperson === f.salesperson) && (!f.branch || j.branch === f.branch))
    .sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number));
}

/** Count, chargeable kg and TEU of a list. */
export const jobTotals = (jobs: readonly LgJob[]) => ({
  count: jobs.length,
  kg: Math.round(jobs.reduce((s, j) => s + (j.chargeable_kg ?? 0), 0) * 100) / 100,
  teu: jobs.reduce((s, j) => s + (j.containers ?? []).reduce((t, c) => t + TEU[c.size], 0), 0),
});

/** A copy for "Duplicate job": same parties, lane and mode; new date, enquiry status, no refs, containers or number. */
export const duplicateJob = (j: LgJob, date: string): Omit<LgJob, 'id' | 'number' | 'updated_at'> => ({ date, status: 'enquiry', dir: j.dir, mode: j.mode, legs: j.legs, incoterm: j.incoterm, origin: j.origin, destination: j.destination, dest_country: j.dest_country, client_id: j.client_id, shipper: j.shipper, consignee: j.consignee, agent_id: j.agent_id, salesperson: j.salesperson, branch: j.branch, refs: {} });
