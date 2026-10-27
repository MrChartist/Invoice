/**
 * RT-A: the company object `mrchartist_inv_retail_settings` (MRP guard, deliveries, short book, free quantity on bills,
 * and RT-E3's cash / PAN guard). Owner only (`settings.manage`), audited on save, synced as a singleton, backed up.
 * Absent = everything off, so existing companies see no change. Small on purpose: the stock checks read it.
 */
import { DB_PREFIX, getJson, setJson } from '../storage';
import { requireAccess } from '../access';
import { audit } from '../audit';
import type { GuardMode, RetailSettings } from '../../types/retail-r9';
import { RT_OBJECTS } from './rt-shared';

export const RETAIL_SETTINGS_KEY = `${DB_PREFIX}${RT_OBJECTS.retailSettings}`;

const mode = (v: unknown): GuardMode | undefined => (v === 'off' || v === 'warn' || v === 'block' ? v : undefined);

export function readRetailSettings(): RetailSettings {
  try {
    const raw = getJson<Partial<RetailSettings> | null>(RETAIL_SETTINGS_KEY, null);
    if (!raw || typeof raw !== 'object') return {};
    const out: RetailSettings = {};
    const m = mode(raw.mrp_guard);
    if (m) out.mrp_guard = m;
    if (raw.delivery?.enabled) out.delivery = { enabled: true };
    if (raw.short_book?.enabled) out.short_book = { enabled: true };
    if (raw.free_qty === true) out.free_qty = true;
    const c = mode(raw.cash_guard);
    if (c) out.cash_guard = c;
    if (raw.require_pan === true) out.require_pan = true;
    if (typeof raw.updated_at === 'string') out.updated_at = raw.updated_at;
    return out;
  } catch {
    return {};
  }
}

const describe = (s: RetailSettings): string =>
  [`MRP guard ${s.mrp_guard ?? 'off'}`, s.delivery?.enabled && 'deliveries', s.short_book?.enabled && 'short book', s.free_qty && 'free quantity on bills', s.cash_guard && s.cash_guard !== 'off' && `cash guard ${s.cash_guard}`, s.require_pan && 'PAN required'].filter(Boolean).join(', ');

/** Owner only: merge `patch` into the retail settings (audited). Returns the saved settings. */
export function saveRetailSettings(patch: Partial<RetailSettings>): RetailSettings {
  requireAccess('settings.manage');
  const before = readRetailSettings();
  const next: RetailSettings = { ...before, ...patch, updated_at: new Date().toISOString() };
  setJson(RETAIL_SETTINGS_KEY, next);
  try {
    audit.record({ entity: 'settings', entity_id: RT_OBJECTS.retailSettings, action: 'update', summary: `Retail checks: ${describe(before)} → ${describe(next)}` });
  } catch {
    /* logging never blocks */
  }
  return readRetailSettings();
}
