/**
 * PS-D reads and writes of PS-A's profile data (PRD §6): the `ca` sub-object of `prof_settings` (PS-D5 company links,
 * through PS-A's `ps-settings.ts`), the profile kind (`settings.prof_kind`) and the firm form (`ps-profile.ts`, the annual
 * pack's entity type — never a second field).
 */
import { SINGLETON_KEYS, getJson } from '../storage';
import type { EntityType } from '../../types/books-r2';
import type { ProfCaSettings } from '../../types/prof-r14';
import { readProfSettings, saveProfSettings } from './ps-settings';
import { readFirmForm } from './ps-profile';

/** `prof_settings.ca` (links cleaned: one row per company). */
export function readCaSettings(): ProfCaSettings {
  const ca = readProfSettings().ca ?? {};
  const seen = new Set<string>();
  const links = (Array.isArray(ca.company_clients) ? ca.company_clients : []).filter((l) => l && typeof l.company_id === 'string' && typeof l.client_id === 'string' && !seen.has(l.company_id) && !!seen.add(l.company_id));
  return { ...ca, company_clients: links };
}

/** Owner only (audited by `saveProfSettings`): link a company on this device to a client of the firm ('' unlinks). */
export function linkCompany(companyId: string, clientId: string, gstin?: string): ProfCaSettings {
  const ca = readCaSettings();
  const rest = (ca.company_clients ?? []).filter((l) => l.company_id !== companyId);
  saveProfSettings({ ca: { ...ca, company_clients: clientId ? [...rest, { company_id: companyId, client_id: clientId, ...(gstin ? { gstin: gstin.toUpperCase() } : {}) }] : rest } });
  return readCaSettings();
}

/** `settings.prof_kind` (PS-A1), '' when the company has no professional profile. */
export function profKind(): string {
  const k = (getJson<{ prof_kind?: unknown } | null>(SINGLETON_KEYS.settings, null) ?? {}).prof_kind;
  return typeof k === 'string' ? k : '';
}

/** The firm form (`proprietorship` when not asked yet). */
export const firmForm = (): EntityType => readFirmForm() ?? 'proprietorship';
