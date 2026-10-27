/**
 * PS-A4 utilisation per timekeeper and period: available hours = weekly capacity × weeks in the period, less leave
 * (loss-of-pay days from payroll attendance when the staff row links an employee, at capacity ÷ 5 a day); billable
 * hours; non-billable hours by work type; utilisation = billable ÷ available, against the target. Pure.
 */
import type { ServiceStaff } from '../../types/services-r10';
import type { TimeEntry } from '../../types/time';
import { num, round2 } from '../invoice-calc';
import { parseDay } from '../dates';

export interface UtilRow {
  id: string;
  name: string;
  available: number;
  billable: number;
  nonBillable: Record<string, number>;
  pct: number | null;
  target?: number;
  under: boolean;
}

/** Days from `from` to `to`, both included. */
export const daysIn = (from: string, to: string): number => Math.max(Math.round((parseDay(to).getTime() - parseDay(from).getTime()) / 86_400_000) + 1, 0);

export function utilisation(staff: readonly ServiceStaff[], entries: readonly TimeEntry[], o: { from: string; to: string; leaveDays?: (employeeId: string) => number }): UtilRow[] {
  const weeks = daysIn(o.from, o.to) / 7;
  const by = new Map<string, TimeEntry[]>();
  for (const e of entries) if (e.staff_id && e.date >= o.from && e.date <= o.to) by.set(e.staff_id, [...(by.get(e.staff_id) ?? []), e]);
  return staff.filter((s) => s.active !== false && (num(s.ps?.capacity_hours_week) > 0 || by.has(s.id))).map((s) => {
    const cap = num(s.ps?.capacity_hours_week);
    const leave = s.employee_id && o.leaveDays ? o.leaveDays(s.employee_id) * (cap / 5) : 0;
    const available = round2(Math.max(cap * weeks - leave, 0));
    let billable = 0;
    const nonBillable: Record<string, number> = {};
    for (const e of by.get(s.id) ?? []) {
      const h = num(e.minutes) / 60;
      if (e.billable) billable += h;
      else nonBillable[e.work_type_id ?? ''] = round2((nonBillable[e.work_type_id ?? ''] ?? 0) + h);
    }
    billable = round2(billable);
    const pct = available > 0 ? round2((billable / available) * 100) : null;
    const target = s.ps?.target_pct;
    return { id: s.id, name: s.name, available, billable, nonBillable, pct, ...(target ? { target } : {}), under: !!target && pct !== null && pct < target };
  });
}

/** Loss-of-pay days of an employee in the months the period touches (payroll attendance rows `{employee_id, month, lop}`). */
export function leaveDaysFrom(rows: readonly { employee_id?: string; month?: string; lop?: number }[], from: string, to: string): (employeeId: string) => number {
  const m0 = from.slice(0, 7);
  const m1 = to.slice(0, 7);
  return (id) => rows.filter((r) => r?.employee_id === id && (r.month ?? '') >= m0 && (r.month ?? '') <= m1).reduce((s, r) => s + num(r.lop), 0);
}
