/**
 * R15-B1 travel profile: the kind picked under Services → Travel, tours and events (setup wizard, Settings → Features
 * "Travel profile"). The settings patch (business type, modules, packs, `travel_kind`) comes from `shop-presets.ts`
 * `applyTravelKind`; this module writes the kind's regime default and switches into `travel_settings` (never turning
 * back a value the user set). Changing the profile deletes nothing.
 */
import type { TravelKind, TravelSettings, TvRegime, TvSwitches } from '../../types/travel-r15';
import { readTravelSettings, saveTravelSettings } from './tv-settings';

/** The regime default and switches each kind turns on (PRD B1 table). */
export function tvProfileOf(kind: TravelKind): { regime: TvRegime; switches: TvSwitches } {
  switch (kind) {
    case 'tour_operator': return { regime: 'to5', switches: { itc_block: true, tcs_outbound: true, costing: true } };
    case 'agent': return { regime: 'agent', switches: { tickets: true, statements: true, commissions: true, pure_agent: true } };
    case 'inbound': return { regime: 'to18', switches: { foreign_currency: true, export_chip: true, exempt_prompt: true } };
    case 'events': return { regime: 'to18', switches: { budgets: true, event_pos: true, vendor_tds: true } };
    default: return { regime: 'to18', switches: {} };
  }
}

/** The settings after applying `kind` to `current` (pure; a regime / switch already set is kept). */
export function travelSwitchesFor(kind: TravelKind, current: TravelSettings = {}): TravelSettings {
  const p = tvProfileOf(kind);
  const switches: TvSwitches = { ...current.switches };
  for (const [k, v] of Object.entries(p.switches) as [keyof TvSwitches, boolean][]) if (switches[k] === undefined) switches[k] = v;
  return { ...current, regime_default: current.regime_default ?? p.regime, switches };
}

/** Owner only: write the profile's regime default and switches (audited). */
export const applyTravelSwitches = (kind: TravelKind, bsp?: boolean): TravelSettings => {
  const next = travelSwitchesFor(kind, readTravelSettings());
  if (kind === 'agent' && bsp !== undefined) next.iata = { ...next.iata, bsp };
  return saveTravelSettings(next);
};
