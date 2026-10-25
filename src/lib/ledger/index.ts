/**
 * Double-entry ledger (Phase 6.1–6.4) — public entry point. Lazy-loaded by the Books page only;
 * never import this from the app shell (bundle budget).
 */

import type { Client } from '../../types/invoice';
import { loadBooksData, toIsoDate, type BooksData } from '../books';
import { loadChallans } from '../tds-payables';
import { loadOpeningBills } from '../opening-bills';
import { getTable } from '../storage';
import { loadUserAccounts } from './accounts';
import { loadAssets } from './assets';
import { loadBooksBegin, loadOpenings } from './openings';
import { buildLedger, type Ledger, type LedgerInput } from './postings';
import type { OpeningsInput } from './postings-openings';
import { loadVouchers, type ManualVoucher } from './vouchers';
import { loadSettings, loadPositions, type StockPosition } from '../inventory';
import { effectiveMode, loadClosingStockConfig, netOfStockJournals, stockJournalPostings, stockValuerFor, type StockJournalPosting, type StockValuer } from './closing-stock';
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
 * none). Positions are only computed in inventory mode. Closing-stock journals already posted to
 * Stock-in-hand (year-end wizard, or a typed "closing stock" journal) are netted off, so a statement
 * never counts the stock twice (`netOfStockJournals`). Every statement screen (Books, Gateway Display,
 * ratios) must use this one function so they agree.
 */
export function loadStockValuer(positions?: StockPosition[], lazy?: () => StockPosition[], manual: readonly ManualVoucher[] = loadVouchers()): StockValuer | undefined {
  let cached = positions;
  const get = () => (cached ??= lazy ? lazy() : loadPositions());
  const raw = stockValuerFor(loadClosingStockConfig(), get, loadSettings().method);
  return netOfStockJournals(raw, stockJournalPostings(manual, toIsoDate(new Date())));
}

/**
 * Closing-stock journals that overlap report-time valuation (for the warning on P&L / BS and the
 * year-end wizard). Empty when valuation is off or no such journal is in the books.
 */
export function stockJournalConflicts(manual: readonly ManualVoucher[] = loadVouchers(), positions?: () => StockPosition[]): StockJournalPosting[] {
  const postings = stockJournalPostings(manual, toIsoDate(new Date())).filter((p) => p.delta > 0);
  if (!postings.length) return [];
  return effectiveMode(loadClosingStockConfig(), positions ?? (() => loadPositions())) === 'none' ? [] : postings;
}
