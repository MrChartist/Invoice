/**
 * Round 4 package A (production, costing & traceability) — persisted shapes and additive fields.
 * `src/types/stock.ts` (the `Godown.kind` union aside), `manufacturing.ts` and `purchases.ts` are not edited:
 * the links to a production order and the QC flag arrive here by declaration merging (additive, optional,
 * snake_case). Tables: `production_orders`, `qc_results`, `recall_notices`, `landed_cost_vouchers`; key
 * `qc_settings` (object).
 */

declare module './stock' {
  interface StockTransfer {
    /** Additive (R4-A1): the production order this issue to / return from the shop floor belongs to. */
    production_order_id?: string;
  }
}

declare module './manufacturing' {
  interface ManufacturingVoucher {
    /** Additive (R4-A1): output reported against this production order. */
    production_order_id?: string;
  }
  interface StockJournal {
    /** Additive (R4-A1): shop-floor material written off as scrap when this production order was closed. */
    production_order_id?: string;
  }
}

declare module '../lib/inventory' {
  interface StockItem {
    /** Additive (R4-A4): receipts of this item default to the QC hold godown until checked. */
    qc_on_receipt?: boolean;
  }
}

/* ── Production orders (R4-A1) ───────────────────────────────── */

/** Stored milestones. "In progress" and "Completed" are also derived from the output (see `orderStatus`). */
export type ProductionOrderStatus = 'planned' | 'released' | 'in_progress' | 'completed' | 'closed' | 'cancelled';

export interface ProductionOrderLog {
  /** ISO timestamp. */
  at: string;
  /** Local user name (absent = owner / single user). */
  by?: string;
  action: 'create' | 'edit' | 'release' | 'issue' | 'return' | 'output' | 'complete' | 'close' | 'write_off' | 'reopen' | 'cancel';
  note?: string;
}

/** A required component, exploded from the BOM at release (base units, scrap % included). */
export interface ProductionMaterial {
  id: string;
  item_id: string;
  /** Required quantity for the planned output, base units, scrap included. */
  qty: number;
  /** Of which normal loss (scrap %). */
  scrap?: number;
  /** BOM component quantity per finished unit (scrap included): the standard for costing. */
  per_unit: number;
  /** Store godown the BOM names for it (absent = the order's store godown). */
  godown_id?: string;
}

/** Production order `WO/FY<yy-yy>/<seq>`. Table `production_orders`. */
export interface ProductionOrder {
  id: string;
  number: string;
  /** yyyy-mm-dd (FY of the number). */
  date: string;
  /** Finished stock item. */
  item_id: string;
  bom_id?: string;
  /** Planned finished quantity (base units). */
  planned_qty: number;
  due_date?: string;
  /** Make to order: the sales order (`invoices` row, SALES_ORDER) and its line. */
  so_id?: string;
  so_line_id?: string;
  /** Created from this production plan (`production_plans`). */
  plan_id?: string;
  cost_centre_id?: string;
  /** Shop floor godown (kind 'wip'); set at release. */
  wip_godown_id: string;
  /** Additive: the store materials are issued from by default (absent = Main). */
  store_godown_id?: string;
  /** Additive: where finished goods go (absent = Main), or the QC hold godown when `output_to_qc` (R4-A4). */
  output_godown_id?: string;
  output_to_qc?: boolean;
  status: ProductionOrderStatus;
  /** Exploded at release (absent before). */
  materials?: ProductionMaterial[];
  closed_at?: string;
  log: ProductionOrderLog[];
  narration?: string;
  /** R4-A2: standard conversion cost per finished unit (labour, overhead), typed on the order. */
  standard_conversion?: number;
  created_at?: string;
  updated_at?: string;
}

/* ── QC hold (R4-A4) ─────────────────────────────────────────── */

export type QcSourceKind = 'grn' | 'purchase' | 'manufacturing' | 'transfer' | 'other';

/** A QC decision on stock held in a QC godown. Table `qc_results`. */
export interface QcResult {
  id: string;
  /** yyyy-mm-dd of the decision. */
  date: string;
  item_id: string;
  batch_no?: string;
  godown_id: string;
  source: { kind: QcSourceKind; id?: string; number?: string };
  /** Base units decided. */
  qty: number;
  result: 'pass' | 'fail';
  note?: string;
  inspector?: string;
  /** Release: the STR into the target godown. */
  transfer_id?: string;
  /** Reject: the Rejections Out / stock journal raised. */
  return_id?: string;
  created_at?: string;
}

/** Key `qc_settings`. */
export interface QcSettings {
  /** Hold every receipt for QC (else only items marked `qc_on_receipt`). */
  hold_all: boolean;
  /** Bell: stock in QC older than this many days (default 3). */
  alert_days: number;
}

/* ── Recall (R4-A3) ──────────────────────────────────────────── */

/** Log of a recall: which batches, and who was told. Table `recall_notices`. */
export interface RecallNotice {
  id: string;
  date: string;
  /** `item_id|BATCH` keys traced forward. */
  batch_keys: string[];
  note?: string;
  notified: { party: string; at: string }[];
  created_at?: string;
}

/* ── Landed-cost voucher (R4-A5) ─────────────────────────────── */

export type LandedMethod = 'value' | 'qty' | 'weight' | 'equal';

export interface LandedVoucherCharge {
  id: string;
  /** A non-stock line of a purchase bill / expense (freight, CHA, insurance), or a typed memo amount. */
  source: { kind: 'bill' | 'memo'; id?: string; line_id?: string };
  label: string;
  /** ₹, before GST. */
  amount: number;
}

export interface LandedVoucherTarget {
  kind: 'bill' | 'grn';
  id: string;
}

/** One goods line's share when the voucher was saved (display / audit; the engine recomputes live). */
export interface LandedAllocationRow {
  target: LandedVoucherTarget;
  line_id: string;
  item_id?: string;
  name: string;
  /** Line quantity in base units. */
  qty_base: number;
  amount: number;
  /** Cost per base unit before / after this voucher. */
  unit_before: number;
  unit_after: number;
}

/** Landed-cost voucher `LCV/FY<yy-yy>/<seq>`. Table `landed_cost_vouchers`. */
export interface LandedCostVoucher {
  id: string;
  number: string;
  date: string;
  method: LandedMethod;
  charges: LandedVoucherCharge[];
  targets: LandedVoucherTarget[];
  allocation_snapshot: LandedAllocationRow[];
  narration?: string;
  created_at?: string;
  updated_at?: string;
}
