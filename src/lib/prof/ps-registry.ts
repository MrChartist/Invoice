/**
 * Round 14 (professional firms) table registrations that live in first-paint maps. `TABLE_ACTIONS` (access.ts) and
 * `WATCHED_TABLES` (audit-edits.ts) ship with the shell, so the Round 14 rows are added here, at runtime, by a lazy chunk
 * (the R8 `tr-registry.ts` … R13 `mf-registry.ts` pattern; first-paint budget ≈ 0). Every module that writes a Round 14
 * table imports this file for its side effect (`import './ps-registry'`), and so do the lazy writers that touch every
 * table: the folder-sync engine (`sync-engine.ts`) and the recycle bin (`trust/recycle-bin.ts`).
 * `tests/ps-registry.test.ts` pins both maps and the importers. One block per package (§6 of docs/prd/round-14.md).
 */
import { TABLE_ACTIONS, type AccessAction } from '../access';
import { WATCHED_TABLES, type WatchedTable } from '../audit-edits';

/** Role needed to write each Round 14 table / object (`requireTableWrite`). */
export const PS_TABLE_ACTIONS: Readonly<Record<string, AccessAction>> = {
  // PS-A: engagements are documents; conflict checks are masters
  prof_settings: 'settings.manage',
  engagements: 'doc.create',
  conflict_checks: 'master.edit',
  // PS-B: client-money vouchers post journals (books)
  client_money: 'books.edit',
  // PS-C: the EDF register is books (FEMA working paper)
  edf_register: 'books.edit',
  // PS-D: partners are owner data; partner postings are books; the UDIN register is documents
  partners: 'settings.manage',
  partner_runs: 'books.edit',
  udin_register: 'doc.create',
};

/** Audited tables (every row change logged; deletes go to the recycle bin). `prof_settings` is audited on save. */
export const PS_WATCHED: Readonly<Record<string, WatchedTable>> = {
  // PS-A
  engagements: { entity: 'invoice', label: 'Engagement' },
  conflict_checks: { entity: 'client', label: 'Conflict check' },
  // PS-D
  partners: { entity: 'settings', label: 'Partner' },
  partner_runs: { entity: 'voucher', label: 'Partner posting' },
  udin_register: { entity: 'item', label: 'UDIN' },
  // PS-B
  client_money: { entity: 'payment', label: 'Client-money voucher' },
  // PS-C
  edf_register: { entity: 'payment', label: 'EDF (export of services)' },
};

/** Idempotent: adds the rows once (never overwrites a row another module set). */
export function registerProfTables(): void {
  const actions = TABLE_ACTIONS as Record<string, AccessAction | readonly AccessAction[]>;
  const watched = WATCHED_TABLES as Record<string, WatchedTable>;
  for (const [t, a] of Object.entries(PS_TABLE_ACTIONS)) if (!actions[t]) actions[t] = a;
  for (const [t, w] of Object.entries(PS_WATCHED)) if (!watched[t]) watched[t] = w;
}

registerProfTables();
