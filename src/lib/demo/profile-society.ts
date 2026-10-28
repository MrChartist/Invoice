/**
 * R18 sample rows of the society profile (Demo company only, R6-B4). Dispatched by the Demo company's pack `society`;
 * one block per package (§6 of docs/prd/round-18.md). Pure: the units go through `DemoExtras.tables`; the MH tariff is
 * returned as `societySettings` and written by `fillDemo` (only while the Demo company is open, only when absent).
 */
import type { DemoExtras } from '../demo-data';
import type { HsHead, SocietySettings, SocietyUnit } from '../../types/society-r18';
import type { ProfileContext } from './profiles';

export function societyExtras(ctx: ProfileContext): DemoExtras & { societySettings: SocietySettings } {
  const { today, base } = ctx;
  const at = `${today}T09:00:00.000Z`;
  const owner = (i: number) => base.clients[i % Math.max(1, base.clients.length)]?.id;
  // R18-A: "Demo Sunshine CHS" (Maharashtra) — wing A and a shop, with the MH tariff.
  const h = (id: string, name: string, kind: HsHead['kind'], basis: HsHead['basis'], rate: number, sac?: string): HsHead => ({ id, name, kind, basis, rate, ...(sac ? { sac } : {}), active: true });
  const heads: HsHead[] = [
    h('dh-svc', 'Service charges', 'service', 'per_unit', 3000, '999598'), h('dh-snk', 'Sinking fund', 'sinking', 'cost_pct_pa', 0.25, '999598'), h('dh-rep', 'Repair and maintenance fund', 'repair', 'cost_pct_pa', 0.75, '999598'),
    h('dh-ptx', 'Property tax', 'statutory', 'typed', 0), h('dh-prk', 'Parking charges', 'parking', 'per_slot', 500, '999598'), h('dh-noc', 'Non-occupancy charges', 'non_occupancy', 'pct_of_head', 10, '999598'), h('dh-edu', 'Education and training fund', 'education', 'fixed_member', 10, '999598'),
  ];
  const u = (id: string, code: string, o: Partial<SocietyUnit>): SocietyUnit => ({ id, code, wing: 'A', use: 'residential', occupancy: 'owner', parking: [], status: 'active', updated_at: at, demo: true, ...o });
  const units: SocietyUnit[] = [
    u('demo-hs-a101', 'A-101', { carpet_area: 600, construction_cost: 2400000, owner_id: owner(0), parking: [{ slot: 'P1', kind: 'covered' }], typed: { 'dh-ptx': 1200 } }),
    u('demo-hs-a102', 'A-102', { carpet_area: 600, construction_cost: 2400000, owner_id: owner(1), occupancy: 'tenant', parking: [{ slot: 'P2', kind: 'covered' }], typed: { 'dh-ptx': 1200 } }),
    u('demo-hs-a901', 'A-901', { carpet_area: 1500, construction_cost: 6000000, owner_id: owner(2), parking: [{ slot: 'P9', kind: 'covered' }, { slot: 'P10', kind: 'covered' }], typed: { 'dh-ptx': 3000 } }),
    u('demo-hs-s1', 'S-1', { wing: undefined, use: 'commercial', carpet_area: 300, construction_cost: 1500000, owner_id: owner(3), typed: { 'dh-ptx': 900 } }),
  ];
  return { tables: { society_units: units as never[] }, societySettings: { state: '27', cycle: 'monthly', bill_day: 1, due_days: 15, area_unit: 'sqft', heads } };
}
