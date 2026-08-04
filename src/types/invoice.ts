/**
 * Canonical domain types for the invoice app.
 * `useInvoiceStore` re-exports these so existing imports keep working.
 *
 * Persisted field names use snake_case because they are written to
 * localStorage as-is and older records already use that shape — renaming
 * them would orphan every existing user's data.
 */

export type DocumentType =
  | 'INVOICE'
  | 'TAX_INVOICE'
  | 'QUOTATION'
  | 'PROFORMA'
  | 'CREDIT_NOTE'
  | 'DELIVERY_CHALLAN';

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

export const DOCUMENT_LABELS: Record<DocumentType, string> = {
  INVOICE: 'Invoice',
  TAX_INVOICE: 'Tax Invoice',
  QUOTATION: 'Quotation',
  PROFORMA: 'Proforma Invoice',
  CREDIT_NOTE: 'Credit Note',
  DELIVERY_CHALLAN: 'Delivery Challan',
};

/** Short code used inside the document number, e.g. INV / QTN / CRN. */
export const DOCUMENT_CODES: Record<DocumentType, string> = {
  INVOICE: 'INV',
  TAX_INVOICE: 'INV',
  QUOTATION: 'QTN',
  PROFORMA: 'PRO',
  CREDIT_NOTE: 'CRN',
  DELIVERY_CHALLAN: 'DCH',
};

export const UNITS = [
  'NOS', 'PCS', 'HRS', 'DAY', 'MONTH', 'SET', 'KG', 'LTR', 'MTR', 'SQF', 'BOX', 'LOT',
] as const;

/** GST slabs used in India. 0 doubles as exempt/nil-rated for this tool. */
export const GST_SLABS = [0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 12, 18, 28] as const;

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
  /** Per-line discount in percent, applied before invoice-level discount. */
  discount_percent?: number;
  /** Gross line amount = quantity × rate (kept for legacy records). */
  amount: number;
  created_at?: string;
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

  notes: string;
  terms: string;
  po_number?: string;

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

  created_at?: string;
  updated_at?: string;
}
