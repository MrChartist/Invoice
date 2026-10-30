/**
 * TR-B3 brokerage posting (loaded on demand from Distribution → Brokers): one `saveVoucher` journal Dr Brokerage |
 * Cr Sundry creditors (broker) | Cr TDS payable 194H, with the 194H row in the TDS register (`deduct194h`), and undo.
 * Working paper — verify with your CA (TR12, T15).
 */
import './tr-registry';
import type { BrokeragePosting } from '../../types/trade-r8';
import { requireAccess } from '../access';
import { isoDay } from '../dates';
import { generateId, getTable, setTable } from '../storage';
import { withTablesRollback } from '../table-txn';
import { A, chartOf, loadUserAccounts, saveUserAccount } from '../ledger/accounts';
import { deleteVoucher, saveVoucher } from '../ledger/vouchers';
import { deleteManualDeduction, fyQuarterOf } from '../tds-payables';
import { agentsDb, deduct194h, type SalesAgent } from '../sales-commission';

// Not imported from tr-brokers.ts (that would split the TR-B screen chunk): the caller passes the statement it shows.
const BROKERAGE_TABLE = 'brokerage_postings';
const BROKERAGE_LEDGER = 'Brokerage';
const loadBrokeragePostings = (): BrokeragePosting[] => getTable<BrokeragePosting>(BROKERAGE_TABLE).filter((p) => p && typeof p.id === 'string');

/** Save a broker (a `sales_agents` row of kind broker). */
export const saveBroker = (b: SalesAgent): SalesAgent => agentsDb.save({ ...b, kind: 'broker' });

function ensureLedger(): string {
  const chart = chartOf(loadUserAccounts());
  const found = chart.find((a) => a.name.toLowerCase() === BROKERAGE_LEDGER.toLowerCase());
  if (found) return found.id;
  const codes = new Set(chart.map((a) => a.code));
  let c = 6196;
  while (codes.has(String(c))) c++;
  return saveUserAccount({ code: String(c), name: BROKERAGE_LEDGER, group: 'INDIRECT_EXPENSES' }).id;
}

/**
 * Post brokerage payable for a broker and period (194H by default on brokers, §8 Q18). `st` is `brokerageStatement`
 * of that broker and period (tr-brokers.ts), worked out by the caller from live data.
 */
export function postBrokerage(b: SalesAgent, period: { from: string; to: string }, date: string, st: { total: number; lines: readonly unknown[] }): BrokeragePosting {
  requireAccess('books.edit');
  const brokerId = b.id;
  if (!isoDay(period.from) || !isoDay(period.to) || period.to < period.from || !isoDay(date)) throw new Error('Choose a valid period.');
  const all = loadBrokeragePostings();
  if (all.some((x) => x.broker_id === brokerId && x.from <= period.to && x.to >= period.from)) throw new Error(`Brokerage for ${b.name} is already posted for part of this period.`);
  if (!(st.total > 0)) throw new Error('No brokerage payable by us in this period.');
  const fy = fyQuarterOf(date)?.fy;
  const prior = all.filter((p) => p.broker_id === brokerId && fyQuarterOf(p.to)?.fy === fy).map((p) => ({ id: p.id, date: p.to, base: p.amount, tds: p.tds, code: '194H' }));
  return withTablesRollback([BROKERAGE_TABLE, 'vouchers', 'accounts', 'tds_deductions'], () => {
    const t = deduct194h(b, date, st.total, prior);
    const total = Math.round(st.total * 100);
    const tds = Math.round(t.amount * 100);
    const v = saveVoucher({
      type: 'JOURNAL',
      date,
      narration: `Brokerage payable to ${b.name} for ${period.from} to ${period.to} (${st.lines.length} document(s))${tds ? `, TDS u/s 194H ₹${t.amount.toFixed(2)}` : ''}: verify with your CA`,
      lines: [
        { account_id: ensureLedger(), dr: total, cr: 0 },
        { account_id: A.creditors, dr: 0, cr: total - tds, party: b.name },
        ...(tds ? [{ account_id: A.tds194h, dr: 0, cr: tds }] : []),
      ],
      voucher_class: 'Brokerage',
    });
    const row: BrokeragePosting = { id: generateId(), broker_id: b.id, broker_name: b.name, from: period.from, to: period.to, date, amount: st.total, tds: t.amount, tds_rate: t.rate, voucher_id: v.id, voucher_number: v.number, ...(t.rowId ? { tds_row_id: t.rowId } : {}), created_at: new Date().toISOString() };
    setTable(BROKERAGE_TABLE, [...all, row]);
    return row;
  });
}

/** Undo: the journal and the TDS-register row are deleted (period lock applies); the row goes to the recycle bin. */
export function deleteBrokeragePosting(id: string): void {
  requireAccess('books.edit');
  const row = loadBrokeragePostings().find((p) => p.id === id);
  if (!row) return;
  withTablesRollback([BROKERAGE_TABLE, 'vouchers', 'tds_deductions'], () => {
    deleteVoucher(row.voucher_id);
    if (row.tds_row_id) deleteManualDeduction(row.tds_row_id);
    setTable(BROKERAGE_TABLE, loadBrokeragePostings().filter((p) => p.id !== id));
  });
}
