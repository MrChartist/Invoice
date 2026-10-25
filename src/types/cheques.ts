/**
 * Cheque register (roadmap 6.26). Persisted in table `cheques` (`mrchartist_inv_cheques`).
 * Additive only — never rename fields.
 */

export type ChequeDirection = 'received' | 'issued';

/** Received: in hand → deposited → cleared, or bounced (a bounced cheque can be re-deposited). */
export type ReceivedChequeStatus = 'received' | 'deposited' | 'cleared' | 'bounced';
/** Issued: handed over → presented by the payee → cleared, or cancelled (stop payment / torn). */
export type IssuedChequeStatus = 'issued' | 'presented' | 'cleared' | 'cancelled';
export type ChequeStatus = ReceivedChequeStatus | IssuedChequeStatus;

export interface Cheque {
  id: string;
  direction: ChequeDirection;
  /** 6-digit cheque number printed on the leaf (CTS-2010). */
  number: string;
  /** Drawee bank (received) or our bank (issued). */
  bank: string;
  branch?: string;
  /** Date written on the cheque, YYYY-MM-DD. After today = post-dated (PDC). */
  cheque_date: string;
  /** Rupees. */
  amount: number;
  /** Drawer (received) or payee (issued) — printed on an issued cheque. */
  party_name: string;
  client_id?: string;
  vendor_id?: string;
  /** Linked document: a sales invoice (received) or a purchase bill (issued). */
  invoice_id?: string;
  purchase_id?: string;
  status: ChequeStatus;
  /** Lifecycle dates (YYYY-MM-DD). */
  received_on?: string;
  deposited_on?: string;
  presented_on?: string;
  cleared_on?: string;
  bounced_on?: string;
  cancelled_on?: string;
  bounce_reason?: string;
  /** Times this cheque has bounced (a re-deposited cheque keeps its history). */
  bounce_count?: number;
  /** `transactions` row recorded when a received cheque cleared against `invoice_id`. */
  payment_id?: string;
  /** `purchase_payments` row recorded when an issued cheque cleared against `purchase_id`. */
  purchase_payment_id?: string;
  /**
   * Additive (integrity review): our bank account the cheque is deposited into (received) or drawn on
   * (issued) — multi-account BRS. Carried onto the payment recorded at clearing; missing = main account.
   */
  bank_account_id?: string;
  /** Issued: print the "A/C Payee" crossing. Defaults to true. */
  account_payee?: boolean;
  notes?: string;
  created_at?: string;
  updated_at?: string;
}
