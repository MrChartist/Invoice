/**
 * Pharma pack sale checks (7U, roadmap 7.43) — the small part the stock checks load on every issue.
 * Off unless the pharma pack is switched on (`pharma_settings`, backed up with the company):
 *  - "Block the sale of expired batches": the expired-batch confirmation ("Sell anyway") becomes an
 *    error that stops the save (editor, POS, recurring runs — every `liveDocTrackingIssues` caller);
 *  - near expiry: a line whose batch expires within `near_expiry_days` of the sale gets a warning, or
 *    an error with "Block near-expiry sales" on.
 * Pure apart from reading the settings.
 */
import { DB_PREFIX, getJson } from './storage';

export const PHARMA_SETTINGS_KEY = `${DB_PREFIX}pharma_settings`;

export interface PharmaSettings {
  enabled: boolean;
  block_expired: boolean;
  near_expiry_days: number;
  block_near_expiry: boolean;
}

export const DEFAULT_PHARMA: PharmaSettings = { enabled: false, block_expired: false, near_expiry_days: 90, block_near_expiry: false };

export function readPharmaSettings(): PharmaSettings {
  try {
    const raw = getJson<Partial<PharmaSettings> | null>(PHARMA_SETTINGS_KEY, null);
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_PHARMA };
    const days = Math.round(Number(raw.near_expiry_days));
    return {
      enabled: raw.enabled === true,
      block_expired: raw.block_expired === true,
      near_expiry_days: Number.isFinite(days) && days >= 0 && days <= 730 ? days : DEFAULT_PHARMA.near_expiry_days,
      block_near_expiry: raw.block_near_expiry === true,
    };
  } catch {
    return { ...DEFAULT_PHARMA };
  }
}

/** `day` + n days (YYYY-MM-DD, local). */
export function plusDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const t = new Date(y, m - 1, d + n);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

const SALE_TYPES = new Set(['', 'INVOICE', 'TAX_INVOICE', 'BILL_OF_SUPPLY', 'DELIVERY_CHALLAN']);

interface Issues {
  errors: string[];
  expired: string[];
  warnings: string[];
}

/** Apply the pharma settings to the stock issues of a document (returns a new object). */
export function pharmaGate<T extends Issues>(
  issues: T,
  doc: { doc_type?: string; issue_date: string; items: readonly { name: string; batch_no?: string; batch_expiry?: string }[] },
  settings: PharmaSettings = readPharmaSettings(),
): T {
  if (!settings.enabled || !SALE_TYPES.has(doc.doc_type ?? '')) return issues;
  const out: T = { ...issues, errors: [...issues.errors], expired: [...issues.expired], warnings: [...issues.warnings] };
  if (settings.block_expired && out.expired.length) {
    out.errors.push(...out.expired.map((e) => `${e} Expired stock cannot be sold (pharma setting).`));
    out.expired = [];
  }
  if (settings.near_expiry_days > 0 && /^\d{4}-\d{2}-\d{2}$/.test(doc.issue_date)) {
    const limit = plusDays(doc.issue_date, settings.near_expiry_days);
    for (const l of doc.items) {
      const exp = l.batch_expiry ?? '';
      if (!l.name.trim() || !exp || exp < doc.issue_date || exp > limit) continue;
      const msg = `${l.name}: batch ${l.batch_no ?? '—'} expires on ${exp} (within ${settings.near_expiry_days} days).`;
      (settings.block_near_expiry ? out.errors : out.warnings).push(msg);
    }
  }
  return out;
}
