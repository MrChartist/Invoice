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

export const SUPPLY_TYPE_LABELS: Record<SupplyType, string> = {
  B2B: 'B2B (regular)',
  B2C: 'B2C (regular)',
  SEZ_WITH_PAYMENT: 'SEZ supply with IGST payment',
  SEZ_WITHOUT_PAYMENT: 'SEZ supply without payment (LUT)',
  EXPORT_WITH_PAYMENT: 'Export with IGST payment',
  EXPORT_LUT: 'Export under LUT (no tax)',
  DEEMED_EXPORT: 'Deemed export',
};

/** Common TDS sections a customer may deduct from a payment. */
export const TDS_SECTIONS: { section: string; label: string; rate: number }[] = [
  { section: '194C-1', label: '194C Contractor (individual/HUF) 1%', rate: 1 },
  { section: '194C-2', label: '194C Contractor (others) 2%', rate: 2 },
  { section: '194H', label: '194H Commission / brokerage 5%', rate: 5 },
  { section: '194I-A', label: '194I Rent (plant/machinery) 2%', rate: 2 },
  { section: '194I-B', label: '194I Rent (land/building) 10%', rate: 10 },
  { section: '194J-T', label: '194J Technical services 2%', rate: 2 },
  { section: '194J', label: '194J Professional fees 10%', rate: 10 },
  { section: '194Q', label: '194Q Purchase of goods 0.1%', rate: 0.1 },
  { section: 'CUSTOM', label: 'Custom rate', rate: 0 },
];

/** Common TCS rates. */
export const TCS_PRESETS: { label: string; rate: number }[] = [
  { label: '206C(1H) sale of goods 0.1%', rate: 0.1 },
  { label: '206C(1H) no PAN 1%', rate: 1 },
  { label: '206C(1G) overseas remittance 20%', rate: 20 },
];

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
}
