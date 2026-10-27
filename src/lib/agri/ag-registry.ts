/**
 * Round 12 (agriculture) table registrations that live in first-paint maps. `TABLE_ACTIONS` (access.ts) and
 * `WATCHED_TABLES` (audit-edits.ts) ship with the shell, so the Round 12 rows are added here, at runtime, by a lazy chunk
 * (the R8 `tr-registry.ts` / R9 `rt-registry.ts` / R10 `sv-registry.ts` / R11 `cn-registry.ts` pattern; first-paint
 * budget ≈ 0). Every module that writes a Round 12 table imports this file for its side effect
 * (`import './ag-registry'`), and so do the lazy writers that touch every table: the folder-sync engine
 * (`sync-engine.ts`) and the recycle bin (`trust/recycle-bin.ts`). `tests/ag-registry.test.ts` pins both maps and the
 * importers. One block per package (§6 of docs/prd/round-12.md): each package edits only its own block.
 */
import { TABLE_ACTIONS, type AccessAction } from '../access';
import { WATCHED_TABLES, type WatchedTable } from '../audit-edits';

/** Role needed to write each Round 12 table / object (`requireTableWrite`). */
export const AG_TABLE_ACTIONS: Readonly<Record<string, AccessAction>> = {
  // AG-A: batches and cycles are documents (closing / paying a cycle checks `books.edit`); quality tables are masters
  agri_settings: 'settings.manage',
  farm_batches: 'doc.create',
  quality_cut_tables: 'master.edit',
  farmer_cycles: 'doc.create',
  // AG-B: rate charts are masters; shifts, dispatches and milk cards are documents
  milk_rate_charts: 'master.edit',
  milk_shifts: 'doc.create',
  milk_dispatches: 'doc.create',
  milk_cards: 'doc.create',
  // AG-C: mills — weighbridge slips and custom-milling agreements (documents)
  weighbridge_slips: 'doc.create',
  cmr_agreements: 'doc.create',
  // AG-D: cold_lots (doc.create), cold_rent_plans (master.edit), agri_loans, member_shares (books.edit)
};

/** Audited tables (every row change logged; deletes go to the recycle bin). `agri_settings` is audited on save. */
export const AG_WATCHED: Readonly<Record<string, WatchedTable>> = {
  // AG-A
  farm_batches: { entity: 'item', label: 'Farm batch' },
  quality_cut_tables: { entity: 'item', label: 'Quality-cut table' },
  farmer_cycles: { entity: 'invoice', label: 'Farmer cycle bill' },
  // AG-B
  milk_rate_charts: { entity: 'item', label: 'Milk rate chart' },
  milk_shifts: { entity: 'stock_transfer', label: 'Milk collection shift' },
  milk_dispatches: { entity: 'stock_transfer', label: 'Milk dispatch' },
  milk_cards: { entity: 'invoice', label: 'Milk card' },
  // AG-C
  weighbridge_slips: { entity: 'item', label: 'Weighbridge slip' },
  cmr_agreements: { entity: 'client', label: 'Custom-milling agreement' },
  // AG-D
};

/** Idempotent: adds the rows once (never overwrites a row another module set). */
export function registerAgriTables(): void {
  const actions = TABLE_ACTIONS as Record<string, AccessAction | readonly AccessAction[]>;
  const watched = WATCHED_TABLES as Record<string, WatchedTable>;
  for (const [t, a] of Object.entries(AG_TABLE_ACTIONS)) if (!actions[t]) actions[t] = a;
  for (const [t, w] of Object.entries(AG_WATCHED)) if (!watched[t]) watched[t] = w;
}

registerAgriTables();
