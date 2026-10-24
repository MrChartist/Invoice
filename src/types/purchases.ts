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
}

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
}

/** A supplier bill or a direct expense. Persisted in table `purchases`. */
export interface PurchaseRecord {
  id: string;
  kind: PurchaseKind;
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
