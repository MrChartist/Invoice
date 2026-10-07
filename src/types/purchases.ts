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
  /** Whether the GST on this bill is claimed as input tax credit. */
  itc_eligible: boolean;
  total: number;
  amount_paid: number;
  notes?: string;
  created_at?: string;
  updated_at?: string;
}

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
