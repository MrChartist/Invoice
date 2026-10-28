/**
 * Round 18 (co-operative housing societies, apartment owners' associations and RWAs) — persisted shapes and additive
 * fields of R18-A … R18-D (docs/prd/round-18.md §6). Existing type files are not edited: the new optional fields arrive
 * here by declaration merging. Every Round 18 snapshot on a document lives under ONE record key `hs`
 * (`R18_RECORD_KEYS` in `src/store/invoice-defaults.ts`); there is no Round 18 line key (pass-through statutory dues
 * reuse `charge_head_id: 'rule33'`, the SAC sits in `hsn`). R18-A declares the sub-field types of every package in one
 * commit; B–D fill only their own block — an interface re-declared there merges with A's. No Aadhaar, PAN or bank
 * details of members are stored; nominees are name / share / relation only (PRD §6). Types only (0 bytes). Working
 * papers — verify with your CA (docs/CA_REVIEW.md §18, HS1–HS44).
 */

/* ════════════════════════════════════════ R18-A ════════════════════════════════════════ */

/** The body picked on the wizard card "Housing society / apartment association / RWA" (settings `society_kind`). */
export type SocietyKind = 'chs' | 'aoa' | 'rwa' | 'commercial' | 'agency';
/** A3: what a charge head is (decides its GST role in B2: `statutory` is pass-through, `outsider` non-member income). */
export type HsHeadKind = 'service' | 'sinking' | 'repair' | 'major_repair' | 'statutory' | 'service_supply' | 'parking' | 'non_occupancy' | 'education' | 'election' | 'insurance' | 'lease_rent' | 'outsider' | 'other';
/**
 * A3: how a head's monthly amount is worked out for a unit. `rate` means: ₹ per unit (`per_unit`, `per_lifted_unit`),
 * ₹ per sq ft / sq m (`area_carpet`, `area_super`), the monthly total shared by undivided interest (`undivided_pct`),
 * % a year of the construction cost (`cost_pct_pa`), ₹ per slot (`per_slot`, `slot_rates` by kind), % of the
 * `service` head for let units (`pct_of_head`), ₹ per member (`fixed_member`); `typed` reads the unit's own amount
 * (`SocietyUnit.typed[head.id]`). `per_inlet` = ₹ per water inlet (`SocietyUnit.inlets`); `per_lifted_unit` = ₹ per
 * unit in a lifted building (`SocietyUnit.lifted`) — cut 2 of R18-A, added afterwards (PENDING #5).
 */
export type HsBasis = 'per_unit' | 'area_carpet' | 'area_super' | 'undivided_pct' | 'cost_pct_pa' | 'per_slot' | 'pct_of_head' | 'typed' | 'fixed_member' | 'per_inlet' | 'per_lifted_unit';
export type HsCycle = 'monthly' | 'quarterly' | 'half_yearly';
export type HsUnitUse = 'residential' | 'commercial' | 'garage' | 'other';
export type HsOccupancy = 'owner' | 'tenant' | 'vacant';
export type HsSlotKind = 'covered' | 'open' | 'stilt' | 'two_wheeler';

/** A3: one charge head of the tariff (`society_settings.heads`). Amounts are a month's; a cycle multiplies them. */
export interface HsHead {
  id: string;
  name: string;
  kind: HsHeadKind;
  basis: HsBasis;
  rate: number;
  /** `per_slot`: a rate per slot kind (else `rate`). */
  slot_rates?: Partial<Record<HsSlotKind, number>>;
  /** SAC printed on the line (member heads 999598, `outsider` 997212; none for `statutory`). */
  sac?: string;
  /** D1: the fund cost centre this head's billing is tagged with. */
  fund?: string;
  active: boolean;
  /** First / last day the head applies (`YYYY-MM-DD`; absent = always). */
  from?: string;
  to?: string;
}

/** A2: one parking slot of a unit. */
export interface HsSlot { slot: string; kind: HsSlotKind }

/** A2: table `society_units` (not dated, synced, audited, `master.edit`). C / D add their optional fields below. */
export interface SocietyUnit {
  id: string;
  /** The society's own code (`A-101`), unique per company. */
  code: string;
  wing?: string;
  floor?: string;
  use: HsUnitUse;
  carpet_area?: number;
  super_area?: number;
  /** Percentage of undivided interest (apartment Acts; TN s.18(1)). */
  undivided_pct?: number;
  /** Architect-certified construction cost (₹) — the base of MH fund minimums (HS27). */
  construction_cost?: number;
  inlets?: number;
  lifted?: boolean;
  /** The member billed (a client). */
  owner_id?: string;
  joint_ids?: string[];
  occupancy: HsOccupancy;
  /** Recorded, never billed (TN s.18(3) recovery from the occupier is a hint, HS34). */
  tenant_id?: string;
  parking: HsSlot[];
  /** Per-unit monthly amounts of `typed` heads, by head id (property tax as the municipal bill, HS44). */
  typed?: Record<string, number>;
  status: 'active' | 'merged' | 'closed';
  updated_at: string;
  demo?: boolean;
}

/** A2: a member is a client (`Client.hs`). Bills go to the owner; a tenant is recorded, never billed. */
export interface ClientHs { unit_ids: string[]; role: 'owner' | 'joint' | 'tenant'; member_no?: string }

/** C: the interest rule on arrears (simple, capped by the State row; never on interest, HS38). */
export interface HsInterest { pct?: number; grace_days?: number; from: 'due' | 'bill'; min_amount?: number; on_interest: false }
/** D3: one FY's audit. */
export interface HsAudit { fy: string; auditor?: string; appointed_on?: string; report_on?: string; rectified_on?: string }

/** Company object `society_settings` (owner only, audited, synced as a singleton). A writes the shape of every package. */
export interface SocietySettings {
  /** A: two-digit State code of the society's law (default the sender's State). */
  state?: string;
  cycle?: HsCycle;
  /** A: the bill's day of the period's first month (1–28). */
  bill_day?: number;
  due_days?: number;
  heads?: HsHead[];
  area_unit?: 'sqft' | 'sqm';
  /** A4 (PENDING #6): `false` = bills leave out the "How your bill is worked out" footnote (default on). */
  explain?: boolean;
  /** A3: States whose `in_force: false` rows the user confirmed are in force (the KA Bill, HS33). */
  confirmed?: string[];
  /** B: the ₹7,500 valuation (`whole` default, HS2) and the SAC of non-member income; a society run's batch limit. */
  gst?: { valuation: 'whole' | 'excess'; outsider_sac?: string };
  run_limit?: number;
  /** C: interest on arrears, receipt allocation (HS37), dues-certificate validity. */
  interest?: HsInterest;
  allocation?: 'interest_first' | 'oldest_first';
  certificate_validity_days?: number;
  /** D: fund cost centres, when contributions move to the funds (HS39), audit per FY. */
  funds?: { sinking?: string; repair?: string; major_repair?: string };
  fund_transfer?: 'period' | 'year_end' | 'none';
  audit?: HsAudit[];
  updated_at?: string;
}

/** A4: one head printed on the society paper (B fills `line_id`, the invoice line of the head). */
export interface HsHeadRow { head_id: string; name: string; kind: HsHeadKind; basis: string; amount: number; line_id?: string }

/** The invoice snapshot `hs` (A: unit, period, heads, explain; B: run, test, regime, decl, levy; C: arrears, interest; D: funds). */
export interface HsSnapshot {
  unit?: { id: string; code: string; wing?: string; area?: number; area_unit?: 'sqft' | 'sqm'; members: string[] };
  /** Billing period: `YYYY-MM`, `YYYY-Qn` or `YYYY-Hn` (FY quarters / halves; the year is the FY's first year). */
  period?: string;
  /** Due date (`YYYY-MM-DD`). */
  due?: string;
  heads?: HsHeadRow[];
  /** A4: print "How your bill is worked out" (cut 1 of R18-A, added afterwards; set by the run unless switched off). */
  explain?: boolean;
  /** B1 / B2: the run, the ₹7,500 test, the regime and its printed sentence (snapshotted, never re-derived). */
  run_id?: string;
  test?: { counted: number; limit: number; months: number };
  regime?: 'unregistered' | 'agency' | 'exempt77c' | 'taxable_whole' | 'taxable_excess' | 'outsider';
  decl?: string;
  levy?: { name: string; kind: HsHeadKind; basis: HsBasis; total: number };
  /** C1: arrears brought forward (memo; the old bills stay the receivable) and the interest line. */
  arrears?: { amount: number; as_of: string };
  interest?: { amount: number; from: string; to: string; pct: number; on: number; through: string };
  /** D1: the fund contributions of this bill. */
  funds?: { sinking?: number; repair?: number; major_repair?: number };
}

declare module './invoice' {
  interface InvoiceRecord {
    /** Round 18 record snapshot (see `HsSnapshot`). */
    hs?: HsSnapshot;
  }
  interface Client {
    /** A2: the member's units and role. */
    hs?: ClientHs;
  }
}

declare module '../lib/localDb' {
  interface AppSettings {
    /** A1: society profile (business type `nonprofit`, `services` for `agency`); absent = no Society desk. */
    society_kind?: SocietyKind;
  }
}

/* ════════════════════════════════════════ R18-B ════════════════════════════════════════ */

/** B1: table `society_runs` (dated by the bill date, synced, audited, `doc.create`). */
export interface SocietyRun {
  id: string;
  period: string;
  /** Bill date (`YYYY-MM-DD`): the sync / period-lock date. */
  date: string;
  due: string;
  batch_run_id?: string;
  unit_ids: string[];
  counts: { bos: number; tax: number; plain: number; outsider: number };
  totals: Record<string, number>;
  /** B4: a one-off special levy run. */
  levy?: { name: string; kind: HsHeadKind; basis: HsBasis; total: number };
  undone?: { at: string; reason: string };
  updated_at: string;
}

/* ════════════════════════════════════════ R18-C ════════════════════════════════════════ */

/** C2: a dues certificate issued for a unit (the amount is a print, never a posting). */
export interface HsCertificate { no: string; date: string; amount: number; valid_till: string }
/** C2: a transfer of membership (premium typed; MH cap a hint only, HS18). */
export interface HsTransfer { date: string; from_ids: string[]; to_ids: string[]; premium?: number; dues_settled: boolean }

/* ════════════════════════════════════════ R18-D ════════════════════════════════════════ */

/** D3: the audit's due date as typed (MH; else `audit_due_months` after the FY end from the State row). */
export interface HsAudit { due_on?: string }

/** D3: a nominee (name / share / relation only — no ID numbers). */
export interface HsNominee { name: string; share_pct: number; relation?: string }

/** C / D fields of a unit (interface merging with A's declaration above). */
export interface SocietyUnit {
  /** C2 */
  certificates?: HsCertificate[];
  transfers?: HsTransfer[];
  /** D3 */
  share_cert?: string;
  nominees?: HsNominee[];
  admitted_on?: string;
}
