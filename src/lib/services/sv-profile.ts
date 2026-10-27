/**
 * SV-A1 service profile: the kind picked under "Services" (setup wizard, Settings → Features). The settings patch
 * (business type `services`, modules, explicit packs, `service_kind`) comes from `shop-presets.ts` `applyServiceKind`;
 * this module writes the profile's switches into `service_settings` and never turns a switch the user set back on —
 * a profile only fills switches that were never set. Changing the profile deletes nothing; packs turned off only hide
 * tabs. Existing services companies (no `service_kind`) are untouched until they pick (checklist step).
 */
import type { ServiceSettings } from '../../types/services-r10';
import type { ServiceKindId } from '../shop-presets';
import { readServiceSettings, saveServiceSettings } from './sv-settings';

type Switches = Pick<ServiceSettings, 'rule46a' | 'staff_required' | 'itc_caution' | 'no_itc_as_exempt' | 'checkin_gate'>;

/** The switches each kind turns on (PRD SV-A1 table; SV-B … SV-D add their own objects). */
export const SERVICE_SWITCHES: Readonly<Record<ServiceKindId, Switches>> = {
  clinic: { rule46a: true, itc_caution: true, no_itc_as_exempt: true },
  lab: { rule46a: true },
  salon: { staff_required: true, itc_caution: true, no_itc_as_exempt: true },
  fitness: { itc_caution: true, no_itc_as_exempt: true, checkin_gate: 'warn' },
  coaching: { rule46a: true },
  workshop: {},
  appliance: {},
  professional: {},
  other: {},
};

/** The service settings after applying `kind`'s switches to `current` (pure; a switch already set is kept). */
export function serviceSwitchesFor(kind: ServiceKindId, current: ServiceSettings = {}): ServiceSettings {
  const next: ServiceSettings = { ...current };
  for (const [k, v] of Object.entries(SERVICE_SWITCHES[kind]) as [keyof Switches, never][]) if (next[k] === undefined) next[k] = v;
  return next;
}

/** Owner only: write the profile's switches (audited). */
export function applyServiceSwitches(kind: ServiceKindId): ServiceSettings {
  return saveServiceSettings(serviceSwitchesFor(kind, readServiceSettings()));
}
