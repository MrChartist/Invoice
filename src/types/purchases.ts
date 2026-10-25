import type { AttachmentRef } from './attachments';

/**
 * Shared shapes for the purchase / expense side of the books.
 * Several feature modules (purchases, GST reports, inventory, books) read the
 * `vendors` and `purchases` tables, so the persisted shape lives here and is
 * additive-only: add optional fields, never rename or remove one.
 */

export interface Vendor {
  id: string;
  name: string;
  gstin?: string;
  state_code?: string;
  email?: string;
  phone?: string;
  address?: string;
  notes?: string;
  created_at?: string;
  /** Udyam registration number, `UDYAM-XX-00-0000000` (MSMED Act). */
  msme_udyam?: string;
  /** Udyam category. Micro and Small suppliers drive the Sec 43B(h) / MSMED Sec 15 tracker. */
  msme_category?: MsmeCategory;
  /** Additive (6.23): party custom-field values keyed by field id. */
  custom_fields?: Record<string, string>;
  /* ── TDS on payables (Tally parity) — additive, all optional ── */
  /** Supplier PAN (10 characters). Missing / invalid → Sec 206AA higher rate. */
  pan?: string;
  /** Deductee category (`DeducteeType` in src/lib/tds-rules.ts); derived from the PAN when absent. */
  deductee_type?: 'COMPANY' | 'INDIVIDUAL' | 'HUF' | 'FIRM' | 'OTHER';
  /** Default TDS section code for this supplier's bills (e.g. `194J`, `194C-2`). */
  tds_section?: string;
  /** Sec 206AB "specified person" (non-filer) — applies only while 206AB was in force. */
  tds_non_filer?: boolean;
  /** Sec 197 lower / nil deduction certificate: number and rate (%). */
  tds_lower_cert?: string;
  tds_lower_rate?: number;
  /** Non-resident payee: TDS goes in Form 27Q (flagged only — not computed by this app). */
  non_resident?: boolean;
}

export type MsmeCategory = 'MICRO' | 'SMALL' | 'MEDIUM';

export type PurchaseKind = 'PURCHASE' | 'EXPENSE';

export interface PurchaseLine {
  id: string;
  name: string;
  hsn?: string;
  unit?: string;
  quantity: number;
  rate: number;
  tax_rate: number;
  /** Optional link to an inventory/catalogue item id (for stock-in). */
  item_id?: string;
  /** Additive: the purchase-order line this bill line receives (set by "Convert to bill"). */
  po_line_id?: string;
  /* ── Stock tracking (6.6 / 6.10 / 6.11) — additive, only set for tracked stock items ── */
  /** Batch / lot number received on this line. */
  batch_no?: string;
  /** Manufacturing and expiry dates of the batch, yyyy-mm-dd. */
  mfg_date?: string;
  expiry_date?: string;
  /** Printed MRP of the batch (informational). */
  mrp?: number;
  /** Serial / IMEI numbers received; count equals `quantity`. */
  serials?: string[];
  /** Godown the goods are received into (absent = the default godown). */
  godown_id?: string;
}

/** A supplier bill or a direct expense. Persisted in table `purchases`. */
export interface PurchaseRecord {
  id: string;
  kind: PurchaseKind;
  /** Additive (WP-9): `branches` row id of the branch / location that received the bill. */
  branch_id?: string;
  vendor_id?: string;
  vendor_name: string;
  vendor_gstin?: string;
  /** The supplier's own bill number. */
  bill_number: string;
  /** yyyy-mm-dd */
  date: string;
  due_date?: string;
  /** Two-digit GST state code of the place of supply on the bill. */
  place_of_supply?: string;
  category: string;
  lines: PurchaseLine[];
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  /**
   * Whether the GST on this bill is claimed as input tax credit. A blocked credit
   * (Sec 17(5)) is `itc_eligible: false` with `itc_reversal_reason: 'SEC_17_5'`.
   */
  itc_eligible: boolean;
  /** Reverse charge: the GST on this bill is payable by us (GSTR-3B 3.1(d), ITC 4A(3)). */
  reverse_charge?: boolean;
  /** Import: goods (Bill of Entry, ITC 4A(1)) or services (reverse charge, 3.1(d) + ITC 4A(2)). */
  import_type?: ImportType;
  /** Bill of Entry number / date (yyyy-mm-dd) / 6-character port code, for imports of goods. */
  boe_number?: string;
  boe_date?: string;
  port_code?: string;
  /** ITC reversed against this bill (amount, spread pro-rata over the GST heads). */
  itc_reversed?: number;
  /** Why ITC was reversed: Rules 42/43 and Sec 17(5) go to 3B 4B(1); Rule 37 and others to 4B(2). */
  itc_reversal_reason?: ItcReversalReason;
  total: number;
  amount_paid: number;
  notes?: string;
  created_at?: string;
  updated_at?: string;
  /* ── Billable expenses (6.14, all optional; absent = an ordinary cost) ── */
  /** `clients` row id this cost is re-billed to. */
  billable_to_client_id?: string;
  /** Markup on cost when re-billed, percent (ignored for pure-agent reimbursements). */
  markup_percent?: number;
  /** Recovered at actual cost as a pure agent (Rule 33, CGST Rules): billed as a 0% line. */
  pure_agent?: boolean;
  /** Invoice id it was re-billed on. Billed only while that invoice exists and is not cancelled. */
  rebilled_in?: string;
  /** Additive: the purchase order (table `purchase_orders`) this bill was converted from. */
  po_id?: string;
  /** Additive (6.16): `cost_centres` row id this bill / expense is charged to (project P&L, budgets). */
  cost_centre_id?: string;
  /** Additive (6.12): receipt photos / PDFs (see src/lib/attachments.ts). Ignored by every report. */
  attachments?: AttachmentRef[];
  /* ── TDS deducted by us (Tally parity) — additive, all optional; absent = no TDS ── */
  /** Section code (`TDS_PAYABLE_SECTIONS` in src/lib/tds-rules.ts), e.g. `194J`, `194C-2`, `194I-B`. */
  tds_section?: string;
  /** Rate applied (%), after 206AA / 206AB / a Sec 197 certificate. */
  tds_rate?: number;
  /** Amount TDS is computed on (₹) — normally the taxable value, GST excluded (CBDT Circular 23/2017). */
  tds_base?: number;
  /** TDS amount (₹). With `tds_on` 'BILL' it reduces what the supplier is owed (`supplierPayable`). */
  tds_amount?: number;
  /** When it is deducted: at booking the bill (Tally's default) or when paying (`purchase_payments.tds_amount`). */
  tds_on?: 'BILL' | 'PAYMENT';
  /** Snapshot of the payee's PAN and category used for this deduction. */
  tds_pan?: string;
  tds_deductee_type?: 'COMPANY' | 'INDIVIDUAL' | 'HUF' | 'FIRM' | 'OTHER';
  /**
   * 26Q "reason" code when the rate is not the normal one: `A` lower / nil deduction certificate
   * (Sec 197), `C` higher rate — no PAN (206AA) or non-filer (206AB), `Y` threshold not crossed.
   */
  tds_reason?: string;
  /** Sec 197 certificate number snapshot. */
  tds_cert_no?: string;
}

/**
 * Bill-wise payables (Tally parity): money paid to a supplier that is NOT against a bill yet —
 * Tally's "Advance", "On Account" and "New Ref" allocations. Persisted in table `vendor_payments`.
 * It is real cash out (Books cash book, ledger Dr Sundry creditors / Cr Cash-Bank). Adjusting it
 * against a bill later adds an `allocations` row and raises the bill's `amount_paid`; that moves no
 * money, so no reader counts it as a new payment.
 */
export interface VendorPayment {
  id: string;
  vendor_id?: string;
  vendor_name: string;
  /** yyyy-mm-dd */
  date: string;
  amount: number;
  method: string;
  reference?: string;
  bank_account_id?: string;
  kind: 'ADVANCE' | 'ON_ACCOUNT' | 'NEW_REF';
  /** Reference name for a New Ref (e.g. the supplier's proforma number). */
  ref_name?: string;
  /** Adjustments against bills (Agst Ref), oldest first. */
  allocations?: { purchase_id: string; amount: number; date: string }[];
  /** Groups the rows of one multi-bill payment (the `purchase_payments` rows carry the same id). */
  group_id?: string;
  created_at?: string;
}

/** One line of a purchase order. Same shape as a bill line, minus the stock link. */
export interface PurchaseOrderLine {
  id: string;
  name: string;
  hsn?: string;
  unit?: string;
  quantity: number;
  rate: number;
  tax_rate: number;
}

/**
 * A purchase order sent to a supplier. Persisted in table `purchase_orders`. Not a tax or
 * books document: nothing posts until the supplier's bill is recorded. Received quantity is
 * derived from bills whose `po_id` points here (per line through `PurchaseLine.po_line_id`).
 */
export interface PurchaseOrder {
  id: string;
  /** `PO/FY<yy-yy>/<seq>` (Indian FY of `date`). */
  po_number: string;
  /** yyyy-mm-dd */
  date: string;
  /** Expected delivery, yyyy-mm-dd. */
  expected_date?: string;
  vendor_id?: string;
  vendor_name: string;
  vendor_gstin?: string;
  place_of_supply?: string;
  lines: PurchaseOrderLine[];
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
  notes?: string;
  /** yyyy-mm-dd the user closed a partly received order. */
  closed_on?: string;
  created_at?: string;
  updated_at?: string;
}

export type ImportType = 'GOODS' | 'SERVICES';
export type ItcReversalReason = 'RULE_42' | 'RULE_43' | 'RULE_37' | 'SEC_17_5' | 'OTHER';

export const ITC_REVERSAL_REASONS: { value: ItcReversalReason; label: string }[] = [
  { value: 'RULE_42', label: 'Rule 42 (inputs / services: exempt or non-business use)' },
  { value: 'RULE_43', label: 'Rule 43 (capital goods: exempt or non-business use)' },
  { value: 'RULE_37', label: 'Rule 37 (supplier not paid within 180 days)' },
  { value: 'SEC_17_5', label: 'Sec 17(5) blocked credit' },
  { value: 'OTHER', label: 'Other' },
];

export const PURCHASE_CATEGORIES = [
  'Purchases',
  'Rent',
  'Salaries',
  'Software & subscriptions',
  'Professional fees',
  'Travel',
  'Utilities',
  'Marketing',
  'Office supplies',
  'Bank charges',
  'Other',
] as const;
