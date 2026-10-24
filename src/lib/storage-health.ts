/**
 * Storage health: how close the device is to losing data or failing to save.
 *
 * `assessStorage` is pure (unit-tested); `measureStorage` gathers the inputs from
 * localStorage. localStorage is capped at roughly 5 million characters per origin in
 * mainstream browsers and is NOT counted by `navigator.storage.estimate()`, so usage is
 * measured directly.
 */

import { DB_PREFIX, collectAppData } from './storage';
import { ASSET_TABLE, isAssetRef } from './assets';

export const LOCAL_QUOTA_CHARS = 5 * 1024 * 1024;
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
}

export function formatChars(n: number): string {
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
      detail: `${pct}% of this browser's ~5 MB is used. New invoices may fail to save. Download a backup now, then delete old data or large logos.`,
    });
  } else if (pct >= 75) {
    findings.push({
      id: 'filling', level: 'warn', title: 'Storage is filling up',
      detail: `${pct}% of this browser's ~5 MB is used. Download a backup and keep an eye on large logos.`,
    });
  }

  if (input.invoicesWithImages > 0 && input.embeddedImageChars >= 0.1 * quota) {
    findings.push({
      id: 'logos', level: pct >= 75 ? 'warn' : 'ok', title: 'Logos are copied into every invoice',
      detail: `${input.invoicesWithImages} invoice${input.invoicesWithImages === 1 ? '' : 's'} carry their own copy of your logo/signature (${formatChars(input.embeddedImageChars)}). A smaller logo image (under 50 KB) saves space on every future invoice.`,
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
  return { level, pct, usedChars: input.usedChars, quotaChars: quota, biggest, findings };
}

/** Gather the storage side of the input (sync, from the same store the app reads). */
export function measureStorage(): Pick<
  StorageInput,
  'usedChars' | 'tables' | 'embeddedImageChars' | 'invoicesWithImages' | 'sharedImageChars' | 'invoicesSharingImages'
> {
  const data = collectAppData();
  let usedChars = 0;
  const tables: StorageInput['tables'] = [];
  for (const [key, value] of Object.entries(data)) {
    const chars = key.length + value.length;
    usedChars += chars;
    tables.push({ key, chars });
  }
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
  return { usedChars, tables, embeddedImageChars, invoicesWithImages, sharedImageChars, invoicesSharingImages };
}
