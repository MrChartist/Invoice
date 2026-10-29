/**
 * SV-D2 labour operations (table `labour_ops`, `master.edit`, audited "Labour operation") and technician time: clock in /
 * out per technician on a job writes a NON-billable `time_entries` row with `job_id` / `staff_id` (the job bill carries
 * the labour, so time is never billed twice). Efficiency = billed labour hours (bill lines with `sv.labour_op_id`, hours as
 * the quantity, per `sv.staff_id`) ÷ clocked hours, per technician. Working paper — verify with your CA (SV20).
 */
import './sv-registry';
import type { InvoiceRecord } from '../../types/invoice';
import type { ServiceJob } from '../../types/retail-r9';
import type { LabourOp } from '../../types/services-r10';
import type { TimeEntry } from '../../types/time';
import { generateId, getTable, setTable } from '../storage';
import { requireAccess } from '../access';
import { num, round2 } from '../invoice-calc';
import { timeDb } from '../timesheets';
import { patchJob } from './sv-jobs-workshop';
import { SV_TABLES } from './sv-shared';

export const loadLabourOps = (): LabourOp[] => getTable<LabourOp>(SV_TABLES.labourOps).filter((o) => !!o && typeof o.id === 'string');

export function saveLabourOp(i: Omit<LabourOp, 'id' | 'created_at'> & { id?: string }): LabourOp {
  requireAccess('master.edit');
  const all = loadLabourOps();
  const code = i.code.trim().toUpperCase();
  if (!code || !i.name.trim()) throw new Error('Type the code and the description.');
  if (all.some((o) => o.id !== i.id && o.code === code)) throw new Error(`Code ${code} is already used.`);
  const prev = all.find((o) => o.id === i.id);
  const row: LabourOp = { ...prev, ...i, id: prev?.id ?? generateId(), code, name: i.name.trim(), created_at: prev?.created_at ?? new Date().toISOString(), ...(prev ? { updated_at: new Date().toISOString() } : {}) };
  setTable(SV_TABLES.labourOps, prev ? all.map((o) => (o.id === row.id ? row : o)) : [...all, row]);
  return row;
}

/** Data-layer delete (recycle bin). Bills keep their snapshot. */
export function deleteLabourOp(id: string): void {
  requireAccess('master.edit');
  setTable(SV_TABLES.labourOps, loadLabourOps().filter((o) => o.id !== id));
}

/** Start a technician's clock on a job. */
export const clockIn = (job: ServiceJob, staffId: string, at = new Date().toISOString()): ServiceJob => patchJob(job.id, { clocks: { ...job.clocks, [staffId]: at } }, true);

/** Stop it: a non-billable time entry (minutes, at least 1) on the job. */
export function clockOut(job: ServiceJob, staff: { id: string; name: string }, at = new Date()): TimeEntry {
  const from = job.clocks?.[staff.id];
  if (!from) throw new Error(`${staff.name} is not clocked in.`);
  const minutes = Math.max(1, Math.round((at.getTime() - Date.parse(from)) / 60000));
  const { [staff.id]: _x, ...rest } = job.clocks ?? {};
  void _x;
  patchJob(job.id, { clocks: rest }, true);
  return logTime(job, staff, minutes, from.slice(0, 10));
}

export function logTime(job: Pick<ServiceJob, 'id' | 'number' | 'customer' | 'client_id'>, staff: { id: string; name: string }, minutes: number, date: string): TimeEntry {
  requireAccess('doc.create');
  if (!(num(minutes) > 0)) throw new Error('Type the minutes.');
  return timeDb.save({ client_name: job.customer, ...(job.client_id ? { client_id: job.client_id } : {}), description: `${job.number}: ${staff.name}`, date, minutes: Math.round(num(minutes)), hourly_rate: 0, billable: false, job_id: job.id, staff_id: staff.id });
}

export interface EfficiencyRow { staff_id: string; billed: number; clocked: number; pct: number }

/** Billed labour hours vs clocked hours per technician (live bills only). */
export function efficiency(entries: readonly TimeEntry[], invoices: readonly InvoiceRecord[], from = '', to = '9999'): EfficiencyRow[] {
  const m = new Map<string, EfficiencyRow>();
  const row = (id: string) => m.get(id) ?? m.set(id, { staff_id: id, billed: 0, clocked: 0, pct: 0 }).get(id)!;
  for (const e of entries) if (e.job_id && e.staff_id && e.date >= from && e.date <= to) row(e.staff_id).clocked += num(e.minutes) / 60;
  for (const i of invoices) {
    if (!i?.sv?.job || i.status === 'Cancelled' || i.doc_type === 'QUOTATION' || i.issue_date < from || i.issue_date > to) continue;
    for (const l of i.items ?? []) if (l.sv?.labour_op_id && l.sv.staff_id) row(l.sv.staff_id).billed += num(l.quantity);
  }
  return [...m.values()].map((r) => ({ ...r, billed: round2(r.billed), clocked: round2(r.clocked), pct: r.clocked ? Math.round((r.billed / r.clocked) * 100) : 0 }));
}
