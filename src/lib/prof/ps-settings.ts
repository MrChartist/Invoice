/**
 * PS-A1: the company object `mrchartist_inv_prof_settings` (switches, WIP reasons / buckets / accrual date, legal / CA
 * ids; B–D add their sub-objects). Owner only (`settings.manage`), audited on save, synced as a singleton, backed up.
 * Absent = nothing professional, so existing companies see no change. Object-valued keys this package does not know
 * (B–D sub-fields) are kept as stored.
 */
import './ps-registry';
import { DB_PREFIX, getJson, setJson } from '../storage';
import { requireAccess } from '../access';
import { audit } from '../audit';
import { ruleAt } from '../tax-rules';
import { WIP_DEFAULTS } from '../prof-rules';
import type { ProfSettings } from '../../types/prof-r14';
import { PS_OBJECTS } from './ps-shared';

export const PROF_SETTINGS_KEY = `${DB_PREFIX}${PS_OBJECTS.profSettings}`;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const txt = (v: unknown, n = 60) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

/** Pure: clean a stored object (bad values dropped; unknown object-valued keys kept for B–D). */
export function cleanProfSettings(raw: unknown): ProfSettings {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) if (v !== null && v !== undefined && typeof v === 'object' && !['switches', 'wip'].includes(k)) out[k] = v;
  if (r.switches && typeof r.switches === 'object') out.switches = Object.fromEntries(Object.entries(r.switches).filter(([, v]) => typeof v === 'boolean'));
  const w = r.wip as Record<string, unknown> | undefined;
  if (w && typeof w === 'object') {
    const reasons = Array.isArray(w.reasons) ? [...new Set(w.reasons.map((x) => txt(x, 40)).filter(Boolean))] : [];
    const buckets = Array.isArray(w.buckets) ? [...new Set(w.buckets.map(Number).filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => a - b) : [];
    out.wip = { ...(reasons.length ? { reasons } : {}), ...(buckets.length ? { buckets } : {}), ...(DAY.test(txt(w.accrue_from)) ? { accrue_from: txt(w.accrue_from) } : {}) };
  }
  if (typeof r.updated_at === 'string') out.updated_at = r.updated_at;
  return out as ProfSettings;
}

export function readProfSettings(): ProfSettings {
  try {
    return cleanProfSettings(getJson<unknown>(PROF_SETTINGS_KEY, null));
  } catch {
    return {};
  }
}

/** The firm's write-down reasons and ageing buckets (else the practice list). */
export function wipRules(s: ProfSettings = readProfSettings()): { reasons: readonly string[]; buckets: readonly number[] } {
  const d = ruleAt(WIP_DEFAULTS);
  return { reasons: s.wip?.reasons ?? d.reasons, buckets: s.wip?.buckets ?? d.buckets };
}

/** Owner only: merge `patch` into the professional settings (audited). Returns the saved settings. */
export function saveProfSettings(patch: Partial<ProfSettings>): ProfSettings {
  requireAccess('settings.manage');
  const before = readProfSettings();
  const next = cleanProfSettings({ ...before, ...patch, updated_at: new Date().toISOString() });
  setJson(PROF_SETTINGS_KEY, next);
  const on = (s: ProfSettings) => Object.values(s.switches ?? {}).filter(Boolean).length;
  try {
    audit.record({ entity: 'settings', entity_id: PS_OBJECTS.profSettings, action: 'update', summary: `Professional settings: ${on(before)} → ${on(next)} switch(es) on${next.wip?.accrue_from !== before.wip?.accrue_from ? `; WIP accrual from ${next.wip?.accrue_from ?? 'off'}` : ''}` });
  } catch {
    /* logging never blocks */
  }
  return readProfSettings();
}
