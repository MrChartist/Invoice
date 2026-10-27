/**
 * Round 13 (manufacturing) table registrations that live in first-paint maps. `TABLE_ACTIONS` (access.ts) and
 * `WATCHED_TABLES` (audit-edits.ts) ship with the shell, so the Round 13 rows are added here, at runtime, by a lazy chunk
 * (the R8 `tr-registry.ts` … R12 `ag-registry.ts` pattern; first-paint budget ≈ 0). Every module that writes a Round 13
 * table imports this file for its side effect (`import './mf-registry'`), and so do the lazy writers that touch every
 * table: the folder-sync engine (`sync-engine.ts`) and the recycle bin (`trust/recycle-bin.ts`).
 * `tests/mf-registry.test.ts` pins both maps and the importers. One block per package (§6 of docs/prd/round-13.md).
 */
import { TABLE_ACTIONS, type AccessAction } from '../access';
import { WATCHED_TABLES, type WatchedTable } from '../audit-edits';

/** Role needed to write each Round 13 table / object (`requireTableWrite`). */
export const MF_TABLE_ACTIONS: Readonly<Record<string, AccessAction>> = {
  // MF-A: work centres and routings are masters; job cards are documents
  mfg_settings: 'settings.manage',
  work_centres: 'master.edit',
  routings: 'master.edit',
  job_cards: 'doc.create',
  // MF-B: drawings are masters; inspection reports, quotes, runs and print estimates are documents
  drawings: 'master.edit',
  inspection_reports: 'doc.create',
  job_quotes: 'doc.create',
  process_runs: 'doc.create',
  print_estimates: 'doc.create',
  // MF-C: cut_plans (doc.create)
  // MF-D: cost_cards (master.edit), export_authorisations, incentive_claims (books.edit)
};

/** Audited tables (every row change logged; deletes go to the recycle bin). `mfg_settings` is audited on save. */
export const MF_WATCHED: Readonly<Record<string, WatchedTable>> = {
  // MF-A
  work_centres: { entity: 'item', label: 'Work centre' },
  routings: { entity: 'item', label: 'Routing' },
  job_cards: { entity: 'stock_transfer', label: 'Job card' },
  // MF-B
  drawings: { entity: 'item', label: 'Drawing' },
  inspection_reports: { entity: 'item', label: 'Inspection report' },
  job_quotes: { entity: 'invoice', label: 'Job quote sheet' },
  process_runs: { entity: 'stock_transfer', label: 'Moulding run' },
  print_estimates: { entity: 'invoice', label: 'Print estimate' },
  // MF-C
  // MF-D
};

/** Idempotent: adds the rows once (never overwrites a row another module set). */
export function registerMfgTables(): void {
  const actions = TABLE_ACTIONS as Record<string, AccessAction | readonly AccessAction[]>;
  const watched = WATCHED_TABLES as Record<string, WatchedTable>;
  for (const [t, a] of Object.entries(MF_TABLE_ACTIONS)) if (!actions[t]) actions[t] = a;
  for (const [t, w] of Object.entries(MF_WATCHED)) if (!watched[t]) watched[t] = w;
}

registerMfgTables();
