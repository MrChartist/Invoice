/**
 * TR-C4 live readers for the bank stock statement and HSN-wise stock (storage in, pure inputs out). Lazy: only the
 * two Reports / Inventory tabs import this module.
 */
import type { InvoiceRecord } from '../../types/invoice';
import type { PurchaseReturn } from '../../types/purchases';
import type { Godown } from '../../types/stock';
import type { BankStatementTerms } from '../../types/trade-r8';
import { computeStock, computeStockDetailed, liveInputs } from '../inventory';
import { computeTracking } from '../stock-tracking';
import { stockGroupsDb } from '../stock-groups';
import { loadLedger, loadStockValuer } from '../ledger';
import { closingBalances } from '../ledger/reports';
import { bankLedgerId } from '../bank-ledgers';
import { A } from '../ledger/accounts';
import { billwisePayables, vendorPaymentsDb } from '../billwise';
import { paymentsDb, purchasesDb } from '../purchases';
import { vendorsDb } from '../vendors';
import { loadPayableOpeningBills } from '../opening-bills';
import { loadReceivablesInput } from '../khata-actions';
import { buildReceivables } from '../receivables';
import { parseDay } from '../dates';
import { getTable } from '../storage';
import { round2 } from '../invoice-calc';
import { GODOWNS_TABLE, godownList } from '../godowns';
import { toUqc } from '../gst-reports';
import { agencySales, loadArrivals, lotBalances } from './tr-arrivals';
import type { StockStatementInput } from './tr-stock-statement';
import { hsnStock, type HsnStockRow } from './tr-hsn-stock';

/** Creditors for goods on `asOf`: unpaid purchase bills (kind PURCHASE) and supplier opening bills, bill-wise. */
export function creditorsForGoods(asOf: string): number {
  const purchases = purchasesDb.all();
  const goods = new Set(purchases.filter((p) => (p.kind ?? 'PURCHASE') === 'PURCHASE').map((p) => p.id));
  const parties = billwisePayables({ purchases, payments: paymentsDb.all(), vendorPayments: vendorPaymentsDb.all(), vendors: vendorsDb.all(), asOf, returns: getTable<PurchaseReturn>('purchase_returns'), openingBills: loadPayableOpeningBills(vendorsDb.all()) });
  return round2(parties.reduce((t, p) => t + p.bills.filter((b) => b.opening || goods.has(b.purchaseId)).reduce((s, b) => s + Math.max(b.balance, 0), 0), 0));
}

/** Whole days from `a` to `b` (local days). */
const daysBetween = (a: string, b: string) => Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / 86_400_000);

/** Open sales bills on `asOf` (documents and receipts after that day left out), aged by bill date. */
export function debtorsAsOf(asOf: string): { age: number; amount: number }[] {
  const input = loadReceivablesInput();
  const report = buildReceivables(
    {
      ...input,
      invoices: input.invoices.filter((i) => String(i.issue_date).slice(0, 10) <= asOf),
      payments: input.payments.filter((p) => String(p.date ?? '').slice(0, 10) <= asOf),
      advances: (input.advances ?? []).filter((a) => String(a.date ?? '').slice(0, 10) <= asOf),
    },
    { now: new Date(`${asOf}T12:00:00`) },
  );
  return report.parties.flatMap((p) => p.bills.map((b) => ({ age: daysBetween(b.issueDate.slice(0, 10), asOf), amount: round2(b.outstanding) })));
}

/** Everything the drawing-power working needs for `asOf` and the chosen cash-credit account. */
export function loadStockStatementInput(asOf: string, bankAccountId: string, terms: BankStatementTerms): StockStatementInput & { valuerLabel?: string } {
  const inputs = { ...liveInputs(), asOf };
  const positions = computeStock(inputs);
  const groups = new Map(stockGroupsDb.all().map((g) => [g.id, g.name]));
  const byGroup = new Map<string, number>();
  for (const p of positions) {
    if (!(Math.abs(p.value) > 0.004)) continue;
    const name = (p.item.group_id && groups.get(p.item.group_id)) || 'Primary';
    byGroup.set(name, round2((byGroup.get(name) ?? 0) + p.value));
  }
  const valuer = loadStockValuer(undefined, () => computeStockDetailed(liveInputs()).positions);
  const engineTotal = round2([...byGroup.values()].reduce((t, v) => t + v, 0));
  const stockTotal = valuer ? round2(valuer.value(asOf)) : engineTotal;
  // Principals' goods: lot balance × the lot's average agency sale rate so far (a memo, never in our stock).
  const lots = lotBalances(loadArrivals().filter((a) => a.status !== 'cancelled' && a.date <= asOf), agencySales(getTable<InvoiceRecord>('invoices')), asOf);
  const consignment = round2(lots.reduce((t, l) => t + (l.sold > 0 && l.balance > 0 ? (l.amount / l.sold) * l.balance : 0), 0));
  const ledger = loadLedger();
  const id = bankAccountId ? bankLedgerId(bankAccountId) : A.bankOd;
  const bal = closingBalances(ledger, asOf).get(id) ?? 0;
  return {
    asOf,
    groups: [...byGroup].map(([name, value]) => ({ name, value })).sort((a, b) => a.name.localeCompare(b.name)),
    stockTotal,
    consignment,
    creditors: creditorsForGoods(asOf),
    debtors: debtorsAsOf(asOf),
    terms,
    outstanding: round2(Math.max(-bal, 0) / 100),
    ...(valuer && Math.abs(stockTotal - engineTotal) > 0.5 ? { valuerLabel: valuer.label } : {}),
  };
}

/** HSN × godown rows as on `asOf`, and the godown names. */
export function loadHsnStock(asOf: string): { rows: HsnStockRow[]; godownName: (id: string) => string } {
  const inputs = { ...liveInputs(), asOf };
  const positions = computeStock(inputs);
  const tracking = computeTracking(inputs);
  const godowns = godownList(getTable<Godown>(GODOWNS_TABLE));
  const rows = hsnStock(positions.filter((p) => p.item.track_stock).map((p) => ({ hsn: p.item.hsn, unit: toUqc(p.item.unit, p.item.hsn ?? ''), qty: p.qty, value: p.value, byGodown: tracking.get(p.item.id)?.byGodown })));
  return { rows, godownName: (id) => godowns.find((g) => g.id === id)?.name ?? id };
}
