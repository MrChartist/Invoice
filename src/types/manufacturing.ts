/**
 * Persisted shapes for manufacturing and stock vouchers (Tally parity, Phase 7). Additive only:
 * add optional fields, never rename or remove one.
 *
 * Tables:
 *  - `boms`                    Bill of Materials per finished stock item (several per item, one default).
 *  - `manufacturing_vouchers`  Manufacturing Journal `MFG/FY<yy-yy>/<seq>`.
 *  - `stock_journals`          Stock Journal `SJ/FY<yy-yy>/<seq>` (conversions / repacking). Godown-only
 *                              transfers stay `stock_transfers` (`STR/…`), never a stock journal.
 *  - `physical_stock`          Physical Stock voucher `PHY/FY<yy-yy>/<seq>`: counted vs book, difference posted.
 *
 * None of these is stored as `stock_moves`: like invoices and bills, each voucher is a read-only input
 * the stock engine (`collectEvents` in src/lib/inventory.ts) turns into events, so deleting or editing a
 * voucher can never leave orphan moves behind.
 */

/** A component consumed per `Bom.batch_qty` units of the finished item. */
export interface BomComponent {
  id: string;
  /** `stock_items` row id. */
  item_id: string;
  /** Quantity per `batch_qty` finished units (before scrap). */
  qty: number;
  /** Normal loss: consumption is grossed up by this % (5 → 1.05 × qty). */
  scrap_pct?: number;
  /** Godown to consume from (absent = the voucher's / Main). */
  godown_id?: string;
}

/**
 * Additional outputs of the process:
 *  - `by_product` and `scrap`: valued at a fixed `rate` per unit, deducted from the main item's cost;
 *  - `co_product`: takes `cost_pct` % of the net cost (the main item gets the rest).
 */
export type BomOutputKind = 'by_product' | 'co_product' | 'scrap';

export interface BomOutput {
  id: string;
  item_id: string;
  /** Quantity per `Bom.batch_qty` finished units. */
  qty: number;
  kind: BomOutputKind;
  /** By-product / scrap realisable value per unit (₹). */
  rate?: number;
  /** Co-product share of the net cost, %. */
  cost_pct?: number;
  godown_id?: string;
}

/** Bill of Materials (Tally "Components (BoM)"). Table `boms`. */
export interface Bom {
  id: string;
  /** Finished `stock_items` row id. */
  item_id: string;
  /** e.g. "Standard", "Alternate (imported resin)". */
  name: string;
  /** Finished units the component quantities are for (default 1). */
  batch_qty: number;
  /** The BOM a new Manufacturing Journal picks first for this item. */
  is_default?: boolean;
  components: BomComponent[];
  outputs?: BomOutput[];
  notes?: string;
  created_at?: string;
  updated_at?: string;
}

/** One stock line of a voucher (consumption or production). */
export interface VoucherStockLine {
  id: string;
  item_id: string;
  qty: number;
  godown_id?: string;
  batch_no?: string;
  /** Production lines of batch-tracked items. */
  mfg_date?: string;
  expiry_date?: string;
  /**
   * Additive (7M): unit the quantity was typed in and its factor snapshot (`qty` and a fixed `rate` are per that
   * unit; `stockVoucherInputs` converts to base units). Absent = the item's base unit.
   */
  unit?: string;
  unit_factor?: number;
}

/** Production line of a voucher: the cost split rules mirror `BomOutput`. */
export interface VoucherOutputLine extends VoucherStockLine {
  /** Absent on the main finished line of a Manufacturing Journal. */
  kind?: BomOutputKind;
  /** Fixed unit value (by-product / scrap; or a stock-journal destination valued by hand). */
  rate?: number;
  /** Share of the net cost, %. Lines with neither `rate` nor `cost_pct` share the rest by quantity. */
  cost_pct?: number;
}

/** Labour, power, overhead … added to the production cost: a % of component cost or a ₹ amount. */
export interface AdditionalCost {
  id: string;
  label: string;
  mode: 'pct' | 'amount';
  value: number;
}

/** What the voucher cost when it was saved (display / audit only; the stock engine recomputes live). */
export interface VoucherCostSnapshot {
  components: number;
  additional: number;
  /** By-product + scrap value deducted. */
  deductions: number;
  /** Value of the main finished line. */
  finished: number;
  unit: number;
}

/** Manufacturing Journal. Table `manufacturing_vouchers`. */
export interface ManufacturingVoucher {
  id: string;
  /** `MFG/FY<yy-yy>/<seq>` (Indian FY of `date`). */
  number: string;
  /** yyyy-mm-dd */
  date: string;
  /** Finished item. */
  item_id: string;
  bom_id?: string;
  /** Finished quantity produced. */
  qty: number;
  /** Godown the finished goods go to (absent = Main). */
  godown_id?: string;
  batch_no?: string;
  mfg_date?: string;
  expiry_date?: string;
  /** Actual consumption (pre-filled from the BOM, editable; batch items split FEFO). */
  components: VoucherStockLine[];
  /** By-products, co-products and scrap. */
  outputs: VoucherOutputLine[];
  costs: AdditionalCost[];
  narration?: string;
  cost_snapshot?: VoucherCostSnapshot;
  created_at?: string;
  updated_at?: string;
}

/** Stock Journal (conversion / repacking). Table `stock_journals`. */
export interface StockJournal {
  id: string;
  /** `SJ/FY<yy-yy>/<seq>`. */
  number: string;
  date: string;
  /** Source (consumption). */
  consume: VoucherStockLine[];
  /** Destination (production). */
  produce: VoucherOutputLine[];
  costs: AdditionalCost[];
  narration?: string;
  cost_snapshot?: VoucherCostSnapshot;
  created_at?: string;
  updated_at?: string;
}

/** One counted line of a Physical Stock voucher. */
export interface PhysicalStockLine {
  id: string;
  item_id: string;
  godown_id?: string;
  batch_no?: string;
  /** Units counted. */
  counted: number;
  /** Book quantity on the voucher date when it was saved (closing of that day, this voucher excluded). */
  book_qty: number;
  /** counted − book_qty: the adjustment the voucher posts (+ excess / − shortage). */
  diff: number;
  /** Unit cost on the date when saved (shortage / excess value). */
  rate?: number;
}

/** Physical Stock voucher (Tally Ctrl+F7). Table `physical_stock`. */
export interface PhysicalStockVoucher {
  id: string;
  /** `PHY/FY<yy-yy>/<seq>`. */
  number: string;
  date: string;
  lines: PhysicalStockLine[];
  narration?: string;
  created_at?: string;
  updated_at?: string;
}
