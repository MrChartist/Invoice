/**
 * Round 21 (petrol pumps, CNG stations and LPG distributors) — persisted shapes and additive fields of R21-A … R21-D
 * (docs/prd/round-21.md §4, §6). Existing type files are not edited: the new optional fields arrive here by declaration
 * merging. Every Round 21 snapshot on a document lives under ONE record key `fu` (`R21_RECORD_KEYS` in
 * `src/store/invoice-defaults.ts`); a fuel line's non-GST column reuses the R10 line key `sv.exempt: 'NON_GST'`, its pump
 * data sits in `fu.lines[lineId]`. A tank is a godown with `Godown.fu` (no new `Godown.kind`). R21-A declares the
 * sub-field types of every package in one commit; B–D fill only their own block — an interface re-declared there merges
 * with A's. Types only (0 bytes). Working papers — verify with your CA (docs/CA_REVIEW.md §21, FU1–FU30).
 */

/* ════════════════════════════════════════ R21-A ════════════════════════════════════════ */

/** The business picked on the wizard card "Petrol pump, CNG station or LPG distributor". */
export type FuelKind = 'pump' | 'cng' | 'pump_cng' | 'lpg' | 'pump_lpg';
/** A3: what a stock item is at the pump (`ms` / `hsd` / branded / `cng` are non-GST by `FUEL_GST_STATUS_RULES`). */
export type FuProduct = 'ms' | 'hsd' | 'ms_branded' | 'hsd_branded' | 'cng' | 'auto_lpg' | 'lube' | 'other';

/** A2: a tank is a godown with this block: product, capacity, calibration chart (dip mm → litres). CNG cascades: `chart: []`. */
export interface FuTank {
  product_item_id: string;
  capacity_l: number;
  /** [dip mm, litres] rows, strictly increasing in both. */
  chart: [number, number][];
  dead_stock_l?: number;
  calibrated_on?: string;
  calibration_due?: string;
}

/** A2: table `fuel_nozzles` (`master.edit`, not dated, audited). A nozzle's product is its tank's product. */
export interface FuelNozzle {
  id: string;
  /** Dispensing unit no. ("2") and nozzle no. ("B"): printed as "2-B". */
  du_no: string;
  nozzle_no: string;
  tank_id: string;
  item_id: string;
  /** Totaliser reading when the nozzle was put on the books (B carries readings shift to shift). */
  totaliser_start: number;
  wm_stamped_on?: string;
  wm_due?: string;
  active: boolean;
  created_at?: string;
  updated_at?: string;
}

/** A3: per-litre (per-kg) build-up typed from the oil company's price circular (D: Rule 42 duty exclusion, margins). */
export interface FuPriceBuild { dealer_price?: number; excise?: number; vat?: number; dealer_margin?: number }

/** A3: table `fuel_prices` (`master.edit`, dated by `date`, audited): the retail selling price from `date` `time`. */
export interface FuelPrice {
  id: string;
  item_id: string;
  date: string;
  /** `HH:MM` (oil-company prices change at 06:00). */
  time: string;
  rsp: number;
  build?: FuPriceBuild;
  created_at?: string;
}

/** A3: pump data of one document line, snapshotted (`fu.lines[lineId]`). */
export interface FuLine {
  nozzle_id?: string;
  /** "2-B" as printed. */
  nozzle?: string;
  litres: number;
  price_id?: string;
  /** Price in force (per L / kg) and the moment it took effect ("2026-10-29 06:00"). */
  rsp?: number;
  at?: string;
  unit?: 'L' | 'KG';
  /** D1: vehicle and slip of a credit sale. */
  vehicle?: string;
  slip_no?: string;
}

/** The `fu` record snapshot (A: lines; B: shift; D: slips, vehicle annexure, LPG use). */
export interface FuSnapshot {
  lines?: Record<string, FuLine>;
  /** B3: the shift a counter-sale Bill of Supply belongs to (undo = cancel the shift's documents). */
  shift_id?: string;
  /** D1: the slips a monthly credit bill covers (billed state is derived from live documents). */
  slip_ids?: string[];
  /** D4: the customer's LPG use the rate was decided by. */
  lpg_use?: FuLpgUse;
}

/** Object `fuel_settings` (`settings.manage`, audited on save, a singleton; absent = nothing fuel). */
export interface FuelSettings {
  shift_count?: number;
  shift_starts?: string[];
  price_time?: string;
  test_litres?: number;
  counter_client_id?: string;
  short_ledger_id?: string;
  excess_ledger_id?: string;
  credit_billing?: 'monthly' | 'daily';
  omc_vendor_ids?: string[];
  updated_at?: string;
}

declare module './invoice' {
  interface InvoiceRecord {
    /** Round 21 record snapshot (see `FuSnapshot`). */
    fu?: FuSnapshot;
  }
}

declare module '../lib/localDb' {
  interface AppSettings {
    /** A1: fuel profile (business type `kirana`); absent = no fuel desk. */
    fuel_kind?: FuelKind;
  }
}

declare module './stock' {
  interface Godown {
    /** A2: a fuel tank (an ordinary saleable godown). */
    fu?: FuTank;
  }
}

declare module '../lib/inventory' {
  interface StockItem {
    /** A3: a pump product. */
    fu?: { product: FuProduct; unit: 'L' | 'KG' };
  }
}

/* ════════════════════════════════════════ R21-B ════════════════════════════════════════ */

/** B1: one nozzle's meter reading in a shift. */
export interface FuReading {
  nozzle_id: string;
  opening: number;
  closing?: number;
  test_l: number;
  test_returned: true;
  /** Why the opening differs from the previous shift's closing (audited). */
  reason?: string;
  /** The totaliser's maximum (it wraps to 0 after it); absent = 10⁷. */
  max?: number;
  /** FU9: the typed totaliser reading at each price change inside the shift (in order); absent = all at the opening price. */
  splits?: number[];
}
/** B2: one attendant's collections by mode. */
export interface FuCollection { attendant: number; mode: 'cash' | 'upi' | 'card' | 'fleet' | 'loyalty' | 'credit'; amount: number; ref?: string }

/** B1: table `fuel_shifts` (`doc.create`, dated by `date`, audited; one row per day × shift number). */
export interface FuelShift {
  id: string;
  date: string;
  shift_no: number;
  opened_at: string;
  closed_at?: string;
  attendants: { employee_id?: string; name?: string; nozzle_ids: string[] }[];
  readings: FuReading[];
  collections: FuCollection[];
  status: 'open' | 'closed' | 'posted';
  /** B2: how each attendant's shortage was settled (a cash receipt or a write-off row on the shift's Bill of Supply). */
  settled?: { attendant: number; how: 'cash' | 'write_off'; payment_id: string; amount: number }[];
}

/* ════════════════════════════════════════ R21-C ════════════════════════════════════════ */

/** C1 / C2: table `fuel_tank_logs` (`doc.create`, dated by `date`, audited). */
export interface FuelTankLog {
  id: string;
  date: string;
  kind: 'dip' | 'density' | 'receipt';
  time?: string;
  tank_id?: string;
  nozzle_id?: string;
  mm?: number;
  water_mm?: number;
  litres?: number;
  density_15?: number;
  /** C2: the OMC purchase bill and its compartments. */
  purchase_id?: string;
  compartments?: { invoice_l: number; invoice_density?: number; observed_density?: number }[];
}

/** C4: licence / stamping / calibration due dates (on `fuel_settings`). */
export interface FuLicence { kind: 'peso' | 'wm_du' | 'fire' | 'calibration' | 'dealership' | 'other'; ref: string; valid_to: string }

/* ════════════════════════════════════════ R21-D ════════════════════════════════════════ */

export type FuLpgUse = 'household' | 'ndec' | 'other';

/** D1: table `fuel_slips` (`doc.create`, dated by `date`, audited; `slip_no` typed, unique per company). */
export interface FuelSlip {
  id: string;
  slip_no: string;
  date: string;
  shift_id?: string;
  client_id: string;
  vehicle_no: string;
  driver?: string;
  item_id: string;
  litres: number;
  amount: number;
  nozzle_id?: string;
}

declare module './invoice' {
  interface Client {
    /** D1 / D4: vehicle limits and the LPG use that decides the refill rate. */
    fu?: { vehicles?: { no: string; limit_l?: number; limit_amount?: number }[]; lpg_use?: FuLpgUse };
  }
}
