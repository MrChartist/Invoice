/**
 * Persisted shapes for multi-godown stock (6.10). Additive only: add optional fields,
 * never rename or remove one. Batches (6.6) and serials (6.11) have no table of their own:
 * they live on purchase lines, invoice lines, stock moves and transfer lines, and every
 * balance is derived on read (`src/lib/stock-tracking.ts`).
 */

/** Id of the implicit default godown. Lines / moves without a `godown_id` belong here. */
export const MAIN_GODOWN_ID = 'main';

/** A storage location. Table `godowns`; the implicit "Main" godown is not stored unless renamed. */
export interface Godown {
  id: string;
  name: string;
  address?: string;
  /** Additive (WP-8): parent godown (a store room inside a warehouse); absent = top level. */
  parent_id?: string;
  /**
   * Additive (7M, job work): the premises of a job worker. Stock here is still ours ("our stock with third
   * party") and counts in the stock summary; Material Out / In move goods to and from it.
   */
  job_worker?: boolean;
  /** The job worker (`vendors` row) whose premises this is. */
  vendor_id?: string;
  /**
   * Additive (8F): what the godown is for. 'van' = a delivery van (stock loaded by transfer, settled daily);
   * 'expiry' = non-saleable expired / breakage stock (sales from it are refused). Absent = an ordinary godown.
   */
  kind?: 'van' | 'expiry';
  created_at?: string;
  updated_at?: string;
}

export interface StockTransferLine {
  id: string;
  /** `stock_items` row id. */
  item_id: string;
  qty: number;
  /** Batch moved (batch-tracked items). */
  batch_no?: string;
  /** Serials moved (serial-tracked items); count equals `qty`. */
  serials?: string[];
  /** Additive (7M): unit `qty` was typed in and its factor snapshot; readers convert with `lineFactor`. */
  unit?: string;
  unit_factor?: number;
}

/**
 * Stock transfer voucher between two godowns. Table `stock_transfers`. Moves quantity only:
 * no value, no GST, no books or ledger posting (costing is company-wide).
 */
export interface StockTransfer {
  id: string;
  /** `STR/FY<yy-yy>/<seq>` (Indian FY of `date`). */
  transfer_number: string;
  /** yyyy-mm-dd */
  date: string;
  from_godown: string;
  to_godown: string;
  lines: StockTransferLine[];
  notes?: string;
  created_at?: string;
  updated_at?: string;
}
