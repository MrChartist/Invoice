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
import { loadVouchers } from './vouchers';
import { loadSettings, loadPositions, type StockPosition } from '../inventory';
import { loadClosingStockConfig, stockValuerFor, type StockValuer } from './closing-stock';

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
 * none). Positions are only computed in inventory mode.
 */
export function loadStockValuer(positions?: StockPosition[], lazy?: () => StockPosition[]): StockValuer | undefined {
  let cached = positions;
  const get = () => (cached ??= lazy ? lazy() : loadPositions());
  return stockValuerFor(loadClosingStockConfig(), get, loadSettings().method);
}
