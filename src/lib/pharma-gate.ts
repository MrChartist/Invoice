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
  /** Additive (8.84): refuse a sale priced above the batch MRP (incl. GST, per base unit). */
  block_above_mrp?: boolean;
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
      block_above_mrp: raw.block_above_mrp === true,
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

/* ── 8F sale limits: non-saleable godowns and the batch MRP ceiling ── */

interface LimitLine { name: string; quantity?: number; rate?: number; discount_percent?: number; tax_rate?: number; unit_factor?: number; godown_id?: string; batch_no?: string; arrival_id?: string }

/** Tax-inclusive selling price per base unit of a line (rate after the line discount, GST added). */
export function linePricePerBase(l: LimitLine): number {
  const net = (Number(l.rate) || 0) * (1 - Math.min(Math.max(Number(l.discount_percent) || 0, 0), 100) / 100);
  const f = Number(l.unit_factor) > 0 ? Number(l.unit_factor) : 1;
  return (net * (1 + Math.max(Number(l.tax_rate) || 0, 0) / 100)) / f;
}

/**
 * Errors for a sale (8.84 / 8.82): a line leaving a non-saleable godown (kind 'expiry'), and — with the
 * pharma option "Block sale above MRP" — a line priced (incl. GST, per base unit) above its batch's MRP.
 * `mrpOf` returns the MRP per base unit of a line's batch (undefined = unknown, not checked).
 */
export function saleLimitGate<T extends Issues>(
  issues: T,
  doc: { doc_type?: string; items: readonly LimitLine[] },
  opts: { nonSaleable: ReadonlySet<string>; godownName: (id: string) => string; mrpOf?: (l: LimitLine) => number | undefined; settings?: PharmaSettings; agencyOk?: ReadonlySet<string> },
): T {
  if (!SALE_TYPES.has(doc.doc_type ?? '')) return issues;
  const settings = opts.settings ?? readPharmaSettings();
  const errors: string[] = [];
  for (const l of doc.items) {
    if (!l.name?.trim() || !((Number(l.quantity) || 0) > 0)) continue;
    // R8-C (TR-C1): an agency line sells its principal's lot from a consignment godown; our own lines may not.
    if (l.godown_id && opts.nonSaleable.has(l.godown_id) && !(l.arrival_id && opts.agencyOk?.has(l.godown_id))) errors.push(`${l.name}: ${opts.godownName(l.godown_id)} holds non-saleable (expired / breakage) stock — sell from another godown.`);
    if (settings.enabled && settings.block_above_mrp && opts.mrpOf) {
      const mrp = opts.mrpOf(l);
      const price = linePricePerBase(l);
      if (mrp && mrp > 0 && price > mrp + 0.005) errors.push(`${l.name}: price ₹${price.toFixed(2)} (incl. GST) is above the batch MRP ₹${mrp.toFixed(2)} (pharma setting).`);
    }
  }
  return errors.length ? { ...issues, errors: [...issues.errors, ...errors] } : issues;
}

/* ── QA5-2 F9: a sale may not draw on stock held in a non-saleable godown ── */

/**
 * Errors for sale lines whose godown (absent = Main, where the stock engine books it) has less than the
 * line needs while the item has quantity sitting in non-saleable godowns (QC hold, expiry, WIP, in transit):
 * that sale would sell held goods and drive the saleable godown negative. Items with no held stock keep the
 * usual behaviour (a shortfall is a warning). `byGodown` is the item's balance per godown WITHOUT this document.
 */
export function heldStockGate<T extends Issues>(
  issues: T,
  doc: { doc_type?: string; items: readonly (LimitLine & { hsn?: string; optional?: boolean; alt_group?: string; selected?: boolean })[] },
  opts: {
    nonSaleable: ReadonlySet<string>;
    itemOf: (l: { name: string; hsn?: string }) => string | undefined;
    byGodown: (itemId: string) => Readonly<Record<string, number>> | undefined;
    godownName: (id: string) => string;
    mainId: string;
  },
): T {
  if (!opts.nonSaleable.size || !SALE_TYPES.has(doc.doc_type ?? '')) return issues;
  const need = new Map<string, { item: string; godown: string; name: string; qty: number }>();
  for (const l of doc.items) {
    const q = (Number(l.quantity) || 0) * (Number(l.unit_factor) > 0 ? Number(l.unit_factor) : 1);
    // Unselected optional / alternative lines are not sold.
    if (!l.name?.trim() || !(q > 0) || ((l.optional || (l.alt_group ?? '').trim()) && !l.selected) || l.arrival_id) continue; // R8-C: agency lines are not our stock
    const godown = l.godown_id || opts.mainId;
    const item = opts.nonSaleable.has(godown) ? undefined : opts.itemOf(l);
    if (!item) continue;
    const key = `${item}|${godown}`;
    const row = need.get(key) ?? { item, godown, name: l.name.trim(), qty: 0 };
    row.qty += q;
    need.set(key, row);
  }
  const errors: string[] = [];
  const fmt = (n: number) => String(Math.round(n * 1000) / 1000);
  for (const r of need.values()) {
    const bal = opts.byGodown(r.item) ?? {};
    const heldIn = [...opts.nonSaleable].filter((g) => (Number(bal[g]) || 0) > 1e-9);
    if (!heldIn.length) continue;
    const have = Math.max(Number(bal[r.godown]) || 0, 0);
    if (r.qty <= have + 1e-9) continue;
    const held = heldIn.reduce((s, g) => s + (Number(bal[g]) || 0), 0);
    errors.push(`${r.name}: only ${fmt(have)} saleable in ${opts.godownName(r.godown)}; ${fmt(held)} is held in ${heldIn.map(opts.godownName).join(', ')} (not for sale) — release it first or sell from another godown.`);
  }
  return errors.length ? { ...issues, errors: [...issues.errors, ...errors] } : issues;
}
