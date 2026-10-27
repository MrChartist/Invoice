/**
 * Round 11 (construction) — persisted shapes and additive fields of the four packages (docs/prd/round-11.md §6).
 * `invoice.ts`, `purchases.ts`, `localDb.ts` and `invoice-defaults.ts` are not edited: everything a construction
 * document prints lives under keys `normalizeRecord` already keeps verbatim — the record key `boq_terms` (R5-B) gains
 * one sub-object `cn` (the construction snapshot) and new deduction kinds go into `ra_deductions`. On a BOQ (sales
 * order) `boq_terms` keeps its R5 meaning; on an RA bill / demand / works invoice `boq_terms.cn` is the snapshot.
 * One block per package, marked `// CN-A` … `// CN-D`: each package fills only its own block. Types only (0 bytes).
 * Everything here is a working paper — verify with your CA (docs/CA_REVIEW.md §11, CN1–CN28).
 */

/* ════════════════════════════════════════ CN-A ════════════════════════════════════════ */

/** The construction business picked under the `contractor` business type (settings `construction_kind`). */
export type ConstructionKind = 'civil' | 'subcontractor' | 'builder' | 'interiors' | 'mep' | 'labour' | 'other';

/** RA bill paper: ordinary item table + abstract page, the PWD cumulative item table, or the line sub-line only. */
export type RaPaperStyle = 'standard' | 'pwd' | 'summary';

/** Works views (Time → Works) a construction profile switches on (CN-B / CN-D fill the screens). */
export type CnWorksView = 'contracts' | 'advances' | 'escalation' | 'guarantees' | 'subcon' | 'labour' | 'plant' | 'reco' | 'pnl';

/** Builder views (Receivables → Realty, CN-C). */
export type CnRealtyView = 'projects' | 'units' | 'bookings' | 'plans' | 'demands' | 'rera' | 'cancellations' | 'procurement';

/** Company object `mrchartist_inv_construction_settings` (`settings.manage`, audited on save, synced as a singleton). */
export interface ConstructionSettings {
  /** RA bill paper style (default `standard`; civil + government → `pwd`). */
  ra_paper?: RaPaperStyle;
  /** Print the M-book column / sub-line. */
  mb_column?: boolean;
  /** The company works for government departments / PSUs (GST TDS deductor default, cess, measured-by boxes). */
  government?: boolean;
  /** Print the contractor's certificate (default on) and its text (default `DEFAULT_CERTIFICATE`). */
  certificate?: boolean;
  certificate_text?: string;
  /** Print the "Measured by / Checked by / Passed for payment" boxes (government default). */
  signoff_boxes?: boolean;
  /** Deviation limit, % over the BOQ quantity per item (contract term; default 25). */
  deviation_pct?: number;
  /** Works views switched on by the profile (a view turned off is only hidden; its URL still opens it). */
  views?: Partial<Record<CnWorksView, boolean>>;
  /** Interiors / MEP: show the supply + installation caution (CN3). */
  split_caution?: boolean;
  /** Interiors: photo pages on by default. */
  photo_pages?: boolean;
  /** Labour contractor: manpower-supply bill preset (SAC 998519). */
  manpower_preset?: boolean;
  updated_at?: string;
}

/** Works-contract tax class of a line (suggests a rate / SAC by document date; a typed rate always wins). */
export type CnClass = 'wc_general' | 'wc_govt' | 'wc_govt_earthwork' | 'wc_subcon_govt' | 'pure_labour_exempt' | 'supply_goods' | 'install_service' | 'manpower'
  // CN-C3 real-estate classes (filled by CN-C)
  | 'realty_affordable' | 'realty_residential' | 'realty_commercial' | 'realty_old_option';

/** Line class on an RA bill: BOQ item, extra item, substituted item, quantity beyond the deviation limit. */
export type CnLineKind = 'boq' | 'extra' | 'substituted' | 'deviation';

/** Site of the work: place of supply = its State (Sec 12(3)). */
export interface CnSite {
  address?: string;
  state_code?: string;
}

/** Contract particulars printed in the "Contract particulars" box (snapshot; empty fields are skipped). */
export interface CnHeader {
  name_of_work?: string;
  agreement_no?: string;
  agreement_date?: string;
  work_order_no?: string;
  work_order_date?: string;
  tender_ref?: string;
  /** Client office (division / circle). */
  client_office?: string;
  /** Engineer-in-charge. */
  engineer?: string;
  site?: CnSite;
  contract_value?: number;
  stipulated_start?: string;
  stipulated_completion?: string;
  extended_completion?: string;
  /** "4th RA bill (running)" / "Final bill". */
  ra_label?: string;
  period_from?: string;
  period_to?: string;
  measured_on?: string;
  mb_nos?: string[];
  /** CN-B (JV / consortium, informational): "Member of ABC–XYZ JV (40%)". */
  jv_note?: string;
}

/** Per invoice line (keyed by the invoice line id): BOQ no., M-book, class and the certified quantities. */
export interface CnLine {
  /** BOQ item no. (copied from `boq_ref`). */
  ref?: string;
  /** M-book ref "112/45–47". */
  mb?: string;
  cls?: CnClass;
  kind?: CnLineKind;
  /** Extra / substituted item approval ref. */
  approval?: string;
  /** Substituted item: the BOQ item no. it replaces. */
  substitutes?: string;
  boq_qty?: number;
  prev_qty?: number;
  cum_qty?: number;
  prev_amount?: number;
  cum_amount?: number;
}

/** One row of the abstract of cost, snapshotted at save so later bills never change it. */
export interface CnAbstractRow {
  /** BOQ line id (or the invoice line id of an extra / substituted / deviation line). */
  id: string;
  kind: CnLineKind;
  ref: string;
  description: string;
  unit: string;
  boq_qty: number;
  rate: number;
  prev_qty: number;
  prev_amount: number;
  this_qty: number;
  this_amount: number;
  cum_qty: number;
  cum_amount: number;
  /** % of the BOQ quantity (0 without one). */
  pct: number;
  mb?: string;
  approval?: string;
}

/** Contractor's certificate and sign-off boxes printed under the bill (snapshot). */
export interface CnCertificate {
  text?: string;
  boxes?: boolean;
}

/** CN-B3: price-variation statement snapshot on a supplementary bill (filled by CN-B). */
export interface CnPvSnapshot {
  statement_id?: string;
  number?: string;
  /** CN-B3: the working as billed (printed by `PvWorkingPage`; never recomputed at print). */
  clause?: string;
  period_from?: string;
  period_to?: string;
  base_month?: string;
  m_factor?: number;
  work_value?: number;
  rows?: CnPvRow[];
  /** Σ share × index change (fraction). */
  sum?: number;
  amount?: number;
  [key: string]: unknown;
}

/** CN-B3: one component of the price-variation working. */
export interface CnPvRow {
  key: string;
  share_pct: number;
  base_index: number;
  current_index: number;
  /** (I − I0) / I0 × share / 100. */
  weighted: number;
}

/** CN-C3: stage demand snapshot on a demand invoice (filled by CN-C). */
export interface CnDemandSnapshot {
  booking_id?: string;
  unit?: string;
  stage?: string;
  [key: string]: unknown;
}

/** CN-B (JV / consortium share, informational). */
export interface CnJvSnapshot {
  name?: string;
  share_pct?: number;
}

/** `boq_terms.cn` — the Round 11 snapshot on a document (each package owns its sub-fields). */
export interface CnSnapshot {
  v?: 1;
  /** A works-contract bill (prints the construction paper even without an RA number). */
  works?: boolean;
  header?: CnHeader;
  lines?: Record<string, CnLine>;
  /** Abstract of cost (A4): printed as the following page. */
  abstract?: CnAbstractRow[];
  /** Paper style at save time. */
  paper?: RaPaperStyle;
  certificate?: CnCertificate;
  /** Deviation limit used (%). */
  deviation_pct?: number;
  // CN-B
  pv?: CnPvSnapshot;
  jv?: CnJvSnapshot;
  // CN-C
  demand?: CnDemandSnapshot;
}

declare module './transport-works-r5' {
  interface BoqTerms {
    /** Round 11 construction snapshot (on an RA bill / demand / works invoice; never read from a BOQ by bills). */
    cn?: CnSnapshot;
    /** CN-A2 / B1: the site of the BOQ (place of supply). */
    site?: CnSite;
    /** CN-A3: contract particulars typed on the BOQ when there is no contract (B1). */
    header?: CnHeader;
    /** CN-A4: deviation limit % for this BOQ (default 25). */
    deviation_pct?: number;
  }
  interface MeasurementLine {
    /** CN-A4: line class (absent = BOQ item; `extra` keeps working through the R5 reason). */
    kind?: 'substituted' | 'extra';
    approval?: string;
    /** Substituted item: the BOQ item no. it replaces. */
    substitutes?: string;
  }
}

declare module '../lib/localDb' {
  interface AppSettings {
    /** CN-A1: construction profile under the `contractor` business type; absent = not chosen (unchanged company). */
    construction_kind?: ConstructionKind;
  }
}

declare module './invoice' {
  interface InvoiceItem {
    /** CN-A2, catalogue rows: works-contract tax class (on an RA bill the class lives in `boq_terms.cn.lines`). */
    cn_class?: CnClass;
  }
}

/* ════════════════════════════════════════ CN-B ════════════════════════════════════════
 * Contract register, advances, price variation, recoveries, guarantees, closure. B adds `SecurityDeposit.contract_id`
 * here (declaration merging on the R5-C type). */

/** Extension of time granted (`with_ld`: granted with LD, so LD still runs from the earlier date). */
export interface CnEot {
  upto: string;
  ref?: string;
  date?: string;
  with_ld?: boolean;
}

/** A mobilisation / plant advance (an `advances` row) recovered from the contract's RA bills. */
export interface CnAdvanceTerm {
  advance_id: string;
  kind: 'mobilisation' | 'plant';
  /** Simple interest % a year on the unrecovered balance (contract term; 0 / absent = interest-free). */
  interest_pct?: number;
  interest_basis?: 'simple';
  /** Recovery starts at / completes by this % of work done (defaults 10 / 80, contract term). */
  recover_from_pct?: number;
  recover_by_pct?: number;
  bg_id?: string;
}

export type CnPvExclusion = 'secured_advance' | 'extra_items' | 'escalation_free_items';

/** Price variation clause (CPWD 10CC-type by default; the contract clause governs). */
export interface CnEscalation {
  formula: 'cpwd_10cc' | 'custom';
  clause?: string;
  base_month?: string;
  components: { key: string; share_pct: number; base_index: number }[];
  /** Share of the work value that varies (default 0.85: profit and overheads 15%). */
  m_factor?: number;
  exclusions?: CnPvExclusion[];
}

export type CnClosureKey = 'final_bill' | 'completion' | 'dlp' | 'retention' | 'sd' | 'bgs' | 'pv_final' | 'no_claim' | 'reco';

export interface CnClosure {
  no_claim_ref?: string;
  no_claim_date?: string;
  /** Items ticked by hand (PV final statement, material reconciliation). */
  ticks?: Partial<Record<CnClosureKey, boolean>>;
  /** Items waived, with the reason (audited with the contract). */
  waived?: Partial<Record<CnClosureKey, string>>;
  closed_on?: string;
}

/** Table `works_contracts` (CN-B1; `master.edit`, audited, backed up, synced). Field names as CN-A's `ContractLike`. */
export interface WorksContract {
  id: string;
  boq_id?: string;
  client_id?: string;
  client_name?: string;
  name_of_work: string;
  agreement_no?: string;
  agreement_date?: string;
  work_order_no?: string;
  work_order_date?: string;
  tender_ref?: string;
  client_office?: string;
  engineer?: string;
  site?: CnSite;
  contract_value: number;
  stipulated_start?: string;
  stipulated_completion?: string;
  eots?: CnEot[];
  /** Derived on save: the latest EOT (read by the bill header). */
  extended_completion?: string;
  ld?: { pct_per_week?: number; cap_pct?: number };
  /** Deviation limit % per item (default 25, contract term). */
  deviation_pct?: number;
  dlp_months?: number;
  /** Contract terms that win over the BOQ's deduction set: retention, security deposit, water + electricity (%). */
  retention_pct?: number;
  sd_pct?: number;
  water_pct?: number;
  power_pct?: number;
  government?: boolean;
  jv?: { name: string; share_pct?: number; lead?: boolean };
  /** Derived on save: "Consortium: <name> (our share x%)". */
  jv_note?: string;
  advance_terms?: CnAdvanceTerm[];
  escalation?: CnEscalation;
  status: 'running' | 'completed' | 'closed';
  completed_on?: string;
  cost_centre_id?: string;
  notes?: string;
  closure?: CnClosure;
  created_at?: string;
  updated_at?: string;
}

/** Table `secured_advances` (CN-B2): 75% of materials at site; a liability, not an advance for supply (CN7). */
export interface SecuredAdvance {
  id: string;
  contract_id: string;
  date: string;
  materials: { item_id?: string; description: string; qty: number; unit?: string; rate: number; value: number }[];
  pct: number;
  amount: number;
  mode: string;
  bank_account_id?: string;
  /** Receipt journal Dr bank | Cr "Secured advance from clients" (class "Secured advance"). */
  voucher_id?: string;
  status: 'open' | 'cancelled';
  created_at?: string;
}

/** Table `price_variations` (CN-B3, `PVB/FY…`). */
export interface PriceVariation {
  id: string;
  number: string;
  contract_id: string;
  date: string;
  period_from: string;
  period_to: string;
  work_value: number;
  indices: { key: string; current_index: number }[];
  amount: number;
  working: CnPvSnapshot;
  /** The supplementary invoice (PV > 0) or credit note (PV < 0). */
  invoice_id?: string;
  status: 'draft' | 'billed' | 'cancelled';
  created_at?: string;
}

export type BgKind = 'performance' | 'mobilisation' | 'secured' | 'retention_release' | 'emd' | 'other';

/** Table `bank_guarantees` (CN-B5; `books.edit`, audited). */
export interface BankGuarantee {
  id: string;
  contract_id?: string;
  kind: BgKind;
  bank: string;
  bg_no: string;
  amount: number;
  issued_on: string;
  expires_on: string;
  claim_until?: string;
  margin?: { fd_ref?: string; amount?: number };
  commission_pct?: number;
  status: 'live' | 'extended' | 'released' | 'invoked';
  history: { on: string; action: 'extended' | 'released' | 'invoked'; expires_on?: string; ref?: string }[];
  created_at?: string;
}

/** One recovery typed on an RA bill (measurement form): kind, amount or qty × rate, its reference. */
export interface CnRecoveryInput {
  kind: 'secured_advance' | 'material_recovery' | 'hire_charges' | 'withheld' | 'ld' | 'other';
  amount?: number;
  qty?: number;
  rate?: number;
  /** Secured advance id. */
  ref_id?: string;
  label?: string;
  reason?: string;
  release_on?: string;
}

declare module './transport-works-r5' {
  interface RaDeduction {
    /** CN-B: the advance / secured advance this row recovers. */
    ref_id?: string;
    /** CN-B4: withheld — reason and expected release day. */
    reason?: string;
    release_on?: string;
  }
}

declare module './institutions-r5' {
  interface SecurityDeposit {
    /** CN-B5: EMD / security deposit paid to a client for this contract. */
    contract_id?: string;
  }
}

/* ════════════════════════════════════════ CN-C ════════════════════════════════════════
 * Builders: projects, units, bookings, payment plans, demands, RERA account. C adds `AdvanceRecord.booking_id` and
 * `BankAccount.rera_project_id` here. */

/* ════════════════════════════════════════ CN-D ════════════════════════════════════════
 * Site operations: sub-contract work orders, labour, muster, plant, reconciliation, site P&L. D adds
 * `PurchaseRecord.cn_sub` and `FixedAsset.cn_equipment` here. */
