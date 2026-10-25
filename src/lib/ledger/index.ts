/**
 * Double-entry ledger (Phase 6.1–6.4) — public entry point. Lazy-loaded by the Books page only;
 * never import this from the app shell (bundle budget).
 */

import { loadBooksData, toIsoDate, type BooksData } from '../books';
import { loadChallans } from '../tds-payables';
import { loadUserAccounts } from './accounts';
import { loadAssets } from './assets';
import { buildLedger, type Ledger, type LedgerInput } from './postings';
import { loadVouchers } from './vouchers';

export * from './accounts';
export * from './assets';
export * from './budgets';
export * from './cost-centre-pnl';
export * from './postings';
export * from './ratios';
export * from './reports';
export * from './voucher-variants';
export * from './vouchers';

/** Everything the ledger needs, read from storage (fail-soft: empty tables give an empty ledger). */
export function loadLedgerInput(books: BooksData = loadBooksData(), today: string = toIsoDate(new Date())): LedgerInput {
  return { ...books, userAccounts: loadUserAccounts(), manual: loadVouchers(), assets: loadAssets(), today, challans: loadChallans() };
}

export function loadLedger(): Ledger {
  return buildLedger(loadLedgerInput());
}
