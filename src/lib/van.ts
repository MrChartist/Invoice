/**
 * Van sales (8.82 — Marg / Gofrugal "van load · van settlement").
 *
 *  - A van is a godown with `kind: 'van'` (godowns master). Bills sold from the van name it as the line
 *    godown, so stock per godown shows what is still on the van.
 *  - Van load: a stock transfer from a godown to the van (`stock_transfers`, `STR/FY…`), notes "Van load".
 *  - Van settlement (`van_settlements`, `VST/FY<yy-yy>/<seq>`, series counters): at day end the unsold goods
 *    go back by a transfer van → godown, and the cash handed in is compared with the cash received on the
 *    day's van bills (plus collections the salesman brings for older bills). The settlement stores the
 *    figures and the return transfer's id; it posts nothing to the books (bills and payments already did).
 *
 * Writers check roles (`books.edit`), the period lock (by date) and audit. All-or-nothing: a settlement and
 * its return transfer are written together or not at all. Pure above "Storage".
 */

import type { InvoiceRecord, Payment } from '../types/invoice';
import type { StockTransfer, StockTransferLine } from '../types/stock';
import { num, round2 } from './invoice-calc';
import { fxRate } from './fx';
import { isRevenueDoc } from './stats';
import { lineFactor } from './units';
import { generateId, getTable, setTable } from './storage';
import { requireAccess } from './access';
import { assertUnlocked } from './period-lock';
import { audit } from './audit';
import { nextSeriesNumberFor, recordSeries } from './series-counters';
import { withTablesRollback } from './table-txn';
import { transfersDb, TRANSFERS_TABLE } from './godowns';

export const VAN_SETTLEMENTS_TABLE = 'van_settlements';
export const VAN_PREFIX = 'VST';

export interface VanSettlement {
  id: string;
  /** `VST/FY<yy-yy>/<seq>`. */
  number: string;
  /** yyyy-mm-dd */
  date: string;
  van_id: string;
  /** Godown the unsold goods returned to. */
  return_to: string;
  /** The van → godown transfer carrying the returned goods ('' when nothing came back). */
  return_transfer_id?: string;
  /** Van bills of the day and their value (₹). */
  bill_ids: string[];
  bills_total: number;
  /** Cash received on those bills that day (payment rows, method Cash). */
  cash_on_bills: number;
  /** Other collections the salesman handed in (older bills). */
  collections: number;
  /** Cash counted at the office. */
  cash_counted: number;
  /** counted − (cash on bills + collections); negative = short. */
  difference: number;
  notes?: string;
  created_at?: string;
}

/* ── Pure ─────────────────────────────────────────────────────── */

export interface VanDay {
  bills: InvoiceRecord[];
  billsTotal: number;
  cashOnBills: number;
  /** Quantity (base units) loaded per item id that day. */
  loaded: Record<string, number>;
}

/** The van's bills and loads on `date`: documents with a line leaving the van, payments in cash that day. */
export function vanDay(vanId: string, date: string, invoices: readonly InvoiceRecord[], payments: readonly Pick<Payment, 'invoice_id' | 'amount' | 'date' | 'method'>[], transfers: readonly StockTransfer[]): VanDay {
  const bills = invoices.filter((i) => i && isRevenueDoc(i) && String(i.issue_date).slice(0, 10) === date && (i.items ?? []).some((l) => l.godown_id === vanId));
  const ids = new Set(bills.map((b) => b.id));
  let billsTotal = 0;
  for (const b of bills) billsTotal += num(b.total) * (fxRate(b) ?? 0);
  const cashOnBills = payments.filter((p) => ids.has(p.invoice_id) && String(p.date).slice(0, 10) === date && /cash/i.test(String(p.method ?? ''))).reduce((s, p) => s + num(p.amount), 0);
  const loaded: Record<string, number> = {};
  for (const t of transfers) {
    if (t.to_godown !== vanId || t.date !== date) continue;
    for (const l of t.lines ?? []) loaded[l.item_id] = round2((loaded[l.item_id] ?? 0) + num(l.qty) * lineFactor(l));
  }
  return { bills, billsTotal: round2(billsTotal), cashOnBills: round2(cashOnBills), loaded };
}

export const settlementDifference = (counted: number, cashOnBills: number, collections: number): number => round2(num(counted) - num(cashOnBills) - num(collections));

/* ── Storage ──────────────────────────────────────────────────── */

export const vanSettlementsDb = {
  all: (): VanSettlement[] => getTable<VanSettlement>(VAN_SETTLEMENTS_TABLE).filter((r) => r && typeof r.id === 'string'),
  nextNumber: (date?: string): string => nextSeriesNumberFor(VAN_PREFIX, date, vanSettlementsDb.all().map((r) => r.number)),

  /** Van load: a transfer from `from` to the van. */
  load(input: { date: string; van_id: string; from: string; lines: StockTransferLine[]; notes?: string }): StockTransfer {
    requireAccess('books.edit');
    return transfersDb.save({ date: input.date, from_godown: input.from, to_godown: input.van_id, lines: input.lines, notes: input.notes?.trim() || 'Van load' });
  },

  /** Settle the van for a day: return transfer (if any lines) + the settlement record, together. */
  settle(input: { date: string; van_id: string; return_to: string; returns: StockTransferLine[]; collections?: number; cash_counted: number; notes?: string }): VanSettlement {
    requireAccess('books.edit');
    if (!input.date || !input.van_id) throw new Error('Choose the van and the date.');
    if (vanSettlementsDb.all().some((s) => s.van_id === input.van_id && s.date === input.date)) throw new Error('This van is already settled for that day.');
    const number = vanSettlementsDb.nextNumber(input.date);
    const state = assertUnlocked({ issue_date: input.date, invoice_number: number }, 'create');
    const day = vanDay(input.van_id, input.date, getTable<InvoiceRecord>('invoices'), getTable<Payment>('transactions'), transfersDb.all());
    return withTablesRollback([TRANSFERS_TABLE, VAN_SETTLEMENTS_TABLE, 'series_counters'], () => {
      const lines = input.returns.filter((l) => l.item_id && num(l.qty) > 0);
      const back = lines.length ? transfersDb.save({ date: input.date, from_godown: input.van_id, to_godown: input.return_to, lines, notes: `Van settlement ${number}` }) : undefined;
      const collections = round2(Math.max(num(input.collections), 0));
      const rec: VanSettlement = {
        id: generateId(), number, date: input.date, van_id: input.van_id, return_to: input.return_to,
        ...(back ? { return_transfer_id: back.id } : {}),
        bill_ids: day.bills.map((b) => b.id), bills_total: day.billsTotal, cash_on_bills: day.cashOnBills, collections,
        cash_counted: round2(num(input.cash_counted)), difference: settlementDifference(input.cash_counted, day.cashOnBills, collections),
        ...(input.notes?.trim() ? { notes: input.notes.trim() } : {}), created_at: new Date().toISOString(),
      };
      setTable(VAN_SETTLEMENTS_TABLE, [...vanSettlementsDb.all(), rec]);
      recordSeries(number);
      audit.record({
        entity: 'stock_transfer', entity_id: rec.id, action: 'create', doc_number: number,
        summary: `Van settlement ${number}: ${rec.bill_ids.length} bill(s) ₹${rec.bills_total.toFixed(2)}, cash counted ₹${rec.cash_counted.toFixed(2)} (difference ₹${rec.difference.toFixed(2)})${back ? `, goods back on ${back.transfer_number}` : ''}${state === 'overridden' ? ' (period lock overridden)' : ''}`,
      });
      return rec;
    });
  },

  /** Delete a settlement and its return transfer (period lock respected; audited). */
  remove(id: string): void {
    requireAccess('books.edit');
    const rec = vanSettlementsDb.all().find((r) => r.id === id);
    if (!rec) return;
    assertUnlocked({ issue_date: rec.date, invoice_number: rec.number }, 'delete');
    withTablesRollback([TRANSFERS_TABLE, VAN_SETTLEMENTS_TABLE], () => {
      if (rec.return_transfer_id) transfersDb.remove(rec.return_transfer_id, { confirmStock: true });
      setTable(VAN_SETTLEMENTS_TABLE, vanSettlementsDb.all().filter((r) => r.id !== id));
    });
    audit.record({ entity: 'stock_transfer', entity_id: id, action: 'delete', doc_number: rec.number, summary: `Deleted van settlement ${rec.number}` });
  },
};
