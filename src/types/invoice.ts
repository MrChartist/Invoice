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
  | 'SALES_ORDER'
  /**
   * Rule 49 Bill of Supply (own BOS series): no tax is charged. Issued by composition dealers for every
   * outward supply and by regular taxpayers for wholly exempt / nil-rated / non-GST supplies.
   */
  | 'BILL_OF_SUPPLY';

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
  BILL_OF_SUPPLY: 'Bill of Supply',
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
  BILL_OF_SUPPLY: 'BOS',
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
  /**
   * Additive (integrity review): ids of the time entries / mileage trips / re-billed purchase rows this
   * line bills (Time -> "Bill client"). Billing state is derived from these (`timesheets.ts`), so
   * deleting the line frees them and a duplicate keeps billing them.
   */
  bill_refs?: string[];
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
  /* ── Stock tracking (6.6 / 6.10 / 6.11) — all optional, absent on untracked lines ── */
  /** Additive (6.6): batch / lot the goods on this line come from (stock items with `track_batches`). */
  batch_no?: string;
  /** Additive (6.6): snapshot of that batch's expiry and manufacturing dates (YYYY-MM-DD), for printing. */
  batch_expiry?: string;
  batch_mfg?: string;
  /** Additive (6.11): serial / IMEI numbers on this line (stock items with `track_serials`); count = quantity. */
  serials?: string[];
  /** Additive (6.11): warranty given on this sale, in months (snapshot of the stock item's warranty). */
  warranty_months?: number;
  /** Additive (6.10): godown the goods leave from (credit notes: return to). Absent = the default godown. */
  godown_id?: string;
  /* ── Barcode & pricing (6.7 / 6.9) ── */
  /** Additive (6.7), catalogue rows only: barcode printed on the pack (EAN-13 / UPC / Code 128 text). */
  barcode?: string;
  /** Additive (6.7), catalogue rows only: the shop's own item code; a scan matches it too. */
  sku?: string;
  /** Additive (6.7), catalogue rows only: maximum retail price printed on shelf labels. */
  mrp?: number;
  /** Additive (6.9), catalogue rows only: quantity slabs — a line of at least `min_qty` gets `rate`. */
  qty_slabs?: QtySlab[];
  /**
   * Additive (6.9), invoice lines only: why the rate is what it is when it was set automatically
   * (a price level name such as "Wholesale", or "Qty ≥ 10"). Absent = typed or the catalogue's base rate.
   */
  price_basis?: string;
  /** Additive (6.9), invoice lines only: the scheme this free (₹0) line was given under. */
  scheme_id?: string;
  /** Additive (6.9), invoice lines only: id of the paid line this free line belongs to. */
  free_of?: string;
  /**
   * Additive (WP-8), invoice lines only: the line is typed in an alternate unit of its stock item
   * (`unit` = 'BOX'); one line unit is this many base units (snapshot, absent = 1). Stock moves
   * quantity × unit_factor; the rate stays per line unit (`src/lib/units.ts`).
   */
  unit_factor?: number;
}

/** A quantity slab on a catalogue item (6.9). */
export interface QtySlab {
  min_qty: number;
  rate: number;
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
  /** Additive (6.9): id of the `price_levels` row this party buys at (e.g. Wholesale). Absent = base rates. */
  price_level?: string;
  /**
   * Additive (WP-1 masters): id of a user sub-group under Sundry Debtors (`groups` table,
   * `src/lib/ledger/accounts.ts`) this party is placed in. Absent = directly under Sundry Debtors.
   * The party's opening balance lives in `ledger_openings`, its bill-wise breakup in `opening_bills`.
   */
  group_id?: string;
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
  /**
   * Additive (roadmap 5.9): GST registration type. Absent = 'regular'. A composition profile issues
   * Bills of Supply (no tax) and files CMP-08 / GSTR-4 instead of GSTR-1 / 3B. Snapshotted with the profile.
   */
  gst_scheme?: GstScheme;
  /** Additive: what kind of composition taxpayer — decides the rate (`compositionRate` in tax-rules). */
  composition_category?: CompositionCategory;
}

/** GST registration type of a sender profile. */
export type GstScheme = 'regular' | 'composition';

/**
 * Composition categories: Sec 10(1) manufacturer / trader / restaurant service, and the
 * Sec 10(2A) option for service providers (Notification 2/2019-CT(R)).
 */
export type CompositionCategory = 'manufacturer' | 'trader' | 'restaurant' | 'service';

/** Column of GSTR-1 Table 8 a Bill of Supply from a regular taxpayer is reported in. */
export type ExemptKind = 'NIL' | 'EXEMPT' | 'NON_GST';

/**
 * Supply made through an e-commerce operator (ECO): `TCS_52` = the operator collects TCS under Sec 52 (the
 * supplier pays the tax and reports the supply with the operator's GSTIN, GSTR-1 Table 14(a)); `PAY_9_5` = the
 * operator itself pays the tax under Sec 9(5) (restaurant / passenger transport / accommodation …; the supplier
 * reports the value only, GSTR-1 Table 14(b) and GSTR-3B 3.1.1(ii)). See `src/lib/eco.ts`.
 */
export type EcoSection = 'TCS_52' | 'PAY_9_5';

/**
 * Why a delivery challan was issued (Rule 55). Only the first four are listed in GSTR-1 Table 13 (doc 9-12);
 * `ANTICIPATION` (goods sent ahead of the tax invoice of the same supply) is not, and absent = not listed.
 */
export type ChallanPurpose = 'JOB_WORK' | 'APPROVAL' | 'LIQUID_GAS' | 'OTHER_THAN_SUPPLY' | 'ANTICIPATION';

/**
 * Additive (roadmap 5.9): a document already reported in a filed GSTR-1 that was edited afterwards.
 * `original` is the document exactly as it was when the amendment started (it stays in the GSTR-1 of
 * its own period); the edited record is reported in the period of `amended_on` (B2BA / B2CLA / B2CSA /
 * CDNRA / CDNURA). See `src/lib/amendments.ts`.
 */
export interface AmendmentInfo {
  /** Number and date (YYYY-MM-DD) of the document as originally reported. */
  original_number: string;
  original_date: string;
  /** GSTN return period (MMYYYY, last month covered) the original was reported in. */
  period: string;
  /** Local day the amendment was made: the return period it is reported in. */
  amended_on: string;
  reason?: string;
  /** The document as filed (sender trimmed to its GST identity; no nested amendment). */
  original?: Omit<InvoiceRecord, 'amends'>;
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
  /** Additive (multi-account BRS): the bank account it was received into (`bank-accounts.ts`); missing = main. */
  bank_account_id?: string;
  /**
   * Additive (roadmap 5.3): this row is an advance (`advances` table) adjusted against the invoice,
   * not new money. It settles the bill like any payment, but cash books, receipts numbering and
   * bank matching skip it — the cash came in on the advance's own date.
   */
  advance_id?: string;
  /**
   * Additive (integrity review): receipt voucher number `RCPT/FY<yy-yy>/<seq>`, stamped when the payment is
   * recorded (never re-derived, so a later delete / bounce cannot renumber it). Older rows without it keep
   * the date-order number (`receipts.ts`). Absent on advance adjustments.
   */
  receipt_number?: string;
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

export type TransportMode = 'ROAD' | 'RAIL' | 'AIR' | 'SHIP';

/**
 * Dispatch / transport details printed on the document (P1-24) and offered to the e-Way bill.
 * Every field is optional; dates are local days (YYYY-MM-DD). See `src/lib/transport.ts`.
 */
export interface TransportDetails {
  mode?: TransportMode;
  vehicle_no?: string;
  transporter_name?: string;
  /** Transporter GSTIN or the 15-character TRANSIN. */
  transporter_id?: string;
  /** Lorry receipt / railway receipt / airway bill / bill of lading number. */
  lr_no?: string;
  lr_date?: string;
  eway_bill_no?: string;
  /** Approximate distance, km. */
  distance_km?: number;
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
  /**
   * Additive: set on reverse-charge documents calculated by this version on. The GST is shown as
   * "payable by the recipient" and is NOT inside `total` / `balance_due`. Older reverse-charge
   * records (flag absent) stored a total that includes the tax; readers adapt through
   * `src/lib/rcm.ts` — stored records are never rewritten.
   */
  rcm_tax_excluded?: boolean;
  /**
   * Additive, credit notes only: goods came back into stock (a sales return). Absent on older notes —
   * then the note's reason decides (`src/lib/credit-restock.ts`). Discount / rate-difference / GST
   * correction notes move no stock and take no cost of goods back.
   */
  goods_returned?: boolean;

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
  /** Additive (5.9): Bill of Supply from a regular taxpayer — GSTR-1 Table 8 column (absent = EXEMPT). */
  exempt_kind?: ExemptKind;
  /** Additive (5.9): set when a document reported in a filed return is amended (never copied). */
  amends?: AmendmentInfo;
  /** Additive (6.8): billed at the POS counter (counted in that day's Z report). Never copied. */
  pos?: boolean;
  /** Additive (5.9 e-commerce): GSTIN of the e-commerce operator the supply was made through (absent = direct sale). */
  eco_gstin?: string;
  /** Additive: how that operator is involved (absent with `eco_gstin` = `TCS_52`). Only stored with `eco_gstin`. */
  eco_section?: EcoSection;
  /** Additive, delivery challans only: Rule 55 purpose — decides the GSTR-1 Table 13 row (absent = not listed). */
  challan_purpose?: ChallanPurpose;
  /** Additive (P1-24): transport / dispatch details, printed in the transport block. Absent = none. */
  transport?: TransportDetails;
  /**
   * Additive (WP-9 maker-checker): approval state of a document a clerk issued while approvals are
   * on. A pending document is stored as a Draft (`src/lib/approval-gate.ts`).
   */
  approval?: ApprovalInfo;
  /** Additive (WP-9): `branches` row id — the branch / location the document belongs to. */
  branch_id?: string;
  /** Additive (WP-9): `stock_transfers` id this Sec 25(4) inter-branch tax invoice was raised for (posts to "Branch transfer"). */
  branch_transfer_id?: string;
  /** Additive (WP-9): loyalty points redeemed on this bill; `value` (₹) is part of its invoice discount. */
  loyalty_redeem?: { points: number; value: number };
}

/** WP-9: maker-checker state kept on the document itself. */
export interface ApprovalInfo {
  state: 'pending' | 'approved' | 'rejected';
  /** The document this decision belongs to (a copied record never carries an approval over). */
  doc_id: string;
  /** Status the clerk wanted (normally Sent); restored on approval. */
  requested_status: InvoiceStatus;
  requested_by: string;
  requested_at: string;
  decided_by?: string;
  decided_at?: string;
  note?: string;
}
