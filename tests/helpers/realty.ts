/** CN-C fixtures: a builder company with one project (tower A), units, a CLP plan and a buyer in Clients. */
import { freezeDate, resetStorage } from './shim.ts';
import { installSettings } from './world.ts';
import { localDb } from '../../src/lib/localDb.ts';
import { bankAccountsDb } from '../../src/lib/bank-accounts.ts';
import { saveProject } from '../../src/lib/construction/cn-realty-projects.ts';
import { addUnits, loadUnits } from '../../src/lib/construction/cn-units.ts';
import { parseStages, savePlan } from '../../src/lib/construction/cn-plans.ts';
import { createBooking, defaultCostSheet } from '../../src/lib/construction/cn-bookings.ts';
import type { CostHead } from '../../src/types/construction-r11.ts';

export const BUYER = { id: 'c-buyer', name: 'Asha Rao', email: '', address: 'Pune', city: 'Pune', zip: '', state_code: '27' };

export function realtyWorld(today = '2026-10-27', over: Partial<Parameters<typeof saveProject>[0]> = {}) {
  resetStorage();
  freezeDate(`${today}T10:00:00`);
  installSettings({ business_type: 'contractor', construction_kind: 'builder', industry_packs: ['realty', 'works'] } as never);
  localDb.clients.upsert(BUYER);
  bankAccountsDb.save({ id: 'rera', name: 'RERA account', account_no: '50100012345', ifsc: 'HDFC0000001', active: true });
  const project = saveProject({ name: 'Green Heights', rera_no: 'P52100012345', rera_account_id: 'rera', state_code: '27', city_class: 'other', gst_scheme: 'n03_2019', towers: [{ name: 'A', floors: 4 }], ...over });
  const tower = project.towers[0];
  addUnits({ project_id: project.id, tower_id: tower.id, tower: 'A', floors: 1, perFloor: 4, type: 'residential', carpet_sqm: 100, saleable_sqft: 1500, base_rate: 5000 });
  const plan = savePlan({ name: 'CLP', kind: 'clp', stages: parseStages('Booking 10, Agreement 10, Plinth 15, 1st slab 15, 2nd slab 15, 3rd slab 15, Possession 20') });
  return { project, tower, plan, units: loadUnits() };
}

/** Book unit `n` (0-based) with a cost sheet whose consideration is `value` (stamp duty ₹4 lakh pass-through). */
export function book(w: ReturnType<typeof realtyWorld>, n = 0, value = 7500000, date = '2026-05-01') {
  const u = w.units[n];
  const sheet: CostHead[] = defaultCostSheet(u).map((h) => (h.head === 'Basic' ? { ...h, amount: value } : h.head === 'Stamp duty' ? { ...h, amount: 400000 } : h));
  return createBooking({ date, unit_id: u.id, client_id: BUYER.id, client_name: BUYER.name, cost_sheet: sheet, plan_id: w.plan.id });
}
