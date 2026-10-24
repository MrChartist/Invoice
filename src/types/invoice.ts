/**
 * Canonical domain types for the invoice app.
 * `useInvoiceStore` re-exports these so existing imports keep working.
 *
 * Persisted field names use snake_case because they are written to
 * localStorage as-is and older records already use that shape — renaming
 * them would orphan every existing user's data.
 */

import { tdsSections, tcsPresets, type TdsSection, type TcsPreset } from '../lib/tax-rules';
import type { AttachmentRef } from './attachments';
import type { CustomFieldValue } from './custom-fields';

export type DocumentType =
  | 'INVOICE'
  | 'TAX_INVOICE'
  | 'QUOTATION'
  | 'PROFORMA'
  | 'CREDIT_NOTE'
  | 'DEBIT_NOTE'
  | 'DELIVERY_CHALLAN'
  | 'SALES_ORDER';

export type InvoiceStatus =
  | 'Draft'
  | 'Sent'
  | 'Partially Paid'
  | 'Paid'
  | 'Overdue'
  | 'Cancelled';

/**
 * How tax is split.
 *  - NONE       no tax charged
 *  - SINGLE     one combined "Tax" line (what pre-GST-aware records used —
 *               kept so historical documents keep printing exactly as issued)
 *  - CGST_SGST  intra-state supply, tax halved into CGST + SGST
 *  - IGST       inter-state supply
 */
export type GstMode = 'NONE' | 'SINGLE' | 'CGST_SGST' | 'IGST';

export type DiscountType = 'PERCENT' | 'AMOUNT';

/**
 * Nature of supply. Absent/undefined behaves like B2B/B2C (normal GST).
 *  - *_WITH_PAYMENT   zero-rated but IGST is charged (claimed back as refund)
 *  - *_WITHOUT_PAYMENT / EXPORT_LUT  zero-rated, no tax charged (under LUT/bond)
 *  - DEEMED_EXPORT    taxed normally
 */
export type SupplyType =
  | 'B2B'
  | 'B2C'
  | 'SEZ_WITH_PAYMENT'
  | 'SEZ_WITHOUT_PAYMENT'
  | 'EXPORT_WITH_PAYMENT'
  | 'EXPORT_LUT'
  | 'DEEMED_EXPORT';

/** 'nearest' = classic round-off; 'none' = exact paise. */
export type RoundMode = 'nearest' | 'up' | 'down' | 'none';

/** Base on which TCS / TDS is computed. */
export type TcsBase = 'taxable' | 'total';

export const DOCUMENT_LABELS: Record<DocumentType, string> = {
  INVOICE: 'Invoice',
  TAX_INVOICE: 'Tax Invoice',
  QUOTATION: 'Quotation',
  PROFORMA: 'Proforma Invoice',
  CREDIT_NOTE: 'Credit Note',
  DEBIT_NOTE: 'Debit Note',
  DELIVERY_CHALLAN: 'Delivery Challan',
  SALES_ORDER: 'Sales Order',
};

/** Short code used inside the document number, e.g. INV / QTN / CRN. */
export const DOCUMENT_CODES: Record<DocumentType, string> = {
  INVOICE: 'INV',
  TAX_INVOICE: 'INV',
  QUOTATION: 'QTN',
  PROFORMA: 'PRO',
  CREDIT_NOTE: 'CRN',
  DEBIT_NOTE: 'DBN',
  DELIVERY_CHALLAN: 'DCH',
  SALES_ORDER: 'SO',
};

export const UNITS = [
  'NOS', 'PCS', 'HRS', 'DAY', 'MONTH', 'SET', 'KG', 'LTR', 'MTR', 'SQF', 'BOX', 'LOT',
] as const;

/** GST slabs used in India (see `src/lib/tax-rules.ts`). */
export { GST_SLABS } from '../lib/tax-rules';

export const SUPPLY_TYPE_LABELS: Record<SupplyType, string> = {
  B2B: 'B2B (regular)',
  B2C: 'B2C (regular)',
  SEZ_WITH_PAYMENT: 'SEZ supply with IGST payment',
  SEZ_WITHOUT_PAYMENT: 'SEZ supply without payment (LUT)',
  EXPORT_WITH_PAYMENT: 'Export with IGST payment',
  EXPORT_LUT: 'Export under LUT (no tax)',
  DEEMED_EXPORT: 'Deemed export',
};

/** TDS sections / TCS presets in force today. Use `tdsSections(date)` / `tcsPresets(date)` for a document date. */
export const TDS_SECTIONS: TdsSection[] = tdsSections();
export const TCS_PRESETS: TcsPreset[] = tcsPresets();

export interface InvoiceItem {
  id: string;
  /** Item / service name — the primary description column. */
  name: string;
  /** Optional second line of detail printed under the name. */
  description?: string;
  type: string;
  /** HSN (goods) or SAC (services) code. */
  hsn?: string;
  unit?: string;
  quantity: number;
  rate: number;
  /** Per-line GST rate in percent. */
  tax_rate?: number;
  /** GST Cess, percent of taxable value (ad valorem). Optional. */
  cess_rate?: number;
  /** Fixed cess per unit (e.g. tobacco), in currency. Optional. */
  cess_per_unit?: number;
  /** Per-line discount in percent, applied before invoice-level discount. */
  discount_percent?: number;
  /** Gross line amount = quantity × rate (kept for legacy records). */
  amount: number;
  /** Additive (6.16): cost centre for this line, overriding the document's `cost_centre_id`. */
  cost_centre_id?: string;
  created_at?: string;
  /**
   * Additive: id of the Sales Order line this line fulfils (set when a challan / invoice is converted from a
   * sales order, carried along SO → challan → invoice). Read with the record's `sales_order_id`.
   */
  order_line_id?: string;
  /**
   * Additive (6.23), catalogue rows only: item custom-field values keyed by field id. Picking the
   * item onto an invoice copies the values (with their labels) into `custom_values`.
   */
  custom_fields?: Record<string, string>;
  /** Additive (6.23), invoice lines only: snapshot of item custom fields (label + value + print flag). */
  custom_values?: CustomFieldValue[];
}

export interface Client {
  id?: string;
  name: string;
  email: string;
  address: string;
  city: string;
  zip: string;
  company?: string;
  gstin?: string;
  phone?: string;
  /** State name, free text (legacy). */
  state?: string;
  /** Two-digit GST state code — authoritative for the CGST/SGST vs IGST split. */
  state_code?: string;
  notes?: string;
  /** Income-tax PAN (AAAAA9999A). Used by the TDS register to identify the deductor. */
  pan?: string;
  /** TAN of the client as a TDS deductor (AAAA99999A) — the key 26AS / AIS reports use. */
  tan?: string;
  /**
   * Additive (roadmap 6.15): this client's late-payment terms. `percent_pa` = simple interest
   * % a year on the overdue balance; `flat` = a fixed ₹ fee. Only used when the user clicks
   * "Add late fee" on an overdue invoice (a NEW invoice is created; see src/lib/late-fee.ts).
   */
  late_fee?: { mode: 'percent_pa' | 'flat'; rate: number; graceDays: number };
  /** Additive (6.23): party custom-field values keyed by field id. */
  custom_fields?: Record<string, string>;
  /**
   * Additive (roadmap 6.25): credit limit in rupees. The editor warns (never blocks) when this
   * client's outstanding plus the invoice being drafted goes over it (`src/lib/credit-limit.ts`).
   */
  credit_limit?: number;
  /** Additive (6.25): credit period in days; bills older than this with a balance raise the same warning. */
  credit_days?: number;
  created_at?: string;
  updated_at?: string;
}

export interface SenderProfile {
  id?: string;
  companyName: string;
  companyTagline: string;
  companyEmail: string;
  companyPhone: string;
  companyAddress: string;
  companyGstin: string;
  pan?: string;
  companyWebsite: string;
  /** Two-digit GST state code of the place of business. */
  stateCode?: string;
  /** City / locality — printed on e-Invoice JSON (falls back to guessing from the address). */
  city?: string;
  /** 6-digit PIN code of the place of business. */
  pin?: string;
  /** Free line for a professional registration, e.g. "SEBI RA INH000015297". */
  regLine?: string;
  logo?: string;
  signature?: string;
  bankName: string;
  accountName: string;
  accountNumber: string;
  ifsc: string;
  upiId: string;
  /** Per-profile document number prefix, e.g. "MC". */
  invoicePrefix?: string;
  /** Default terms text pre-filled on new invoices. */
  defaultTerms?: string;
}

export interface Payment {
  id: string;
  invoice_id: string;
  amount: number;
  method: string;
  reference?: string;
  note?: string;
  date: string;
  /**
   * Additive (roadmap 6.19): rupees actually realised per unit of the invoice currency on this
   * receipt (bank's buying rate). Only meaningful on a foreign-currency invoice with an
   * `exchange_rate`; the difference is the realised exchange gain/loss (`src/lib/fx-gain.ts`).
   * `amount` stays in the invoice currency.
   */
  realised_rate?: number;
}

/** Outcome the user records on a quotation (Expired / Converted are derived, never stored). */
export type QuoteStatus = 'Accepted' | 'Declined';

/** Consignee / delivery address when goods go somewhere other than the billing address. */
export interface ShipTo {
  name?: string;
  address?: string;
  city?: string;
  state_code?: string;
  zip?: string;
  gstin?: string;
}

/** Everything that makes up one document. Also the persisted localStorage row. */
export interface InvoiceRecord {
  id: string;
  invoice_number: string;
  doc_type: DocumentType;
  issue_date: string;
  due_date: string;
  status: InvoiceStatus;
  currency: string;

  /** Snapshot of the template used, so old documents never re-skin themselves. */
  template_id: string;

  client: Client;
  /** Snapshot of the sender profile at save time. */
  sender: SenderProfile | null;
  items: InvoiceItem[];

  /* ── Tax / GST ─────────────────────────────────────────────── */
  gst_mode: GstMode;
  /** Two-digit GST state code of the place of supply. */
  place_of_supply: string;
  reverse_charge: boolean;

  /* ── Money knobs ───────────────────────────────────────────── */
  discount_type: DiscountType;
  /** Percent when discount_type is PERCENT, else an absolute amount. */
  discount_rate: number;
  /** Fallback flat GST rate for items that carry no tax_rate (legacy records). */
  tax_rate: number;
  shipping: number;
  other_charges: number;
  round_off_enabled: boolean;
  amount_paid: number;

  /* ── Advanced tax (all optional; absent = off, legacy behaviour) ── */
  supply_type?: SupplyType;
  lut_number?: string;
  lut_date?: string;
  /** Item rates already include GST (and ad valorem cess). */
  price_includes_tax?: boolean;
  /** Overrides round_off_enabled when present. */
  round_mode?: RoundMode;
  tcs_enabled?: boolean;
  tcs_rate?: number;
  tcs_base?: TcsBase;
  tcs_label?: string;
  tds_enabled?: boolean;
  /** e.g. '194J'. */
  tds_section?: string;
  tds_rate?: number;
  /** true (default): TDS on taxable value; false: on invoice total. */
  tds_on_taxable?: boolean;

  notes: string;
  terms: string;
  po_number?: string;
  /** Set on invoices generated by a recurring schedule (idempotency stamp). */
  recurring_id?: string;
  recurring_date?: string;

  /* ── Computed, persisted for fast ledger reads ──────────────── */
  subtotal: number;
  discount_amount: number;
  taxable_value: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  tax_amount: number;
  round_off: number;
  total: number;
  balance_due: number;
  cess_amount?: number;
  tcs_amount?: number;
  /** TDS deducted by the customer — a tax asset for the issuer. */
  tds_amount?: number;

  created_at?: string;
  updated_at?: string;
  /** Additive: the client's answer to a quotation. */
  quote_status?: QuoteStatus;
  /** Additive: ship-to / consignee address (printed and used for the e-Way bill). */
  ship_to?: ShipTo;
  /**
   * Additive: shipping + other charges are part of the taxable value (CGST Act s.15(2)(c)),
   * taxed at the highest GST rate on the document. Absent/false = untaxed (legacy behaviour).
   */
  charges_taxable?: boolean;
  /**
   * Additive: rupees per ONE unit of `currency` (e.g. 83.25 for USD) — the CBIC-notified /
   * shipping-bill rate. Only meaningful when currency is not INR; GST returns, e-Invoice,
   * Books, Tally and rupee dashboards convert with it (see `src/lib/fx.ts`).
   */
  exchange_rate?: number;
  /** Additive (exports): shipping bill / bill of export number, date (YYYY-MM-DD) and 6-char port code. */
  shipping_bill_no?: string;
  shipping_bill_date?: string;
  port_code?: string;
  /** Additive (roadmap 6.15): id of the overdue invoice this late-fee invoice was raised on. */
  late_fee_for?: string;
  /** Additive: the Sales Order a challan / invoice was converted from (see `src/lib/sales-orders.ts`). */
  sales_order_id?: string;
  /** Additive (sales orders): local day (YYYY-MM-DD) the user closed a partly fulfilled order. */
  order_closed_on?: string;
  /**
   * Additive (roadmap 6.16): `cost_centres` row id (project / department / branch) the document's
   * income is booked to. Lines may override it with their own `cost_centre_id`.
   */
  cost_centre_id?: string;
  /**
   * Additive (6.23): document custom fields, snapshotted with their label and print flag so a
   * later rename / delete of the field never changes what this document prints.
   */
  custom_values?: CustomFieldValue[];
  /**
   * Additive (6.12): internal files (receipts, signed copies). Never printed, and not copied when
   * the document is duplicated or converted.
   */
  attachments?: AttachmentRef[];
}
