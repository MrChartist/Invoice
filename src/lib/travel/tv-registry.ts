/**
 * Round 15 (travel) table registrations that live in first-paint maps. `TABLE_ACTIONS` (access.ts) and
 * `WATCHED_TABLES` (audit-edits.ts) ship with the shell, so the Round 15 rows are added here, at runtime, by a lazy
 * chunk (the R8 `tr-registry.ts` … R14 `ps-registry.ts` pattern; first-paint budget 0). Every module that writes a
 * Round 15 table imports this file for its side effect (`import './tv-registry'`), and so do the lazy writers that
 * touch every table: the folder-sync engine (`sync-engine.ts`) and the recycle bin (`trust/recycle-bin.ts`).
 * `tests/tv-registry.test.ts` pins both maps and the importers. One block per package (§6 of docs/prd/round-15.md).
 */
import { TABLE_ACTIONS, type AccessAction } from '../access';
import { WATCHED_TABLES, type WatchedTable } from '../audit-edits';

/** Role needed to write each Round 15 table / object (`requireTableWrite`). */
export const TV_TABLE_ACTIONS: Readonly<Record<string, AccessAction>> = {
  // R15-B: the settings object is the owner's; bookings are documents
  travel_settings: 'settings.manage',
  travel_bookings: 'doc.create',
  // R15-C: statements are accounting checks (the bill they make is a purchase)
  supplier_statements: 'books.edit',
};

/** Audited tables (every row change logged; deletes go to the recycle bin). `travel_settings` is audited on save. */
export const TV_WATCHED: Readonly<Record<string, WatchedTable>> = {
  // R15-B
  travel_bookings: { entity: 'invoice', label: 'Travel booking' },
  // R15-C
  supplier_statements: { entity: 'purchase', label: 'Supplier statement' },
};

/** Idempotent: adds the rows once (never overwrites a row another module set). */
export function registerTravelTables(): void {
  const actions = TABLE_ACTIONS as Record<string, AccessAction | readonly AccessAction[]>;
  const watched = WATCHED_TABLES as Record<string, WatchedTable>;
  for (const [t, a] of Object.entries(TV_TABLE_ACTIONS)) if (!actions[t]) actions[t] = a;
  for (const [t, w] of Object.entries(TV_WATCHED)) if (!watched[t]) watched[t] = w;
}

registerTravelTables();
