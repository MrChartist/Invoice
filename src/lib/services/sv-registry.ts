/**
 * Round 10 (service businesses) table registrations that live in first-paint maps. `TABLE_ACTIONS` (access.ts) and
 * `WATCHED_TABLES` (audit-edits.ts) ship with the shell, so the Round 10 rows are added here, at runtime, by a lazy
 * chunk (the R8 `tr-registry.ts` / R9 `rt-registry.ts` / R11 `cn-registry.ts` pattern; Round 10 first-paint budget 0).
 * Every module that writes a Round 10 table imports this file for its side effect (`import './sv-registry'`), and so do
 * the lazy writers that touch every table: the folder-sync engine (`sync-engine.ts`) and the recycle bin
 * (`trust/recycle-bin.ts`). `tests/sv-registry.test.ts` pins both maps and the importers.
 * One block per package (§6 of docs/prd/round-10.md): each package edits only its own block.
 */
import { TABLE_ACTIONS, type AccessAction } from '../access';
import { WATCHED_TABLES, type WatchedTable } from '../audit-edits';

/** Role needed to write each Round 10 table / object (`requireTableWrite`). */
export const SV_TABLE_ACTIONS: Readonly<Record<string, AccessAction>> = {
  // SV-A: the front desk books and bills; staff and plans are masters; payouts post journals / payroll adjustments
  appointments: 'doc.create',
  service_staff: 'master.edit',
  commission_plans: 'master.edit',
  staff_payouts: 'books.edit',
  payer_claims: 'doc.create',
  service_settings: 'settings.manage',
  // SV-B: clinic_visits, admissions, lab_tests, lab_orders, clinic_settings
  // SV-C: member_plans, memberships, checkins, class_attendance, class_schedules
  // SV-D: vehicles / appliances and labour operations are masters; the workshop settings object is the owner's
  service_assets: 'master.edit',
  labour_ops: 'master.edit',
  workshop_settings: 'settings.manage',
};

/** Audited tables (every row change logged; deletes go to the recycle bin). `service_settings` is audited on save. */
export const SV_WATCHED: Readonly<Record<string, WatchedTable>> = {
  // SV-A
  appointments: { entity: 'invoice', label: 'Appointment' },
  service_staff: { entity: 'item', label: 'Service staff' },
  commission_plans: { entity: 'item', label: 'Commission plan' },
  staff_payouts: { entity: 'payment', label: 'Staff payout' },
  payer_claims: { entity: 'invoice', label: 'Payer claim' },
  // SV-B
  // SV-C
  // SV-D
  service_assets: { entity: 'item', label: 'Vehicle / appliance' },
  labour_ops: { entity: 'item', label: 'Labour operation' },
};

/** Idempotent: adds the rows once (never overwrites a row another module set). */
export function registerServiceTables(): void {
  const actions = TABLE_ACTIONS as Record<string, AccessAction | readonly AccessAction[]>;
  const watched = WATCHED_TABLES as Record<string, WatchedTable>;
  for (const [t, a] of Object.entries(SV_TABLE_ACTIONS)) if (!actions[t]) actions[t] = a;
  for (const [t, w] of Object.entries(SV_WATCHED)) if (!watched[t]) watched[t] = w;
}

registerServiceTables();
