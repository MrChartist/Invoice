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
    mf?: { karigar?: MfKarigar; msme_trader?: boolean };
  }
  interface PurchaseRecord {
    /** B3 scrap bought, C4 karigar piece bills. */
    mf?: { kind?: 'scrap' | 'piece_bill'; ref_id?: string; piece?: MfPieceBill };
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
    mf?: { style?: MfStyle };
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
    mf?: { lot?: string; bundles?: string[]; pieces?: number; scrap_at_jw?: boolean };
  }
}

/* ════════════════════════════════════════ MF-B ════════════════════════════════════════ */
// MF-B: drawings, inspection_reports (FAI), job_quotes, process_runs, print_estimates (PES); `mf.drawing`, `mf.print`,
// `mf.scrap`.

/** B1: one revision of a drawing; exactly one is `current` (a newer revision supersedes it). */
export interface DrawingRevision {
  rev: string;
  date: string;
  note?: string;
  attachment_id?: string;
  status: 'current' | 'superseded' | 'hold';
}

/** B1: a dimension / characteristic to inspect (nominal − tol_minus … nominal + tol_plus). */
export interface DrawingChar {
  id: string;
  name: string;
  nominal: number;
  tol_minus: number;
  tol_plus: number;
  unit: string;
  critical?: boolean;
}

/** B1: drawing register (table `drawings`, `master.edit`). */
export interface Drawing {
  id: string;
  number: string;
  title: string;
  client_id?: string;
  item_id?: string;
  revisions: DrawingRevision[];
  characteristics?: DrawingChar[];
  material_grade?: string;
  /** Owner override of a `hold` revision for production release (audited). */
  release_override?: { rev: string; by: string; at: string };
  created_at?: string;
  updated_at?: string;
}

/** B1: inspection report `FAI/FY…` (table `inspection_reports`, `doc.create`, dated). */
export interface InspectionReport {
  id: string;
  number: string;
  date: string;
  kind: 'first_article' | 'lot' | 'final';
  order_id?: string;
  drawing_id: string;
  rev: string;
  sample: number;
  readings: { char_id: string; values: number[] }[];
  result: 'pass' | 'fail' | 'deviation';
  inspector: string;
  note?: string;
  created_at?: string;
  updated_at?: string;
}

/** B2: a blank / finished shape (mm; `kg_per_m` for sections). */
export interface MfShape {
  kind: 'plate' | 'round' | 'tube' | 'ring' | 'section';
  l?: number;
  w?: number;
  t?: number;
  d?: number;
  od?: number;
  id?: number;
  kg_per_m?: number;
}

/** B2: weight-based job quote sheet (table `job_quotes`, `doc.create`, dated). Times are per piece unless `setup_h`. */
export interface JobQuote {
  id: string;
  date: string;
  client_id?: string;
  item_id?: string;
  part: string;
  drawing_id?: string;
  rev?: string;
  material: string;
  /** g / cc. */
  density: number;
  blank: MfShape;
  /** Finished shape, or `net_kg` typed. */
  finish?: MfShape;
  net_kg?: number;
  material_rate: number;
  scrap_rate: number;
  ops: { name: string; hours: number; setup_h?: number; rate: number; work_centre_id?: string }[];
  outside: { name: string; basis: 'kg' | 'piece'; rate: number }[];
  packing?: number;
  freight?: number;
  overhead_pct: number;
  margin_pct: number;
  breaks: number[];
  quote_ids?: string[];
  status: 'draft' | 'quoted' | 'won' | 'lost';
  created_at?: string;
  updated_at?: string;
}

/** B4: a mould / die (`mfg_settings.moulds`). */
export interface MfMould {
  id: string;
  name: string;
  item_id: string;
  cavities: number;
  cycle_s: number;
  /** Shot weight incl. runner, g; runner weight, g (part weight = (shot − runner) ÷ cavities). */
  shot_g?: number;
  runner_g?: number;
  life_shots?: number;
  shots_done: number;
}

/** B4: moulding / extrusion run (table `process_runs`, `doc.create`, dated). */
export interface ProcessRun {
  id: string;
  date: string;
  shift?: string;
  order_id?: string;
  work_centre_id?: string;
  mould_id?: string;
  item_id: string;
  hours: number;
  cycle_s?: number;
  cavities?: number;
  shots?: number;
  /** g per good part (else from the mould). */
  part_g?: number;
  inputs: { item_id: string; kind: 'virgin' | 'regrind' | 'masterbatch' | 'additive'; kg: number; batch?: string }[];
  good_qty: number;
  reject_qty: number;
  runner_kg?: number;
  purge_kg?: number;
  regrind_out_kg?: number;
  regrind_item_id?: string;
  /** The manufacturing journal the run wrote. */
  voucher_id?: string;
  note?: string;
  created_at?: string;
  updated_at?: string;
}

/** B5: a press (`mfg_settings.presses`); sheet sizes in mm. */
export interface MfPress {
  id: string;
  name: string;
  max_sheet: { w: number; h: number };
  colours: number;
  impressions_per_hour: number;
  make_ready_min: number;
  make_ready_sheets: number;
  rate_per_1000_imp: number;
  min_charge: number;
  work_centre_id?: string;
}

/** B5: a finishing line of an estimate (₹ per sq in of sheet, per sheet, per piece or per lot). */
export interface PrintFinish {
  name: string;
  basis: 'sqin' | 'sheet' | 'piece' | 'lot';
  rate: number;
}

/** B5: print estimate `PES/FY…` (table `print_estimates`, `doc.create`, dated). Sizes in mm. */
export interface PrintEstimate {
  id: string;
  number: string;
  date: string;
  client_id?: string;
  item_id?: string;
  job: string;
  size: { w: number; h: number };
  breaks: number[];
  colours_front: number;
  colours_back: number;
  varnish_plate?: boolean;
  press_id?: string;
  sheet: { w: number; h: number };
  margins?: { gripper: number; bleed: number; edge: number };
  gsm: number;
  stock_item_id?: string;
  /** Paper ₹ per kg. */
  paper_rate: number;
  plate_rate: number;
  running_waste_pct: number;
  finishing: PrintFinish[];
  outside?: number;
  margin_pct: number;
  quote_ids?: string[];
  order_id?: string;
  status: 'draft' | 'quoted' | 'won' | 'lost';
  created_at?: string;
  updated_at?: string;
}

/** B4 / B5 sub-fields of the company object `mfg_settings`. */
export interface MfgSettings {
  moulds?: MfMould[];
  presses?: MfPress[];
  /** B4: the stock item regrind goes to when a run names none. */
  regrind_item_id?: string;
}

export interface MfScrapSnap {
  /** B3: the buyer's declaration of use in manufacturing (Form 127 / earlier 27C) — TCS not collected. */
  declaration?: string;
  /** B3: "Buyer deducts GST TDS 2% u/s 51" note printed. */
  gst_tds?: boolean;
}

declare module './purchases' {
  interface PurchaseLine {
    /** B1: heat no. / material test certificate ref of the material bought (carried to the output batch). */
    mf_heat?: string;
  }
}

declare module '../lib/inventory' {
  interface StockItem {
    /** B4: highest regrind % in the mix the customer / quality term allows. */
    mf_max_regrind_pct?: number;
    /** B4: post-consumer recycled material (recycled content in the EPR register). */
    mf_pcr?: boolean;
    /** B4: kg per unit for EPR kg when the item is not sold in kg. */
    mf_unit_kg?: number;
  }
}

/* ════════════════════════════════════════ MF-C ════════════════════════════════════════ */
// MF-C: cut_plans (CUT, bundles inside), karigar piece bills (KPB on `purchases`); `mf.cmt`. Declare the row shapes here.


/** C1: a style's fabric (per colour, optional) and trims; on `StockItem.mf.style` of the style (a variant parent). */
export interface MfStyle {
  fabric_items: { item_id: string; per_piece_m: number; colour_map?: Record<string, string> }[];
  trims?: { item_id: string; per_piece: number }[];
  size_ratio_default?: Record<string, number>;
  routing_id?: string;
}

/** C1: one lay of a cut plan. */
export interface MfLay {
  plies: number;
  marker_ratio: Record<string, number>;
  marker_length_m: number;
  width_cm?: number;
}

/** C2: one operation a bundle went through (or a reject). */
export interface MfBundleStep {
  date: string;
  op_id?: string;
  op?: string;
  good: number;
  rejected: number;
  reason?: string;
  /** Who (karigar vendor id / employee id) and the job-card entry it was recorded against. */
  by?: string;
  jc_entry_id?: string;
}

export type MfBundleWhere = 'floor' | 'fabricator' | 'finished' | 'rejected';

/** C2: a bundle inside its lot (`<lot>/<no>`). `pieces` as cut; rejected pieces leave it (`rejected`). */
export interface MfBundle {
  no: number;
  size: string;
  colour: string;
  shade?: string;
  pieces: number;
  rejected?: number;
  /** QA15 M1: `got` = pieces of the bundle already received back on its CMT challan (a part-received bundle stays there). */
  at: { op_id?: string; op?: string; where: MfBundleWhere; party_id?: string; challan_id?: string; got?: number };
  history: MfBundleStep[];
  /** The output journal (R4-A manufacturing voucher) that reported its finished pieces, or `cmt:<Material In id>` when
   *  its stitched pieces reached stock on a CMT receipt (QA15 M1: never reported again). */
  reported?: string;
}

/** C1: cut plan / lot `CUT/FY…` (table `cut_plans`, `doc.create`); bundles inside. */
export interface CutPlan {
  id: string;
  number: string;
  date: string;
  order_id?: string;
  style_id: string;
  colour: string;
  fabric_item_id: string;
  fabric_batch?: string;
  lays: MfLay[];
  /** Pieces cut by size (Σ plies × ratio unless typed). */
  cut: Record<string, number>;
  fabric_issued_m: number;
  end_bits_m?: number;
  cut_waste_kg?: number;
  waste_item_id?: string;
  bundle_size?: number;
  bundles?: MfBundle[];
  /** Stock documents written for the cut (R4-A issue / return, the waste journal). */
  docs?: { issue_id?: string; return_id?: string; waste_id?: string };
  notes?: string;
  created_at?: string;
  updated_at?: string;
}

/** C4: a karigar's rate (operation id or name; a style-specific row wins). */
export interface MfKarigarRate {
  op: string;
  style_id?: string;
  rate: number;
  from: string;
}

/** C4: `Vendor.mf.karigar` — a piece-rate worker who is not on payroll. PAN / bank come from the vendor master. */
export interface MfKarigar {
  kind: 'home' | 'floor' | 'fabricator';
  rates: MfKarigarRate[];
  upi?: string;
  /** Deduct pieces rejected for his fault from the bill (default on). */
  deduct_rejects?: boolean;
}

export interface MfPieceLine {
  op: string;
  style?: string;
  pieces: number;
  rate: number;
  amount: number;
  source: 'jobcard' | 'bundle' | 'cmt' | 'typed';
  refs?: string[];
}

/** C4: `PurchaseRecord.mf.piece` of a karigar piece bill `KPB/FY…`. */
export interface MfPieceBill {
  period: { from: string; to: string };
  lines: MfPieceLine[];
  rejected_deducted?: number;
  advance_recovered?: number;
  advance_jv_id?: string;
}

/* ════════════════════════════════════════ MF-D ════════════════════════════════════════ */
// MF-D: cost_cards, export_authorisations, incentive_claims; `mf.food`, `mf.export_aa`. Declare the row shapes here.
