/**
 * Round 10 (service businesses) shared names — one place for the tables, objects, series and packs of all four
 * packages (SV-A … SV-D), so B–D build on the names SV-A registered (backup, sync, open-export schema, rights, audit
 * labels). Data only; no imports. See docs/features/services-r10.md.
 */

/** Company tables (`mrchartist_inv_<table>`): backed up, synced, audited, rights in `sv-registry.ts`. */
export const SV_TABLES = {
  // SV-A: appointment book, service staff, commission plans, staff payouts, payer claims
  appointments: 'appointments',
  staff: 'service_staff',
  plans: 'commission_plans',
  payouts: 'staff_payouts',
  claims: 'payer_claims',
  // SV-B: OPD visits, admissions, lab test master, lab orders
  visits: 'clinic_visits',
  admissions: 'admissions',
  labTests: 'lab_tests',
  labOrders: 'lab_orders',
  // SV-C: membership plans, memberships (MEM/FY…), check-ins (one row per day), classes / batches, class attendance
  memberPlans: 'member_plans',
  memberships: 'memberships',
  checkins: 'checkins',
  classes: 'class_schedules',
  attendance: 'class_attendance',
  // SV-B: clinic_visits, admissions, lab_tests, lab_orders — SV-C: member_plans, memberships, checkins, class_schedules,
  // class_attendance — SV-D: service_assets, labour_ops (each package adds its own rows)
  // SV-D: vehicles / appliances, labour operations
  assets: 'service_assets',
  labourOps: 'labour_ops',
} as const;

/** Company objects (singletons). */
export const SV_OBJECTS = {
  serviceSettings: 'service_settings', // SV-A: resources, hours, messages, tips, Rule 46A, no-ITC switches
  clinicSettings: 'clinic_settings', // SV-B: UHID prefix, rooms, room-day rule, deposit alert, referral switch, rate list
  // SV-B: clinic_settings — SV-D: workshop_settings
  workshopSettings: 'workshop_settings', // SV-D: checklists, terms, classes, labour rates, depreciation, intervals
} as const;

/** New Indian-FY series (`<PREFIX>/FY<yy-yy>/<seq>`, through `series-counters.ts`; never reused after a delete). */
export const SV_SERIES = {
  claims: 'CLM', // SV-A5
  visits: 'OPD', // SV-B1
  admissions: 'IPD', // SV-B2
  labOrders: 'LAB', // SV-B3
  memberships: 'MEM', // SV-C1
} as const;
/** Series prefixes once reserved for SV-B / SV-C: all taken now (SV_SERIES). */
export const SV_RESERVED_SERIES: readonly string[] = [];

/** The four Round 10 packs (`industry-packs.ts`). */
export const SV_PACKS = ['clinic', 'salon', 'fitness', 'workshop'] as const;
/** Packs whose desk is the shared front desk (appointments, staff, commission). */
export const FRONT_DESK_PACKS = SV_PACKS;
