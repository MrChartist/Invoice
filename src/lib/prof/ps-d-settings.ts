/**
 * PS-D reads and writes of PS-A's profile data (PRD §6): the `ca` sub-object of the company object `prof_settings`
 * (PS-D5 company links; the object itself, its backup / sync rows and the profile picker are PS-A's), the profile kind
 * (`settings.prof_kind`) and the firm form (the annual pack's entity type — never a second field). Sub-objects this
 * package does not own are kept as stored.
 */
import { DB_PREFIX, SINGLETON_KEYS, getJson, getTable, setJson } from '../storage';
import { requireAccess } from '../access';
import { audit } from '../audit';
import type { EntityType } from '../../types/books-r2';
import type { ProfCaSettings } from '../../types/prof-r14d';

export const PROF_SETTINGS_KEY = `${DB_PREFIX}prof_settings`;

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});

/** `prof_settings.ca` (links cleaned: one row per company). */
export function readCaSettings(): ProfCaSettings {
  const ca = obj(obj(getJson<unknown>(PROF_SETTINGS_KEY, null)).ca) as ProfCaSettings;
  const seen = new Set<string>();
  const links = (Array.isArray(ca.company_clients) ? ca.company_clients : []).filter((l) => l && typeof l.company_id === 'string' && typeof l.client_id === 'string' && !seen.has(l.company_id) && seen.add(l.company_id));
  return { ...ca, company_clients: links };
}

/** Owner only: link (or with `clientId` '' unlink) a company on this device to a client of the open (firm) company. */
export function linkCompany(companyId: string, clientId: string, gstin?: string): ProfCaSettings {
  requireAccess('settings.manage');
  const all = obj(getJson<unknown>(PROF_SETTINGS_KEY, null));
  const ca = readCaSettings();
  const rest = (ca.company_clients ?? []).filter((l) => l.company_id !== companyId);
  const company_clients = clientId ? [...rest, { company_id: companyId, client_id: clientId, ...(gstin ? { gstin: gstin.toUpperCase() } : {}) }] : rest;
  setJson(PROF_SETTINGS_KEY, { ...all, ca: { ...ca, company_clients }, updated_at: new Date().toISOString() });
  try {
    audit.record({ entity: 'settings', entity_id: 'prof_settings', action: 'update', summary: clientId ? `CA desk: company ${companyId} linked to a client` : `CA desk: company ${companyId} unlinked` });
  } catch {
    /* logging never blocks */
  }
  return readCaSettings();
}

/** `settings.prof_kind` (PS-A1), '' when the company has no professional profile. */
export function profKind(): string {
  const k = obj(getJson<unknown>(SINGLETON_KEYS.settings, null)).prof_kind;
  return typeof k === 'string' ? k : '';
}

/** The firm form: the annual pack's entity type of the latest FY that set one (`proprietorship` when none). */
export function firmForm(): EntityType {
  const rows = getTable<{ id?: string; entity_type?: EntityType }>('notes_to_accounts').filter((r) => r?.entity_type).sort((a, b) => String(b.id).localeCompare(String(a.id)));
  return rows[0]?.entity_type ?? 'proprietorship';
}
