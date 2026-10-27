/**
 * Round 13 (manufacturing MSMEs) — persisted shapes and additive fields of the four packages (docs/prd/round-13.md §6).
 * `invoice.ts`, `purchases.ts`, `localDb.ts`, `inventory.ts`, `production-r4.ts` and `job-work.ts` are not edited: the
 * new optional fields arrive here by declaration merging. Every Round 13 snapshot on a document lives under ONE record
 * key `mf` (`R13_RECORD_KEYS` in `src/store/invoice-defaults.ts`); there is no Round 13 line key (per-line particulars sit
 * in `mf.lines[lineId]`). MF-A declares the sub-field types of `mf` for all four packages in one commit; MF-B … MF-D
 * fill only their own block (`// MF-B` …) — an interface re-declared in a later block merges with MF-A's.
 * Types only (0 bytes). Working papers — verify with your CA (docs/CA_REVIEW.md §13, MF1–MF32 and MF33+).
 */

/* ════════════════════════════════════════ MF-A ════════════════════════════════════════ */

/** The factory picked on the "Factory / manufacturing" card (settings `mfg_kind`). */
export type MfgKind = 'engineering' | 'textile' | 'plastics' | 'printing' | 'food' | 'other';
/** Sub-choice (settings `mfg_sub`): engineering `drawing` / `catalogue`; textile `yarn` / `fabric` / `processing` /
 *  `garments`; plastics `moulding` / `extrusion` / `film` / `corrugation`. */
export type MfgSub = 'drawing' | 'catalogue' | 'yarn' | 'fabric' | 'processing' | 'garments' | 'moulding' | 'extrusion' | 'film' | 'corrugation';

/** The views a kind turns on (A1 table); a switch the user set is never turned back by a profile. */
export interface MfSwitches {
  routings?: boolean;
  job_cards?: boolean;
  machine_hours?: boolean;
  drawings?: boolean;
  scrap?: boolean;
  inspection?: boolean;
  styles?: boolean;
  cut_plans?: boolean;
  bundles?: boolean;
  cmt?: boolean;
  karigars?: boolean;
  price_bands?: boolean;
  runs?: boolean;
  regrind?: boolean;
  balance?: boolean;
  epr?: boolean;
  estimates?: boolean;
  tickets?: boolean;
  paper_gsm?: boolean;
  print_classes?: boolean;
  cost_cards?: boolean;
  shelf_life?: boolean;
  fssai_print?: boolean;
  min_shelf?: boolean;
  schemes?: boolean;
}

/**
 * Company object `mrchartist_inv_mfg_settings` (`settings.manage`, audited on save, synced as a singleton, backed up).
 * B–D add their object-valued sub-fields (moulds, presses, absorb switch, e-way note …) in their own blocks below;
 * `cleanMfgSettings` keeps every object-valued key it does not know.
 */
export interface MfgSettings {
  switches?: MfSwitches;
  /** A3: reject reasons offered on a job-card entry (default list in `mfg-rules.ts` `WORK_DEFAULTS`). */
  reject_reasons?: string[];
  /** A3: the stock item job-card scrap kg goes to when an entry names none. */
  scrap_item_id?: string;
  updated_at?: string;
}

/** A shift of a work centre (hours a day). */
export interface WorkShift {
  name: string;
  hours: number;
}

/** A2: work centre (table `work_centres`, `master.edit`). Machine-hour rate = hourly + labour + power + overhead. */
export interface WorkCentre {
  id: string;
  name: string;
  kind: 'machine' | 'line' | 'manual' | 'outside';
  /** ₹ / hour of the machine (depreciation, upkeep). */
  hourly_rate: number;
  labour_rate?: number;
  power_rate?: number;
  overhead_rate?: number;
  shifts: WorkShift[];
  /** Working weekdays, 0 = Sunday … 6 = Saturday (`Date.getDay`). */
  days: number[];
  /** % (default 100). */
  efficiency_pct?: number;
  /** Parallel machines / operators (default 1). */
  capacity_units?: number;
  /** Local days (`yyyy-mm-dd`) the centre is closed. */
  holidays?: string[];
  /** D5: typed normal capacity, hours a year (AS 2). */
  normal_hours?: number;
  cost_centre_id?: string;
  /** `outside`: the job worker (vendor) who does the operation. */
  vendor_id?: string;
  active: boolean;
  created_at?: string;
  updated_at?: string;
}

/** One operation of a routing. Run time per unit (`run_min_per_unit`) or a rate (`run_units_per_hour`). */
export interface RoutingOp {
  id: string;
  seq: number;
  name: string;
  work_centre_id: string;
  setup_min: number;
  run_min_per_unit?: number;
  run_units_per_hour?: number;
  /** Batch operation (oven, coating): run time is per batch of this many units. */
  batch_size?: number;
  move_min?: number;
  inspection?: boolean;
  /** C4: ₹ per good unit paid to a karigar / piece-rate operator. */
  piece_rate?: number;
  notes?: string;
}

/** A2: routing (table `routings`, `master.edit`). One default per item. */
export interface Routing {
  id: string;
  item_id: string;
  bom_id?: string;
  name: string;
  is_default: boolean;
  revision?: string;
  /** A3: an operation may report more good units than the previous one gave. */
  allow_out_of_sequence?: boolean;
  ops: RoutingOp[];
  created_at?: string;
  updated_at?: string;
}

/** A2: an operation copied onto a released order (snapshot; the routing changing later never changes it). */
export interface MfOrderOp extends RoutingOp {
  /** Planned hours for the order's planned quantity (set-up + run ÷ efficiency), 2 decimals. */
  planned_hours: number;
  /** Machine-hour rate of the work centre at release (₹ / hour). */
  rate: number;
}

/** Who did the work on a job-card entry: an employee (payroll piece rate) or a karigar (vendor, C4). */
export interface JobOperator {
  kind: 'employee' | 'karigar';
  id: string;
}

/** One reported spell of work on an operation. Hours from start / end (local `HH:mm`) or typed. */
export interface JobCardEntry {
  id: string;
  date: string;
  start?: string;
  end?: string;
  hours: number;
  /** A set-up spell (counted as set-up, not run, in the day report). */
  setup?: boolean;
  operator?: JobOperator;
  /** Machine name / number within the work centre. */
  machine?: string;
  good: number;
  rejected: number;
  rework: number;
  reason?: string;
  scrap_kg?: number;
  scrap_item_id?: string;
  note?: string;
}

/** A3: job card `JCD/FY…` (table `job_cards`): ONE row per production order per operation, with an entries array. */
export interface JobCard {
  id: string;
  number: string;
  /** yyyy-mm-dd: the first entry's day (else the day the card was opened); FY of the number. */
  date: string;
  order_id: string;
  op_id: string;
  work_centre_id: string;
  planned: { qty: number; hours: number };
  entries: JobCardEntry[];
  status: 'open' | 'running' | 'done';
  created_at?: string;
  updated_at?: string;
}

/** A5: per-line manufacturing particulars on an invoice (printed under the line by `mfLineText`). */
export interface MfLineSnap {
  drawing?: string;
  rev?: string;
  po_line?: string;
  heat?: string;
  grade?: string;
  batch?: string;
  packed_on?: string;
  best_before?: string;
  use_by?: string;
  mrp?: number;
  style?: string;
  lot?: string;
  /** "S6 M12 L12 XL6" (C) — printed as typed. */
  sizes?: string;
  epr_cat?: string;
  recycled_pct?: number;
}

/** A5: the header box (job particulars) — engineering customer PO and drawing list. */
export interface MfHeaderSnap {
  customer_po?: string;
  drawings?: string;
  /** Free particulars lines (each printed as one row). */
  rows?: { label: string; value: string }[];
}

/** B: drawing / inspection summary of an engineering invoice (filled by MF-B). */
export interface MfDrawingSnap {
  inspection?: { report_no?: string; result?: string; rows?: { label: string; value: string }[] };
}
/** B: print-job particulars (size, colours, ups, sheets, impressions, paper). */
export interface MfPrintSnap {
  size?: string;
  colours?: string;
  ups?: number;
  sheets?: number;
  impressions?: number;
  paper?: string;
  quantity?: string;
}
/** B: scrap weighment of a scrap invoice. */
export interface MfScrapSnap {
  rows?: { item: string; gross_kg?: number; tare_kg?: number; net_kg: number }[];
  tcs?: boolean;
}
/** C: CMT / garment invoice — the size × colour breakdown. */
export interface MfCmtSnap {
  sizes?: string[];
  grid?: { colour: string; qty: number[] }[];
}
/** D: food invoice header. */
export interface MfFoodSnap {
  fssai?: string;
}
/** D: export under Advance Authorisation. */
export interface MfExportAaSnap {
  aa_no?: string;
  sion?: string;
}

/** A5: the Round 13 snapshot on an invoice (record key `mf`). Each package writes its sub-object through `mfSnapshot`. */
export interface MfSnapshot {
  kind?: 'drawing' | 'food' | 'print' | 'cmt' | 'scrap' | 'export_aa';
  header?: MfHeaderSnap;
  drawing?: MfDrawingSnap;
  print?: MfPrintSnap;
  scrap?: MfScrapSnap;
  cmt?: MfCmtSnap;
  food?: MfFoodSnap;
  export_aa?: MfExportAaSnap;
  lines?: Record<string, MfLineSnap>;
  /** Snapshot text of a declaration (wins over the derived ones). */
  declaration?: string;
  /** B4: recycled content % (PWM Rules) printed as a declaration. */
  recycled_pct?: number;
}

/** A2 / A3 (+ C, D): the order's Round 13 part. */
export interface MfOrder {
  ops?: MfOrderOp[];
  grid?: { colour: string; qty: number[] }[];
  food?: { shelf_life_days?: number };
}

declare module './invoice' {
  interface InvoiceRecord {
    /** Round 13 record snapshot (see `MfSnapshot`). */
    mf?: MfSnapshot;
  }
  interface SenderProfile {
    /** MF-A5: Udyam category (printed with the number; micro / small adds the MSMED Sec 15 clause for GSTIN buyers). */
    msme_category?: 'MICRO' | 'SMALL' | 'MEDIUM';
    /** MF-A5: "Print Udyam number" — off only when `false` (MF22). */
    udyam_print?: boolean;
    /** MF-A5: FSSAI licence / registration number (14 digits), printed under the GSTIN (never on e-way JSON). */
    fssai_no?: string;
  }
  interface Client {
    /** C / D: EPR registration of a brand owner (B4), minimum remaining shelf life % at dispatch (D2). */
    mf?: { epr_no?: string; min_shelf_pct?: number };
  }
}

declare module './purchases' {
  interface Vendor {
    /** C4: a karigar paid by the piece; D3: an Udyam-registered trader (outside 43B(h)). */
    mf?: { karigar?: boolean; msme_trader?: boolean };
  }
  interface PurchaseRecord {
    /** B3 scrap bought, C4 karigar piece bills. */
    mf?: { kind?: 'scrap' | 'piece_bill'; ref_id?: string };
  }
}

declare module '../lib/localDb' {
  interface AppSettings {
    /** MF-A1: manufacturing profile (business type `manufacturer`, or unchanged for `other`); absent = not chosen. */
    mfg_kind?: MfgKind;
    mfg_sub?: MfgSub;
  }
}

declare module '../lib/inventory' {
  interface StockItem {
    /** A4: supplier lead time (days) and manufacturing lead time (days; default from the routing). */
    lead_days?: number;
    make_days?: number;
    /** B3 scrap class, B/C/D tax class, B4 EPR category, D1 shelf life, D5 Schedule III class, C1 style. */
    mf_scrap_class?: string;
    mf_class?: string;
    mf_epr?: string;
    shelf_life_days?: number;
    mf_inv_class?: string;
    mf?: { style?: string };
  }
}

declare module './production-r4' {
  interface ProductionOrder {
    mf?: MfOrder;
  }
}

declare module './manufacturing' {
  interface VoucherOutputLine {
    /** A3: a scrap line that came from job-card scrap kg (counted once against the cards). */
    mf_jc?: boolean;
  }
  interface ProductionPlan {
    /** A4: a dated plan (buckets by day / week). Old plans open unchanged. */
    dated?: boolean;
    buckets?: 'day' | 'week';
  }
}

declare module './job-work' {
  interface JobWorkLine {
    /** C: bundle / lot reference of a CMT challan line. */
    mf?: { lot?: string; bundles?: string[] };
  }
}

/* ════════════════════════════════════════ MF-B ════════════════════════════════════════ */
// MF-B: drawings, inspection_reports (FAI), job_quotes, process_runs, print_estimates (PES); `mf.drawing`, `mf.print`,
// `mf.scrap`. Declare the row shapes here.

/* ════════════════════════════════════════ MF-C ════════════════════════════════════════ */
// MF-C: cut_plans (CUT, bundles inside), karigar piece bills (KPB on `purchases`); `mf.cmt`. Declare the row shapes here.

/* ════════════════════════════════════════ MF-D ════════════════════════════════════════ */
// MF-D: cost_cards, export_authorisations, incentive_claims; `mf.food`, `mf.export_aa`. Declare the row shapes here.
