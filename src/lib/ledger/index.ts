/**
 * Double-entry ledger (Phase 6.1–6.4) — public entry point. Lazy-loaded by the Books page only;
 * never import this from the app shell (bundle budget).
 */

import type { Client } from '../../types/invoice';
import { loadBooksData, toIsoDate, type BooksData } from '../books';
import { loadChallans } from '../tds-payables';
import { loadOpeningBills } from '../opening-bills';
import { getTable } from '../storage';
import { chartOf, loadUserAccounts } from './accounts';
import { loadAssets } from './assets';
import { loadBooksBegin, loadOpenings } from './openings';
import { buildLedger, type Ledger, type LedgerInput } from './postings';
import { dayBefore, type OpeningsInput } from './postings-openings';
import { loadVouchers, type ManualVoucher } from './vouchers';
import { loadSettings, loadPositions, type StockPosition } from '../inventory';
import { effectiveMode, loadClosingStockConfig, netOfStockJournals, netOfStockOpening, stockJournalPostings, stockValuerFor, type StockJournalPosting, type StockValuer } from './closing-stock';
import { loadPayrollPayments, loadRuns } from '../payroll/records';
import { loadBranches } from '../branch';

export * from './accounts';
export * from './assets';
export * from './budgets';
export * from './cost-centre-pnl';
export * from './groups';
export * from './ledger-interest';
export * from './openings';
export * from './postings';
export * from './postings-openings';
export * from './ratios';
export * from './reports';
export * from './voucher-variants';
export * from './vouchers';

/** Everything the ledger needs, read from storage (fail-soft: empty tables give an empty ledger). */
export function loadLedgerInput(books: BooksData = loadBooksData(), today: string = toIsoDate(new Date())): LedgerInput & OpeningsInput {
  return {
    ...books,
    userAccounts: loadUserAccounts(),
    manual: loadVouchers(),
    assets: loadAssets(),
    today,
    challans: loadChallans(),
    // WP-1 openings
    ledgerOpenings: loadOpenings(),
    openingBills: loadOpeningBills(),
    booksBegin: loadBooksBegin(today),
    clients: getTable<Client>('clients'),
    payrollRuns: loadRuns(),
    payrollPayments: loadPayrollPayments(),
    branches: loadBranches(), // WP-9: lets the reports narrow to a branch (`branch-books.ts`)
  };
}

export function loadLedger(): Ledger {
  return buildLedger(loadLedgerInput());
}

/** Stock positions from storage (inventory engine, company costing method) — read only. */
export function loadStockPositions(): StockPosition[] {
  return loadPositions();
}

/**
 * Closing-stock valuer per the company setting (inventory FIFO / weighted average, typed figures, or
 * none). Positions are only computed in inventory mode. Closing-stock journals already posted to an
 * Inventories ledger (the year-end wizard's class) are netted off, so a statement
 * never counts the stock twice (`netOfStockJournals`); so is an opening balance typed on an Inventories ledger
 * (`netOfStockOpening` — item openings are already in the valuation). Every statement screen (Books, Gateway Display,
 * ratios) must use this one function so they agree.
 */
export function loadStockValuer(positions?: StockPosition[], lazy?: () => StockPosition[], manual: readonly ManualVoucher[] = loadVouchers()): StockValuer | undefined {
  let cached = positions;
  const get = () => (cached ??= lazy ? lazy() : loadPositions());
  const today = toIsoDate(new Date());
  const raw = stockValuerFor(loadClosingStockConfig(), get, loadSettings().method);
  const stockIds = inventoryLedgerIds();
  return netOfStockOpening(netOfStockJournals(raw, stockJournalPostings(manual, today, stockIds)), stockLedgerOpening(stockIds), dayBefore(loadBooksBegin(today)));
}

/** Ids of the Inventories ledgers: Stock-in-hand and the user's own stock ledgers (review L5: one set for openings and journals). */
export function inventoryLedgerIds(): ReadonlySet<string> {
  return new Set(chartOf(loadUserAccounts()).filter((a) => a.group === 'INVENTORIES').map((a) => a.id));
}

/** Closing-stock journals in the books today (year-end wizard class, any Inventories ledger), with their branch tag. */
export function loadStockJournalPostings(manual: readonly ManualVoucher[] = loadVouchers()): StockJournalPosting[] {
  return stockJournalPostings(manual, toIsoDate(new Date()), inventoryLedgerIds());
}

/** Σ opening balances (debit-positive paise) of the Inventories ledgers (Stock-in-hand and user stock ledgers). */
function stockLedgerOpening(inventories: ReadonlySet<string> = inventoryLedgerIds()): number {
  return loadOpenings().reduce((s, o) => s + (inventories.has(o.ledger_id) ? o.dr - o.cr : 0), 0);
}

/**
 * Closing-stock journals that overlap report-time valuation (for the warning on P&L / BS and the
 * year-end wizard). Empty when valuation is off or no such journal is in the books.
 */
export function stockJournalConflicts(manual: readonly ManualVoucher[] = loadVouchers(), positions?: () => StockPosition[]): StockJournalPosting[] {
  const postings = loadStockJournalPostings(manual).filter((p) => p.delta > 0);
  if (!postings.length) return [];
  return effectiveMode(loadClosingStockConfig(), positions ?? (() => loadPositions())) === 'none' ? [] : postings;
}
