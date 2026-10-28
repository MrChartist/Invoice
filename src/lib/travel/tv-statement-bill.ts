/**
 * R15-C2 "Make bill": the one accounting event of a statement. The net payable (tickets less refunds / ACMs, plus
 * ADMs not disputed; commission already netted on a net-remit statement) becomes one purchase bill of the supplier,
 * dated the period end: fares at actual (no GST of ours, no ITC) and ADM charges as their own line.
 * It flows into payables, BRS and the Tally export unchanged; the consolidator's own GST invoice on its service charge
 * is entered as usual. Nothing posts before this. Working papers — verify with your CA.
 */
import './tv-registry';
import type { PurchaseLine, PurchaseRecord } from '../../types/purchases';
import type { SupplierStatement } from '../../types/travel-r15';
import { generateId, getTable } from '../storage';
import { round2 } from '../invoice-calc';
import { withTablesRollback } from '../table-txn';
import { purchasesDb } from '../purchases';
import { loadStatements, updateStatement } from './tv-statements';
import { TV_TABLES } from './tv-shared';

const line = (name: string, rate: number): PurchaseLine => ({ id: generateId(), name, quantity: 1, rate, tax_rate: 0 });

/** Pure: the bill a statement stands for (read back through `readPurchase` — tests/purchase-contract.test.ts). */
export function statementBill(st: SupplierStatement, v?: { name: string; gstin?: string }): Omit<PurchaseRecord, 'id'> {
  const net = st.totals.net;
  if (!(net > 0)) throw new Error('The supplier owes you on this statement — record their credit note instead.');
  const adm = round2(st.rows.filter((r) => r.flag === 'adm' && !r.disputed).reduce((s, r) => s + r.net, 0));
  const what = 'Fares and taxes at actual';
  const lines = adm > 0 && net - adm > 0 ? [line(`${what}, net of commission ₹${st.totals.commission.toFixed(2)}`, round2(net - adm)), line('ADM charges', adm)] : [line(what, net)];
  return {
    kind: 'EXPENSE', vendor_id: st.vendor_id, vendor_name: v?.name ?? 'Supplier', ...(v?.gstin ? { vendor_gstin: v.gstin } : {}),
    bill_number: st.ref || `${st.kind.toUpperCase()} ${st.period_end}`, date: st.period_end, category: 'Travel bookings',
    lines, taxable: net, cgst: 0, sgst: 0, igst: 0, itc_eligible: false, total: net, amount_paid: 0,
    notes: `Supplier statement ${st.period_start} – ${st.period_end}. Verify with your CA.`, created_at: new Date().toISOString(),
  };
}

/** Make the statement's purchase bill (`books.edit`, period lock through the bill). Returns the bill. */
export function makeStatementBill(id: string): PurchaseRecord {
  const st = loadStatements().find((s) => s.id === id);
  if (!st) throw new Error('This statement is no longer on the list.');
  if (st.bill_id && purchasesDb.get(st.bill_id)) throw new Error('The bill of this statement is made already.');
  const draft = statementBill(st, getTable<{ id: string; name: string; gstin?: string }>('vendors').find((x) => x.id === st.vendor_id));
  return withTablesRollback(['purchases', TV_TABLES.statements], () => {
    const bill = purchasesDb.save(draft);
    updateStatement(id, (s) => ({ ...s, bill_id: bill.id }));
    return bill;
  });
}
