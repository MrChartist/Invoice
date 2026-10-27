/**
 * Round 11 (construction) table registrations that live in first-paint maps. `TABLE_ACTIONS` (access.ts) and
 * `WATCHED_TABLES` (audit-edits.ts) ship with the shell, so the Round 11 rows are added here, at runtime, by a lazy
 * chunk (the R8 `tr-registry.ts` / R9 `rt-registry.ts` pattern; Round 11 first-paint budget 0). Every module that
 * writes a Round 11 table imports this file for its side effect (`import './cn-registry'`), and so do the lazy writers
 * that touch every table: the folder-sync engine (`sync-engine.ts`) and the recycle bin (`trust/recycle-bin.ts`).
 * `tests/cn-registry.test.ts` pins both maps and the importers.
 * One block per package (§6 of docs/prd/round-11.md): each package edits only its own block.
 */
import { TABLE_ACTIONS, type AccessAction } from '../access';
import { WATCHED_TABLES, type WatchedTable } from '../audit-edits';

/** The company object of CN-A (`mrchartist_inv_construction_settings`). */
export const CN_OBJECTS = { constructionSettings: 'construction_settings' } as const;

/** Role needed to write each Round 11 table / object (`requireTableWrite`). */
export const CN_TABLE_ACTIONS: Readonly<Record<string, AccessAction>> = {
  // CN-A: the construction profile switches (owner only)
  construction_settings: 'settings.manage',
  // CN-B: works_contracts, secured_advances, price_variations, bank_guarantees
  // CN-C: builders (masters, bookings / stage certificates, the RERA account)
  realty_projects: 'master.edit',
  realty_units: 'master.edit',
  realty_bookings: 'doc.create',
  payment_plans: 'master.edit',
  stage_certificates: 'doc.create',
  rera_withdrawals: 'books.edit',
  // CN-D: site operations (work orders / bills / compliance / muster / logs as documents; labour and hired plant as masters)
  sub_work_orders: 'doc.create',
  sub_measurements: 'doc.create',
  labour_compliance: 'doc.create',
  site_labour: 'master.edit',
  muster_days: 'doc.create',
  hired_equipment: 'master.edit',
  plant_logs: 'doc.create',
};

/** Audited tables (every row change logged; deletes go to the recycle bin). `construction_settings` is audited on save. */
export const CN_WATCHED: Readonly<Record<string, WatchedTable>> = {
  // CN-A: none (the settings object is audited on save)
  // CN-B
  // CN-C
  realty_projects: { entity: 'item', label: 'Realty project' },
  realty_units: { entity: 'item', label: 'Realty unit' },
  realty_bookings: { entity: 'invoice', label: 'Booking' },
  payment_plans: { entity: 'item', label: 'Payment plan' },
  stage_certificates: { entity: 'invoice', label: 'Stage certificate' },
  rera_withdrawals: { entity: 'payment', label: 'RERA account entry' },
  // CN-D
  sub_work_orders: { entity: 'invoice', label: 'Sub-contract work order' },
  sub_measurements: { entity: 'invoice', label: 'Sub-contractor bill' },
  labour_compliance: { entity: 'item', label: 'Labour compliance' },
  site_labour: { entity: 'item', label: 'Site worker' },
  muster_days: { entity: 'item', label: 'Site muster' },
  hired_equipment: { entity: 'item', label: 'Hired equipment' },
  plant_logs: { entity: 'item', label: 'Plant log sheet' },
};

/** Idempotent: adds the rows once (never overwrites a row another module set). */
export function registerConstructionTables(): void {
  const actions = TABLE_ACTIONS as Record<string, AccessAction | readonly AccessAction[]>;
  const watched = WATCHED_TABLES as Record<string, WatchedTable>;
  for (const [t, a] of Object.entries(CN_TABLE_ACTIONS)) if (!actions[t]) actions[t] = a;
  for (const [t, w] of Object.entries(CN_WATCHED)) if (!watched[t]) watched[t] = w;
}

registerConstructionTables();
