/**
 * PS-A1 professional profile: the kind picked under Services → Professional (setup wizard, Settings → Features
 * "Professional profile"). The settings patch (business type, modules, packs, `prof_kind`, `prof_sub`) comes from
 * `shop-presets.ts` `applyProfKind`; this module writes the kind's switches into `prof_settings` (never turning back a
 * switch the user set), the advocate's / CA's ids, and the firm form — which IS the annual pack's entity type (one value,
 * `notes_to_accounts.entity_type` of the current FY), never a second field. Changing the profile deletes nothing.
 */
import type { FirmForm, ProfKind, ProfSettings, PsSwitches } from '../../types/prof-r14';
import { getTable, setTable } from '../storage';
import { requireAccess } from '../access';
import { audit } from '../audit';
import { localDb } from '../localDb';
import { getIndianFY } from '../invoice-number';
import { todayInput } from '../utils';
import { readProfSettings, saveProfSettings } from './ps-settings';

const CORE: PsSwitches = { matters: true, prebill: true };

/** The switches each kind turns on (PRD PS-A1 table); `sub` = the kind's sub-choice. */
export function psSwitchesOf(kind: ProfKind, sub?: string): PsSwitches {
  const exp = sub === 'exports' ? { export_check: true, fx_cards: true } : {};
  switch (kind) {
    case 'ca': return { ...CORE, engagements: true, fee_schedule: true, udin_lines: true, disb_agent: true, tds_194j: true };
    case 'legal': return { ...CORE, engagements: true, conflicts: true, conflict_first: true, rcm_by_client: true, fee_memo: true, client_money: true, success_prompt: true, disb_agent: true };
    case 'design': return { ...CORE, engagements: true, stages: true, property_pos: true };
    case 'consulting': return { ...CORE, engagements: true, utilisation: true, ...exp };
    case 'agency': return { ...CORE, engagements: true, media: true, tds_194c: true };
    case 'freelancer': return { ...CORE, presumptive: true, threshold: true, ...exp };
    default: return { ...CORE };
  }
}

/** The settings after applying `kind` to `current` (pure; switches already set are kept). */
export function profSwitchesFor(kind: ProfKind, current: ProfSettings = {}, sub?: string): ProfSettings {
  const switches: PsSwitches = { ...current.switches };
  for (const [k, v] of Object.entries(psSwitchesOf(kind, sub)) as [keyof PsSwitches, boolean][]) if (switches[k] === undefined) switches[k] = v;
  return { ...current, switches };
}

export interface ProfIds { enrolment?: string; bar_council?: string; membership?: string; frn?: string }

/** Owner only: write the profile's switches and the advocate's / CA's ids (audited). */
export function applyProfSwitches(kind: ProfKind, sub?: string, ids: ProfIds = {}): ProfSettings {
  const cur = profSwitchesFor(kind, readProfSettings(), sub);
  const t = (v?: string) => v?.trim() || undefined;
  if (kind === 'legal' && (t(ids.enrolment) || t(ids.bar_council))) cur.legal = { ...cur.legal, ...(t(ids.enrolment) ? { enrolment: t(ids.enrolment) } : {}), ...(t(ids.bar_council) ? { bar_council: t(ids.bar_council) } : {}) };
  if (kind === 'ca' && (t(ids.membership) || t(ids.frn))) cur.ca = { ...cur.ca, ...(t(ids.membership) ? { membership: t(ids.membership) } : {}), ...(t(ids.frn) ? { frn: t(ids.frn) } : {}) };
  return saveProfSettings(cur);
}

const NOTES = 'notes_to_accounts';

/** The firm form: the latest FY's annual-pack entity type (absent = not asked yet). */
export function readFirmForm(): FirmForm | undefined {
  const rows = getTable<{ id?: string; entity_type?: FirmForm }>(NOTES).filter((r) => r?.entity_type).sort((a, b) => String(b.id).localeCompare(String(a.id)));
  return rows[0]?.entity_type;
}

/** Write the firm form as the current FY's entity type (the annual pack's own row; its notes kept; audited). */
export function writeFirmForm(form: FirmForm, day = todayInput()): void {
  requireAccess('books.edit');
  const fy = getIndianFY(day).label;
  const id = `FY${fy}`;
  const rows = getTable<{ id?: string; notes?: object; entity_type?: FirmForm }>(NOTES);
  const prev = rows.find((r) => r?.id === id);
  if (prev?.entity_type === form) return;
  setTable(NOTES, [...rows.filter((r) => r?.id !== id), { notes: {}, ...prev, id, entity_type: form, updated_at: new Date().toISOString() }]);
  audit.record({ entity: 'settings', entity_id: id, action: prev ? 'update' : 'create', summary: `Firm form for ${id}: ${form} (professional profile)` });
}

/** A professional company (any kind)? Used to hide the profession's rows from everyone else. */
export const isProfessional = (): boolean => typeof localDb.settings.get().prof_kind === 'string';
