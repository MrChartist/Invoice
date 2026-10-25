/**
 * Round 2 package C (books, compliance & output) — persisted shapes and additive fields.
 * `src/types/invoice.ts` is owned by package A, so the catalogue weights are added here by
 * declaration merging (additive, optional, snake_case).
 */
import type { DocumentType } from './invoice';

export type WeightUnit = 'kg' | 'g';

declare module './invoice' {
  interface InvoiceItem {
    /** Additive (R2-C4), catalogue rows: net weight of ONE base unit, in `weight_unit` (default kg). */
    net_weight?: number;
    /** Additive (R2-C4), catalogue rows: gross (packed) weight of one base unit, in `weight_unit`. */
    gross_weight?: number;
    weight_unit?: WeightUnit;
  }
}

declare module '../lib/inventory' {
  interface StockItem {
    /** Additive (R2-C4): net / gross weight of one base unit, in `weight_unit` (default kg). */
    net_weight?: number;
    gross_weight?: number;
    weight_unit?: WeightUnit;
  }
}

/* ── Packing list (R2-C4) ─────────────────────────────────────── */

/** Saved package type (Settings → Items → Package types). Dimensions in cm, tare in kg. */
export interface PackageType {
  id: string;
  name: string;
  length_cm: number;
  breadth_cm: number;
  height_cm: number;
  tare_kg: number;
  created_at?: string;
}

/** Snapshot of one document line on the packing list (the invoice itself never changes). */
export interface PackingLine {
  /** The document line's id. */
  line_id: string;
  name: string;
  hsn?: string;
  unit?: string;
  /** Quantity as typed on the document (line unit). */
  quantity: number;
  /** Base units per line unit (alternate units, `lineFactor`); 1 when absent. */
  unit_factor?: number;
  /** Net weight of one BASE unit in kg (from the catalogue / stock item at the time); 0 = unknown. */
  net_kg: number;
  /** Gross weight of one base unit in kg when the item master has one (packaging per unit); else absent. */
  gross_kg?: number;
}

export interface PackageContent {
  line_id: string;
  /** Quantity of the line (line unit) in EACH package of this row. */
  qty: number;
}

/** One package row: `count` identical packages, numbered from `from_no`. */
export interface PackingPackage {
  id: string;
  /** First box number of this row (box numbers run from_no … from_no + count − 1). */
  from_no: number;
  count: number;
  type_id?: string;
  type_name: string;
  length_cm: number;
  breadth_cm: number;
  height_cm: number;
  tare_kg: number;
  marks?: string;
  contents: PackageContent[];
}

export interface PackingList {
  id: string;
  /** `PKL/FY25-26/0001` */
  number: string;
  /** Local day YYYY-MM-DD. */
  date: string;
  source: { kind: 'invoice' | 'challan'; id: string; number: string; doc_type: DocumentType };
  party: string;
  /** Ship-to / consignee text snapshot. */
  ship_to?: string;
  lines: PackingLine[];
  packages: PackingPackage[];
  notes?: string;
  created_at: string;
  updated_at?: string;
}

/* ── Deferrals (R2-C2) ────────────────────────────────────────── */

export type DeferralMethod = 'days' | 'months';
export type DeferralStatus = 'active' | 'stopped' | 'completed';

export interface Deferral {
  id: string;
  /** 'revenue' (invoice line → income received in advance) or 'expense' (bill line → prepaid expense). */
  kind: 'revenue' | 'expense';
  source: { kind: 'invoice' | 'purchase'; id: string; line_index: number; number?: string; party?: string; name?: string; date?: string };
  /** Amount deferred, integer paise. */
  amount_paise: number;
  /** First day of the service period (YYYY-MM-DD). */
  start: string;
  months: number;
  method: DeferralMethod;
  /** P&L account the source posted to (Sales / the expense account) — released back into it. */
  account_id: string;
  /** Balance-sheet account the amount waits in (Income received in advance / Prepaid expenses). */
  holding_account_id: string;
  /** Manual voucher ids written for this schedule (initial deferral, monthly releases, reversal). */
  voucher_ids: string[];
  /** Entry key ('init', 'r1'…, 'stop') → voucher id, so posting is idempotent. */
  posted?: Record<string, string>;
  status: DeferralStatus;
  /** Day the schedule was stopped (unreleased amount reversed on this day). */
  stopped_on?: string;
  created_at: string;
  updated_at?: string;
}

/* ── Notes to accounts (R2-C1) ────────────────────────────────── */

export type EntityType = 'proprietorship' | 'partnership' | 'llp' | 'company';

export interface NoteText {
  /** Full text of an editable note, or the extra paragraph under an automatic note. */
  text?: string;
  extra?: string;
}

/** One row per FY: `id` = 'FY25-26'. */
export interface NotesToAccounts {
  id: string;
  notes: Record<string, NoteText>;
  entity_type?: EntityType;
  updated_at?: string;
}
