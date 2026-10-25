/**
 * Advance receipts (roadmap 5.3). Persisted in table `advances` (`mrchartist_inv_advances`).
 * Additive only — never rename fields.
 *
 * An advance is money received from a client before the invoice. It gets a Receipt Voucher
 * (CGST Rule 50) in its own series `ADV/FY25-26/0001`. Adjustments against invoices are NOT stored
 * here: they are ordinary `transactions` rows carrying `advance_id` (recorded through
 * `localDb.payments.record`), so deleting the invoice or the payment frees the advance again.
 * Refunds of an unadjusted balance (Refund Voucher, Rule 51) are kept on the record.
 */

export type AdvanceSupply = 'services' | 'goods';

/** GST worked out when the voucher was issued (a snapshot, like an invoice's totals). */
export interface AdvanceTax {
  /** False when no GST is due on this advance (goods after 15 Nov 2017, export, rate 0). */
  applies: boolean;
  supply_type: 'INTRA' | 'INTER';
  /** Amount received less the tax in it (amount × 100 / (100 + rate)). */
  taxable: number;
  igst: number;
  cgst: number;
  sgst: number;
}

export interface AdvanceRefund {
  id: string;
  /** Refund Voucher number, `RFV/FY25-26/0001` (own series). */
  number: string;
  date: string;
  amount: number;
  method: string;
  reference?: string;
  note?: string;
  created_at: string;
  /** Additive (multi-account BRS): bank account it was paid from; missing = the main account. */
  bank_account_id?: string;
}

/** Issuer details printed on the voucher, frozen when it is saved (Critical Rule 3). */
export interface AdvanceSender {
  companyName: string;
  companyAddress?: string;
  companyGstin?: string;
  companyEmail?: string;
  companyPhone?: string;
  stateCode?: string;
}

export interface AdvanceRecord {
  id: string;
  /** Receipt Voucher number, `ADV/FY25-26/0001`. */
  number: string;
  /** Day the money was received, YYYY-MM-DD. */
  date: string;
  client: { id?: string; name: string; company?: string; gstin?: string; address?: string; state_code?: string; email?: string };
  /** Two-digit state code of the place of supply of the expected supply (96 = export). */
  place_of_supply: string;
  supply: AdvanceSupply;
  /** GST rate of the expected supply, %. */
  tax_rate: number;
  /** Rupees received, tax inclusive. INR only. */
  amount: number;
  method: string;
  reference?: string;
  /** Additive (multi-account BRS): bank account it was received into; missing = the main account. */
  bank_account_id?: string;
  /** What the advance is for (printed as the description of supply). */
  description?: string;
  note?: string;
  tax: AdvanceTax;
  sender?: AdvanceSender | null;
  refunds?: AdvanceRefund[];
  created_at: string;
  updated_at?: string;
}
