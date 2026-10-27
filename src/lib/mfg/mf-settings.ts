/**
 * MF-A1: the company object `mrchartist_inv_mfg_settings` (switches, reject reasons, scrap item; B–D add moulds,
 * presses, the absorb switch, the e-way note …). Owner only (`settings.manage`), audited on save, synced as a singleton,
 * backed up. Absent = nothing manufacturing, so existing companies see no change. Object-valued keys this package does
 * not know (B–D sub-fields) are kept as stored.
 */
import './mf-registry';
import { DB_PREFIX, getJson, setJson } from '../storage';
import { requireAccess } from '../access';
import { audit } from '../audit';
import { ruleAt } from '../tax-rules';
import { WORK_DEFAULTS } from '../mfg-rules';
import type { MfgSettings } from '../../types/mfg-r13';
import { MF_OBJECTS } from './mf-shared';

export const MFG_SETTINGS_KEY = `${DB_PREFIX}${MF_OBJECTS.mfgSettings}`;
const OWN = ['switches', 'reject_reasons', 'scrap_item_id', 'updated_at'];

/** Pure: clean a stored object (bad values dropped; unknown object-valued keys kept for B–D). */
export function cleanMfgSettings(raw: unknown): MfgSettings {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) if (!OWN.includes(k) && v !== null && v !== undefined) out[k] = v;
  if (r.switches && typeof r.switches === 'object') out.switches = Object.fromEntries(Object.entries(r.switches).filter(([, v]) => typeof v === 'boolean'));
  if (Array.isArray(r.reject_reasons)) {
    const rs = [...new Set(r.reject_reasons.filter((x): x is string => typeof x === 'string').map((x) => x.trim().slice(0, 40)).filter(Boolean))];
    if (rs.length) out.reject_reasons = rs;
  }
  if (typeof r.scrap_item_id === 'string' && r.scrap_item_id) out.scrap_item_id = r.scrap_item_id;
  if (typeof r.updated_at === 'string') out.updated_at = r.updated_at;
  return out as MfgSettings;
}

export function readMfgSettings(): MfgSettings {
  try {
    return cleanMfgSettings(getJson<unknown>(MFG_SETTINGS_KEY, null));
  } catch {
    return {};
  }
}

/** The reject reasons of the company (else the practice list). */
export const rejectReasons = (s: MfgSettings = readMfgSettings()): readonly string[] => s.reject_reasons ?? ruleAt(WORK_DEFAULTS).reject_reasons;

/** Owner only: merge `patch` into the manufacturing settings (audited). Returns the saved settings. */
export function saveMfgSettings(patch: Partial<MfgSettings>): MfgSettings {
  requireAccess('settings.manage');
  const before = readMfgSettings();
  const next = cleanMfgSettings({ ...before, ...patch, updated_at: new Date().toISOString() });
  setJson(MFG_SETTINGS_KEY, next);
  const on = (s: MfgSettings) => Object.values(s.switches ?? {}).filter(Boolean).length;
  try {
    audit.record({ entity: 'settings', entity_id: MF_OBJECTS.mfgSettings, action: 'update', summary: `Manufacturing settings: ${on(before)} → ${on(next)} switch(es) on` });
  } catch {
    /* logging never blocks */
  }
  return readMfgSettings();
}
