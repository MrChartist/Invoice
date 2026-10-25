/**
 * R2-A5: the company reminder schedule and edited templates, stored under the object key
 * `mrchartist_inv_reminder_settings` (backed up and synced like every company key). The pure maths lives in
 * `reminders.ts` (`ReminderSchedule`, `stageForDays`) and `reminder-schedule.ts` (`normalizeSchedule`); this file only reads and writes it.
 * No module-level storage reads (safe to import from early chunks).
 */
import { DB_PREFIX, getJson, setJson } from './storage';
import { requireAccess } from './access';
import { audit } from './audit';
import { DEFAULT_REMINDER_SCHEDULE, type ReminderSchedule } from './reminders';
import { normalizeSchedule, scheduleIssues } from './reminder-schedule';

export const REMINDER_SETTINGS_KEY = `${DB_PREFIX}reminder_settings`;

export function loadReminderSchedule(): ReminderSchedule {
  return normalizeSchedule(getJson<unknown>(REMINDER_SETTINGS_KEY, null));
}

/** Save the schedule (owner / settings.manage). Throws when the stages are out of order. */
export function saveReminderSchedule(next: ReminderSchedule): ReminderSchedule {
  requireAccess('settings.manage');
  const issues = scheduleIssues(next);
  if (issues.length) throw new Error(issues.join(' '));
  const clean = normalizeSchedule(next);
  setJson(REMINDER_SETTINGS_KEY, clean);
  try {
    audit.record({
      entity: 'settings', entity_id: 'reminder_settings', action: 'update',
      summary: `Reminder schedule: upcoming ${clean.upcoming_days} days before, polite after ${clean.polite_after}, firm after ${clean.firm_after}, final after ${clean.final_after} days overdue`,
    });
  } catch {
    /* logging never blocks */
  }
  return clean;
}

/** "Reset to defaults" — today's 3 / 0 / 7 / 30 offsets; edited templates are kept unless `templates` is true. */
export function resetReminderSchedule(templates = false): ReminderSchedule {
  const cur = loadReminderSchedule();
  return saveReminderSchedule({ ...DEFAULT_REMINDER_SCHEDULE, ...(templates || !cur.templates ? {} : { templates: cur.templates }) });
}
