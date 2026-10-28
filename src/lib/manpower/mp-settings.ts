/**
 * R17-A1: the company object `mrchartist_inv_manpower_settings` (billing days, shift hours, service charge, bill date;
 * B–D add theirs). Owner only (`settings.manage`), audited on save, synced as a singleton, backed up. Absent = nothing
 * manpower, so existing companies see no change. Keys this package does not know (B–D sub-fields) are kept as stored.
 */
import './mp-registry';
import { DB_PREFIX, getJson, setJson } from '../storage';
import { requireAccess } from '../access';
import { audit } from '../audit';
import type { ManpowerSettings } from '../../types/manpower-r17';
import { MP_OBJECTS } from './mp-shared';

export const MANPOWER_SETTINGS_KEY = `${DB_PREFIX}${MP_OBJECTS.settings}`;

export function readManpowerSettings(): ManpowerSettings {
  try {
    const r = getJson<ManpowerSettings | null>(MANPOWER_SETTINGS_KEY, null);
    return r && typeof r === 'object' ? r : {};
  } catch {
    return {};
  }
}

/** Owner only: merge `patch` into the manpower settings (audited). Returns the saved settings. */
export function saveManpowerSettings(patch: Partial<ManpowerSettings>): ManpowerSettings {
  requireAccess('settings.manage');
  const next: ManpowerSettings = { ...readManpowerSettings(), ...patch, updated_at: new Date().toISOString() };
  if (next.service_charge_pct !== undefined && !(next.service_charge_pct >= 0 && next.service_charge_pct <= 100)) delete next.service_charge_pct;
  setJson(MANPOWER_SETTINGS_KEY, next);
  try {
    audit.record({ entity: 'settings', entity_id: MP_OBJECTS.settings, action: 'update', summary: `Manpower settings: ${Object.keys(patch).join(', ')}` });
  } catch {
    /* logging never blocks */
  }
  return next;
}

/**
 * R17-A1 profile defaults by kind (pure; a value the user set is kept): a security agency bills 12-hour shifts, every
 * other kind 8; pro-rata over calendar days; the bill dated at the month end (MP11, MP32).
 */
export function manpowerDefaultsFor(kind: string, cur: ManpowerSettings = {}): ManpowerSettings {
  return { ...cur, billing_days: cur.billing_days ?? 'calendar', shift_hours: cur.shift_hours ?? (kind === 'security' ? 12 : 8), bill_date: cur.bill_date ?? 'month_end', service_charge_pct: cur.service_charge_pct ?? 0 };
}

/** Owner only: write the profile's defaults (audited). */
export const applyManpowerDefaults = (kind: string): ManpowerSettings => saveManpowerSettings(manpowerDefaultsFor(kind, readManpowerSettings()));
