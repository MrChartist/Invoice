/**
 * "Share backup" for phones (roadmap 8.20): browsers without `showDirectoryPicker` (Android Chrome,
 * iOS Safari) cannot write scheduled backups to a folder, so the backup goes through the OS share
 * sheet (Web Share Level 2) into Google Drive, WhatsApp "message yourself", Files, e-mail…
 *
 * Rules (docs/features/security.md):
 *  - Owner only (`data.backup`), like every full backup.
 *  - A file that leaves the device for a cloud app is encrypted: with the stored backup key (Settings →
 *    Data → Automatic backups → passphrase; encrypt-only, the passphrase is never stored) or with a
 *    passphrase typed for this share. A readable file needs an explicit "share without encryption",
 *    and is refused outright while vault mode is on (data encrypted at rest never leaves readable).
 *  - Android Chrome shares only some file types (not `.json`): the file is offered as
 *    `….encrypted.json`, then as `….encrypted.txt` (text/plain) when the browser refuses the first.
 *    Restore reads either (content-checked, not by extension).
 *
 * `shareBackupGate` is pure (tested); `shareBackupNow` runs from a click (the share sheet needs a
 * fresh user gesture: set the passphrase first, then tap Share).
 */

import { requireAccess } from './access';
import { backupFilename, buildEncryptedBackup, buildEncryptedBackupWithKey, exportPlainBackup, VAULT_PLAIN_BACKUP_MESSAGE } from './backup';
import { getBackupKey } from './auto-backup';
import { recordBackup } from './auto-backup-schedule';
import { vaultEnabled } from './storage';
import { canShareFiles, shareFile, type ShareFileResult } from './share';
import type { StoredEncryptionKey } from './crypto';

export type ShareMode = 'key' | 'passphrase' | 'plain';

export interface ShareGateInput {
  /** `can('data.backup')`. */
  owner: boolean;
  vault: boolean;
  /** A backup key is stored on this device. */
  hasKey: boolean;
  /** Passphrase typed for this share ('' / undefined = none). */
  passphrase?: string;
  /** The user ticked "share without encryption". */
  allowPlain?: boolean;
}

export type ShareGate =
  | { ok: true; mode: ShareMode }
  | { ok: false; reason: 'denied' | 'needs-passphrase' | 'short-passphrase' | 'vault' };

export const MIN_SHARE_PASSPHRASE = 8;

/** Which file a share may build, or why it may not. Order: owner → key → typed passphrase → plain. */
export function shareBackupGate(i: ShareGateInput): ShareGate {
  if (!i.owner) return { ok: false, reason: 'denied' };
  if (i.hasKey) return { ok: true, mode: 'key' };
  const pass = i.passphrase ?? '';
  if (pass) return pass.length >= MIN_SHARE_PASSPHRASE ? { ok: true, mode: 'passphrase' } : { ok: false, reason: 'short-passphrase' };
  if (i.allowPlain) return i.vault ? { ok: false, reason: 'vault' } : { ok: true, mode: 'plain' };
  return { ok: false, reason: 'needs-passphrase' };
}

/** File names to try, in order (Android Chrome refuses `.json` in the share sheet). */
export function shareFileNames(now: Date, encrypted: boolean): { name: string; type: string }[] {
  const json = backupFilename(now, encrypted);
  return [
    { name: json, type: 'application/json' },
    { name: json.replace(/\.json$/, '.txt'), type: 'text/plain' },
  ];
}

export type ShareFailReason = Extract<ShareGate, { ok: false }>['reason'] | Exclude<ShareFileResult, 'shared'> | 'error';
export type ShareBackupResult = { ok: true; filename: string } | { ok: false; reason: ShareFailReason; message: string };

/** True when this browser can hand a backup file to another app. */
export function canShareBackup(): boolean {
  const probe = (name: string, type: string) => {
    try {
      return canShareFiles(new File(['{}'], name, { type }));
    } catch {
      return false;
    }
  };
  return probe('b.json', 'application/json') || probe('b.txt', 'text/plain');
}

/** Build the backup and open the share sheet. Never throws; counts as a backup only when shared. */
export async function shareBackupNow(opts: { passphrase?: string; allowPlain?: boolean; now?: Date } = {}): Promise<ShareBackupResult> {
  const now = opts.now ?? new Date();
  let owner = true;
  try {
    requireAccess('data.backup');
  } catch {
    owner = false;
  }
  let key: StoredEncryptionKey | null;
  try {
    key = owner ? await getBackupKey() : null;
  } catch {
    key = null;
  }
  const gate = shareBackupGate({ owner, vault: vaultEnabled(), hasKey: !!key, passphrase: opts.passphrase, allowPlain: opts.allowPlain });
  if ('reason' in gate) { // (`in`, not `!gate.ok`: tests typecheck without strictNullChecks)
    const message =
      gate.reason === 'denied' ? 'Only the owner can share a full backup.'
        : gate.reason === 'vault' ? VAULT_PLAIN_BACKUP_MESSAGE
          : gate.reason === 'short-passphrase' ? `Use a passphrase of at least ${MIN_SHARE_PASSPHRASE} characters.`
            : 'Set a backup passphrase first: the file is going to another app.';
    return { ok: false, reason: gate.reason, message };
  }
  let text: string;
  try {
    text = gate.mode === 'key' ? await buildEncryptedBackupWithKey(key!, now)
      : gate.mode === 'passphrase' ? await buildEncryptedBackup(opts.passphrase!, now)
        : exportPlainBackup(now);
  } catch (err) {
    return { ok: false, reason: 'error', message: (err as Error)?.message || 'Could not build the backup.' };
  }
  let last: ShareFileResult = 'unsupported';
  for (const f of shareFileNames(now, gate.mode !== 'plain')) {
    const file = new File([text], f.name, { type: f.type });
    last = await shareFile(file, { title: f.name });
    if (last === 'shared') {
      recordBackup(now);
      return { ok: true, filename: f.name };
    }
    if (last !== 'unsupported') break; // cancelled / blocked / failed: do not offer a second sheet
  }
  const message =
    last === 'cancelled' ? 'Share cancelled — nothing was saved.'
      : last === 'blocked' ? 'Tap Share again to open the share sheet.'
        : last === 'unsupported' ? 'This browser cannot share files. Use Download backup instead.'
          : 'The backup could not be shared.';
  return { ok: false, reason: last, message };
}
