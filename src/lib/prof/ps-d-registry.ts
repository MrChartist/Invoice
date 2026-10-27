/**
 * Round 14 PS-D table registrations (the D block of PS-A's `ps-registry.ts`, PRD §6): `TABLE_ACTIONS` (access.ts) and
 * `WATCHED_TABLES` (audit-edits.ts) ship with the shell, so the rows are added here, at runtime, by a lazy chunk (the
 * `mf-registry.ts` pattern; first-paint bytes 0). Every module that writes a PS-D table imports this file for its side
 * effect (`import './ps-d-registry'`), and so do the lazy all-table writers (`sync-engine.ts`, `trust/recycle-bin.ts`).
 */
import { TABLE_ACTIONS, type AccessAction } from '../access';
import { WATCHED_TABLES, type WatchedTable } from '../audit-edits';

/** Role needed to write each PS-D table (`requireTableWrite`). */
export const PS_D_TABLE_ACTIONS: Readonly<Record<string, AccessAction>> = {
  partners: 'settings.manage',
  partner_runs: 'books.edit',
  udin_register: 'doc.create',
};

/** Audited tables (every row change logged; deletes go to the recycle bin). */
export const PS_D_WATCHED: Readonly<Record<string, WatchedTable>> = {
  partners: { entity: 'settings', label: 'Partner' },
  partner_runs: { entity: 'voucher', label: 'Partner posting' },
  udin_register: { entity: 'item', label: 'UDIN' },
};

/** Idempotent: adds the rows once (never overwrites a row another module set). */
export function registerPsDTables(): void {
  const actions = TABLE_ACTIONS as Record<string, AccessAction | readonly AccessAction[]>;
  const watched = WATCHED_TABLES as Record<string, WatchedTable>;
  for (const [t, a] of Object.entries(PS_D_TABLE_ACTIONS)) if (!actions[t]) actions[t] = a;
  for (const [t, w] of Object.entries(PS_D_WATCHED)) if (!watched[t]) watched[t] = w;
}

registerPsDTables();
