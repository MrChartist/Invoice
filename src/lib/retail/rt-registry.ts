/**
 * Round 9 (retail) table registrations that live in first-paint maps. `TABLE_ACTIONS` (access.ts) and `WATCHED_TABLES`
 * (audit-edits.ts) ship with the shell, so the Round 9 rows are added here, at runtime, by a lazy chunk (the R8
 * `tr-registry.ts` / R7 `hotel-registry.ts` pattern; Round 9 first-paint budget 0). Every module that writes a Round 9
 * table imports this file for its side effect (`import './rt-registry'`), and so do the lazy writers that touch every
 * table: the folder-sync engine (`sync-engine.ts`) and the recycle bin (`trust/recycle-bin.ts`).
 * `tests/rt-registry.test.ts` pins both maps to `RT_TABLES` / `RT_OBJECTS` and checks the importers.
 * One block per package (§6 of docs/prd/round-9.md): each package edits only its own block.
 */
import { TABLE_ACTIONS, type AccessAction } from '../access';
import { WATCHED_TABLES, type WatchedTable } from '../audit-edits';

/** Role needed to write each Round 9 table / object (`requireTableWrite`). */
export const RT_TABLE_ACTIONS: Readonly<Record<string, AccessAction>> = {
  // RT-A: riders are a master; rider settlements post cash journals (payment.record); the short book is a counter note
  delivery_riders: 'master.edit',
  rider_settlements: 'payment.record',
  short_book: 'doc.create',
  retail_settings: 'settings.manage',
  // RT-B
  doctors: 'master.edit',
  rx_refills: 'doc.create',
  // RT-C
  alteration_jobs: 'doc.create',
  // RT-D
  imei_checks: 'doc.create',
  finance_deals: 'doc.create',
  service_jobs: 'doc.create',
  // RT-E
  metal_rates: 'master.edit',
  jewel_tags: 'master.edit',
  karigar_moves: 'books.edit',
};

/** Audited tables (every row change logged; deletes go to the recycle bin). `retail_settings` is audited on save. */
export const RT_WATCHED: Readonly<Record<string, WatchedTable>> = {
  // RT-A
  delivery_riders: { entity: 'client', label: 'Delivery rider' },
  rider_settlements: { entity: 'payment', label: 'Rider settlement' },
  short_book: { entity: 'item', label: 'Short book entry' },
  // RT-B
  doctors: { entity: 'client', label: 'Doctor' },
  rx_refills: { entity: 'invoice', label: 'Refill schedule' },
  // RT-C
  alteration_jobs: { entity: 'invoice', label: 'Alteration job' },
  // RT-D
  imei_checks: { entity: 'item', label: 'IMEI check' },
  finance_deals: { entity: 'payment', label: 'Finance deal (DO)' },
  service_jobs: { entity: 'invoice', label: 'Service job' },
  // RT-E
  metal_rates: { entity: 'item', label: 'Metal rate' },
  jewel_tags: { entity: 'item', label: 'Jewellery tag' },
  karigar_moves: { entity: 'stock_transfer', label: 'Karigar issue / receipt' },
};

/** Idempotent: adds the rows once (never overwrites a row another module set). */
export function registerRetailTables(): void {
  const actions = TABLE_ACTIONS as Record<string, AccessAction | readonly AccessAction[]>;
  const watched = WATCHED_TABLES as Record<string, WatchedTable>;
  for (const [t, a] of Object.entries(RT_TABLE_ACTIONS)) if (!actions[t]) actions[t] = a;
  for (const [t, w] of Object.entries(RT_WATCHED)) if (!watched[t]) watched[t] = w;
}

registerRetailTables();

// QA10 (R6 / R8): a bill deleted / cancelled frees its exchange receipts and cancels its finance DO (`voidHook`).
import './rt-doc-hooks';
// R15-A3: the shared exchange roll-up, re-exported so netting.ts rides on this chunk.
export { exchangeSettled, ownFlow, syncNettedPaid } from './rt-doc-hooks';
