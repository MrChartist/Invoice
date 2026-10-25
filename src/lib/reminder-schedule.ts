/**
 * R2-A5: validation and normalisation of the company reminder schedule (pure). Kept out of `reminders.ts` so the
 * Dashboard's first-paint bundle only carries the defaults it needs.
 */
import { DEFAULT_REMINDER_SCHEDULE, SCHEDULED_STAGES, type ReminderSchedule, type ReminderTemplates, type ScheduledStage } from './reminders';

const intIn = (v: unknown, d: number, max = 365) => {
  const n = Math.round(Number(v));
  return v !== null && v !== '' && Number.isFinite(n) && n >= 0 ? Math.min(n, max) : d;
};

/** Problems that make a schedule unusable (empty = fine). The stages must start in order. */
export function scheduleIssues(s: Pick<ReminderSchedule, 'polite_after' | 'firm_after' | 'final_after'>): string[] {
  const out: string[] = [];
  if (!(s.firm_after > s.polite_after)) out.push('The firm reminder must start after the polite one.');
  if (!(s.final_after > s.firm_after)) out.push('The final notice must start after the firm reminder.');
  return out;
}

/** A stored schedule made safe: numbers clamped, out-of-order stages replaced by the defaults. */
export function normalizeSchedule(raw: unknown): ReminderSchedule {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_REMINDER_SCHEDULE;
  const cd = o.cooldowns && typeof o.cooldowns === 'object' ? (o.cooldowns as Record<string, unknown>) : {};
  const cooldowns = Object.fromEntries(SCHEDULED_STAGES.map((st) => [st, Math.max(1, intIn(cd[st], d.cooldowns[st], 90))])) as Record<ScheduledStage, number>;
  const out: ReminderSchedule = {
    upcoming_days: intIn(o.upcoming_days, d.upcoming_days, 60),
    polite_after: intIn(o.polite_after, d.polite_after),
    firm_after: intIn(o.firm_after, d.firm_after),
    final_after: intIn(o.final_after, d.final_after),
    cooldowns,
  };
  if (scheduleIssues(out).length) Object.assign(out, { polite_after: d.polite_after, firm_after: d.firm_after, final_after: d.final_after });
  if (o.templates && typeof o.templates === 'object') out.templates = o.templates as ReminderTemplates;
  return out;
}
