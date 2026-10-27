/**
 * SV-C3 classes and batches (table `class_schedules`, `master.edit`, audited "Class / batch"): weekdays and time,
 * dates, capacity, the plans that cover it (fitness) or the R5-C fee plan (coaching), holidays. Members enrol up to the
 * capacity, then join the wait-list (the first on it moves up when a place frees); coaching students sit on their fee
 * enrolment (`Enrolment.class_id`). Occurrences skip holidays and days outside the dates.
 */
import './sv-registry';
import type { Client } from '../../types/invoice';
import type { ClassSchedule } from '../../types/services-r10';
import type { FeePlan } from '../../types/institutions-r5';
import { generateId, getTable, setTable } from '../storage';
import { requireAccess } from '../access';
import { localDb } from '../localDb';
import { shiftDay } from '../dates';
import { SV_TABLES } from './sv-shared';
import { weekdayOf } from './sv-slots';

export const loadClasses = (): ClassSchedule[] => getTable<ClassSchedule>(SV_TABLES.classes).filter((c) => !!c && typeof c.id === 'string');
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export type ClassInput = Omit<ClassSchedule, 'id' | 'created_at'> & { id?: string };

export function saveClass(i: ClassInput): ClassSchedule {
  requireAccess('master.edit');
  const name = i.name.trim();
  if (!name) throw new Error('Name the class or batch.');
  if (!i.days.length || !HHMM.test(i.start)) throw new Error('Choose the days and the start time.');
  if (i.from && i.to && i.to < i.from) throw new Error('The end date is before the start date.');
  const all = loadClasses();
  const prev = i.id ? all.find((c) => c.id === i.id) : undefined;
  const row: ClassSchedule = { ...prev, ...i, name, days: [...new Set(i.days)].sort(), minutes: Math.max(5, Number(i.minutes) || 60), id: prev?.id ?? generateId(), created_at: prev?.created_at ?? new Date().toISOString(), ...(prev ? { updated_at: new Date().toISOString() } : {}) };
  setTable(SV_TABLES.classes, prev ? all.map((c) => (c.id === row.id ? row : c)) : [...all, row]);
  return row;
}

export function deleteClass(id: string): void {
  requireAccess('master.edit');
  setTable(SV_TABLES.classes, loadClasses().filter((c) => c.id !== id));
}

/** Days the class meets between `from` and `to` (its weekdays, inside its dates, holidays skipped). */
export function occurrences(c: Pick<ClassSchedule, 'days' | 'from' | 'to' | 'holidays'>, from: string, to: string): string[] {
  const out: string[] = [];
  const a = c.from && c.from > from ? c.from : from;
  const b = c.to && c.to < to ? c.to : to;
  for (let d = a; d <= b; d = shiftDay(d, 1)) if (c.days.includes(weekdayOf(d)) && !c.holidays?.includes(d)) out.push(d);
  return out;
}

/** Enrol a member: a place while under capacity, else the wait-list. Returns where the member landed. */
export function enrolMember(id: string, clientId: string): 'member' | 'waitlist' {
  requireAccess('master.edit');
  const c = loadClasses().find((x) => x.id === id);
  if (!c) throw new Error('Class not found.');
  if (c.members?.includes(clientId) || c.waitlist?.includes(clientId)) throw new Error('Already enrolled.');
  const full = !!c.capacity && (c.members?.length ?? 0) >= c.capacity;
  saveClass(full ? { ...c, waitlist: [...(c.waitlist ?? []), clientId] } : { ...c, members: [...(c.members ?? []), clientId] });
  return full ? 'waitlist' : 'member';
}

/** Drop a member (or a wait-listed one); the first on the wait-list takes a freed place. */
export function dropMember(id: string, clientId: string): void {
  requireAccess('master.edit');
  const c = loadClasses().find((x) => x.id === id);
  if (!c) return;
  const members = (c.members ?? []).filter((x) => x !== clientId);
  const waitlist = (c.waitlist ?? []).filter((x) => x !== clientId);
  if ((!c.capacity || members.length < c.capacity) && waitlist.length && members.length < (c.members ?? []).length) members.push(waitlist.shift()!);
  saveClass({ ...c, members, waitlist });
}

/** Coaching students of a batch (their enrolment on the batch's fee plan names it). */
export const studentsOfBatch = (c: Pick<ClassSchedule, 'id' | 'fee_plan_id'>, clients: readonly Client[]) =>
  clients.filter((s) => (s.enrolments ?? []).some((e) => e.plan_id === c.fee_plan_id && e.class_id === c.id));

/** Put a student on a batch (or off it with `classId` ''). */
export function setBatch(clientId: string, planId: string, classId: string): void {
  requireAccess('master.edit');
  const s = localDb.clients.getById(clientId);
  if (!s?.enrolments?.some((e) => e.plan_id === planId)) throw new Error('Enrol the student on the fee plan first (Fees → Students).');
  localDb.clients.upsert({ ...s, enrolments: s.enrolments.map((e) => (e.plan_id === planId ? { ...e, class_id: classId || undefined } : e)) });
}

/** "Fee increase during the course": a plan whose per-student total rose above `before` while students are enrolled. */
export function feeIncreaseWarning(before: Pick<FeePlan, 'heads'>, after: FeePlan, clients: readonly Client[]): number {
  const total = (p: Pick<FeePlan, 'heads'>) => p.heads.reduce((s, h) => s + Number(h.amount || 0), 0);
  return total(after) > total(before) ? clients.filter((c) => (c.enrolments ?? []).some((e) => e.plan_id === after.id && !e.refund)).length : 0;
}
