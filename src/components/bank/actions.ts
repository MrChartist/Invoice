/**
 * The only places the reconciliation screen WRITES to the books. Every write goes through the same
 * lib functions the existing Payment / Expense flows use (`localDb.payments.record`,
 * `purchasesDb.save`, `paymentsDb.record`), so invoice status, `amount_paid`, Books and the
 * dashboard stay consistent. Each function validates first and throws an Error with a
 * user-readable message; nothing is written when it throws.
 */

import {
  inferMode,
  methodForMode,
  openBalance,
  referenceFor,
  type BankLine,
} from '../../lib/bank-recon';
import { num, round2 } from '../../lib/invoice-calc';
import { localDb } from '../../lib/localDb';
import {
  balanceOf,
  computePurchaseTotals,
  expenseLine,
  paymentsDb,
  purchasesDb,
  type PurchasePayment,
} from '../../lib/purchases';
import { businessContext } from '../../lib/purchases-context';
import type { Payment } from '../../types/invoice';
import type { PurchaseRecord } from '../../types/purchases';

const lineAmount = (l: Pick<BankLine, 'debit' | 'credit'>) => (l.credit > 0 ? l.credit : l.debit);

/** Record a payment received against an invoice, dated and referenced from the bank line. */
export function recordReceiptFromLine(line: BankLine, invoiceId: string, amount: number = lineAmount(line)): Payment {
  if (!(line.credit > 0)) throw new Error('Only a credit can be recorded as a receipt.');
  const invoice = localDb.invoices.getById(invoiceId);
  if (!invoice) throw new Error('That invoice no longer exists.');
  const value = round2(num(amount));
  if (!(value > 0)) throw new Error('Enter an amount above zero.');
  const owing = openBalance(invoice);
  if (value > owing + 0.01) throw new Error(`The amount is more than the invoice balance of ${owing.toFixed(2)}.`);
  return localDb.payments.record({
    invoiceId,
    amount: value,
    method: methodForMode(inferMode(line.narration)),
    reference: referenceFor(line) || undefined,
    note: 'From bank statement',
    date: line.date,
  });
}

export interface ExpenseFromLine {
  category: string;
  vendorName: string;
  /** GST slab the debit includes (0 = none). */
  taxRate: number;
  itcEligible: boolean;
  notes?: string;
}

/** Create an expense for a debit (GST backed out of the amount) and record it as paid on the line's date. */
export function recordExpenseFromLine(line: BankLine, opts: ExpenseFromLine): { bill: PurchaseRecord; payment: PurchasePayment } {
  if (!(line.debit > 0)) throw new Error('Only a debit can be recorded as an expense.');
  const rate = Math.max(num(opts.taxRate), 0);
  const business = businessContext();
  const bill = expenseLine(opts.category, line.debit, rate, true);
  const totals = computePurchaseTotals([bill], { placeOfSupply: business.stateCode, businessState: business.stateCode, gstApplies: rate > 0 });
  if (Math.abs(totals.total - line.debit) > 0.01) {
    throw new Error(`At ${rate}% GST the expense comes to ${totals.total.toFixed(2)}, not ${line.debit.toFixed(2)}. Pick another GST rate.`);
  }
  const saved = purchasesDb.save({
    kind: 'EXPENSE',
    vendor_name: opts.vendorName.trim() || opts.category,
    bill_number: '',
    date: line.date,
    place_of_supply: business.stateCode || undefined,
    category: opts.category,
    lines: [bill],
    taxable: totals.taxable,
    cgst: totals.cgst,
    sgst: totals.sgst,
    igst: totals.igst,
    itc_eligible: opts.itcEligible && totals.tax > 0,
    total: totals.total,
    amount_paid: 0,
    notes: opts.notes?.trim() || 'From bank statement',
  });
  const payment = paymentsDb.record(saved.id, {
    amount: saved.total,
    date: line.date,
    method: methodForMode(inferMode(line.narration)),
    reference: referenceFor(line) || undefined,
  });
  return { bill: saved, payment };
}

/** Record a debit as a payment against an existing supplier bill. */
export function recordBillPaymentFromLine(line: BankLine, purchaseId: string, amount: number = lineAmount(line)) {
  if (!(line.debit > 0)) throw new Error('Only a debit can be recorded as a bill payment.');
  const bill = purchasesDb.get(purchaseId);
  if (!bill) throw new Error('That bill no longer exists.');
  const value = round2(num(amount));
  if (!(value > 0)) throw new Error('Enter an amount above zero.');
  if (value > balanceOf(bill) + 0.01) throw new Error(`The amount is more than the bill balance of ${balanceOf(bill).toFixed(2)}.`);
  return paymentsDb.record(purchaseId, {
    amount: value,
    date: line.date,
    method: methodForMode(inferMode(line.narration)),
    reference: referenceFor(line) || undefined,
  });
}
