/**
 * R17-B bridge to payroll — the ONLY Round 17 module importing the payroll store (C appends `readRunForMonth`).
 *  - B2 "Send to payroll": the month's locked musters → attendance (`attendancePush`), written by `saveAttendance` for
 *    the people in the musters only; refused by the store once the month's run is final (the payroll lock).
 *  - A2 criterion 5 (moved to B): deploy / release an employee at a site (`cost_centre_id` + `mp.post_id`).
 * Payroll rights apply (`books.edit` + `payroll.view`). Working papers — verify with your CA.
 */
import type { Employee } from '../../types/payroll';
import { loadAttendance, loadAttendanceTypes, loadEmployees, saveAttendance, saveEmployee } from '../payroll/store';
import { attendancePush, type AttendancePush } from './mp-attendance';
import { loadMusters } from './mp-muster';
import { readManpowerSettings } from './mp-settings';

export { loadEmployees, loadAttendanceTypes };

/** The preview of the push (nothing written). */
export const previewPush = (month: string): AttendancePush[] => attendancePush(month, loadMusters(month), loadAttendance(), readManpowerSettings().extra_duty_type_id);

/** Write the preview into payroll attendance; returns the number of people written. */
export function pushAttendance(month: string): number {
  const rows = previewPush(month);
  if (!rows.length) throw new Error('No locked muster for this month.');
  saveAttendance(month, rows.map((r) => ({ employee_id: r.employee_id, lop: r.lop, units: r.units })));
  return rows.length;
}

/** Deploy an employee at a site on a post (`siteId` empty = release from the site). */
export function deployEmployee(e: Employee, siteId: string, postId?: string): Employee {
  const { mp: _mp, ...rest } = e;
  void _mp;
  const mp = { ...e.mp, post_id: siteId ? postId : undefined };
  return saveEmployee({ ...rest, cost_centre_id: siteId || undefined, ...(mp.post_id || mp.guard_licence ? { mp } : {}) });
}
