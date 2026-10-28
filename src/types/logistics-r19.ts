/**
 * Round 19 (freight forwarders, customs brokers (CHA), courier franchisees and 3PL warehouses) — persisted shapes and
 * additive fields of R19-A … R19-D (docs/prd/round-19.md §6). Existing type files are not edited: the new optional
 * fields arrive here by declaration merging. Every Round 19 snapshot on a document lives under ONE record key `lg`
 * (`R19_RECORD_KEYS` in `src/store/invoice-defaults.ts`); there is no Round 19 line key (pure-agent recoveries reuse
 * `charge_head_id: 'rule33'`, the SAC sits in `hsn`, the head of each line in `lg.heads[lineId]`). A job is a row of
 * `lg_jobs`, never a cost centre. R19-A declares the sub-field types of every package in one commit; B–D fill only
 * their own block — an interface re-declared there merges with A's. KYC is dates and method only (no document copies,
 * Aadhaar or PAN images); docket consignee names are not stored (PIN and zone only). Types only (0 bytes). Working
 * papers — verify with your CA (docs/CA_REVIEW.md §19, LG1–LG44).
 */

/* ════════════════════════════════════════ R19-A ════════════════════════════════════════ */

/** The business picked on the wizard card "Freight forwarding, customs clearance, courier or warehouse". */
export type LogisticsKind = 'forwarder' | 'cha' | 'courier' | 'warehouse' | 'multi';
export type LgDir = 'export' | 'import' | 'domestic' | 'cross_trade';
export type LgMode = 'sea_fcl' | 'sea_lcl' | 'air' | 'road' | 'rail' | 'multimodal' | 'courier';
export type LgLeg = 'road' | 'rail' | 'sea' | 'air' | 'inland_water';
export type LgStatus = 'enquiry' | 'booked' | 'in_transit' | 'arrived' | 'delivered' | 'closed' | 'cancelled';
export type LgContainerSize = '20' | '40' | '40HC' | '45' | 'LCL';

/** A2: job references (typed from the carrier / customs systems, never fetched). */
export interface LgRefs {
  mbl?: string; hbl?: string; mawb?: string; hawb?: string;
  sb_no?: string; sb_date?: string; boe_no?: string; boe_date?: string;
  igm?: string; vessel?: string; voyage?: string; flight?: string;
}
export interface LgContainer { no: string; size: LgContainerSize; seal?: string }
/** A2: one line of package dimensions in cm (`n` packages of l × w × h). */
export interface LgDims { l: number; w: number; h: number; n: number }

/** B1: a typed charge line kept on the job (the charge sheet is rebuilt from the job + these). */
export interface LgCharge { head_id: string; qty: number; rate: number; currency: string; amount: number; note?: string }

/** A2: table `lg_jobs` (dated by `date`, synced, audited, `doc.create`; number from the `JOB` series). */
export interface LgJob {
  id: string;
  /** `JOB/FY26-27/0001` (or a branch prefix such as `JOB-BOM/FY26-27/0001`). */
  number: string;
  date: string;
  status: LgStatus;
  dir: LgDir;
  mode: LgMode;
  /** Multimodal legs (B2: an air leg makes it 18 % from 22 Sep 2025). */
  legs?: LgLeg[];
  incoterm?: string;
  /** Port / airport / ICD code or text. */
  origin: string;
  destination: string;
  /** ISO-2 country of the destination (required for an export by sea / air). */
  dest_country?: string;
  etd?: string;
  eta?: string;
  client_id: string;
  shipper?: string;
  consignee?: string;
  /** The overseas agent (a client id; D1 pairs it with a vendor). */
  agent_id?: string;
  salesperson?: string;
  refs: LgRefs;
  containers?: LgContainer[];
  pkgs?: number;
  gross_kg?: number;
  chargeable_kg?: number;
  cbm?: number;
  dims?: LgDims[];
  branch?: string;
  note?: string;
  closed_on?: string;
  /** B1: typed charge lines. */
  charges?: LgCharge[];
  updated_at: string;
  demo?: boolean;
}

export type LgHeadKind =
  | 'freight_sea' | 'freight_air' | 'freight_road' | 'freight_rail' | 'freight_multimodal' | 'courier'
  | 'origin' | 'destination' | 'documentation' | 'clearance' | 'forwarding' | 'handling' | 'storage' | 'gta'
  | 'insurance' | 'duty' | 'cfs' | 'port' | 'do_charges' | 'demurrage' | 'commission' | 'other';
/** `own` = taxable supply; `pure_agent` = Rule 33 recovery (`rule33` line); `exempt` by `exempt_if`. */
export type LgRole = 'own' | 'pure_agent' | 'exempt';
export type LgUnit = 'per_kg' | 'per_cbm' | 'per_wm' | 'per_container' | 'per_shipment' | 'per_bill' | 'per_pkg' | 'per_day' | 'pct_of_value' | 'typed';
export type LgPosRule = 'transport' | 'general' | 'intermediary' | 'auto';

/** A3: one charge head (`logistics_settings.heads`). */
export interface LgHead {
  id: string;
  name: string;
  kind: LgHeadKind;
  role: LgRole;
  unit: LgUnit;
  rate?: number;
  currency?: string;
  sac?: string;
  pos_rule?: LgPosRule;
  exempt_if?: 'agri_produce' | 'rice';
  active: boolean;
}

/** A3: the lane rate sheet shape. Cut at the R19-A cap (PRD §3 cut 2): declared only; no table `lg_rate_sheets` is registered. */
export interface LgRateRow { head_id: string; rate: number; currency: string; unit: LgUnit; min?: number }
export interface LgRateSheet {
  id: string;
  client_id?: string;
  lane: { origin: string; destination: string; mode: LgMode };
  valid_from: string;
  valid_to?: string;
  rows: LgRateRow[];
  updated_at: string;
  demo?: boolean;
}

/** D2 / D3: shapes held in the settings object (filled by D). */
export interface LgZone { zone: string; first_500g: number; addl_500g: number; min?: number; rto_pct?: number }
export interface LgStoragePlan { id: string; name: string; unit: 'pallet' | 'sqft' | 'cbm' | 'mt'; basis: 'per_day' | 'per_month' | 'peak'; rate: number; handling_in?: number; handling_out?: number; min_monthly?: number }

/** Company object `logistics_settings` (owner only, audited, synced as a singleton). A writes the shape of every package. */
export interface LogisticsSettings {
  /** A3: charge heads. */
  heads?: LgHead[];
  /** A2: branch prefix of the `JOB` series (`JOB-BOM`). */
  job_prefix?: string;
  default_currency?: string;
  weight_unit?: 'kg';
  /** B: one document per (POS, currency, kind) or one per job (LG9); accruals; margin alert. */
  split?: 'pos_currency' | 'single';
  accrue?: boolean;
  margin_alert_pct?: number;
  /** B2: heads that follow the freight's POS and rate on the same document (composite, LG9). */
  composite_with_freight?: string[];
  /** C: deposits, posting of disbursements (LG11), register columns. */
  deposit_required?: boolean;
  disb_posting?: 'gross' | 'net_journal';
  register_fields?: string[];
  /** D: volumetric divisors (cm³ per kg; sea kg per CBM — commercial conventions, LG33), zones, storage plans, COD ledger. */
  volumetric?: { air: number; courier: number; sea_kg_per_cbm: number };
  zones?: LgZone[];
  storage_plans?: LgStoragePlan[];
  cod_ledger?: string;
  updated_at?: string;
}

/** The invoice snapshot `lg` (A: job, refs, ports, weights; B: heads, regime, POS reason, FX; C: disbursements; D: manifest / storage / agent). */
export interface LgSnapshot {
  job_id?: string;
  job_no?: string;
  mode?: LgMode;
  dir?: LgDir;
  refs?: LgRefs;
  ports?: { origin: string; destination: string; dest_country?: string };
  weights?: { pkgs?: number; gross_kg?: number; chargeable_kg?: number; cbm?: number };
  containers?: LgContainer[];
  /** A3: a quotation built from a rate sheet. */
  quote?: boolean;
  lane?: { origin: string; destination: string; mode: LgMode };
  /** B1: the head of each line, by line id. */
  heads?: Record<string, string>;
  /** B2: the regime and the printed place-of-supply reason. */
  regime?: string;
  pos_reason?: string;
  /** B4: the exchange rate printed (Rule 34(2)). */
  fx?: { currency: string; rate: number; source?: string };
  /** C3: the disbursement schedule printed after the lines. */
  disb?: { date: string; kind: string; ref?: string; payee?: string; amount: number }[];
  /** D2 / D3 / D1 */
  manifest_id?: string;
  storage_id?: string;
  agent?: { id: string; name?: string; kind?: 'profit_share' | 'freight' | 'other' };
  period?: string;
  count?: number;
  kg?: number;
}

declare module './invoice' {
  interface InvoiceRecord {
    /** Round 19 record snapshot (see `LgSnapshot`). */
    lg?: LgSnapshot;
  }
}

declare module '../lib/localDb' {
  interface AppSettings {
    /** A1: logistics profile (business type `transport`); absent = no Shipments desk. */
    logistics_kind?: LogisticsKind;
  }
}

/* ════════════════════════════════════════ R19-B ════════════════════════════════════════ */

declare module './purchases' {
  interface PurchaseRecord {
    /** B3: the job (and head) a bill is costed to; C1: a disbursement on the client's behalf; C3: its write-off. */
    lg?: {
      job_id: string;
      head_id?: string;
      accrual_id?: string;
      /** B3: a bill split over jobs by line. */
      lines?: Record<string, string>;
      disb?: 'duty' | 'cfs' | 'port' | 'do' | 'shipping_line' | 'insurance' | 'other';
      on_behalf?: boolean;
      /** ICEGATE challan / CFS invoice no. */
      ref?: string;
      in_client_name?: boolean;
      wo?: { date: string; reason: string; by?: string };
      /** D1: an overseas agent's bill typed in its currency (`amount` in that currency, `rate` ₹ per unit; the bill is booked in ₹). */
      fx?: { currency: string; amount: number; rate: number };
    };
  }
  interface Vendor {
    /** D1: the vendor's logistics role (an agent is a client + vendor pair, `Vendor.client_id`). */
    lg?: { kind: 'agent' | 'shipping_line' | 'airline' | 'co_loader' | 'cfs' | 'transporter' | 'other'; foreign?: boolean };
  }
}

/* ════════════════════════════════════════ R19-C ════════════════════════════════════════ */

declare module './advances' {
  interface AdvanceRecord {
    /** C2: a duty deposit (with `pass_through: true`, 0 %) is tied to its job. */
    lg?: { job_id: string };
  }
}

declare module './invoice' {
  interface Client {
    /** C4: IEC and KYC as dates and method only (no document copies, LG27). */
    lg?: { iec?: string; kyc?: { verified_on?: string; by?: string; method?: 'documents' | 'visit' | 'both'; note?: string } };
  }
}

/** C: job fields (merged with A's `LgJob`). */
export interface LgJob {
  /** C4: KYC of the client checked for this job. */
  kyc_ok?: boolean;
  /** C1: the client's authorisation for payments on its behalf (Rule 33 limb (i)). */
  auth?: { ref?: string; date?: string };
}

/* ════════════════════════════════════════ R19-D ════════════════════════════════════════ */

/** D2: one courier docket (inside its manifest row). */
export interface LgDocket {
  no: string;
  date: string;
  network?: string;
  dest_pin?: string;
  zone: string;
  pcs: number;
  kg: number;
  dims?: LgDims[];
  chargeable_kg: number;
  service: 'standard' | 'express' | 'cargo';
  charge: number;
  fsc_pct?: number;
  cod_amount?: number;
  status?: 'booked' | 'delivered' | 'rto';
  /** Declared value (the e-Way hint above ₹50,000, LG20). */
  value?: number;
  /** An international docket (12(8) proviso, POS 96 on its own document). */
  intl?: boolean;
}

/** D2: table `lg_manifests` (dated by the month end, synced, audited, `doc.create`): one row per account customer × month. */
export interface LgManifest {
  id: string;
  client_id: string;
  /** `YYYY-MM`. */
  period: string;
  /** The month's last day (sync / period-lock date). */
  date: string;
  dockets: LgDocket[];
  bill_id?: string;
  cod?: { collected: number; remitted: { date: string; amount: number; ref?: string }[] };
  updated_at: string;
  demo?: boolean;
}

/** D3: table `lg_storage` (dated by the month end, synced, audited, `doc.create`): one row per client × plan × month. */
export interface LgStorageRow {
  id: string;
  client_id: string;
  plan_id: string;
  period: string;
  date: string;
  days: { date: string; in?: number; out?: number; held: number }[] | { opening: number; ins: number; outs: number; closing: number };
  produce?: 'agri' | 'rice' | null;
  bill_id?: string;
  updated_at: string;
  demo?: boolean;
}

/** D: job field (merged with A's `LgJob`). */
export interface LgJob {
  /** D2: a courier job's network and docket. */
  courier?: { network?: string; docket?: string };
}
