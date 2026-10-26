/**
 * Round 4 package B (stores & chains) — persisted shapes and additive fields.
 * `src/types/invoice.ts`, `stock.ts` (the `Godown.kind` union is R4-A's line) and `purchases.ts` are not edited: the
 * new optional fields arrive here by declaration merging (additive, snake_case).
 *
 * Tables: `gift_vouchers`, `branch_prices`, `transfer_requests`; key `gift_voucher_settings` (object).
 * Device-local (outside the prefix, never backed up): `mrchartist_pos_branch`.
 */

declare module './invoice' {
  interface Payment {
    /**
     * Additive (R4-B1): this receipt was paid with a gift voucher (`gift_vouchers` row). It settles the bill like any
     * payment, but no money moved: the ledger debits "Gift vouchers outstanding" instead of cash / bank, and the cash /
     * bank book and bank reconciliation leave it out.
     */
    gift_voucher_id?: string;
  }
}

declare module '../lib/branch' {
  interface Branch {
    /** Additive (R4-B3): the store's price list (one of the `price_levels`). */
    price_level_id?: string;
  }
}

declare module './stock' {
  interface Godown {
    /** Additive (R4-B5): the godown this store is refilled from first (e.g. the warehouse). */
    replenish_from?: string;
  }
  interface StockTransfer {
    /** Additive (R4-B4): the transfer request this dispatch / receipt belongs to. */
    request_id?: string;
    /** Additive (R4-B4): 'out' = source → in-transit godown (dispatch); 'in' = in-transit → destination (receipt). */
    leg?: 'out' | 'in';
  }
}

declare module './manufacturing' {
  interface StockJournal {
    /** Additive (R4-B4): goods lost / damaged in transit written off for this transfer request. */
    request_id?: string;
  }
}

/* ── Gift vouchers (R4-B1) ───────────────────────────────────── */

export type GiftVoucherStatus = 'active' | 'redeemed' | 'expired' | 'cancelled';

/** A promotional voucher used as a discount on a bill (no money was received for it). */
export interface GiftVoucherPromoUse {
  invoice_id: string;
  number: string;
  date: string;
  amount: number;
}

/** Table `gift_vouchers`. Redemptions are DERIVED from `transactions` rows with `gift_voucher_id`. */
export interface GiftVoucher {
  id: string;
  /** `GV/FY<yy-yy>/<seq>` (Indian FY of `issued_on`). */
  number: string;
  /** Printed number + Luhn digit + 4 random characters (`crypto.getRandomValues`); scanned or typed at the counter. */
  code: string;
  face_value: number;
  /** YYYY-MM-DD (sale / issue date). */
  issued_on: string;
  /** YYYY-MM-DD: last day the voucher can be used. */
  expires_on: string;
  /** Free promotional voucher: no sale receipt, redeemed as an amount discount. */
  promo?: boolean;
  buyer?: string;
  branch_id?: string;
  /** Manual receipt voucher (RV) of the sale: Dr Cash / Bank | Cr Gift vouchers outstanding. */
  sale_voucher_id?: string;
  /** How the buyer paid (Cash / UPI / Card …). */
  tender?: string;
  /** Stored milestones; 'redeemed' / 'expired' are also derived (`voucherState`). */
  status: GiftVoucherStatus;
  /** Journal recognising the unredeemed balance after expiry (Dr Gift vouchers outstanding | Cr Unredeemed voucher income). */
  breakage_voucher_id?: string;
  /** Balance recognised by that journal. */
  breakage_amount?: number;
  /** Payment voucher (PV) refunding a cancelled sold voucher. */
  refund_voucher_id?: string;
  /** Promotional vouchers only: bills they were used on. */
  promo_uses?: GiftVoucherPromoUse[];
  note?: string;
  created_at?: string;
  updated_at?: string;
}

/** Key `gift_voucher_settings`. */
export interface GiftVoucherSettings {
  /** Default validity from the sale date (months). */
  validity_months: number;
  /** false = a voucher must be used for its whole balance in one bill. */
  allow_partial: boolean;
  /** Series prefix (default `GV`). */
  prefix: string;
}

/* ── Store price lists (R4-B3) ───────────────────────────────── */

/** Table `branch_prices`: a store's dated override of an item's rate (catalogue item id). */
export interface BranchPrice {
  id: string;
  branch_id: string;
  /** Catalogue (`items_catalog`) item id — the same key price levels use. */
  item_id: string;
  /** Effective from (YYYY-MM-DD). */
  from: string;
  rate: number;
}

/* ── Transfer requests (R4-B4) ───────────────────────────────── */

export type TransferRequestStatus = 'requested' | 'approved' | 'dispatched' | 'partly_dispatched' | 'received' | 'closed' | 'rejected';

export interface TransferRequestLine {
  id: string;
  item_id: string;
  /** Quantity as typed, in `unit` (base unit when absent). */
  qty: number;
  unit?: string;
  unit_factor?: number;
}

export interface TransferRequestLog {
  at: string;
  by?: string;
  action: 'request' | 'edit' | 'approve' | 'reject' | 'dispatch' | 'receive' | 'write_off' | 'claim' | 'close' | 'reopen';
  note?: string;
}

/**
 * Goods reported short or damaged on a receipt. They stay in the in-transit godown until resolved: written off
 * (consume-only stock journal), claimed from the transporter (a note — still in transit), or found (received later).
 */
export interface TransferException {
  id: string;
  date: string;
  item_id: string;
  qty: number;
  kind: 'short' | 'damaged';
  /** The receipt STR it was reported on. */
  receipt_id?: string;
  /** Batch still in transit (batch items). */
  batch_no?: string;
  serials?: string[];
  status: 'open' | 'claimed' | 'written_off' | 'found';
  /** Stock journal / receipt STR / claim note that resolved it. */
  ref?: string;
  note?: string;
}

/** Table `transfer_requests` (`TRQ/FY<yy-yy>/<seq>`). Dispatched / received quantities are derived from its STRs. */
export interface TransferRequest {
  id: string;
  number: string;
  date: string;
  /** Supplying godown (warehouse / another store). */
  from_godown: string;
  /** Requesting store's godown. */
  to_godown: string;
  lines: TransferRequestLine[];
  needed_by?: string;
  status: TransferRequestStatus;
  requested_by?: string;
  approved_by?: string;
  log: TransferRequestLog[];
  /** Dispatch STRs (source → transit, `leg: 'out'`). */
  dispatch_ids: string[];
  /** Receipt STRs (transit → destination, `leg: 'in'`). */
  receipt_ids: string[];
  /** Consume-only stock journals writing off goods lost in transit. */
  writeoff_ids?: string[];
  /** Short / damaged goods reported on receipts and how each was resolved. */
  exceptions?: TransferException[];
  /** Sec 25(4) path: the requesting and supplying godowns belong to branches with different GSTINs. */
  inter_gstin?: boolean;
  notes?: string;
  created_at?: string;
  updated_at?: string;
}
