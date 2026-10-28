/**
 * R18-A1 / A3: the company object `mrchartist_inv_society_settings` (State, cycle, bill day, due days, heads, area unit,
 * confirmed State rows; B–D add theirs). Owner only (`settings.manage`), audited on save, synced as a singleton, backed
 * up. Absent = nothing society, so existing companies see no change. Keys this package does not know (B–D sub-fields)
 * are kept as stored.
 */
import './hs-registry';
import { DB_PREFIX, getJson, setJson } from '../storage';
import { requireAccess } from '../access';
import { audit } from '../audit';
import type { HsHead, SocietySettings } from '../../types/society-r18';
import { BASES, CYCLES, HEAD_KINDS } from './hs-tariff';
import { HS_OBJECTS } from './hs-shared';

export const SOCIETY_SETTINGS_KEY = `${DB_PREFIX}${HS_OBJECTS.settings}`;

export function readSocietySettings(): SocietySettings {
  try {
    const r = getJson<SocietySettings | null>(SOCIETY_SETTINGS_KEY, null);
    return r && typeof r === 'object' ? r : {};
  } catch {
    return {};
  }
}

/** A head as stored: known kind / basis, a rate ≥ 0, a name. */
const cleanHead = (h: HsHead): HsHead | null =>
  h && h.id && h.name?.trim() && HEAD_KINDS.includes(h.kind) && BASES.includes(h.basis)
    ? { ...h, name: h.name.trim(), rate: Number.isFinite(h.rate) && h.rate >= 0 ? Math.round(h.rate * 10000) / 10000 : 0, active: h.active !== false }
    : null;

/** Owner only: merge `patch` into the society settings (audited). Returns the saved settings. */
export function saveSocietySettings(patch: Partial<SocietySettings>): SocietySettings {
  requireAccess('settings.manage');
  const next: SocietySettings = { ...readSocietySettings(), ...patch, updated_at: new Date().toISOString() };
  if (next.heads) next.heads = next.heads.map(cleanHead).filter((h): h is HsHead => !!h);
  if (next.cycle && !CYCLES.includes(next.cycle)) delete next.cycle;
  if (next.bill_day !== undefined && !(Number.isInteger(next.bill_day) && next.bill_day >= 1 && next.bill_day <= 28)) delete next.bill_day;
  if (next.due_days !== undefined && !(Number.isInteger(next.due_days) && next.due_days >= 0 && next.due_days <= 120)) delete next.due_days;
  if (next.state !== undefined && !/^\d{2}$/.test(next.state)) delete next.state;
  setJson(SOCIETY_SETTINGS_KEY, next);
  try {
    audit.record({ entity: 'settings', entity_id: HS_OBJECTS.settings, action: 'update', summary: `Society settings: ${Object.keys(patch).join(', ')}` });
  } catch {
    /* logging never blocks */
  }
  return next;
}

/**
 * R18-A1 profile defaults (pure; a value the user set is kept): the society's State (default the sender's), monthly
 * cycle, bill day 1, 15 due days, area in sq ft.
 */
export function societyDefaultsFor(state: string | undefined, cur: SocietySettings = {}): SocietySettings {
  return { ...cur, state: cur.state ?? (state && /^\d{2}$/.test(state) ? state : undefined), cycle: cur.cycle ?? 'monthly', bill_day: cur.bill_day ?? 1, due_days: cur.due_days ?? 15, area_unit: cur.area_unit ?? 'sqft' };
}

/** Owner only: write the profile's defaults (audited). */
export const applySocietyDefaults = (state?: string): SocietySettings => saveSocietySettings(societyDefaultsFor(state, readSocietySettings()));
