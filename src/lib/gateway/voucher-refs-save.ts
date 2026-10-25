/**
 * Writes for Gateway bill-wise references (7.19). The receivable side reuses `saveReceiptVoucher`
 * (bill-allocation.ts, already all-or-nothing); the payable side records a supplier payment through
 * `billwise.ts` inside one table rollback, so a refused bill (lock, balance) leaves nothing behind.
 */
import { billwisePayables, recordSupplierPayment, vendorPaymentsDb, type SupplierPaymentInput } from '../billwise';
import { openRefsFor } from '../bill-allocation';
import { paymentsDb, purchasesDb } from '../purchases';
import { getTable } from '../storage';
import { withTablesRollback } from '../table-txn';
import { vendorsDb } from '../vendors';
import type { PurchaseReturn } from '../../types/purchases';
import { fromOpenRefs, type OpenBill } from './voucher-refs';

/** Open bills of the party on the given side, oldest due first. */
export function openBillsFor(side: 'receivable' | 'payable', party: string, voucherId?: string): OpenBill[] {
  if (side === 'receivable') return fromOpenRefs(openRefsFor(party, voucherId));
  const key = party.trim().toLowerCase();
  const parties = billwisePayables({
    purchases: purchasesDb.all(),
    payments: paymentsDb.all(),
    vendorPayments: vendorPaymentsDb.all(),
    vendors: vendorsDb.all(),
    returns: getTable<PurchaseReturn>('purchase_returns'),
    asOf: '9999-12-31',
  });
  const p = parties.find((x) => x.vendor.trim().toLowerCase() === key);
  return (p?.bills ?? []).map((b) => ({ id: b.purchaseId, ref: b.number || b.purchaseId, date: b.date, due: b.due, outstanding: b.balance }));
}

/** Record the supplier payment and its bill allocations as ONE change. */
export function saveSupplierPayment(input: SupplierPaymentInput) {
  return withTablesRollback(['purchase_payments', 'purchases', 'vendor_payments'], () => recordSupplierPayment(input));
}
