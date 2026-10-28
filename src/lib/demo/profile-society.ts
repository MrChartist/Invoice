/**
 * R18 sample rows of the society profile (Demo company only, R6-B4). Dispatched by the Demo company's pack `society`;
 * one block per package (§6 of docs/prd/round-18.md). Pure: the units go through `DemoExtras.tables`; the MH tariff is
 * returned as `societySettings` and written by `fillDemo` (only while the Demo company is open, only when absent).
 */
import type { DemoExtras } from '../demo-data';
import type { HsHead, SocietySettings, SocietyUnit } from '../../types/society-r18';
import type { ProfileContext } from './profiles';

export function societyExtras(ctx: ProfileContext): DemoExtras & { societySettings: SocietySettings } {
  // R18-A: "Demo Sunshine CHS" (Maharashtra) — wing A (A-101, A-102 let out, A-901 with two slots) and shop S-1, the MH tariff.
  const heads = ([['Service charges', 'service', 'per_unit', 3000], ['Sinking fund', 'sinking', 'cost_pct_pa', 0.25], ['Repair fund', 'repair', 'cost_pct_pa', 0.75], ['Property tax', 'statutory', 'typed', 0], ['Parking', 'parking', 'per_slot', 500], ['Non-occupancy', 'non_occupancy', 'pct_of_head', 10], ['Education', 'education', 'fixed_member', 10]] as const)
    .map(([name, kind, basis, rate], i): HsHead => ({ id: `dh${i}`, name, kind, basis, rate, ...(kind === 'statutory' ? {} : { sac: '999598' }), active: true }));
  const units = ([['A-101', 600, 1, 1200], ['A-102', 600, 1, 1200], ['A-901', 1500, 2, 3000], ['S-1', 300, 0, 900]] as const).map(([code, area, slots, tax], i): SocietyUnit => ({
    id: `demo-hs-${i}`, code, ...(i < 3 ? { wing: 'A' } : {}), use: i < 3 ? 'residential' : 'commercial', carpet_area: area, construction_cost: area * 4000, owner_id: ctx.base.clients[i % ctx.base.clients.length]?.id,
    occupancy: i === 1 ? 'tenant' : 'owner', parking: Array.from({ length: slots }, (_, k) => ({ slot: `P${i}${k}`, kind: 'covered' })), typed: { dh3: tax }, status: 'active', updated_at: `${ctx.today}T09:00:00.000Z`, demo: true,
  }));
  return { tables: { society_units: units as never[] }, societySettings: { state: '27', cycle: 'monthly', due_days: 15, heads } };
}
