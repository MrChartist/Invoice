/**
 * R15-B1: the company object `mrchartist_inv_travel_settings` (regime default, IATA / BSP, consolidators, fee
 * defaults, switches; C / D add their sub-objects). Owner only (`settings.manage`), audited on save, synced as a
 * singleton, backed up. Absent = nothing travel, so existing companies see no change. Keys this package does not know
 * (C / D sub-fields) are kept as stored.
 */
import './tv-registry';
import { DB_PREFIX, getJson, setJson } from '../storage';
import { requireAccess } from '../access';
import { audit } from '../audit';
import type { TravelSettings, TvRegime } from '../../types/travel-r15';
import { TV_OBJECTS } from './tv-shared';

export const TRAVEL_SETTINGS_KEY = `${DB_PREFIX}${TV_OBJECTS.settings}`;
export const TV_REGIMES: readonly TvRegime[] = ['to5', 'to18', 'agent', 'exempt_outside'];

export function readTravelSettings(): TravelSettings {
  try {
    const r = getJson<TravelSettings | null>(TRAVEL_SETTINGS_KEY, null);
    return r && typeof r === 'object' ? r : {};
  } catch {
    return {};
  }
}

/** Owner only: merge `patch` into the travel settings (audited). Returns the saved settings. */
export function saveTravelSettings(patch: Partial<TravelSettings>): TravelSettings {
  requireAccess('settings.manage');
  const before = readTravelSettings();
  const next: TravelSettings = { ...before, ...patch, updated_at: new Date().toISOString() };
  if (next.regime_default && !TV_REGIMES.includes(next.regime_default)) delete next.regime_default;
  setJson(TRAVEL_SETTINGS_KEY, next);
  try {
    audit.record({ entity: 'settings', entity_id: TV_OBJECTS.settings, action: 'update', summary: `Travel settings: regime ${before.regime_default ?? '—'} → ${next.regime_default ?? '—'}` });
  } catch {
    /* logging never blocks */
  }
  return next;
}
