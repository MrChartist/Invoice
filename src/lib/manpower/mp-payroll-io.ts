/**
 * R17-B bridge to payroll — the ONE Round 17 module that writes payroll tables (C appends `readRunForMonth`).
 *  - B2 "Send to payroll": the month's locked musters → attendance (`attendancePush`) for the people in the musters only,
 *    refused once the month's run is final (the payroll lock);
 *  - A2 criterion 5 (moved to B): deploy / release an employee at a site (`cost_centre_id` + `mp.post_id`).
 * It writes the payroll tables by the payroll store's own rules (rights `books.edit` + `payroll.view`, the final-run
 * refusal, the attendance row shape of `normalizeAttendance`, one audit row) through `storage.ts` instead of importing
 * `payroll/store.ts`: a new importer of the store splits the shared payroll chunk and grows the entry's preload map
 * (first paint must stay +0 B; measured in R17-A and R17-B). `tests/mp-attendance.test.ts` reads the result back
 * through the store. Working papers — verify with your CA.
 */
import { generateId, getTable, setTable } from '../storage';
import { requireAccess } from '../access';
import { audit } from '../audit';
import { attendancePush, type AttendanceNow, type AttendancePush } from './mp-attendance';
import { loadMusters } from './mp-muster';
import { readManpowerSettings } from './mp-settings';

type Row = AttendanceNow & { id: string; updated_at?: string };
const guard = () => {
  requireAccess('books.edit');
  requireAccess('payroll.view');
};
const r2 = (n: number) => Math.round(n * 100) / 100;

/** The preview of the push (nothing written). */
export const previewPush = (month: string): AttendancePush[] => attendancePush(month, loadMusters(month), getTable<Row>('attendance').filter((a) => a?.employee_id), readManpowerSettings().extra_duty_type_id);

/** Write the preview into payroll attendance; returns the number of people written. */
export function pushAttendance(month: string): number {
  guard();
  if (getTable<{ month?: string; status?: string }>('payroll_runs').some((r) => r?.month === month && r.status === 'final')) throw new Error(`Payroll for ${month} is finalized; reopen it to change attendance.`);
  const rows = previewPush(month);
  if (!rows.length) throw new Error('No locked muster for this month.');
  const all = getTable<Row>('attendance');
  const mine = new Set(rows.map((r) => r.employee_id));
  const stamp = new Date().toISOString();
  const next: Row[] = rows.map((r) => {
    const units = Object.fromEntries(Object.entries(r.units).filter(([, v]) => Number(v)).map(([k, v]) => [k, r2(Number(v))]));
    const prev = all.find((a) => a?.month === month && a.employee_id === r.employee_id);
    return { id: prev?.id ?? generateId(), employee_id: r.employee_id, month, lop: Math.max(0, r2(r.lop)), ...(Object.keys(units).length ? { units } : {}), updated_at: stamp };
  });
  setTable('attendance', [...all.filter((a) => a?.month !== month || !mine.has(a.employee_id)), ...next]);
  audit.record({ entity: 'payroll', entity_id: month, action: 'update', summary: `Attendance for ${month} sent from the duty registers (${next.length} employee${next.length === 1 ? '' : 's'})` });
  return next.length;
}

/** Deploy an employee at a site on a post (`siteId` empty = release from the site). */
export function deployEmployee(employeeId: string, siteId: string, postId?: string): void {
  guard();
  const all = getTable<{ id: string; code?: string; name?: string; cost_centre_id?: string; mp?: { post_id?: string; guard_licence?: unknown } }>('employees');
  const e = all.find((x) => x?.id === employeeId);
  if (!e) throw new Error('This employee is no longer on the list.');
  const { cost_centre_id: _c, mp: _m, ...rest } = e;
  void _c;
  void _m;
  const mp = { ...e.mp, post_id: siteId ? postId : undefined };
  if (!mp.post_id) delete mp.post_id;
  const row = { ...rest, ...(siteId ? { cost_centre_id: siteId } : {}), ...(Object.keys(mp).length ? { mp } : {}), updated_at: new Date().toISOString() };
  setTable('employees', all.map((x) => (x.id === employeeId ? row : x)));
  audit.record({ entity: 'employee', entity_id: e.id, action: 'update', doc_number: e.code, summary: `${siteId ? 'Deployed' : 'Released'} employee ${e.code ?? ''} ${e.name ?? ''}`.trim() });
}
