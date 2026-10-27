/**
 * AG-A1 agri profile: the kind picked on the "Farm, dairy & food processing" card (setup wizard, Settings → Features
 * "Agriculture profile"). The settings patch (business type, modules, explicit packs, `agri_kind`, `mill_kind`) comes
 * from `shop-presets.ts` `applyAgriKind`; this module writes the kind's switches and default cycles into
 * `agri_settings` and never turns back a switch the user set — a profile only fills switches that were never set.
 * Changing the profile deletes nothing; switches turned off only hide views.
 */
import type { AgCycleSettings, AgSwitches, AgriSettings } from '../../types/agri-r12';
import type { AgriKindId } from '../shop-presets';
import { readAgriSettings, saveAgriSettings } from './ag-settings';

/** The switches each kind turns on (PRD AG-A1 table). */
export const AGRI_SWITCHES: Readonly<Record<AgriKindId, AgSwitches>> = {
  fpo: { vouchers: true, quality: true, cycles: true, members: true, patronage: true, input_sales: true, weighing: true },
  coop: { members: true, cycles: true, input_sales: true, vouchers: true },
  dairy: { cycles: true, feed_setoff: true, analyser: true, dispatch: true, cash_6dde: true },
  mill: { vouchers: true, weighbridge: true, moisture_cut: true, quality: true, cmr: true, packing_rule: true, weighing: true },
  cold: { lots: true, season_rent: true, lot_loans: true },
  inputs: { licences: true, subsidy: true, harvest_credit: true },
  farm: { batches: true, agri_income: true },
  other: { vouchers: true },
};

/** Default cycles per kind (dairy 10-day, FPO weekly, others 10-day when they pay farmers). */
const CYCLES: Partial<Record<AgriKindId, AgCycleSettings>> = { dairy: { length: '10day', pay_lag_days: 2 }, fpo: { length: 'weekly', pay_lag_days: 3 }, coop: { length: '10day', pay_lag_days: 3 } };

/** The agri settings after applying `kind` to `current` (pure; switches already set are kept). */
export function agriSwitchesFor(kind: AgriKindId, current: AgriSettings = {}): AgriSettings {
  const switches: AgSwitches = { ...current.switches };
  for (const [k, v] of Object.entries(AGRI_SWITCHES[kind]) as [keyof AgSwitches, boolean][]) if (switches[k] === undefined) switches[k] = v;
  return { ...current, switches, ...(!current.cycles && CYCLES[kind] ? { cycles: CYCLES[kind] } : {}) };
}

/** Owner only: write the profile's switches (audited). */
export const applyAgriSwitches = (kind: AgriKindId): AgriSettings => saveAgriSettings(agriSwitchesFor(kind, readAgriSettings()));
