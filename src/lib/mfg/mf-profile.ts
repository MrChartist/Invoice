/**
 * MF-A1 manufacturing profile: the kind picked on the "Factory / manufacturing" card (setup wizard, Settings → Features
 * "Manufacturing profile"). The settings patch (business type, modules, packs, `mfg_kind`, `mfg_sub`) comes from
 * `shop-presets.ts` `applyMfgKind`; this module writes the kind's switches into `mfg_settings` and never turns back a
 * switch the user set — a profile only fills switches that were never set. Changing the profile deletes nothing.
 */
import type { MfSwitches, MfgSettings } from '../../types/mfg-r13';
import type { MfgKindId } from '../shop-presets';
import { readMfgSettings, saveMfgSettings } from './mf-settings';

const CORE: MfSwitches = { routings: true, job_cards: true };

/** The switches each kind turns on (PRD MF-A1 table). Textile cut plans only for garment units (`sub`). */
export function mfSwitchesOf(kind: MfgKindId, sub?: string): MfSwitches {
  switch (kind) {
    case 'engineering': return { ...CORE, machine_hours: true, drawings: true, scrap: true, inspection: true };
    case 'textile': return { ...CORE, styles: true, ...(sub === undefined || sub === 'garments' ? { cut_plans: true } : {}), bundles: true, cmt: true, karigars: true, price_bands: true };
    case 'plastics': return { ...CORE, runs: true, regrind: true, balance: true, epr: true, scrap: true };
    case 'printing': return { ...CORE, estimates: true, tickets: true, paper_gsm: true, print_classes: true };
    case 'food': return { ...CORE, cost_cards: true, shelf_life: true, fssai_print: true, min_shelf: true, schemes: true };
    default: return { ...CORE };
  }
}

/** The manufacturing settings after applying `kind` to `current` (pure; switches already set are kept). */
export function mfgSwitchesFor(kind: MfgKindId, current: MfgSettings = {}, sub?: string): MfgSettings {
  const switches: MfSwitches = { ...current.switches };
  for (const [k, v] of Object.entries(mfSwitchesOf(kind, sub)) as [keyof MfSwitches, boolean][]) if (switches[k] === undefined) switches[k] = v;
  return { ...current, switches };
}

/** Owner only: write the profile's switches (audited). */
export const applyMfgSwitches = (kind: MfgKindId, sub?: string): MfgSettings => saveMfgSettings(mfgSwitchesFor(kind, readMfgSettings(), sub));
