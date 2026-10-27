/**
 * Round 12 package D (cold storage, input dealers, FPO / co-operative) — the row shapes of D's tables and of D's
 * `agri_settings` sub-fields and `ag` snapshot sub-objects. `src/types/agri-r12.ts` (AG-A) merges the record / settings
 * fields in its `// AG-D` block from these types. Type-only: zero bytes. See docs/features/agri-r12.md §AG-D.
 */

/* ── D1 cold-storage lots (custody only, never stock) ── */

/** A chamber of the cold store (`agri_settings.chambers`). */
export interface ColdChamber {
  id: string;
  name: string;
  capacity_bags: number;
  floors?: number;
  temp_range?: string;
}

/** One gate pass out (`GPO/FY…`) on a lot. */
export interface ColdGateOut {
  id: string;
  number: string;
  date: string;
  bags: number;
  weight_kg?: number;
  to?: string;
  vehicle?: string;
  by?: string;
  /** `clear`: no open loan named the lot (or it covered the release); `override`: released over a lien, with a reason. */
  loan_check: 'clear' | 'override';
  override_reason?: string;
}

/** Bags moved to another depositor inside the store; the receiver gets a child lot (`from_lot_id`). */
export interface ColdTransfer {
  id: string;
  date: string;
  to_depositor_id: string;
  to_depositor_name?: string;
  bags: number;
  note: string;
  to_lot_id: string;
}

/** A storage receipt (`CSR/FY…`): the depositor's goods held in custody. */
export interface ColdLot {
  id: string;
  number: string;
  date_in: string;
  depositor_id: string;
  depositor_name: string;
  commodity: string;
  variety?: string;
  bags: number;
  bag_kg?: number;
  weight_kg?: number;
  chamber_id: string;
  location?: string;
  grade?: string;
  season: string;
  rent_plan_id: string;
  marks?: string;
  insured?: { by: string; value: number };
  outs: ColdGateOut[];
  transfers?: ColdTransfer[];
  /** A child lot made by a transfer: the lot it came from (rent runs from the parent's `date_in`). */
  from_lot_id?: string;
  status: 'stored' | 'part_out' | 'closed';
  created_at?: string;
  updated_at?: string;
}

/* ── D2 rent plans ── */

export type RentBasis = 'bag_season' | 'bag_month' | 'qtl_season' | 'qtl_month' | 'flat';
export type StorageClass = 'storage_agri' | 'storage_other';

export interface RentCharge {
  name: string;
  basis: 'bag' | 'qtl' | 'flat';
  rate: number;
  when: 'in' | 'out';
  /** "Own rate" (AG8 (c)): GST % of its own; absent = follows the storage class (composite supply). */
  own_rate?: number;
}

export interface ColdRentPlan {
  id: string;
  name: string;
  commodity?: string;
  basis: RentBasis;
  rate: number;
  season?: { from: string; to: string };
  min_months?: number;
  part_month: 'full' | 'days';
  charges: RentCharge[];
  class: StorageClass;
  bill_at: 'out' | 'in' | 'monthly' | 'season_end';
  late?: { after: string; rate_per_bag_month: number };
  /** A whole chamber / space let out (AG8 (b)): defaults to `storage_other`. */
  space?: boolean;
  /** State-notified rent (order reference), printed on the bill. No preset values. */
  notified?: { rate: number; order_ref: string };
}

/** `ag.rent` on a rent bill (snapshot; printed by the agri paper, never recomputed). */
export interface AgRentSnap {
  lot_id: string;
  lot_no: string;
  depositor: string;
  commodity: string;
  variety?: string;
  chamber?: string;
  date_in: string;
  season: string;
  bags: number;
  bags_in: number;
  balance: number;
  basis: RentBasis;
  rate: number;
  period_from: string;
  period_to: string;
  months?: number;
  out_id?: string;
  gate_pass_no?: string;
  class: StorageClass;
  plan: string;
  notified?: { rate: number; order_ref: string };
  /** The 'in' charges (loading, unloading) are on this bill. */
  in_charges?: boolean;
}

/* ── D3 loans against stored produce ── */

export interface AgriLoanRepayment {
  id: string;
  date: string;
  amount: number;
  interest_part: number;
  principal_part: number;
  receipt_id: string;
  receipt_no?: string;
}

/** A loan to a depositor (`LAS/FY…`) with a lien on the lots it names. */
export interface AgriLoan {
  id: string;
  number: string;
  date: string;
  borrower_id: string;
  borrower_name: string;
  lot_ids: string[];
  principal: number;
  rate_pct: number;
  basis: 'simple' | 'monthly_compound';
  due_date?: string;
  max_ltv_pct?: number;
  /** Market rate per bag typed for the loan-to-value check (memo). */
  bag_rate?: number;
  disbursed_by: 'bank' | 'cash';
  payment_voucher_id: string;
  repayments: AgriLoanRepayment[];
  status: 'open' | 'closed';
  created_at?: string;
}

/* ── D4 input dealer ── */

export type AgriLicenceKind = 'fertiliser_retail' | 'fertiliser_wholesale' | 'seed' | 'insecticide' | 'fssai' | 'apmc' | 'other';

export interface AgriLicence {
  kind: AgriLicenceKind;
  number: string;
  issued_by: string;
  valid_from?: string;
  valid_to?: string;
  premises?: string;
  products?: string[];
}

/** Principal certificate / O-form of a manufacturer (`agri_settings.principals`). */
export interface AgriPrincipal {
  vendor_id: string;
  vendor_name?: string;
  kind: 'fertiliser' | 'insecticide' | 'seed';
  ref: string;
  valid_to?: string;
}

/** A harvest season with its credit due date (`YYYY-MM-DD`, or `MM-DD` = the next one on / after the sale). */
export interface AgriSeason {
  name: string;
  due: string;
}

/** PoS stock typed from the fertiliser PoS device's report: month (`YYYY-MM`) → item id → bags. */
export type PosStock = Record<string, Record<string, number>>;

/** `ag.inputs` on a dealer's bill (snapshot). */
export interface AgInputsSnap {
  /** Licence lines printed in the dealer block. */
  licences?: { kind: AgriLicenceKind; number: string; valid_to?: string }[];
  /** Subsidised fertiliser: the government PoS transaction no. and the farmer ID (Aadhaar last 4 / KCC). */
  pos_txn?: string;
  farmer_id?: string;
  subsidised_bags?: number;
  /** Credit till harvest. */
  season?: string;
  season_due?: string;
}

/* ── D5 members' capital ── */

export type ShareKind = 'allot' | 'transfer_in' | 'transfer_out' | 'surrender' | 'refund' | 'forfeit';

export interface MemberShareRow {
  id: string;
  date: string;
  member_id: string;
  member_name: string;
  kind: ShareKind;
  shares: number;
  face_value: number;
  amount: number;
  certificate_no?: string;
  from_member_id?: string;
  approved_on?: string;
  note?: string;
  /** Allotment paid from: the member's application money (journal), or straight in by bank / cash (receipt). */
  paid_from?: 'application' | 'bank' | 'cash';
  voucher_id?: string;
  created_at?: string;
}

/** D-owned `agri_settings` sub-fields. */
export interface AgriSettingsD {
  chambers?: ColdChamber[];
  /** Storage receipt terms (printed). */
  receipt_terms?: string;
  /** Partial release under a lien: remaining bags must cover the loan at this LTV % (absent = no partial release). */
  release_ltv_pct?: number;
  licences?: AgriLicence[];
  principals?: AgriPrincipal[];
  seasons?: AgriSeason[];
  /** Monthly subsidised bags per farmer before a warning (default from `FERT_SUBSIDY_DEFAULTS`). */
  subsidy_cap?: number;
  pos_stock?: PosStock;
  /** Co-operative: statutory reserve % and dividend cap % (State Act, typed; AG19). */
  coop?: { reserve_pct?: number; dividend_cap_pct?: number; face_value?: number; primary_producers?: boolean };
  /** Typed statutory due dates (MM-DD) for the members' calendar. */
  calendar?: Record<string, string>;
}
