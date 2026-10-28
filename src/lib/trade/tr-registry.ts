/**
 * Round 8 table registrations that live in first-paint maps (R8-C). `TABLE_ACTIONS` (access.ts) and `WATCHED_TABLES`
 * (audit-edits.ts) ship with the shell, so the Round 8 rows are added here, at runtime, by a lazy chunk instead of
 * growing first paint (Round 8 first-paint budget ≤ +0.1 kB). Every module that writes a Round 8 table imports this
 * file for its side effect (`import './tr-registry'`), and so do the lazy writers that touch every table: the
 * folder-sync engine (`sync-engine.ts`) and the recycle bin (`trust/recycle-bin.ts`). Backup lists, sync DATED /
 * NUMBERED and the open-export schema are ordinary static rows (those modules are lazy already).
 * `tests/tr-registry.test.ts` pins both maps to `TR_TABLES` / `TR_OBJECTS` and checks the importers.
 */
import { TABLE_ACTIONS, type AccessAction } from '../access';
import { WATCHED_TABLES, type WatchedTable } from '../audit-edits';

/** Role needed to write each Round 8 table / object (`requireTableWrite`). */
export const TR_TABLE_ACTIONS: Readonly<Record<string, AccessAction>> = {
  // R8-A: party rates and packaging types are masters; claims, price drops and interest runs are books; packaging
  // movements are documents; interest settings are a setting
  party_rates: 'master.edit',
  trade_claims: 'books.edit',
  price_drops: 'books.edit',
  interest_runs: 'books.edit',
  interest_settings: 'settings.manage',
  packaging_types: 'master.edit',
  packaging_moves: 'doc.create',
  // R8-B: bill-charge heads are a master; brokerage postings are books
  trade_charge_heads: 'master.edit',
  brokerage_postings: 'books.edit',
  // R8-C: arrivals and indents are documents; bikri pattis post journals (books); bank-statement terms and our 194Q
  // turnover are settings
  arrivals: 'doc.create',
  sale_pattis: 'books.edit',
  indents: 'doc.create',
  bank_statement_settings: 'settings.manage',
  tds_settings: 'settings.manage',
};

/** Audited tables (every row change logged; deletes go to the recycle bin). `bank_statement_settings` is not audited. */
export const TR_WATCHED: Readonly<Record<string, WatchedTable>> = {
  // R8-A
  party_rates: { entity: 'item', label: 'Party special rate' },
  trade_claims: { entity: 'payment', label: 'Trade claim' },
  price_drops: { entity: 'invoice', label: 'Price-drop run' },
  interest_runs: { entity: 'invoice', label: 'Interest run' },
  packaging_types: { entity: 'item', label: 'Packaging type' },
  packaging_moves: { entity: 'stock_transfer', label: 'Packaging movement' },
  // R8-B
  trade_charge_heads: { entity: 'item', label: 'Bill charge head' },
  brokerage_postings: { entity: 'voucher', label: 'Brokerage posting' },
  // R8-C
  arrivals: { entity: 'stock_transfer', label: 'Arrival' },
  sale_pattis: { entity: 'voucher', label: 'Bikri patti' },
  indents: { entity: 'invoice', label: 'Indent' },
};

/** Idempotent: adds the rows once (never overwrites a row another module set). */
export function registerTradeTables(): void {
  const actions = TABLE_ACTIONS as Record<string, AccessAction | readonly AccessAction[]>;
  const watched = WATCHED_TABLES as Record<string, WatchedTable>;
  for (const [t, a] of Object.entries(TR_TABLE_ACTIONS)) if (!actions[t]) actions[t] = a;
  for (const [t, w] of Object.entries(TR_WATCHED)) if (!watched[t]) watched[t] = w;
}

registerTradeTables();
