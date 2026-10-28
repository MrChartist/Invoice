/**
 * "Scheduled" month-end pack, offline (8G, 8.109). There is no background job: on the first open on /
 * after the schedule day, the notification bell offers last month's pack (link to Reports → Views & packs),
 * and — when the user turned on "write to backup folder" and a backup folder is connected with
 * permission already granted — the pack is written there automatically and the bell says so.
 * Loaded lazily by the bell only once a schedule exists (device-local `mrchartist_report_pack`).
 */

import { registerNotificationProvider } from './notifications';
import { loadPackSchedule, packDue, savePackSchedule } from './report-views';
import { localDayOf } from './dates';

let unregister: (() => void) | null = null;
let written: { month: string; folder: string } | null = null;
let running = false;

/** Write the due pack into the connected backup folder (only when permission is already granted). */
export async function autoWriteDuePack(today: string = localDayOf(new Date())): Promise<{ month: string; folder: string } | null> {
  const s = loadPackSchedule();
  const month = packDue(s, today);
  if (!month || !s.autoFolder || running) return null;
  running = true;
  try {
    const { getFolderHandle } = await import('./auto-backup');
    const dir = await getFolderHandle();
    if (!dir) return null;
    const perm = (await dir.queryPermission?.({ mode: 'readwrite' })) ?? 'granted';
    if (perm !== 'granted') return null;
    const { buildPackZip } = await import('./report-pack');
    const { name, blob } = await buildPackZip(month);
    const handle = (await dir.getFileHandle(name, { create: true })) as unknown as { createWritable(): Promise<{ write(d: Blob): Promise<void>; close(): Promise<void> }> };
    const w = await handle.createWritable();
    await w.write(blob);
    await w.close();
    savePackSchedule({ ...s, lastMonth: month });
    written = { month, folder: dir.name };
    return written;
  } catch {
    return null;
  } finally {
    running = false;
  }
}

export function registerPackAlerts(onChange?: () => void): void {
  if (unregister) return;
  unregister = registerNotificationProvider((ctx) => {
    const at = ctx.now.toISOString();
    if (written) return [{ id: `pack-written:${written.month}`, severity: 'info', title: `Month-end pack ${written.month} saved`, detail: `Written to your backup folder "${written.folder}" (P&L, balance sheet, ageing, GSTR-1 / 3B papers).`, href: '/reports?packs=1', cta: 'Open', at }];
    const month = packDue(loadPackSchedule(), localDayOf(ctx.now));
    if (!month) return [];
    return [{ id: `pack-due:${month}`, severity: 'info', title: `Month-end pack for ${month} is ready`, detail: 'P&L, balance sheet, ageing and GSTR-1 / 3B working papers in one ZIP.', href: `/reports?packs=1&month=${month}`, cta: 'Download', at }];
  });
  void autoWriteDuePack().then((r) => {
    if (r) onChange?.();
  });
}
