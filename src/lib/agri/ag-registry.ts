/**
 * Round 12 (agriculture) table registrations that live in first-paint maps. `TABLE_ACTIONS` (access.ts) and
 * `WATCHED_TABLES` (audit-edits.ts) ship with the shell, so the Round 12 rows are added here, at runtime, by a lazy
 * chunk (the `tr-registry.ts` / `rt-registry.ts` / `cn-registry.ts` pattern). Every module that writes a Round 12 table
 * imports this file for its side effect (`import './ag-registry'`), and so do the lazy writers that touch every table:
 * the folder-sync engine (`sync-engine.ts`) and the recycle bin (`trust/recycle-bin.ts`). One block per package.
 *
 * Minimum compatible version written by AG-D before AG-A landed (AG-D's block and `agri_settings`); AG-A owns this file.
 */
import { TABLE_ACTIONS, type AccessAction } from '../access';
import { WATCHED_TABLES, type WatchedTable } from '../audit-edits';

/** Role needed to write each Round 12 table / object (`requireTableWrite`). */
export const AG_TABLE_ACTIONS: Readonly<Record<string, AccessAction>> = {
  agri_settings: 'settings.manage',
  // AG-D
  cold_lots: 'doc.create',
  cold_rent_plans: 'master.edit',
  agri_loans: 'books.edit',
  member_shares: 'books.edit',
};

/** Audited tables (every row change logged; deletes go to the recycle bin). `agri_settings` is audited on save. */
export const AG_WATCHED: Readonly<Record<string, WatchedTable>> = {
  // AG-D
  cold_lots: { entity: 'invoice', label: 'Cold-storage lot' },
  cold_rent_plans: { entity: 'item', label: 'Storage rent plan' },
  agri_loans: { entity: 'payment', label: 'Loan against stored produce' },
  member_shares: { entity: 'payment', label: 'Member share entry' },
};

/** Idempotent: adds the rows once (never overwrites a row another module set). */
export function registerAgriTables(): void {
  const actions = TABLE_ACTIONS as Record<string, AccessAction | readonly AccessAction[]>;
  const watched = WATCHED_TABLES as Record<string, WatchedTable>;
  for (const [t, a] of Object.entries(AG_TABLE_ACTIONS)) if (!actions[t]) actions[t] = a;
  for (const [t, w] of Object.entries(AG_WATCHED)) if (!watched[t]) watched[t] = w;
}

registerAgriTables();
