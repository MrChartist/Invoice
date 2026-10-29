/**
 * R21-A1: the company object `mrchartist_inv_fuel_settings` (shifts, price time, test litres; B–D add theirs). Owner
 * only (`settings.manage`), audited on save, synced as a singleton, backed up. Absent = nothing fuel, so existing
 * companies see no change; `fuDefaultsFor` fills what is not stored when the desk reads it, so picking the profile writes
 * nothing here. Keys this package does not know (B–D sub-fields) are kept as stored.
 */
import './fu-registry';
import { DB_PREFIX, getJson, setJson } from '../storage';
import { requireAccess } from '../access';
import { audit } from '../audit';
import type { FuelKind, FuelSettings } from '../../types/fuel-r21';
import { FU_OBJECTS } from './fu-shared';

export const FUEL_SETTINGS_KEY = `${DB_PREFIX}${FU_OBJECTS.settings}`;

export function readFuelSettings(): FuelSettings {
  const r = getJson<FuelSettings | null>(FUEL_SETTINGS_KEY, null);
  return r && typeof r === 'object' ? r : {};
}

/** The profile's defaults (pure; a stored value wins): two shifts from 06:00 / 14:00 (an LPG agency one), prices at 06:00, 5 L test, monthly credit bills. */
export const fuDefaultsFor = (kind?: FuelKind, cur: FuelSettings = readFuelSettings()): FuelSettings => ({
  shift_count: kind === 'lpg' ? 1 : 2, shift_starts: kind === 'lpg' ? ['09:00'] : ['06:00', '14:00'], price_time: '06:00', test_litres: 5, credit_billing: 'monthly', omc_vendor_ids: [], ...cur,
});

/** Owner only: merge `patch` into the fuel settings (audited). */
export function saveFuelSettings(patch: Partial<FuelSettings>): FuelSettings {
  requireAccess('settings.manage');
  const next: FuelSettings = { ...readFuelSettings(), ...patch, updated_at: new Date().toISOString() };
  setJson(FUEL_SETTINGS_KEY, next);
  try {
    audit.record({ entity: 'settings', entity_id: FU_OBJECTS.settings, action: 'update', summary: `Fuel settings: ${Object.keys(patch).join(', ')}` });
  } catch {
    /* logging never blocks */
  }
  return next;
}
