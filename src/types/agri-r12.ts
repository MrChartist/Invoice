/**
 * Round 12 (agriculture and food processing) — persisted shapes and additive fields of the four packages
 * (docs/prd/round-12.md §6). `invoice.ts`, `purchases.ts`, `localDb.ts` and `inventory.ts` are not edited: the new
 * optional fields arrive here by declaration merging. Every Round 12 snapshot on a document lives under ONE record key
 * `ag` (`R12_RECORD_KEYS` in `src/store/invoice-defaults.ts`); weighing reuses the R8 line key `wt`. AG-A declares the
 * sub-field types of `ag` for all four packages in one commit; AG-B … AG-D fill only their own block (`// AG-B` …).
 * Types only (0 bytes). Working papers — verify with your CA (docs/CA_REVIEW.md §12, AG1–AG32).
 */

/* ════════════════════════════════════════ AG-A ════════════════════════════════════════ */

/** The agri business picked on the "Farm, dairy & food processing" card (settings `agri_kind`). */
export type AgriKind = 'fpo' | 'coop' | 'dairy' | 'mill' | 'cold' | 'inputs' | 'farm' | 'other';
export type MillKind = 'rice' | 'flour' | 'dal' | 'oil';

/** A collection point: milk centre (a godown, B2), FPO cluster, mill gate or cold store. */
export interface AgCentre {
  id: string;
  name: string;
  kind: 'milk' | 'cluster' | 'mill_gate' | 'cold';
  godown_id?: string;
  /** Per-centre cycle override (A4). */
  cycles?: AgCycleSettings;
}

/** Farmer payment cycles (A4). Periods are local-day ranges (`10day`: 1–10, 11–20, 21–end). */
export interface AgCycleSettings {
  length: 'weekly' | '10day' | 'fortnight' | 'monthly';
  /** Weekly: first weekday (0 = Monday). */
  start_day?: number;
  pay_lag_days: number;
}

/** The views a kind turns on (A1 table, "switches"); a switch the user set is never turned back by a profile. */
export interface AgSwitches {
  vouchers?: boolean;
  quality?: boolean;
  cycles?: boolean;
  weighing?: boolean;
  members?: boolean;
  patronage?: boolean;
  input_sales?: boolean;
  feed_setoff?: boolean;
  analyser?: boolean;
  dispatch?: boolean;
  cash_6dde?: boolean;
  weighbridge?: boolean;
  moisture_cut?: boolean;
  cmr?: boolean;
  packing_rule?: boolean;
  lots?: boolean;
  season_rent?: boolean;
  lot_loans?: boolean;
  licences?: boolean;
  subsidy?: boolean;
  harvest_credit?: boolean;
  batches?: boolean;
  agri_income?: boolean;
}

/**
 * Company object `mrchartist_inv_agri_settings` (`settings.manage`, audited on save, synced as a singleton). B–D add
 * their sub-fields in their own blocks below; `cleanAgriSettings` keeps every object-valued key it does not know.
 */
export interface AgriSettings {
  centres?: AgCentre[];
  cycles?: AgCycleSettings;
  switches?: AgSwitches;
  /** Next farmer code number (`F-0001` …), A2. */
  next_code?: number;
  /** A4: ledger chosen for a pooled cycle's farmer-wise "price difference" (default) or patronage (D5). */
  bonus_mode?: 'price_difference' | 'patronage';
  updated_at?: string;
}

/** A farmer / member / depositor (sub-object `ag` on a vendor or client; the same `code` links both). */
export interface AgParty {
  code: string;
  village?: string;
  centre_id?: string;
  route?: string;
  member_no?: string;
  member_since?: string;
  member?: boolean;
  land_acres?: number;
  crops?: string[];
  animals?: { cows?: number; buffaloes?: number };
  bank?: { name?: string; account?: string; ifsc?: string };
  upi?: string;
  /** Exactly four digits; the full Aadhaar number is never stored (DPDP). */
  aadhaar_last4?: string;
  kcc_no?: string;
  phone?: string;
  language?: 'en' | 'hi';
  status?: 'active' | 'inactive';
}

/** A farm batch: flock, pond, herd or crop (table `farm_batches`, dated `start`). Memo only, no posting (AG31). */
export interface FarmBatchEvent {
  date: string;
  kind: 'mortality' | 'feed' | 'harvest' | 'medicine' | 'weight';
  qty: number;
  unit: string;
  note?: string;
}
export interface FarmBatch {
  id: string;
  kind: 'flock' | 'pond' | 'herd' | 'crop';
  name: string;
  start: string;
  end?: string;
  /** Birds / seed / animals / acres placed. */
  placed: number;
  unit: string;
  /** Opening live weight in kg (FCR = feed ÷ weight gained). */
  start_weight_kg?: number;
  cost_centre_id?: string;
  events: FarmBatchEvent[];
  status: 'active' | 'closed';
  created_at?: string;
  updated_at?: string;
}

/** A quality parameter of a commodity (A3, table `quality_cut_tables`): no preset values — contract terms. */
export interface QualityParam {
  key: 'moisture' | 'foreign' | 'damaged' | 'immature' | 'broken' | 'custom';
  label?: string;
  norm_pct: number;
  mode: 'weight' | 'price';
  /** Cut per point above the norm, % of weight (weight mode) or of the rate (price mode). */
  per_point_pct: number;
  max_pct?: number;
  reject_above?: number;
}
export interface QualityCutTable {
  id: string;
  commodity: string;
  params: QualityParam[];
  updated_at?: string;
}

/** One reading on a voucher and the cut it gave (printed per parameter). */
export interface AgQualityReading {
  key: QualityParam['key'];
  label?: string;
  reading: number;
  norm: number;
  mode: 'weight' | 'price';
  /** Cut points (reading − norm, capped at `max_pct`) × per-point %. */
  cut_pct: number;
  cut_kg?: number;
  cut_rs?: number;
  reject?: boolean;
}

/** A recovered or own charge on a farmer voucher (R8 heads; no preset rate). */
export interface AgVoucherCharge {
  head_id?: string;
  name: string;
  amount: number;
  /** `us`: paid by us (memo — booked to the mandi / labour); `farmer`: recovered from the farmer (less on the voucher). */
  by: 'us' | 'farmer';
}

/** `PurchaseRecord.ag.voucher` — the farmer purchase voucher (`FPV/FY…`). */
export interface AgVoucher {
  centre_id?: string;
  vehicle?: string;
  /** C1: weighbridge slip. */
  wbs_id?: string;
  commodity?: string;
  quality: AgQualityReading[];
  cut_kg: number;
  accepted_kg: number;
  charges?: AgVoucherCharge[];
  /** Snapshot of the declaration printed on the voucher. */
  declaration?: string;
}

export type AgDeductionKind = 'feed' | 'input' | 'advance' | 'loan' | 'share' | 'insurance' | 'union' | 'other';
export interface AgDeduction {
  kind: AgDeductionKind;
  /** feed / input: the farmer's invoice id; advance / loan: the advance voucher id. */
  ref_id?: string;
  amount: number;
  note?: string;
}
export interface FarmerCycleLine {
  /** Vendor id of the farmer. */
  farmer_id: string;
  name?: string;
  qty: number;
  unit: string;
  kg_fat?: number;
  kg_snf?: number;
  amount: number;
  bonus?: number;
  /** Carried in from the previous cycle (a negative net there). */
  carried?: number;
  /** Negative net of this cycle, carried to the next one as a farmer receivable. */
  carry_out?: number;
  deductions: AgDeduction[];
  net: number;
  /** Pay: 'bank' when the farmer has an account, else 'cash'. */
  mode?: 'bank' | 'cash';
  /** B3: per-shift detail for the farmer slip (snapshot). */
  shifts?: { date: string; shift: 'M' | 'E'; qty: number; fat?: number; snf?: number; rate?: number; amount: number }[];
}
/** Pooled cycle bill (table `farmer_cycles`, `CYB/FY…`): one `purchases` row per cycle per centre. */
export interface FarmerCycle {
  id: string;
  number: string;
  centre_id?: string;
  period_from: string;
  period_to: string;
  source: 'milk' | 'produce';
  lines: FarmerCycleLine[];
  purchase_id?: string;
  journal_id?: string;
  /** Set-off receipts (`exchange_purchase_id`) made on close. */
  receipt_ids?: string[];
  /** Payments recorded per mode. */
  payment_ids?: string[];
  payment_file?: string;
  status: 'draft' | 'closed' | 'paid';
  created_at?: string;
  updated_at?: string;
}

/** Agri tax classes (A3): suggest HSN / SAC and rate by document date; a typed rate always wins. */
export type AgClass =
  | 'milk_fresh' | 'milk_uht' | 'curd_loose' | 'curd_packed' | 'paneer' | 'ghee_butter' | 'cheese' | 'milk_powder'
  | 'cereal_loose' | 'cereal_packed_25' | 'paddy' | 'rice_husk' | 'rice_bran_feed' | 'rice_bran_other' | 'dorb'
  | 'broken_rice' | 'oil_cake_feed' | 'oil_cake_other' | 'edible_oil' | 'pulses_loose' | 'pulses_packed_25'
  | 'flour_loose' | 'flour_packed_25' | 'veg_fruit_fresh' | 'potato' | 'seed_sowing' | 'fertiliser' | 'fert_input'
  | 'pesticide_chem' | 'biopesticide' | 'micronutrient' | 'cattle_feed' | 'tractor' | 'farm_machine' | 'live_poultry'
  | 'eggs' | 'fish_fresh' | 'storage_agri' | 'storage_other' | 'milling_pds' | 'job_milling' | 'interest';

/* ── The `ag` snapshot on a document (A5): one record key; each package owns its sub-object ── */

/** Per-line agri particulars (printed under the line by `agriLineText`). */
export interface AgLineSnap {
  /** B: milk. */
  fat?: number;
  snf?: number;
  litres?: number;
  /** D: storage lot and rent. */
  lot?: string;
  bags?: number;
  rate_bag?: number;
  season?: string;
  /** D: inputs. */
  batch?: string;
  exp?: string;
  mrp_bag?: number;
  /** Any other printed particular. */
  text?: string;
}
/** B (milk sale / dispatch). */
export interface AgMilkSnap {
  tanker?: string;
  shift?: string;
  kg_fat?: number;
  kg_snf?: number;
  chart?: string;
}
/** C (custom milling / job milling). */
export interface AgCmrSnap {
  agency?: string;
  season?: string;
  lot_ack?: string;
  paddy_qtl?: number;
  outturn_pct?: number;
  rice_due_qtl?: number;
  rice_delivered_qtl?: number;
  goods_pct?: number;
}
/** D (storage rent). */
export interface AgRentSnap {
  lot_no?: string;
  receipt_no?: string;
  depositor?: string;
  commodity?: string;
  variety?: string;
  bags_in?: number;
  bags_out?: number;
  bags_balance?: number;
  chamber?: string;
  date_in?: string;
  season?: string;
  rate_basis?: string;
  exempt?: boolean;
  /** D2: the rent working (printed as a following page). */
  working?: { label: string; value: string }[];
}
/** D (input dealer). */
export interface AgInputsSnap {
  licences?: { kind: string; no: string }[];
  principal_ref?: string;
  pos_txn?: string;
  farmer_id_last4?: string;
  subsidy_bags?: number;
}
export interface AgSnapshot {
  kind: 'milk_sale' | 'rent' | 'inputs' | 'cmr' | 'produce' | 'job_milling' | 'interest';
  header?: Record<string, string>;
  lines?: Record<string, AgLineSnap>;
  milk?: AgMilkSnap;
  cmr?: AgCmrSnap;
  rent?: AgRentSnap;
  inputs?: AgInputsSnap;
  /** A5: declaration printed with the document (snapshot). */
  declaration?: string;
}

/** `PurchaseRecord.ag`: farmer vouchers and pooled cycle bills. */
export interface AgPurchase {
  voucher?: AgVoucher;
  /** The pooled cycle (`farmer_cycles` id). */
  cycle_id?: string;
  /** B2: milk already entered stock per closed shift; the stock reader skips this purchase's lines. */
  stock_by_shift?: boolean;
}

declare module './invoice' {
  interface InvoiceRecord {
    /** Round 12 record snapshot (see `AgSnapshot`). */
    ag?: AgSnapshot;
  }
  interface InvoiceItem {
    /** AG-A3 catalogue rows: the agri tax class (suggests HSN / rate by document date). */
    ag_class?: AgClass;
  }
  interface Client {
    /** AG-A2: a depositor / a dealer's farmer customer (linked to the vendor by `ag.code`). */
    ag?: AgParty;
  }
}

declare module './purchases' {
  interface Vendor {
    /** AG-A2: a farmer / member (sells to us). */
    ag?: AgParty;
  }
  interface PurchaseRecord {
    ag?: AgPurchase;
  }
}

declare module '../lib/localDb' {
  interface AppSettings {
    /** AG-A1: agri profile (under `manufacturer`, or `kirana` for input dealers); absent = not chosen. */
    agri_kind?: AgriKind;
    mill_kind?: MillKind;
  }
}

declare module '../lib/inventory' {
  interface StockItem {
    ag_class?: AgClass;
    /** C4: pack size (kg / L) and "labelled" — the ≤ 25 kg pre-packaged test. */
    ag_pack_kg?: number;
    ag_labelled?: boolean;
    /** D4: subsidised fertiliser (PoS txn no. + farmer ID required). */
    ag_subsidised?: boolean;
  }
}

/* ════════════════════════════════════════ AG-B ════════════════════════════════════════ */
// AG-B: milk_rate_charts, milk_shifts (one row per centre per shift), milk_dispatches (MDS), milk_cards; agri_settings.milk.
export type MilkKind = 'cow' | 'buffalo' | 'mixed';
export type MilkUnit = 'L' | 'KG';
export type MilkShiftId = 'M' | 'E';
/** B1: a fat / SNF rate chart (table `milk_rate_charts`, dated `effective_from`; append-only: a change is a new row). */
export interface MilkRateChart {
  id: string;
  name: string;
  milk: MilkKind;
  /** matrix: ₹ per unit at (fat, SNF); fat_kg: ₹ per kg fat; ts_kg: ₹ per kg fat + SNF; two_axis: kg fat × fat rate + kg SNF × SNF rate; flat. */
  basis: 'matrix' | 'fat_kg' | 'ts_kg' | 'two_axis' | 'flat';
  unit: MilkUnit;
  effective_from: string;
  effective_to?: string;
  matrix?: { fat_steps: number[]; snf_steps: number[]; rates: number[][] };
  /** Matrix lookup: nearest lower step (default) or nearest step. */
  lookup?: 'lower' | 'nearest';
  fat_rate?: number;
  snf_rate?: number;
  ts_rate?: number;
  flat_rate?: number;
  min_fat?: number;
  min_snf?: number;
  below_min: 'reject' | 'flat' | 'deduct';
  /** ₹ per unit paid (`flat`) or taken off (`deduct`) below the minimum. */
  below_rate?: number;
  /** Add-ons ₹ per unit: shift (key M / E), category (key = milk kind), quantity (key = minimum quantity). */
  incentives?: { kind: 'shift' | 'category' | 'quantity'; key: string; add: number }[];
  centre_ids?: string[];
  /** B4: the buyer's (union / plant) chart used to bill a dispatch. */
  buyer_id?: string;
  created_at?: string;
}
/** B2: one can at the collection centre. Rate, chart and amount are stored, so a later chart never reprices it. */
export interface MilkEntry {
  id: string;
  /** Vendor id of the farmer. */
  farmer_id: string;
  name?: string;
  code?: string;
  milk: MilkKind;
  qty: number;
  unit: MilkUnit;
  fat: number;
  snf: number;
  clr?: number;
  water_pct?: number;
  chart_id?: string;
  /** ₹ per chart unit, incentives included. */
  rate: number;
  amount: number;
  incentive?: number;
  sample_only?: boolean;
  rejected?: boolean;
  reason?: string;
  at: string;
}
/** B2: ONE row per centre per date per shift (table `milk_shifts`, dated `date`). Totals are derived. */
export interface MilkShift {
  id: string;
  centre_id: string;
  date: string;
  shift: MilkShiftId;
  entries: MilkEntry[];
  closed_at?: string;
  closed_by?: string;
  /** The farmer cycle (A4) that billed this shift: it cannot reopen while that cycle is closed. */
  cycle_id?: string;
  /** The stock journal (`SJ/FY…`) that took the accepted milk into the centre godown on close. */
  sj_id?: string;
  updated_at?: string;
}
/** B4: milk sent to the union / plant (table `milk_dispatches`, `MDS/FY…`). */
export interface MilkDispatch {
  id: string;
  number: string;
  date: string;
  shift: MilkShiftId;
  centre_id: string;
  buyer_id: string;
  buyer_name?: string;
  milk: MilkKind;
  tanker?: string;
  sent: { qty: number; unit: MilkUnit; fat: number; snf: number; temp?: number };
  received?: { qty: number; fat: number; snf: number; ack_no: string; date: string };
  invoice_id?: string;
  /** Consume-only stock journal that took the milk out of the centre godown. */
  sj_id?: string;
  created_at?: string;
  updated_at?: string;
}
/** B5: a household milk card (table `milk_cards`, one row per customer per month). */
export interface MilkCard {
  id: string;
  client_id: string;
  client_name?: string;
  /** `YYYY-MM`. */
  month: string;
  milk: MilkKind;
  rate: number;
  default_qty: number;
  /** Day of month ("1" … "31") → litres; absent day = the default; 0 = skipped. */
  days: Record<string, number>;
  delivered_by?: string;
  invoice_id?: string;
  updated_at?: string;
}
/** `agri_settings.milk` (B): stock items per milk kind, CLR, dispatch tolerance and billing basis. */
export interface AgMilkSettings {
  items?: Partial<Record<MilkKind, string>>;
  clr_cow?: number;
  clr_buffalo?: number;
  /** Shortage flag: % of kg fat (default 0.5 — practice, AG28). */
  tolerance_pct?: number;
  /** Bill a dispatch on the union's received figures (default) or on what was sent. */
  invoice_from?: 'received' | 'sent';
  /** Offer a WhatsApp message per entry (off by default). */
  slip_wa?: boolean;
}
export interface AgriSettings {
  milk?: AgMilkSettings;
}
declare module './manufacturing' {
  interface StockJournal {
    /** AG-B2 / B4: the milk shift or dispatch whose stock this journal posted. */
    milk_ref?: string;
  }
}

/* ════════════════════════════════════════ AG-C ════════════════════════════════════════ */
// AG-C: weighbridge_slips (WBS), cmr_agreements (CMR deliveries); `ProductionOrder.ag.mill` (declared below).
/** C2: the milling batch on a production order (filled by AG-C). */
export interface AgMillOrder {
  standard_pct?: number;
  moisture_in_pct?: number;
}
declare module './production-r4' {
  interface ProductionOrder {
    ag?: { mill?: AgMillOrder };
  }
}

/* ════════════════════════════════════════ AG-D ════════════════════════════════════════ */
// AG-D: cold_lots (CSR, GPO), cold_rent_plans, agri_loans (LAS), member_shares (SHC); agri_settings chambers / licences /
// principals / seasons.
