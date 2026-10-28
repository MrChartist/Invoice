/**
 * R17-B2 muster → payroll attendance (pure). Per person across ALL locked musters of the month: duties = Σ duties,
 * LOP = max(payable days − duties, 0) with payable days = the calendar days of the month (the payroll's own rule),
 * `units.ot_hours` = Σ OT hours, and — when the "extra duty" attendance type is set — `units[type]` = max(duties −
 * payable days, 0). Only people in the musters get a row; their other units are kept. The payroll store writes it
 * (`mp-payroll-io.ts`), refused once the month's run is final. Working papers — verify with your CA (MP20, MP32).
 */
import type { SiteMuster } from '../../types/manpower-r17';
import { daysIn } from './mp-muster';

export interface AttendanceNow { employee_id: string; month: string; lop: number; units?: Record<string, number> }
export interface AttendancePush { employee_id: string; duties: number; cur?: AttendanceNow; lop: number; units: Record<string, number> }

const r2 = (n: number) => Math.round(n * 100) / 100;

/** The month's locked musters summed per person, with the attendance row each would get. */
export function attendancePush(month: string, musters: readonly SiteMuster[], current: readonly AttendanceNow[], extraTypeId?: string): AttendancePush[] {
  const days = daysIn(month);
  const by = new Map<string, { duties: number; ot: number }>();
  for (const m of musters) {
    if (m.month !== month || m.status !== 'locked') continue;
    for (const r of m.rows) {
      const t = by.get(r.employee_id) ?? { duties: 0, ot: 0 };
      t.duties += Number(r.duties) || 0;
      t.ot += Number(r.ot_hours) || 0;
      by.set(r.employee_id, t);
    }
  }
  return [...by].map(([employee_id, t]) => {
    const cur = current.find((a) => a.month === month && a.employee_id === employee_id);
    const units: Record<string, number> = { ...cur?.units };
    if (t.ot > 0) units.ot_hours = r2(t.ot);
    else delete units.ot_hours;
    if (extraTypeId) {
      const extra = r2(Math.max(t.duties - days, 0));
      if (extra > 0) units[extraTypeId] = extra;
      else delete units[extraTypeId];
    }
    return { employee_id, duties: r2(t.duties), ...(cur ? { cur } : {}), lop: r2(Math.max(days - t.duties, 0)), units };
  });
}

/** Active sites whose muster for the month is missing or still a draft (the push asks before going on). */
export const unlockedSites = <S extends { id: string; mp: { status: string } }>(sites: readonly S[], month: string, musters: readonly SiteMuster[]): S[] =>
  sites.filter((s) => s.mp.status === 'active' && !musters.some((m) => m.site_id === s.id && m.month === month && m.status === 'locked'));
