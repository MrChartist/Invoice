/**
 * SV-C2 class / batch attendance (table `class_attendance`, `doc.create`, audited "Attendance", dated `date`): one row
 * per class × day with present / absent / late per member or student (one tap marks all present). Attendance % per
 * student per month counts the class's meeting days (holidays skipped) up to `today`; late counts as present.
 * `attendanceLine` adds "Attendance this month: 18 / 22" to the coaching fee reminder when attendance exists (SV19).
 */
import './sv-registry';
import type { AttendanceMark, ClassAttendance, ClassSchedule } from '../../types/services-r10';
import { generateId, getTable, setTable } from '../storage';
import { requireAccess } from '../access';
import { SV_TABLES } from './sv-shared';
import { loadClasses, occurrences } from './sv-classes';

export const loadAttendance = (): ClassAttendance[] => getTable<ClassAttendance>(SV_TABLES.attendance).filter((a) => !!a && typeof a.id === 'string');

/** Save the marks of a class on a day (one row; replaced on a second save). */
export function saveAttendance(classId: string, date: string, marks: Record<string, AttendanceMark>): ClassAttendance {
  requireAccess('doc.create');
  if (!classId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Choose the class and the day.');
  const all = loadAttendance();
  const prev = all.find((a) => a.class_id === classId && a.date === date);
  const row: ClassAttendance = { ...prev, id: prev?.id ?? generateId(), class_id: classId, date, marks, ...(prev ? { updated_at: new Date().toISOString() } : {}) };
  setTable(SV_TABLES.attendance, prev ? all.map((a) => (a.id === row.id ? row : a)) : [...all, row]);
  return row;
}

/** Present (incl. late) / held for one person in a month (`YYYY-MM`) over the classes they attend. */
export function attendanceOf(personId: string, month: string, today: string, classes: readonly ClassSchedule[], rows: readonly ClassAttendance[]): { present: number; held: number } {
  let present = 0;
  let held = 0;
  const last = today < `${month}-31` ? today : `${month}-31`;
  for (const c of classes) {
    const marked = rows.filter((r) => r.class_id === c.id && r.date.startsWith(month) && r.marks[personId]);
    if (!marked.length) continue;
    held += occurrences(c, `${month}-01`, last).length;
    present += marked.filter((r) => r.marks[personId] !== 'A').length;
  }
  return { present, held: Math.max(held, present) };
}

/** Reminder line for a coaching parent ('' when no attendance was taken this month). */
export function attendanceLine(personId: string | undefined, today: string): string {
  if (!personId) return '';
  try {
    const a = attendanceOf(personId, today.slice(0, 7), today, loadClasses(), loadAttendance());
    return a.held ? ` Attendance this month: ${a.present} / ${a.held}.` : '';
  } catch {
    return '';
  }
}
