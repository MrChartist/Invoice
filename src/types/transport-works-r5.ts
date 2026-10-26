/**
 * Round 5 package B (transport & works contracts) — persisted shapes and additive fields.
 * `src/types/invoice.ts`, `purchases.ts`, `manufacturing.ts` and `stock.ts` (beyond the one `Godown.kind` line) are
 * not edited: the new optional fields arrive here by declaration merging (additive, snake_case).
 * Tables: `consignment_notes`, `gta_options`, `vehicles`, `trips`, `ra_measurements`, `boq_coefficients`.
 * No device-local key. Everything here is a working paper — verify with your CA.
 */

/* ── Transport (R5-B1 … B3) ───────────────────────────────────── */

/** GTA tax option for a financial year (Annexure V / VI): reverse charge, or forward charge at 5% / 18% (12% earlier). */
export type GtaOption = 'rcm' | 'fcm_5' | 'fcm_18';

export interface GtaOptionRow {
  id: string;
  /** Indian FY label `26-27`. */
  fy: string;
  option: GtaOption;
  filed_on?: string;
  arn?: string;
  note?: string;
}

export type FreightBasis = 'fixed' | 'per_kg' | 'per_ton' | 'per_package' | 'per_trip';
export type LrPaymentBasis = 'paid' | 'to_pay' | 'tbb';
export type LrStatus = 'booked' | 'in_transit' | 'delivered' | 'billed' | 'cancelled';
/** Who pays the GST on the freight: the recipient (reverse charge) or the GTA (forward charge). */
export type GstLiable = 'recipient' | 'gta';

export interface LrPlace {
  place: string;
  /** Two-digit GST state code. */
  state: string;
}

export interface LrLine {
  description: string;
  packages: number;
  packing?: string;
  /** Kg. */
  actual_weight?: number;
  /** Kg (the weight freight is charged on). */
  charged_weight?: number;
  /** Value of goods (insurance / e-way). */
  value?: number;
  hsn?: string;
}

export interface LrCharge {
  /** loading / unloading / hamali / detention / door_delivery / lr_charge / other */
  kind: string;
  amount: number;
}

export interface LrPod {
  delivered_on: string;
  received_by?: string;
  shortage_qty?: number;
  damage_qty?: number;
  detention_days?: number;
  note?: string;
}

/** Consignment note (LR / bilty). Table `consignment_notes`, numbered `LR/FY…` (a branch may use its own prefix). */
export interface ConsignmentNote {
  id: string;
  number: string;
  date: string;
  from: LrPlace;
  to: LrPlace;
  consignor_id: string;
  consignee_id: string;
  billing_party_id?: string;
  lines: LrLine[];
  invoice_nos?: string;
  eway_nos?: string;
  vehicle_id?: string;
  vehicle_no?: string;
  driver?: string;
  basis: FreightBasis;
  rate: number;
  charges: LrCharge[];
  payment_basis: LrPaymentBasis;
  liable: GstLiable;
  liable_override_reason?: string;
  status: LrStatus;
  pod?: LrPod;
  trip_id?: string;
  bill_id?: string;
  cancelled_reason?: string;
  /** Series prefix used (default `LR`). */
  prefix?: string;
  created_at?: string;
  updated_at?: string;
}

export type VehicleDocKind = 'insurance' | 'permit' | 'fitness' | 'puc' | 'tax' | 'national_permit';

export interface VehicleDoc {
  kind: VehicleDocKind;
  number?: string;
  expires_on: string;
}

/** Table `vehicles`. Own vehicles get a cost centre of kind `vehicle`. */
export interface Vehicle {
  id: string;
  reg_no: string;
  own: boolean;
  type?: string;
  capacity_kg?: number;
  /** Owner of a hired lorry (`vendors` row — the lorry-hire bill is a purchase). */
  owner_id?: string;
  docs: VehicleDoc[];
  asset_id?: string;
  cost_centre_id?: string;
  km_per_litre?: { min: number; max: number };
  created_at?: string;
}

export type TripStatus = 'open' | 'closed' | 'cancelled';

/** Trip sheet. Table `trips`, numbered `TRP/FY…`. */
export interface Trip {
  id: string;
  number: string;
  vehicle_id: string;
  driver?: string;
  start_date: string;
  end_date?: string;
  start_km?: number;
  end_km?: number;
  route?: string;
  lr_ids: string[];
  /** Manual PAYMENT vouchers (Dr staff advances 3615) given to the driver. */
  advance_ids: string[];
  /** The settlement journal written on close. */
  settle_id?: string;
  hire_bill_id?: string;
  /** Fuel litres (sum of diesel expenses as typed). */
  litres?: number;
  status: TripStatus;
  closed_on?: string;
  created_at?: string;
}

/** Sec 194C(6) declaration of a transporter (≤ 10 goods carriages, PAN furnished). */
export interface Transporter194c6 {
  declared_on: string;
  vehicles_owned: number;
  pan: string;
}

/* ── Works contracts (R5-B4 … B6) ─────────────────────────────── */

export type RaDeductionKind = 'retention' | 'advance_recovery' | 'it_tds' | 'gst_tds' | 'labour_cess' | 'security_deposit' | 'ld' | 'other';

/** One row of a BOQ's deduction set (defaults for its RA bills). */
export interface DeductionRule {
  kind: RaDeductionKind;
  /** Percent (retention, advance recovery, IT TDS, GST TDS, cess) — absent for fixed amounts. */
  rate?: number;
  /** Fixed amount per bill (security deposit, LD, other). */
  amount?: number;
  /** Retention: computed on the value before GST ('taxable', default) or including GST ('gross'). */
  basis?: 'taxable' | 'gross';
  /** Retention cap as a percent of the contract value. */
  cap_pct?: number;
  /** Advance recovery starts after this percent of work done (threshold). */
  start_after_pct?: number;
  /** IT TDS section code (default `194C-2`). */
  section?: string;
  label?: string;
}

/** The deduction snapshot on an RA bill. */
export interface RaDeduction {
  kind: RaDeductionKind;
  label: string;
  base: number;
  rate?: number;
  amount: number;
}

/** BOQ terms on the sales order (one additive field). */
export interface BoqTerms {
  deductions?: DeductionRule[];
  /** Defect-liability period in months (retention release). */
  dlp_months?: number;
  /** Retention release on a typed day (beats `dlp_months`). */
  release_on?: string;
  /** Completion day (DLP counts from here; absent = the final RA bill's date). */
  completed_on?: string;
  /** Mobilisation advance (`advances` row) recovered from RA bills. */
  advance_id?: string;
  /** Project cost centre. */
  cost_centre_id?: string;
  /** Labour cess deducted: expense of the contractor (default) or a recoverable. */
  cess_mode?: 'expense' | 'recoverable';
  work_order?: string;
}

export interface MeasurementLine {
  line_id: string;
  cumulative_qty: number;
  this_qty: number;
  mb_ref?: string;
  extra?: { reason: string };
}

/** Table `ra_measurements`. */
export interface RaMeasurement {
  id: string;
  boq_id: string;
  ra_no: number;
  date: string;
  lines: MeasurementLine[];
  invoice_id?: string;
  status: 'draft' | 'billed' | 'cancelled';
  final?: boolean;
  created_at?: string;
}

/** Table `boq_coefficients`: theoretical consumption of a stock item per unit of a BOQ line. */
export interface BoqCoefficient {
  id: string;
  boq_id: string;
  line_id: string;
  item_id: string;
  qty_per_unit: number;
}

/* ── Additive fields on existing records ──────────────────────── */

declare module './invoice' {
  interface InvoiceRecord {
    /** R5-B2: consignment notes billed on this freight bill. */
    lr_ids?: string[];
    /** R5-B4: RA bill number (1, 2, 3 … per BOQ) and the final bill. */
    ra_no?: number;
    ra_final?: boolean;
    /** R5-B4: the BOQ (sales order) this RA bill measures. */
    boq_id?: string;
    /** R5-B5: deductions snapshot, net payable and the retention release day. */
    ra_deductions?: RaDeduction[];
    ra_net_payable?: number;
    retention_release_on?: string;
    /** R5-B4/B5: BOQ terms on the sales order (deduction set, DLP, advance, project). */
    boq_terms?: BoqTerms;
  }
  interface InvoiceItem {
    /** R5-B4: BOQ item number ("2.1.3"). */
    boq_ref?: string;
  }
  interface Client {
    /** R5-B5: the recipient deducts GST TDS u/s 51 (government / PSU / local authority). */
    gst_tds_deductor?: boolean;
    transporter_194c6?: Transporter194c6;
  }
  interface Payment {
    /** R5-B3: driver / trip receipt tag. */
    trip_id?: string;
    /** R5-B5: the RA deduction this row settles (GST TDS, cess, retention release, advance recovery). */
    ra_kind?: RaDeductionKind;
  }
}

declare module './purchases' {
  interface PurchaseRecord {
    /** R5-B3: trip expense / lorry hire of this trip. */
    trip_id?: string;
  }
  interface Vendor {
    /** R5-B3: Sec 194C(6) transporter declaration (the lorry owner is a supplier). */
    transporter_194c6?: Transporter194c6;
  }
}

declare module './manufacturing' {
  interface StockJournal {
    /** R5-B6: site consumption booked against a project cost centre. */
    cost_centre_id?: string;
  }
}

declare module './stock' {
  interface Godown {
    /** R5-B6: the BOQ a site godown belongs to. */
    boq_id?: string;
    cost_centre_id?: string;
  }
}
