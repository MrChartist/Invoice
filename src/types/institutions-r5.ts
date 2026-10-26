/**
 * Round 5 package C (institutions, non-profits & property) — persisted shapes and additive fields.
 * `src/types/invoice.ts` / `purchases.ts` are not edited: the new optional fields arrive here by declaration merging
 * (additive, snake_case). Tables: `fee_plans`, `fee_runs`, `common_credit_runs`, `donations`, `form_10bd_filings`,
 * `form_10be`, `properties`, `leases`, `security_deposits`. No device-local key.
 */

/* ── C1 fees ─────────────────────────────────────────────────── */

export type FeeTax = 'exempt' | 'nil' | 'taxable';
export interface FeeHead {
  name: string;
  amount: number;
  sac?: string;
  tax: FeeTax;
  gst_rate?: number;
  frequency: 'once' | 'per_instalment';
  /** Clinic package: number of sessions the head buys. */
  sessions?: number;
}
export interface FeeInstalment {
  label: string;
  due_date: string;
  /** Percent of the per-instalment heads (all shares sum to 100). */
  share: number;
}
export interface FeeFine {
  kind: 'flat' | 'per_day';
  amount: number;
  grace_days: number;
  cap?: number;
}
export type FeePreset = 'education' | 'coaching' | 'clinic';
export interface FeePlan {
  id: string;
  name: string;
  year_label: string;
  heads: FeeHead[];
  instalments: FeeInstalment[];
  fine?: FeeFine;
  preset?: FeePreset;
  created_at?: string;
  updated_at?: string;
}
export interface FeeRun {
  id: string;
  plan_id: string;
  /** Index into the plan's instalments. */
  instalment: number;
  date: string;
  batch_run_id: string;
  student_ids: string[];
  undone?: boolean;
}
export interface Concession {
  kind: 'pct' | 'amount';
  /** Head name; absent = every head. */
  head?: string;
  value: number;
  reason: string;
}
export interface Enrolment {
  plan_id: string;
  from: string;
  concessions: Concession[];
  transport_route?: string;
  /** Clinic package visits (₹0 consumption entries, local days). */
  visits?: string[];
}

/* ── C2 common credit ────────────────────────────────────────── */

/** ITC use tag of a bill: T4 / T2 / T1 / C2 (and common capital goods for Rule 43). */
export type ItcUse = 'taxable_only' | 'exempt_only' | 'non_business' | 'common' | 'common_capital';
export interface CommonCreditRun {
  id: string;
  /** `YYYY-MM` (monthly) or `FY2025-26` (annual true-up). */
  month: string;
  kind: 'monthly' | 'annual';
  /** Every figure of the working (rupees). */
  figures: Record<string, number>;
  /** Reversal by head (rupees; negative = reclaim). */
  heads: { igst: number; cgst: number; sgst: number; cess: number };
  journal_id?: string;
  date: string;
  created_at: string;
}

/* ── C3 donations ────────────────────────────────────────────── */

export type DonorIdCode = 'pan' | 'aadhaar' | 'tan' | 'passport' | 'voter_id' | 'driving_licence' | 'ration_card' | 'foreign_tax_id';
export type DonationMode = 'cash' | 'kind' | 'electronic' | 'others';
export type DonationType = 'corpus' | 'specific_grant' | 'others';
export type DonationSection = '80G' | '35(1)(ii)' | '35(1)(iia)' | '35(1)(iii)' | 'none';
export interface Donation {
  id: string;
  number: string;
  date: string;
  donor_id: string;
  amount: number;
  mode: DonationMode;
  reference?: string;
  type: DonationType;
  fund_id?: string;
  section: DonationSection;
  purpose?: string;
  anonymous?: boolean;
  /** Bank account the money went into (absent = cash for `cash`, main bank otherwise). */
  bank_account_id?: string;
  voucher_id?: string;
  cancelled?: { on: string; reason: string };
  created_at?: string;
}
export interface Form10bdRow {
  sr: number;
  id_code: string;
  id_no: string;
  section: string;
  name: string;
  address: string;
  type: string;
  mode: string;
  amount: number;
  donor_id: string;
}
export interface Form10bdFiling {
  id: string;
  /** FY start year, e.g. 2025 for FY 2025-26. */
  fy: number;
  arn?: string;
  filed_on?: string;
  rows_snapshot: Form10bdRow[];
}
export interface Form10beRow {
  id: string;
  fy: number;
  donor_id: string;
  cert_no: string;
  cert_date?: string;
  sent_on?: string;
}
export interface NpoProfile {
  pan: string;
  reg_12ab?: string;
  reg_12ab_valid_to?: string;
  urn_80g?: string;
  urn_80g_date?: string;
  urn_80g_valid_to?: string;
  approval_35?: string;
  fcra_reg?: string;
}

/* ── C4 funds ────────────────────────────────────────────────── */

export type FundNature = 'unrestricted' | 'restricted' | 'corpus' | 'fcra';
export interface FundInfo {
  nature: FundNature;
  donor_id?: string;
  purpose?: string;
  start?: string;
  end?: string;
  budget?: number;
}

/* ── C5 leases ───────────────────────────────────────────────── */

export type UnitUse = 'commercial' | 'residential_dwelling' | 'other';
export interface PropertyUnit {
  id: string;
  name: string;
  area?: number;
  use: UnitUse;
}
export interface Property {
  id: string;
  name: string;
  address: string;
  state: string;
  gstin?: string;
  units: PropertyUnit[];
}
export interface LeaseEscalation {
  every_months: number;
  kind: 'pct' | 'amount';
  value: number;
  first_on?: string;
  /** CAM escalates too. */
  include_cam?: boolean;
}
export type LeaseGstClass = 'taxable' | 'rcm' | 'exempt_bos' | 'exempt_none' | 'unregistered';
export interface Lease {
  id: string;
  property_id: string;
  unit_ids: string[];
  tenant_id: string;
  start: string;
  end: string;
  lock_in_end?: string;
  rent: number;
  cam?: number;
  cam_basis?: 'month' | 'sqft';
  heads?: { name: string; amount: number }[];
  billing_day: number;
  due_days: number;
  escalation?: LeaseEscalation;
  gst_class: LeaseGstClass;
  /** Tenant is a registered person using a dwelling for business (RCM) / for its own residence. */
  tenant_business_use?: boolean;
  tds?: { section: '194I-A' | '194I-B'; rate?: number };
  prorata?: boolean;
  /** Informational late-payment interest, % a year (never added to a document). */
  late_fee_pct?: number;
  deposit_id?: string;
  schedule_id: string;
  status: 'active' | 'ended' | 'terminated';
  terminated_on?: string;
  created_at?: string;
}
/** What the recurring generator reads from a lease schedule (stored on the `recurring` row). */
export interface ScheduleEscalation extends Partial<LeaseEscalation> {
  /** Template line ids that escalate (rent; CAM with `include_cam`). */
  lines: string[];
  /** Template line ids billed pro rata (all lease lines). */
  prorata_lines?: string[];
  lease_start: string;
  lease_end?: string;
  prorata?: boolean;
}

/* ── C6 security deposits ────────────────────────────────────── */

export type DepositMoveKind = 'receive' | 'pay' | 'adjust' | 'forfeit' | 'refund';
export interface DepositMovement {
  id: string;
  kind: DepositMoveKind;
  date: string;
  amount: number;
  doc_id?: string;
  voucher_id?: string;
  note?: string;
}
export interface SecurityDeposit {
  id: string;
  direction: 'received' | 'paid';
  party_id: string;
  party_name: string;
  lease_id?: string;
  amount: number;
  date: string;
  mode: string;
  bank_account_id?: string;
  interest?: { pct: number };
  movements: DepositMovement[];
  status: 'open' | 'closed';
  created_at?: string;
}

/* ── Declaration merging (additive fields on existing records) ─ */

declare module './invoice' {
  interface InvoiceRecord {
    /** Additive (R5-C1): fee plan this document bills (idempotency key with `fee_instalment`). */
    fee_plan_id?: string;
    /** Additive (R5-C1): instalment index of the plan (−1 = a fine document). */
    fee_instalment?: number;
  }
  interface Client {
    /** Additive (R5-C1): roll no. / UHID. */
    roll_no?: string;
    /** Additive (R5-C1): class / batch. */
    class_label?: string;
    guardian?: { name?: string; phone?: string };
    enrolments?: Enrolment[];
    /** Additive (R5-C3): donor identity for Form 10BD. */
    donor?: { id_code: DonorIdCode; id_no: string; type?: string };
  }
  interface SenderProfile {
    /** Additive (R5-C3): registrations of a non-profit. */
    npo?: NpoProfile;
  }
  interface Payment {
    /**
     * Additive (R5-C6): the `security_deposits` row this receipt row was settled from. It moved NO money (the deposit
     * held pays the invoice): every cash / bank reader skips it, like a `gift_voucher_id` row.
     */
    deposit_adjustment_id?: string;
  }
}

declare module './purchases' {
  interface PurchaseRecord {
    /** Additive (R5-C2): what the input is used for (Rule 42 / 43). Absent = common. */
    itc_use?: ItcUse;
  }
}

declare module '../lib/bank-accounts' {
  interface BankAccount {
    /** Additive (R5-C4): FCRA designated (SBI NDMB) or utilisation account. */
    fcra?: 'designated' | 'utilisation';
  }
}

declare module '../lib/cost-centres' {
  interface CostCentre {
    /** Additive (R5-C4): fund details of a `fund` cost centre. */
    fund?: FundInfo;
  }
}

declare module '../lib/recurring' {
  interface RecurringSchedule {
    /** Additive (R5-C5): the lease this schedule bills. */
    lease_id?: string;
    /** Additive (R5-C5): escalation / pro-rata applied by the generator's amount hook. */
    escalation?: ScheduleEscalation;
  }
}

declare module '../lib/localDb' {
  interface AppSettings {
    /** Additive (R5-C4): expense accounts treated as FCRA administrative expenses. */
    npo_admin_accounts?: string[];
    /** Additive (R5-C4): amounts accumulated / set apart per FY (Sec 11(2), Form 10 working note), keyed `2025`. */
    npo_accumulated?: Record<string, number>;
  }
}
