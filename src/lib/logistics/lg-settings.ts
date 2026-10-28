/**
 * R19-A1 / A3: the company object `mrchartist_inv_logistics_settings` (heads, job prefix, currency; B–D add theirs).
 * Owner only (`settings.manage`), audited on save, synced as a singleton, backed up. Absent = nothing logistics, so
 * existing companies see no change; `lgDefaultsFor` fills what is not stored when the desk reads it, so picking the
 * profile writes nothing here. Keys this package does not know (B–D sub-fields) are kept as stored.
 */
import './lg-registry';
import { DB_PREFIX, getJson, setJson } from '../storage';
import { requireAccess } from '../access';
import { audit } from '../audit';
import type { LogisticsSettings } from '../../types/logistics-r19';
import { defaultHeads, headOk } from './lg-heads';
import { LG_OBJECTS } from './lg-shared';
import { VOLUMETRIC_DEFAULT } from './lg-weight';

export const LOGISTICS_SETTINGS_KEY = `${DB_PREFIX}${LG_OBJECTS.settings}`;

export function readLogisticsSettings(): LogisticsSettings {
  const r = getJson<LogisticsSettings | null>(LOGISTICS_SETTINGS_KEY, null);
  return r && typeof r === 'object' ? r : {};
}

/** The profile's defaults (pure; a stored value wins): no heads, USD, kg, one document per POS / currency, accruals on, gross disbursements, the volumetric conventions. */
export const lgDefaultsFor = (cur: LogisticsSettings = readLogisticsSettings()): LogisticsSettings => ({ heads: [], default_currency: 'USD', weight_unit: 'kg', split: 'pos_currency', accrue: true, disb_posting: 'gross', volumetric: { ...VOLUMETRIC_DEFAULT }, ...cur });

/** Owner only: merge `patch` into the logistics settings (audited); heads without a name or of an unknown kind / role / unit are dropped. */
export function saveLogisticsSettings(patch: Partial<LogisticsSettings>): LogisticsSettings {
  requireAccess('settings.manage');
  const next: LogisticsSettings = { ...readLogisticsSettings(), ...patch, updated_at: new Date().toISOString() };
  if (next.heads) next.heads = next.heads.filter(headOk).map((h) => ({ ...h, name: h.name.trim() }));
  setJson(LOGISTICS_SETTINGS_KEY, next);
  try {
    audit.record({ entity: 'settings', entity_id: LG_OBJECTS.settings, action: 'update', summary: `Logistics settings: ${Object.keys(patch).join(', ')}` });
  } catch {
    /* logging never blocks */
  }
  return next;
}

/** "Default heads": adds the default heads whose id is not there yet (never overwrites an edited head). */
export function addDefaultHeads(date: string): LogisticsSettings {
  const cur = readLogisticsSettings().heads ?? [];
  return saveLogisticsSettings({ heads: [...cur, ...defaultHeads(date).filter((h) => !cur.some((x) => x.id === h.id))] });
}
