/**
 * R18-A1 / A3: the company object `mrchartist_inv_society_settings` (State, cycle, bill day, due days, heads, area unit,
 * confirmed State rows; B–D add theirs). Owner only (`settings.manage`), audited on save, synced as a singleton, backed
 * up. Absent = nothing society, so existing companies see no change; the profile's defaults (`societyDefaultsFor`) fill
 * what is not stored when the desk reads it, so picking the profile writes nothing here. Keys this package does not
 * know (B–D sub-fields) are kept as stored.
 */
import './hs-registry';
import { DB_PREFIX, getJson, setJson } from '../storage';
import { requireAccess } from '../access';
import { audit } from '../audit';
import type { HsHead, SocietySettings } from '../../types/society-r18';
import { BASES, HEAD_KINDS } from './hs-tariff';
import { HS_OBJECTS } from './hs-shared';

export const SOCIETY_SETTINGS_KEY = `${DB_PREFIX}${HS_OBJECTS.settings}`;

export function readSocietySettings(): SocietySettings {
  const r = getJson<SocietySettings | null>(SOCIETY_SETTINGS_KEY, null);
  return r && typeof r === 'object' ? r : {};
}

/**
 * The profile's defaults (pure; a stored value wins): the society's State (default the sender's), monthly cycle, bill
 * day 1, 15 due days, area in sq ft, no heads.
 */
export const societyDefaultsFor = (state: string | undefined, cur: SocietySettings = {}): SocietySettings => ({ state: /^\d{2}$/.test(state ?? '') ? state : undefined, cycle: 'monthly', bill_day: 1, due_days: 15, area_unit: 'sqft', heads: [], ...cur });

/** Owner only: merge `patch` into the society settings (audited); heads of an unknown kind / basis or without a name are dropped. */
export function saveSocietySettings(patch: Partial<SocietySettings>): SocietySettings {
  requireAccess('settings.manage');
  const next: SocietySettings = { ...readSocietySettings(), ...patch, updated_at: new Date().toISOString() };
  if (next.heads) next.heads = next.heads.filter((h) => h?.id && h.name?.trim() && HEAD_KINDS.includes(h.kind) && BASES.includes(h.basis)).map((h): HsHead => ({ ...h, name: h.name.trim(), rate: h.rate >= 0 ? Math.round(h.rate * 1e4) / 1e4 : 0 }));
  setJson(SOCIETY_SETTINGS_KEY, next);
  try {
    audit.record({ entity: 'settings', entity_id: HS_OBJECTS.settings, action: 'update', summary: `Society settings: ${Object.keys(patch).join(', ')}` });
  } catch {
    /* logging never blocks */
  }
  return next;
}
