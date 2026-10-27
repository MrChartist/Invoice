/**
 * AG-A1: the company object `mrchartist_inv_agri_settings` (centres, cycles, switches; B–D add milk, chambers,
 * licences, principals, seasons). Owner only (`settings.manage`), audited on save, synced as a singleton, backed up.
 * Absent = nothing agri, so existing companies see no change. Object-valued keys this package does not know (B–D
 * sub-fields) are kept as stored.
 */
import './ag-registry';
import { DB_PREFIX, generateId, getJson, setJson } from '../storage';
import { requireAccess } from '../access';
import { audit } from '../audit';
import type { AgCentre, AgCycleSettings, AgriSettings } from '../../types/agri-r12';
import { AG_OBJECTS } from './ag-shared';

export const AGRI_SETTINGS_KEY = `${DB_PREFIX}${AG_OBJECTS.agriSettings}`;
const LENGTHS = ['weekly', '10day', 'fortnight', 'monthly'] as const;
const KINDS = ['milk', 'cluster', 'mill_gate', 'cold'] as const;

const cycles = (c: unknown): AgCycleSettings | undefined => {
  const x = c as Partial<AgCycleSettings> | null;
  if (!x || !LENGTHS.includes(x.length as 'weekly')) return undefined;
  return { length: x.length!, pay_lag_days: Math.max(0, Math.min(60, Math.round(Number(x.pay_lag_days) || 0))), ...(Number.isInteger(x.start_day) ? { start_day: Math.max(0, Math.min(6, Number(x.start_day))) } : {}) };
};

/** Pure: clean a stored object (bad values dropped; unknown object-valued keys kept for B–D). */
export function cleanAgriSettings(raw: unknown): AgriSettings {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) if (!['centres', 'cycles', 'switches', 'next_code', 'bonus_mode', 'updated_at'].includes(k) && v && typeof v === 'object') out[k] = v;
  if (Array.isArray(r.centres)) {
    const cs = r.centres.filter((c): c is AgCentre => !!c && typeof c === 'object' && typeof (c as AgCentre).name === 'string' && !!(c as AgCentre).name.trim())
      .map((c) => ({ id: typeof c.id === 'string' && c.id ? c.id : generateId(), name: c.name.trim().slice(0, 80), kind: KINDS.includes(c.kind) ? c.kind : 'cluster', ...(c.godown_id ? { godown_id: String(c.godown_id) } : {}), ...(cycles(c.cycles) ? { cycles: cycles(c.cycles) } : {}) } as AgCentre));
    if (cs.length) out.centres = cs;
  }
  if (cycles(r.cycles)) out.cycles = cycles(r.cycles);
  if (r.switches && typeof r.switches === 'object') out.switches = Object.fromEntries(Object.entries(r.switches).filter(([, v]) => typeof v === 'boolean'));
  if (Number.isInteger(r.next_code) && Number(r.next_code) > 0) out.next_code = Number(r.next_code);
  if (r.bonus_mode === 'price_difference' || r.bonus_mode === 'patronage') out.bonus_mode = r.bonus_mode;
  if (typeof r.updated_at === 'string') out.updated_at = r.updated_at;
  return out as AgriSettings;
}

export function readAgriSettings(): AgriSettings {
  try {
    return cleanAgriSettings(getJson<unknown>(AGRI_SETTINGS_KEY, null));
  } catch {
    return {};
  }
}

const describe = (s: AgriSettings): string =>
  [s.centres?.length && `${s.centres.length} centre(s)`, s.cycles && `cycles ${s.cycles.length}`, s.switches && `${Object.values(s.switches).filter(Boolean).length} switch(es) on`].filter(Boolean).join(', ') || 'defaults';

/** Owner only: merge `patch` into the agri settings (audited). Returns the saved settings. */
export function saveAgriSettings(patch: Partial<AgriSettings>): AgriSettings {
  requireAccess('settings.manage');
  const before = readAgriSettings();
  const next = cleanAgriSettings({ ...before, ...patch, updated_at: new Date().toISOString() });
  setJson(AGRI_SETTINGS_KEY, next);
  try {
    audit.record({ entity: 'settings', entity_id: AG_OBJECTS.agriSettings, action: 'update', summary: `Agri settings: ${describe(before)} → ${describe(next)}` });
  } catch {
    /* logging never blocks */
  }
  return readAgriSettings();
}

/** The cycle settings of a centre (its override, else the company's, else 10-day). */
export const cyclesOf = (s: AgriSettings, centreId?: string): AgCycleSettings =>
  s.centres?.find((c) => c.id === centreId)?.cycles ?? s.cycles ?? { length: '10day', pay_lag_days: 0 };
