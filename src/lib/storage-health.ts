/**
 * Storage health: how close the device is to losing data or failing to save.
 *
 * `assessStorage` is pure (unit-tested); `measureStorage` gathers the inputs from the
 * storage layer (the IndexedDB-backed cache or localStorage, whichever holds the data).
 * Usage is measured directly from the app's keys. localStorage is capped at roughly 5 million
 * characters per origin and is NOT counted by `navigator.storage.estimate()`; with the
 * IndexedDB backend the cap is the browser's (much larger) IndexedDB quota.
 */

import { DB_PREFIX, collectAppData, storageBackend } from './storage';
import { ASSET_TABLE, isAssetRef } from './assets';
import { ATTACHMENT_KEY_PREFIX, referencedAttachmentIds } from './attachments';

export const LOCAL_QUOTA_CHARS = 5 * 1024 * 1024;
/**
 * Nominal room when the tables live in IndexedDB (Phase 4.2) and the browser gives no estimate.
 * Real IndexedDB quotas are far larger (a share of the disk); Settings refines this with
 * `navigator.storage.estimate()`.
 */
export const IDB_QUOTA_CHARS = 50 * 1024 * 1024;
const DAY = 86_400_000;

export interface StorageInput {
  /** Characters used by app keys (keys + values). */
  usedChars: number;
  quotaChars?: number;
  /** Largest app tables, any order. */
  tables: { key: string; chars: number }[];
  /**
   * Characters spent on logo / signature images still copied INTO invoice snapshots
   * (pre-v3 data; since v3 snapshots hold an `asset:` reference and the image is stored once).
   */
  embeddedImageChars: number;
  invoicesWithImages: number;
  /** Characters of the shared asset table (each distinct image stored once). */
  sharedImageChars?: number;
  /** Invoices whose snapshot points at a shared image instead of carrying a copy. */
  invoicesSharingImages?: number;
  /** Attachment files (6.12): how many are stored, and the ones no record uses any more. */
  attachmentCount?: number;
  attachmentChars?: number;
  unusedAttachments?: number;
  unusedAttachmentChars?: number;
  persisted: boolean | null;
  iosSafari: boolean;
  standalone: boolean;
  lastBackupIso: string | null;
  now: Date;
}

export type HealthLevel = 'ok' | 'warn' | 'critical';

export interface HealthFinding {
  id: string;
  level: HealthLevel;
  title: string;
  detail: string;
}

export interface StorageHealth {
  level: HealthLevel;
  pct: number;
  usedChars: number;
  quotaChars: number;
  biggest: { name: string; chars: number }[];
  findings: HealthFinding[];
  /** Attachment files (6.12) on this device. */
  attachments: { count: number; chars: number; unused: number; unusedChars: number };
}

export function formatChars(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

const rank: Record<HealthLevel, number> = { ok: 0, warn: 1, critical: 2 };

export function assessStorage(input: StorageInput): StorageHealth {
  const quota = input.quotaChars ?? LOCAL_QUOTA_CHARS;
  const pct = Math.min(100, Math.round((input.usedChars / quota) * 100));
  const findings: HealthFinding[] = [];

  if (pct >= 90) {
    findings.push({
      id: 'full', level: 'critical', title: 'Storage is almost full',
      detail: `${pct}% of the ~${formatChars(quota)} this browser allows is used. New invoices may fail to save. Download a backup now, then delete old data or large logos.`,
    });
  } else if (pct >= 75) {
    findings.push({
      id: 'filling', level: 'warn', title: 'Storage is filling up',
      detail: `${pct}% of the ~${formatChars(quota)} this browser allows is used. Download a backup and keep an eye on large logos.`,
    });
  }

  if (input.invoicesWithImages > 0 && input.embeddedImageChars >= 0.1 * quota) {
    findings.push({
      id: 'logos', level: pct >= 75 ? 'warn' : 'ok', title: 'Logos are copied into every invoice',
      detail: `${input.invoicesWithImages} invoice${input.invoicesWithImages === 1 ? '' : 's'} carry their own copy of your logo/signature (${formatChars(input.embeddedImageChars)}). A smaller logo image (under 50 KB) saves space on every future invoice.`,
    });
  }

  if ((input.unusedAttachments ?? 0) > 0) {
    const n = input.unusedAttachments ?? 0;
    findings.push({
      id: 'attachments-unused', level: pct >= 75 ? 'warn' : 'ok', title: `${n} attached file${n === 1 ? ' is' : 's are'} no longer used`,
      detail: `${formatChars(input.unusedAttachmentChars ?? 0)} of receipts / PDFs belong to no bill, expense or invoice any more (a cancelled form or a removed attachment). Use "Clean up unused files" to free the space.`,
    });
  }

  if (input.iosSafari && !input.standalone) {
    findings.push({
      id: 'safari', level: 'critical', title: 'Safari can delete this data',
      detail: 'Safari removes website data after 7 days without a visit. Add this app to your Home Screen (Share → Add to Home Screen) and back up regularly.',
    });
  } else if (input.persisted === false) {
    findings.push({
      id: 'persist', level: 'warn', title: 'Not protected from automatic clean-up',
      detail: 'The browser may clear this data when the device runs low on space. Installing the app usually protects it; keep regular backups either way.',
    });
  }

  const last = input.lastBackupIso ? Date.parse(input.lastBackupIso) : NaN;
  const hasData = input.tables.some((t) => t.chars > 2);
  if (hasData && (Number.isNaN(last) || input.now.getTime() - last > 7 * DAY)) {
    findings.push({
      id: 'backup', level: 'warn', title: Number.isNaN(last) ? 'No backup yet' : 'Last backup is over a week old',
      detail: 'Your data lives only in this browser. Download a backup or turn on automatic backups.',
    });
  }

  // Only tables worth mentioning (10 KB+); small keys such as the PIN record are noise.
  const biggest = [...input.tables]
    .filter((t) => t.chars >= 10 * 1024)
    .sort((a, b) => b.chars - a.chars)
    .slice(0, 4)
    .map((t) => ({ name: t.key.startsWith(DB_PREFIX) ? t.key.slice(DB_PREFIX.length) : t.key, chars: t.chars }));

  const level = findings.reduce<HealthLevel>((l, f) => (rank[f.level] > rank[l] ? f.level : l), 'ok');
  const attachments = {
    count: input.attachmentCount ?? 0,
    chars: input.attachmentChars ?? 0,
    unused: input.unusedAttachments ?? 0,
    unusedChars: input.unusedAttachmentChars ?? 0,
  };
  return { level, pct, usedChars: input.usedChars, quotaChars: quota, biggest, findings, attachments };
}

/** Gather the storage side of the input (sync, from the same store the app reads). */
export function measureStorage(): Pick<
  StorageInput,
  | 'usedChars' | 'quotaChars' | 'tables' | 'embeddedImageChars' | 'invoicesWithImages' | 'sharedImageChars' | 'invoicesSharingImages'
  | 'attachmentCount' | 'attachmentChars' | 'unusedAttachments' | 'unusedAttachmentChars'
> {
  const data = collectAppData();
  let usedChars = 0;
  const tables: StorageInput['tables'] = [];
  // Attachment files are one key each: report them as a single "attachments" entry.
  const used = referencedAttachmentIds(); // live store = `data`; shared parsed tables (PERF-1)
  let attachmentCount = 0;
  let attachmentChars = 0;
  let unusedAttachments = 0;
  let unusedAttachmentChars = 0;
  for (const [key, value] of Object.entries(data)) {
    const chars = key.length + value.length;
    usedChars += chars;
    if (key.startsWith(ATTACHMENT_KEY_PREFIX)) {
      attachmentCount++;
      attachmentChars += chars;
      if (!used.has(key.slice(ATTACHMENT_KEY_PREFIX.length))) {
        unusedAttachments++;
        unusedAttachmentChars += chars;
      }
      continue;
    }
    tables.push({ key, chars });
  }
  if (attachmentCount) tables.push({ key: `${DB_PREFIX}attachments`, chars: attachmentChars });
  let embeddedImageChars = 0;
  let invoicesWithImages = 0;
  let invoicesSharingImages = 0;
  try {
    const invoices = JSON.parse(data[`${DB_PREFIX}invoices`] ?? '[]') as { sender?: { logo?: unknown; signature?: unknown } }[];
    for (const inv of Array.isArray(invoices) ? invoices : []) {
      const images = [inv?.sender?.logo, inv?.sender?.signature];
      const size = images.reduce<number>((s, v) => s + (typeof v === 'string' && v.startsWith('data:') ? v.length : 0), 0);
      if (size > 0) {
        embeddedImageChars += size;
        invoicesWithImages++;
      } else if (images.some(isAssetRef)) {
        invoicesSharingImages++;
      }
    }
  } catch {
    /* unreadable table: nothing to attribute */
  }
  const assetsRaw = data[DB_PREFIX + ASSET_TABLE];
  const sharedImageChars = assetsRaw ? assetsRaw.length : 0;
  const quotaChars = storageBackend() === 'idb' ? IDB_QUOTA_CHARS : LOCAL_QUOTA_CHARS;
  return {
    usedChars, quotaChars, tables, embeddedImageChars, invoicesWithImages, sharedImageChars, invoicesSharingImages,
    attachmentCount, attachmentChars, unusedAttachments, unusedAttachmentChars,
  };
}
