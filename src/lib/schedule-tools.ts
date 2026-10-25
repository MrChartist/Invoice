/**
 * Payment-schedule helpers for the editor and its summary line (8G, 8.100 / A5). Kept out of
 * `payment-schedule.ts`, which the first-paint bundle carries (reminders on the dashboard).
 */

import type { PaymentInstalment } from '../types/invoice';
import { num, round2 } from './invoice-calc';
import { instalmentAmounts } from './payment-schedule';

/** Problems with a schedule against the document total (empty = fine). English: shown with the editor's own strings. */
export function scheduleIssues(schedule: readonly PaymentInstalment[], total: number): ('over' | 'under' | 'pct')[] {
  if (!schedule.length) return [];
  const issues: ('over' | 'under' | 'pct')[] = [];
  const pct = schedule.reduce((s, i) => s + num(i.percent), 0);
  if (pct > 100.001) issues.push('pct');
  const sum = round2(instalmentAmounts(schedule, total).reduce((s, a) => s + a, 0));
  if (sum > round2(total) + 0.009) issues.push('over');
  else if (sum < round2(total) - 0.009) issues.push('under');
  return issues;
}

/** Deposit = the first instalment's amount (what "Request deposit" asks for). 0 without a schedule. */
export function depositAmount(schedule: readonly PaymentInstalment[] | undefined, total: number): number {
  if (!schedule?.length) return 0;
  return instalmentAmounts(schedule, total)[0] ?? 0;
}

/** Ready-made splits for the editor: [percent, days after the issue date][]. */
export const SCHEDULE_PRESETS: Record<'deposit50' | 'deposit30' | 'thirds', [number, number][]> = {
  deposit50: [[50, 0], [50, 30]],
  deposit30: [[30, 0], [70, 30]],
  thirds: [[34, 0], [33, 30], [33, 60]],
};

/** Local day `days` after `iso` (calendar safe, no UTC shift). */
export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  dt.setDate(dt.getDate() + days);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

export function presetSchedule(preset: keyof typeof SCHEDULE_PRESETS, issueDate: string, labels: string[] = []): PaymentInstalment[] {
  return SCHEDULE_PRESETS[preset].map(([percent, days], i) => ({
    id: `i${i + 1}`,
    label: labels[i] ?? (i === 0 ? 'Deposit' : `Instalment ${i + 1}`),
    due_date: addDays(issueDate, days),
    percent,
  }));
}

/** Whole days from today (local) to `due` (negative = overdue); null without a due date (A5 summary line). */
export function daysToDue(due: string | undefined, today: Date = new Date()): number | null {
  if (!due || !/^\d{4}-\d{2}-\d{2}/.test(due)) return null;
  const [y, m, d] = due.slice(0, 10).split('-').map(Number);
  const a = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((Date.UTC(y, m - 1, d) - a) / 86400000);
}
