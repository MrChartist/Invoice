/**
 * Phone backup nudges (roadmap 8.20). Kept out of auto-backup-schedule.ts (first paint): only the lazy
 * phone nudge, the backup status line and the share dialog use it.
 */
import { DB_PREFIX, readRaw } from './storage';
import { parseTime, shouldNudge } from './auto-backup-schedule';

/** Phones (no folder backups, 8.20): nudge after this many new documents or this many days. */
export const PHONE_NUDGE_DOCS = 10;
export const PHONE_NUDGE_DAYS = 3;

/** The phone rule: data exists, not snoozed, and N new documents or 3 days since the last backup. */
export function phoneBackupDue(o: { lastIso: string | null | undefined; now: Date; hasData: boolean; newDocs: number; snoozeUntilIso?: string | null }): boolean {
  return shouldNudge({ ...o, afterDays: PHONE_NUDGE_DAYS }) || (o.newDocs >= PHONE_NUDGE_DOCS && shouldNudge({ ...o, afterDays: -1 }));
}

/** Invoices and purchases created after `lastIso` (all of them when never backed up). */
export function docsSinceBackup(lastIso: string | null | undefined): number {
  const last = parseTime(lastIso) ?? 0;
  let n = 0;
  for (const t of ['invoices', 'purchases']) {
    try {
      const rows = JSON.parse(readRaw(DB_PREFIX + t) || '[]') as { created_at?: string }[];
      for (const r of rows) if ((parseTime(r?.created_at) ?? 0) > last) n++;
    } catch {
      /* unreadable table: counts as nothing new */
    }
  }
  return n;
}

