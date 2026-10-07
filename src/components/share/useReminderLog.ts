import { useCallback, useState } from 'react';
import { generateId, getTable, setTable } from '../../lib/storage';
import {
  REMINDERS_TABLE,
  makeLogEntry,
  makeSnooze,
  type ReminderChannel,
  type ReminderRecord,
  type ReminderStage,
} from '../../lib/reminders';

/** Reads/writes the `reminders` table. Writes throw StorageWriteError — callers toast it. */
export function useReminderLog() {
  const [log, setLog] = useState<ReminderRecord[]>(() => getTable<ReminderRecord>(REMINDERS_TABLE));

  const reload = useCallback(() => setLog(getTable<ReminderRecord>(REMINDERS_TABLE)), []);

  const append = useCallback((entry: ReminderRecord) => {
    const next = [...getTable<ReminderRecord>(REMINDERS_TABLE), entry];
    setTable(REMINDERS_TABLE, next);
    setLog(next);
    return entry;
  }, []);

  const record = useCallback(
    (invoiceId: string, channel: ReminderChannel, tone: ReminderStage, note = '') =>
      append(makeLogEntry(generateId(), invoiceId, channel, tone, new Date(), note)),
    [append],
  );

  const snooze = useCallback(
    (invoiceId: string, days: number) => append(makeSnooze(generateId(), invoiceId, days)),
    [append],
  );

  return { log, reload, record, snooze };
}
