/**
 * Round 5 package A (industry packs & marketplace seller) — persisted shapes and additive fields.
 * `src/types/invoice.ts` is not edited: the new optional fields arrive here by declaration merging (additive,
 * snake_case). Tables: `sales_channels`, `channel_skus`, `marketplace_imports`, `settlements`, `eco_credits`,
 * `marketplace_returns`. Company setting: `industry_packs` on `mrchartist_inv_settings`. No device-local key.
 */
import type { PackId } from '../lib/industry-packs';

declare module './invoice' {
  interface InvoiceRecord {
    /** Additive (R5-A3): the `sales_channels` row this document was sold through (marketplace import). */
    channel_id?: string;
    /** Additive (R5-A3): the marketplace's order id (Amazon order id, Flipkart order item id, Meesho sub-order). */
    channel_order_id?: string;
    /** Additive (QA6 F2): a summary document's covered order ids, so a later per-order import of them is "already imported". */
    channel_order_ids?: string[];
    /** Additive (R5-A3): the `marketplace_imports` row that created this document (undo, idempotency). */
    channel_import_id?: string;
  }
}

declare module '../lib/localDb' {
  interface AppSettings {
    /** Additive (R5-A1): industry packs switched on for this company. Absent = the packs implied by `business_type`. */
    industry_packs?: PackId[];
  }
}

declare module '../lib/bank-accounts' {
  interface BankAccount {
    /** Additive (R5-A2): a marketplace settlement clearing account — never a real bank; hidden from cheque, e-payment and BRS pickers. */
    clearing?: boolean;
  }
}

/* ── Channels (R5-A2) ─────────────────────────────────────────── */

export type ChannelPlatform = 'amazon' | 'flipkart' | 'meesho' | 'other';

/** Settlement amount buckets (R5-A4). */
export type SettlementBucket =
  | 'sale' | 'refund' | 'shipping_recovered' | 'commission' | 'fixed_fee' | 'closing_fee' | 'collection_fee'
  | 'shipping_fee' | 'reverse_shipping' | 'storage' | 'ads' | 'gst_on_fees' | 'tcs' | 'tds_194o'
  | 'reimbursement' | 'claim' | 'other';

/** One user-taught "description contains → bucket" rule (an array, never an object keyed by file text). */
export interface BucketRule {
  match: string;
  bucket: SettlementBucket;
}

/** A column mapping confirmed once for a channel: field → header text (looked up by header, not position). */
export interface SavedMapping {
  preset: string;
  columns: { field: string; header: string }[];
}

export interface SalesChannel {
  id: string;
  name: string;
  platform: ChannelPlatform;
  /** Operator GSTIN per state (Sec 52 TCS registrations carry `C` in place 14). */
  gstins: { state: string; gstin: string }[];
  /** Operator TAN (194-O deductor). */
  tan?: string;
  /** `clients` row of the operator as a party (fee bills, on-account receipts). */
  party_id: string;
  /** `bank_accounts` row with `clearing: true` (its ledger `bank:<id>`). */
  clearing_bank_id: string;
  /** Default godown the channel ships from (e.g. an FBA godown). */
  godown_id?: string;
  /** Damaged / unsellable returns go here (a non-saleable godown). */
  damaged_godown_id?: string;
  eco_section?: 'TCS_52' | 'PAY_9_5';
  presets?: { sales?: SavedMapping; settlement?: SavedMapping; returns?: SavedMapping };
  /* R5-A4 additive */
  payout_cycle_days?: number;
  expected_fee_pct?: { group_id?: string; pct: number }[];
  bucket_map?: BucketRule[];
  /* R5-A6 additive: claim window in days by effective date (absent = platform default) */
  claim_window?: { from: string; days: number }[];
  active: boolean;
  created_at?: string;
}

export interface ChannelSku {
  id: string;
  channel_id: string;
  channel_sku: string;
  /** ASIN / FSN / listing id. */
  listing_id?: string;
  /** `items_catalog` row id. */
  item_id: string;
  /** Units of the item in one listing unit ("pack of 3" = 3). */
  qty_per_unit: number;
  note?: string;
}

/* ── Imports (R5-A3 / A4 / A6) ────────────────────────────────── */

export type MarketplaceImportKind = 'sales' | 'settlement' | 'returns' | 'listings';

export interface MarketplaceImport {
  id: string;
  channel_id: string;
  kind: MarketplaceImportKind;
  file_name: string;
  period_from?: string;
  period_to?: string;
  imported_at: string;
  by?: string;
  counts: Record<string, number>;
  doc_ids?: string[];
  undone_at?: string;
}

/* ── Settlements (R5-A4) ──────────────────────────────────────── */

export interface SettlementLine {
  order_id: string;
  doc_id?: string;
  bucket: SettlementBucket;
  amount: number;
  description: string;
  sku?: string;
}

export interface SettlementPosting {
  payment_ids: string[];
  journal_id?: string;
  contra_id?: string;
  /** Fee tax invoice received at post time: GST on fees went straight to input credit. */
  fee_invoice_received?: boolean;
  at: string;
}

export interface Settlement {
  id: string;
  channel_id: string;
  settlement_id: string;
  period_from?: string;
  period_to?: string;
  deposit_date: string;
  payout: number;
  lines: SettlementLine[];
  posted?: SettlementPosting;
  /** Fee bill (`purchases`) and its re-class journal (R5-A4.6). */
  fee_invoice_id?: string;
  fee_reclass_id?: string;
  import_id: string;
}

/* ── GST TCS / TDS credit (R5-A5) ─────────────────────────────── */

export interface EcoCredit {
  id: string;
  kind: 'tcs' | 'tds';
  operator_gstin: string;
  /** YYYY-MM */
  month: string;
  gross: number;
  returns: number;
  net: number;
  igst: number;
  cgst: number;
  sgst: number;
  source: 'typed' | 'paste';
  decision?: 'accepted' | 'rejected';
  decided_on?: string;
  journal_id?: string;
}

/* ── Returns / RTO / claims (R5-A6) ───────────────────────────── */

export type ReturnType = 'customer_return' | 'rto' | 'courier_lost';
export type ReturnCondition = 'good' | 'damaged' | 'wrong_item' | 'missing';
export type ClaimStatus = 'open' | 'approved' | 'rejected' | 'reimbursed';

export interface MarketplaceReturn {
  id: string;
  channel_id: string;
  order_id: string;
  doc_id?: string;
  credit_note_id?: string;
  type: ReturnType;
  expected_on?: string;
  received_on?: string;
  condition?: ReturnCondition;
  godown_id?: string;
  claim?: { id?: string; raised_on?: string; amount?: number; status: ClaimStatus; settlement_id?: string };
  closed_on?: string;
  note?: string;
  created_at?: string;
}
