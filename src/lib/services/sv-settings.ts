/**
 * SV-A1: the company object `mrchartist_inv_service_settings` (resources, opening hours, slot step, message templates,
 * staff on paper, tips, Rule 46A, the no-ITC switches). Owner only (`settings.manage`), audited on save, synced as a
 * singleton, backed up. Absent = today's behaviour, so existing services companies see no change.
 */
import './sv-registry';
import { DB_PREFIX, generateId, getJson, setJson } from '../storage';
import { requireAccess } from '../access';
import { audit } from '../audit';
import type { ServiceSettings, SvDayHours, SvResource } from '../../types/services-r10';
import { SV_OBJECTS } from './sv-shared';

export const SERVICE_SETTINGS_KEY = `${DB_PREFIX}${SV_OBJECTS.serviceSettings}`;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const STEPS = [5, 10, 15, 30] as const;
export const DEFAULT_HOURS: SvDayHours = { open: '10:00', close: '20:00' };

/** Default `wa.me` texts (en); the desk offers the Hindi ones when the interface is Hindi. */
export const DEFAULT_MESSAGES = {
  confirm: 'Hello {name}, your appointment at {business} is confirmed for {date} at {time} with {staff}.',
  reminder: 'Hello {name}, a reminder of your appointment at {business} tomorrow, {date} at {time} with {staff}.',
  birthday: 'Happy birthday {name}! Best wishes from all of us at {business}.',
} as const;

const str = (v: unknown, max = 400) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);

/** Pure: clean a stored object (unknown keys and bad values dropped). */
export function cleanServiceSettings(raw: unknown): ServiceSettings {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const out: ServiceSettings = {};
  if (Array.isArray(r.resources)) {
    const res = r.resources.filter((x): x is SvResource => !!x && typeof x === 'object' && !!str((x as SvResource).name))
      .map((x) => ({ id: str(x.id, 60) ?? generateId(), name: str(x.name, 60)!, kind: (['room', 'chair', 'bay'] as const).includes(x.kind as 'room') ? x.kind : 'other', ...(x.active === false ? { active: false } : {}) } as SvResource));
    if (res.length) out.resources = res;
  }
  if (Array.isArray(r.hours) && r.hours.length === 7) {
    out.hours = r.hours.map((h) => {
      const x = (h ?? {}) as Partial<SvDayHours>;
      const open = HHMM.test(String(x.open)) ? String(x.open) : DEFAULT_HOURS.open;
      const close = HHMM.test(String(x.close)) && String(x.close) > open ? String(x.close) : DEFAULT_HOURS.close;
      return { open, close, ...(x.closed ? { closed: true } : {}) };
    });
  }
  if (STEPS.includes(Number(r.slot_step) as 5)) out.slot_step = Number(r.slot_step) as ServiceSettings['slot_step'];
  if (r.messages && typeof r.messages === 'object') {
    const m = r.messages as Record<string, unknown>;
    const msg = Object.fromEntries((['confirm', 'reminder', 'birthday'] as const).map((k) => [k, str(m[k])]).filter(([, v]) => v));
    if (Object.keys(msg).length) out.messages = msg;
  }
  for (const k of ['print_staff', 'staff_required', 'rule46a', 'no_itc_as_exempt', 'itc_caution', 'composition_note_seen'] as const) if (typeof r[k] === 'boolean') out[k] = r[k] as boolean;
  if (r.tips === 'pass-through' || r.tips === 'off') out.tips = r.tips;
  if (r.checkin_gate === 'off' || r.checkin_gate === 'warn' || r.checkin_gate === 'block') out.checkin_gate = r.checkin_gate;
  if (r.upgrade_mode === 'difference' || r.upgrade_mode === 'credit_note') out.upgrade_mode = r.upgrade_mode; // SV-C
  if (typeof r.defer_package_income === 'boolean') out.defer_package_income = r.defer_package_income; // PENDING #20
  if (typeof r.defer_package_from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.defer_package_from)) out.defer_package_from = r.defer_package_from;
  if (typeof r.updated_at === 'string') out.updated_at = r.updated_at;
  return out;
}

export function readServiceSettings(): ServiceSettings {
  try {
    return cleanServiceSettings(getJson<unknown>(SERVICE_SETTINGS_KEY, null));
  } catch {
    return {};
  }
}

const describe = (s: ServiceSettings): string =>
  [s.slot_step && `slot ${s.slot_step} min`, s.resources?.length && `${s.resources.length} resource(s)`, s.rule46a && 'Rule 46A title', s.itc_caution && 'ITC caution', s.no_itc_as_exempt === false && 'no-ITC turnover taxable in Rule 42', s.staff_required && 'staff required', s.print_staff && 'staff on paper', s.tips === 'pass-through' && 'tips', s.checkin_gate && `check-in ${s.checkin_gate}`, s.defer_package_income && `package income deferred from ${s.defer_package_from ?? '—'}`].filter(Boolean).join(', ') || 'defaults';

/** Owner only: merge `patch` into the service settings (audited). Returns the saved settings. */
export function saveServiceSettings(patch: Partial<ServiceSettings>): ServiceSettings {
  requireAccess('settings.manage');
  const before = readServiceSettings();
  const next = cleanServiceSettings({ ...before, ...patch, updated_at: new Date().toISOString() });
  setJson(SERVICE_SETTINGS_KEY, next);
  try {
    audit.record({ entity: 'settings', entity_id: SV_OBJECTS.serviceSettings, action: 'update', summary: `Service settings: ${describe(before)} → ${describe(next)}` });
  } catch {
    /* logging never blocks */
  }
  return readServiceSettings();
}

/** Opening hours of a weekday (0 = Monday). */
export const hoursOf = (s: ServiceSettings, weekday: number): SvDayHours => s.hours?.[weekday] ?? DEFAULT_HOURS;
