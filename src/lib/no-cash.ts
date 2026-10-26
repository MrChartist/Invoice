/**
 * QA6-1 (F4): the ONE rule for receipt rows (`transactions`) that settle a bill but moved no cash / bank money.
 *
 *  - `advance_id`            — an advance adjusted against the bill (5.3); the money came in on the advance;
 *  - `write_off`             — a bad-debt write-off (8.106);
 *  - `gift_voucher_id`       — paid with a gift voucher (R4-B1); the cash came in when the voucher was sold;
 *  - `deposit_adjustment_id` — settled from a security deposit held (R5-C6);
 *  - `ra_journal_id`         — GST TDS / labour cess the client deducted from an RA bill (R5-B5);
 *  - `exchange_purchase_id`  — settled by the customer's old goods taken in exchange (R9: old device RT-D3, old gold
 *                              RT-E3); the URD purchase voucher owes them that value, so the receipt clears debtor
 *                              against creditor ("Sundry creditors — exchange").
 *
 * Every cash / bank reader (cash book, Today, bank reconciliation, payment modes, Tally / CSV receipts, collection lag,
 * Z report) skips these with `movedNoCash`, or posts them to their own ledger with `noCashKind` / `NO_CASH_LEDGER`.
 * `tests/no-cash-readers.test.ts` keeps new readers on it. Readers import it through `advance-tax.ts` (same chunk, no
 * extra entry in the first-paint preload map). No imports.
 */

export interface NoCashMarkers {
  advance_id?: unknown;
  write_off?: unknown;
  gift_voucher_id?: unknown;
  deposit_adjustment_id?: unknown;
  ra_journal_id?: unknown;
  exchange_purchase_id?: unknown;
}

export type NoCashKind = 'advance' | 'write_off' | 'gift_voucher' | 'deposit' | 'ra_deduction' | 'exchange';

/** Why a receipt row moved no money ('' = it did). */
export function noCashKind(p: NoCashMarkers | null | undefined): NoCashKind | '' {
  if (!p) return '';
  if (p.advance_id) return 'advance';
  if (p.write_off) return 'write_off';
  if (p.gift_voucher_id) return 'gift_voucher';
  if (p.deposit_adjustment_id) return 'deposit';
  if (p.ra_journal_id) return 'ra_deduction';
  if (p.exchange_purchase_id) return 'exchange';
  return '';
}

/** True when the receipt row settled the bill without cash / bank money moving. */
export const movedNoCash = (p: NoCashMarkers | null | undefined): boolean => noCashKind(p) !== '';

/** The ledger the app's own books debit instead of cash / bank (names as `ledger/accounts.ts` and the modules create them). */
export const NO_CASH_LEDGER: Readonly<Record<NoCashKind, string>> = {
  advance: 'Advances from customers',
  write_off: 'Bad debts written off',
  gift_voucher: 'Gift vouchers outstanding',
  deposit: 'Security deposits received',
  ra_deduction: 'RA deductions clearing',
  exchange: 'Sundry creditors — exchange',
};
