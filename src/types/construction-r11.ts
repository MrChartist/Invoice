/**
 * Round 11 (construction) — persisted shapes and additive fields of the four packages (docs/prd/round-11.md §6).
 * `invoice.ts`, `purchases.ts`, `localDb.ts` and `invoice-defaults.ts` are not edited: everything a construction
 * document prints lives under keys `normalizeRecord` already keeps verbatim — the record key `boq_terms` (R5-B) gains
 * one sub-object `cn` (the construction snapshot) and new deduction kinds go into `ra_deductions`. On a BOQ (sales
 * order) `boq_terms` keeps its R5 meaning; on an RA bill / demand / works invoice `boq_terms.cn` is the snapshot.
 * One block per package, marked `// CN-A` … `// CN-D`: each package fills only its own block. Types only (0 bytes).
 * Everything here is a working paper — verify with your CA (docs/CA_REVIEW.md §11, CN1–CN28).
 */
import type { AttachmentRef } from './attachments'; // CN-D2 (labour compliance files)

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
  /** CN-C: builder settings (interest on delay, forfeiture, allotment terms). */
  realty?: RealtySettings;
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
  [key: string]: unknown;
}

/** CN-C3: stage demand snapshot on a demand invoice (fields: `CnDemandFields` in the CN-C block). */
export interface CnDemandSnapshot extends CnDemandFields {
  booking_id?: string;
  unit?: string;
  stage?: string;
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

/* ════════════════════════════════════════ CN-C ════════════════════════════════════════
 * Builders: projects, units, bookings, payment plans, demands, RERA account. C adds `AdvanceRecord.booking_id` and
 * `BankAccount.rera_project_id` here. */

/** Real-estate GST class of a booked unit (derived at booking, kept on the booking as a snapshot). */
export type RealtyClass = 'realty_affordable' | 'realty_residential' | 'realty_commercial' | 'realty_old_option';
export type RealtyUnitType = 'residential' | 'commercial' | 'parking' | 'plot';
export type RealtyUnitStatus = 'available' | 'hold' | 'booked' | 'registered' | 'cancelled';
export type BookingStatus = 'booked' | 'agreement' | 'registered' | 'possession' | 'cancelled';

/** Table `realty_projects` (`master.edit`). */
export interface RealtyProject {
  id: string;
  name: string;
  cost_centre_id?: string;
  rera_no?: string;
  rera_valid_till?: string;
  /** Bank account (bank_accounts id) designated as the RERA 70% account; collection account. */
  rera_account_id?: string;
  collection_account_id?: string;
  address?: string;
  state_code: string;
  city_class: 'metro' | 'other';
  gst_scheme: 'n03_2019' | 'old_option';
  /** `old_option` projects: the typed GST rate with ITC. */
  old_rate?: number;
  started_on?: string;
  /** Completion certificate / occupancy certificate (demands on / after `cc_date` carry no GST). */
  cc_date?: string;
  oc_date?: string;
  towers: { id: string; name: string; floors: number; completion_pct?: number }[];
  created_at: string;
  updated_at?: string;
}

/** Table `realty_units` (`master.edit`). `base_rate` is ₹ per sq ft of saleable area (carpet when none). */
export interface RealtyUnit {
  id: string;
  project_id: string;
  tower_id: string;
  unit_no: string;
  floor: number;
  type: RealtyUnitType;
  carpet_sqm: number;
  saleable_sqft?: number;
  base_rate: number;
  plc?: { label: string; amount: number }[];
  status: RealtyUnitStatus;
  booking_id?: string;
}

/** A cost-sheet head: taxable heads make the agreement value; pass-through heads (pure agent, Rule 33) never do. */
export interface CostHead {
  head: string;
  amount: number;
  taxable: boolean;
  pass_through: boolean;
}

/** Cancellation snapshot on a booking (CN-C5). */
export interface BookingCancellation {
  date: string;
  reason: string;
  received: number;
  forfeiture: number;
  /** GST on demands outside the Sec 34 window, not reversed by a credit note (the buyer claims it, Circular 188). */
  tax_retained: number;
  refund: number;
  path: 'credit_note' | 'refund_net';
  credit_note_ids?: string[];
  refund_numbers?: string[];
  /** Refund still to be paid outside the advance vouchers (money already adjusted against demands). */
  refund_pending?: number;
  journal_id?: string;
}

/** Table `realty_bookings` (`BKG/FY…`, `doc.create`, dated `date`). */
export interface RealtyBooking {
  id: string;
  number: string;
  date: string;
  unit_id: string;
  project_id: string;
  client_id?: string;
  client_name: string;
  co_applicants?: string;
  cost_sheet: CostHead[];
  /** Sum of the taxable heads (the consideration). */
  agreement_value: number;
  /** Stamp-duty value when higher (194-IA test). */
  stamp_value?: number;
  agreement_date?: string;
  registered_on?: string;
  plan_id: string;
  cls: RealtyClass;
  broker?: { vendor_id?: string; name?: string; pct: number };
  loan?: { bank: string; sanction?: number };
  status: BookingStatus;
  /** Interest on delayed payment waived for this booking (audited with the row). */
  interest_waived?: boolean;
  cancellation?: BookingCancellation;
  created_at: string;
  updated_at?: string;
}

export interface PlanStage {
  id: string;
  label: string;
  pct: number;
  due_days: number;
  trigger: 'booking' | 'agreement' | 'stage' | 'date';
  date?: string;
}

/** Table `payment_plans` (`master.edit`); stage % sum to 100. */
export interface PaymentPlan {
  id: string;
  name: string;
  kind: 'clp' | 'time' | 'down_payment' | 'subvention';
  stages: PlanStage[];
}

/** Table `stage_certificates` (`doc.create`, dated `certified_on`). */
export interface StageCertificate {
  id: string;
  project_id: string;
  tower_id: string;
  stage_id: string;
  stage_label: string;
  certified_on: string;
  by: string;
  ref?: string;
}

export interface ReraCert {
  name: string;
  ref: string;
  date: string;
}

/** Table `rera_withdrawals` (`books.edit`, dated `date`). `kind: 'deposit'` rows record transfers into the account. */
export interface ReraWithdrawal {
  id: string;
  project_id: string;
  date: string;
  amount: number;
  kind?: 'withdrawal' | 'deposit';
  completion_pct?: number;
  certificates?: { engineer?: ReraCert; architect?: ReraCert; ca?: ReraCert };
  purpose?: 'land' | 'construction';
  note?: string;
}

/** Builder settings, kept in `construction_settings.realty` (owner). */
export interface RealtySettings {
  /** Interest on delayed payment, % a year (state RERA rule — SBI MCLR + 2% by default). */
  interest_rate?: number;
  /** Forfeiture on cancellation: % of agreement value, or a fixed amount when set. */
  forfeit_pct?: number;
  forfeit_amount?: number;
  /** Allotment-letter terms. */
  terms?: string;
}

declare module './advances' {
  interface AdvanceRecord {
    /** CN-C2: the booking this receipt is for (realty desk). */
    booking_id?: string;
    /** CN-C2: a pass-through collection (stamp duty, registration, deposits — pure agent, no GST, outside RERA 70%). */
    pass_through?: boolean;
  }
}

declare module '../lib/bank-accounts' {
  interface BankAccount {
    /** CN-C4: this account is the RERA designated (70%) account of that project. */
    rera_project_id?: string;
  }
}

/** Fields of `boq_terms.cn.demand` (CN-C3), kept on the demand invoice as a snapshot. */
export interface CnDemandFields {
  number?: string;
  booking_no?: string;
  tower?: string;
  carpet_sqm?: number;
  rera_no?: string;
  project?: string;
  stage_id?: string;
  stage_label?: string;
  pct?: number;
  agreement_value?: number;
  /** Including this demand. */
  demanded?: number;
  previously_demanded?: number;
  previously_received?: number;
  /** Earlier demand documents' totals incl. GST (for the balance due). */
  previously_billed?: number;
  interest?: { days: number; rate: number; amount: number };
  /** Dated on / after the completion certificate: not a supply (Sch III para 5(b)). */
  cc_after?: boolean;
  cls?: RealtyClass;
  /** One-third land working: value, deemed land, taxable two-thirds, notification and effective rate. */
  land?: { value: number; land: number; taxable: number; notif: number; effective: number };
  account?: { name: string; no?: string; ifsc?: string };
  plan?: { label: string; pct: number }[];
}

/* ════════════════════════════════════════ CN-D ════════════════════════════════════════
 * Site operations: sub-contract work orders, labour, muster, plant, reconciliation, site P&L. D adds
 * `PurchaseRecord.cn_sub` and `FixedAsset.cn_equipment` here (and `Godown.cn_reco`, `BoqTerms.site_pnl`). */

/** CN-D1: deductions on a sub-contractor's bill (a work-order rule; `rate` % of the value before GST, or `amount`). */
export type SubDeductionKind = 'retention' | 'advance_recovery' | 'material_recovery' | 'hire_recovery' | 'other';
export interface SubDeductionRule {
  kind: SubDeductionKind;
  rate?: number;
  amount?: number;
  label?: string;
}

export interface SubWoLine {
  id: string;
  /** The BOQ line this item is sublet from (back-to-back). */
  boq_line_id?: string;
  ref: string;
  description: string;
  unit: string;
  qty: number;
  rate: number;
  sac: string;
  gst_rate: number;
}

/** Table `sub_work_orders` (`SWO/FY…`, `doc.create`, dated `date`). */
export interface SubWorkOrder {
  id: string;
  number: string;
  date: string;
  vendor_id: string;
  vendor_name: string;
  contract_id?: string;
  boq_id?: string;
  /** Site godown (kind `site`) and its cost centre. */
  site_id?: string;
  cost_centre_id?: string;
  lines: SubWoLine[];
  deductions: SubDeductionRule[];
  /** IT TDS section of his bills (default 194C by PAN). */
  tds_section?: string;
  status: 'open' | 'closed' | 'cancelled';
  created_at: string;
  updated_at?: string;
}

/** Table `sub_measurements` (`SCB/FY…`, `doc.create`, dated `date`): the `ra_measurements` shape against a work order. */
export interface SubMeasurement {
  id: string;
  number: string;
  wo_id: string;
  date: string;
  period_from?: string;
  period_to?: string;
  lines: { line_id: string; cumulative_qty: number; this_qty: number; mb_ref?: string }[];
  /** The purchase bill made from it and the deductions journal. */
  purchase_id?: string;
  jv_id?: string;
  status: 'billed' | 'cancelled';
  created_at: string;
}

/** One deduction booked on a sub-contractor's bill (snapshot). */
export interface CnSubDeduction {
  kind: SubDeductionKind;
  label: string;
  amount: number;
  item_id?: string;
  qty?: number;
  rate?: number;
}

/** `PurchaseRecord.cn_sub`: a sub-contractor bill (D1) or a plant-hire bill (D3), snapshotted at save. */
export interface CnSubSnapshot {
  kind: 'subcon' | 'hire';
  wo_id?: string;
  wo_number?: string;
  measurement_id?: string;
  /** SCB/FY… */
  number?: string;
  site_id?: string;
  abstract?: { ref: string; description: string; unit: string; rate: number; prev_qty: number; this_qty: number; cum_qty: number; amount: number; mb?: string }[];
  deductions?: CnSubDeduction[];
  tds?: number;
  /** Bill total − TDS − deductions. */
  net?: number;
  /** Journal Dr creditors | Cr retention payable / recoveries (its amount sits in `amount_paid`). */
  jv_id?: string;
  /** D3: hired equipment, month (YYYY-MM) and operator flag. */
  equipment_id?: string;
  month?: string;
  with_operator?: boolean;
}

/** CN-D2: table `labour_compliance` (vendor × month, `doc.create`). Files go through the attachments store. */
export interface LabourCompliance {
  id: string;
  vendor_id: string;
  vendor_name: string;
  /** YYYY-MM */
  month: string;
  headcount: number;
  wages: number;
  pf: { trrn?: string; amount?: number; file?: AttachmentRef };
  esi: { challan?: string; amount?: number; file?: AttachmentRef };
  wage_register?: AttachmentRef;
  licence?: { no: string; valid_till: string };
  status: 'pending' | 'proved' | 'waived';
}

/** CN-D2: table `site_labour` (`master.edit`). `site_id` = site godown. */
export interface SiteLabour {
  id: string;
  name: string;
  trade: string;
  daily_rate: number;
  ot_rate: number;
  /** Minimum wage typed for the trade (warning only). */
  min_wage?: number;
  phone?: string;
  id_ref?: string;
  site_id: string;
  /** Linked payroll employee (later). */
  employee_id?: string;
  active: boolean;
}

/** CN-D2: table `muster_days` — one row per site per day (`doc.create`, dated `date`). */
export interface MusterDay {
  id: string;
  site_id: string;
  date: string;
  entries: { labour_id: string; present: 0 | 0.5 | 1; ot_hours?: number }[];
  /** Weekly settlement `MUS/FY…` and its payment voucher. */
  mus_no?: string;
  voucher_id?: string;
}

/** CN-D3: table `hired_equipment` (`master.edit`). */
export interface HiredEquipment {
  id: string;
  vendor_id: string;
  vendor_name: string;
  description: string;
  rate: number;
  basis: 'hour' | 'day' | 'month';
  with_operator: boolean;
  from: string;
  to?: string;
  /** Fuel per working hour, typed range (litres). */
  fuel_min?: number;
  fuel_max?: number;
}

/** CN-D3: table `plant_logs` (`PLG/FY…`, `doc.create`, dated `date`). `equipment_ref` = `fa:<asset id>` | `hire:<id>`. */
export interface PlantLog {
  id: string;
  number: string;
  date: string;
  equipment_ref: string;
  site_id: string;
  hours_worked: number;
  idle_hours: number;
  breakdown_hours: number;
  fuel_litres: number;
  operator?: string;
  /** Hire out: charged to this sub-contractor (vendor id) at the equipment's hire-out rate. */
  sub_contractor_id?: string;
  /** The sub-contractor bill (SCB number) that recovered it. */
  recovered_in?: string;
}

/** `FixedAsset.cn_equipment` (D3). */
export interface CnEquipment {
  kind: string;
  reg_no?: string;
  hour_meter?: number;
  cost_centre_id?: string;
  /** Internal charge to our own sites and hire-out rate, per hour. */
  internal_rate?: number;
  hire_rate?: number;
  fuel_min?: number;
  fuel_max?: number;
}

/** `Godown.cn_reco` on a site godown (D4): contract terms per material and client-issued receipts. */
export interface CnSiteReco {
  /** Per stock item: permissible band (−lo% / +hi%), issue rate and penal factor (contract terms). */
  terms?: Record<string, { lo?: number; hi?: number; issue_rate?: number; penal?: number }>;
  /** Materials issued by the client: free (quantity only, value 0) or against recovery at `rate`. */
  issues?: { id: string; date: string; item_id: string; qty: number; mode: 'free' | 'recovery'; rate?: number; ref?: string }[];
}

/** `boq_terms.site_pnl` on a BOQ (D5 memo inputs, typed). */
export interface CnSitePnlInputs {
  /** Work done but not yet measured (₹). */
  unmeasured?: number;
  /** Cost to complete per BOQ group (₹). */
  ctc?: { group: string; amount: number }[];
  updated_at?: string;
}

export interface ConstructionSettings {
  /** CN-D2: hold on a labour contractor's bill until the month's PF / ESI is proved (% of the bill, default 10). */
  labour_withhold_pct?: number;
}

declare module './purchases' {
  interface PurchaseRecord {
    /** CN-D1 / D3: sub-contractor bill or plant-hire bill snapshot. */
    cn_sub?: CnSubSnapshot;
  }
}

declare module '../lib/ledger/assets' {
  interface FixedAsset {
    /** CN-D3: this asset is site equipment (log sheets, hire out, internal charge). */
    cn_equipment?: CnEquipment;
  }
}

declare module './stock' {
  interface Godown {
    /** CN-D4: material reconciliation terms and client-issued receipts of a site godown. */
    cn_reco?: CnSiteReco;
  }
}

declare module './transport-works-r5' {
  interface BoqTerms {
    /** CN-D5: WIP memo inputs (work not yet measured, cost to complete). */
    site_pnl?: CnSitePnlInputs;
  }
}
