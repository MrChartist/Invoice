# Architecture & module contract

Mr. Chartist Invoice is a **local-first, serverless** React 19 + TypeScript + Vite SPA.
Everything lives in the browser behind `src/lib/storage.ts`: data tables in IndexedDB behind a synchronous
in-memory cache (localStorage when IndexedDB is unavailable), device-local keys in localStorage.

## Storage layer (Phase 4.2)
- **Backends.** `initStorage()` runs in `main.tsx` before the first render and before any data is read. It
  opens the app's single IndexedDB database (`mrchartist_inv_kv`, store `data`; the older `kv` store keeps the
  folder handle / backup key / safety snapshot) through one shared connection (`src/lib/idb-kv.ts`) and loads
  every `mrchartist_inv_*` data key into a `Map`. `readRaw/writeRaw/removeRaw/getTable/setTable/getJson/setJson`
  keep their synchronous signatures and serve that map. Without IndexedDB (Node tests, some private modes, or
  before the first successful move) the same functions talk to localStorage exactly as before.
- **Keys.** Every key name is unchanged; values are the same JSON strings. Device-local keys (`DEVICE_LOCAL_KEYS`
  in `storage.ts`: PIN credential, lockout guard, local users `auth_users` + their lockouts `auth_guard_users` (6.21),
  idle timeout, session, `last_backup`, `storage_backend`) and the
  non-prefixed `theme` always stay in localStorage. Modules must not touch `localStorage` directly for app data.
- **Write-through.** A write updates the map at once and is queued; the queue commits in one IndexedDB
  transaction on the next task, and immediately on `pagehide` / `visibilitychange: hidden`. Paths that reload
  right after a bulk change (restore, erase, forgot-PIN reset, sample data) call `reloadAfterFlush()`.
- **Failures.** localStorage writes still throw `StorageWriteError` synchronously. An IndexedDB commit that fails
  keeps the change in memory, sets `storageFailure()` (the layout shows a long-lived error toast) and is retried
  with the next write; while the failure is a quota error, writes that would grow a key throw
  `StorageWriteError(quotaExceeded)` synchronously, so the screens show their usual "storage is full" message.
- **One-time move.** Until `mrchartist_inv_storage_backend = 'idb'` is set, localStorage is the truth: all its data
  keys are written to IndexedDB in one transaction with a `__meta__` marker, read back and compared, and only then
  is the marker set and the localStorage copy removed. Any failure or timeout leaves localStorage untouched and the
  session on localStorage; the next boot retries. After the move, a data key found in localStorage (an outdated tab
  still running old code) is imported only if IndexedDB lacks it, otherwise dropped. If IndexedDB cannot be opened
  on a device whose data has moved, the app shows "Your data could not be opened" instead of starting empty.
- **Cross-tab.** IndexedDB fires no `storage` events, so after each commit the tab posts the changed keys on the
  `mrchartist_inv_sync` BroadcastChannel; other tabs re-read those keys into their map (unless they hold an unsaved
  write for the key) and `cross-tab.ts` shows "Updated in another tab" as before.
- **Readers.** Backup (`collectAppData`), restore, wipe, migrations and storage health all go through the same
  functions, so they read the cache. Storage health uses the browser's IndexedDB quota estimate instead of ~5 MB.
- **Companies (6.20).** Each company is its own IndexedDB database with the same keys inside: the main company is
  `mrchartist_inv_kv`, others `mrchartist_inv_kv__<id>`. The device-local registry `mrchartist_inv_companies`
  (localStorage, never in a backup) lists them and the active one; `idb-kv.ts` opens the active company's
  database, the sync BroadcastChannel is per company, and switching flushes and reloads. Backups, restore, erase,
  vault mode, the folder-backup link and the undo copy are therefore per company with no extra code. localStorage
  copies (pre-4.2 data, stale tabs) are only ever imported into the main company. Forgot-PIN reset deletes every
  company's database (`eraseOtherCompanies`); Erase clears the open company only.
- **Vault mode (5.8).** Optional encryption at rest (`src/lib/vault.ts`). Every value in the `data` store is sealed
  (`mcv1:<iv>:<ct>`, AES-GCM-256, the key name as additional data) with a random data key; that key is wrapped
  (AES-KW) under a PBKDF2-SHA-256 (600k) passphrase key and stored as the `__vault__` record next to the data.
  With a record present `initStorage()` returns `locked`, `main.tsx` shows `VaultUnlock`, and `unlockStorage()`
  decrypts everything into the same map; the synchronous API is unchanged. Flushes seal values after checking
  the record's id (a tab whose vault was removed or re-created elsewhere refuses to write and is told to
  reload); enable / disable re-write the whole store in one transaction (verified by read-back) and broadcast
  `{ vault: 'changed' }` so other tabs reload. Unsealed values found while unlocking are accepted and re-sealed.
  The restore undo copy in the `kv` store is sealed too; Erase / Forgot-PIN drop the vault (`forgetVault`).
- **Folder sync (5.7).** Optional, per company (`docs/features/sync.md`): encrypted snapshot files in a
  user-picked cloud-synced folder, one file per device. Changes are found at sync time by per-row hashes against
  `sync_state` (nothing on the save path), merged by table + row id with version vectors and Lamport clocks; concurrent
  edits become conflicts the user resolves. Sync bookkeeping (`SYNC_META_KEYS` in `storage.ts`) lives in the company
  database (sealed in vault mode) but never in a backup or the undo copy; restore / erase remove it. The device id is
  the device-local key `sync_device`.
- **Rule for new code.** No module evaluated before `initStorage()` (i.e. statically imported by `main.tsx` /
  `App.tsx`) may read storage at module level; read inside functions, effects or lazily loaded modules.

## Ground rules (every module)
1. No backend, no network calls, no analytics. No new runtime dependencies.
2. Vanilla CSS + CSS Modules only; colours/spacing come from tokens in `src/index.css`
   (never hard-code hex in components). Reuse `src/styles/surface.module.css`,
   `src/styles/controls.module.css` and `src/components/ui/*`.
3. Persisted field names are snake_case and **additive only** — never rename/remove.
4. New persisted data = a new table via `getTable/setTable` (`src/lib/storage.ts`),
   key `mrchartist_inv_<table>`. Backup/restore picks every `mrchartist_inv_*` key up
   automatically.
5. Money maths goes through `src/lib/invoice-calc.ts` (`round2`, `num`); never use raw
   floating-point sums for display values.
6. Pure logic lives in `src/lib/*.ts` with `node:test` tests in `tests/*.test.ts`
   (`npm test`, Node ≥ 22, no browser APIs in tested modules).
7. Indian FY numbering (`INV/FY25-26/0001`) is fixed — do not change it.

## Tables (`mrchartist_inv_<table>`, IndexedDB-backed cache or localStorage)
| table | owner module | shape |
|---|---|---|
| `invoices` | core | `InvoiceRecord` (`src/types/invoice.ts`) |
| `clients` | core | `Client` |
| `items_catalog` | core | `InvoiceItem`; additive catalogue-only `barcode` / `sku` / `mrp` (6.7) and `qty_slabs` (6.9) |
| `transactions` | core | `Payment` (payments received; `advance_id` marks an advance adjusted against the invoice, not new money) |
| `vendors` | purchases | `Vendor` (`src/types/purchases.ts`) |
| `purchases` | purchases | `PurchaseRecord` |
| `recurring` | recurring | defined by that module |
| `reminders` | reminders-share | defined by that module |
| `doc_links` | documents | defined by that module |
| `stock_items` | inventory | `StockItem` (`src/lib/inventory.ts`); opt-in `track_batches` / `track_serials` / `warranty_months` / `opening_serials`; additive `barcode` (6.7) |
| `stock_moves` | inventory | `StockMove` (manual adjustments), additive `godown_id` / `batch_no` / `mfg_date` / `expiry_date` / `serials` |
| `godowns` | inventory (6.10) | `Godown` (`src/types/stock.ts`); the default "Main" godown is implicit (stored only if renamed) |
| `stock_transfers` | inventory (6.10) | `StockTransfer` vouchers `STR/FY<yy-yy>/<seq>` between godowns; quantity only, never posted to Books / ledger |
| `einvoice_meta` | einvoice | defined by that module |
| `design_prefs` | templates-studio | defined by that module |
| `purchase_payments` | purchases | `{id, purchase_id, amount, date, method, reference}` |
| `purchase_orders` | purchases (POs) | `PurchaseOrder` (`src/types/purchases.ts`); received qty derived from bills with `po_id` (`src/lib/purchase-orders.ts`) |
| `audit_log` | audit | `AuditEntry` (`src/types/audit.ts`) — written by `localDb` mutations, capped at 5,000 rows |
| `bank_statements` | reconcile | imported statement lines + match state (`docs/features/reconcile-reports.md`) |
| `book_opening` | books | opening cash/bank balances |
| `export_prefs` | exports | last-used export options |
| `notif_state` | notifications | read / snoozed / dismissed notice ids |
| `tds_certificates` | receivables (TDS) | Form 16A received flag per deductor × quarter (`TdsCertificate`, `src/lib/tds-register.ts`) |
| `gstr2b_actions` | GST reports (2B match) | `Gstr2bAction` IMS decision per return period + section + supplier GSTIN + normalised document no. (`src/lib/gstr2b.ts`) |
| `time_entries` | time (6.13) | `TimeEntry` (`src/types/time.ts`); billed state derived from `invoiced_in` (`docs/features/time-expenses.md`) |
| `mileage` | time (6.14) | `MileageEntry` (`src/types/time.ts`), same derived billing |
| `compliance` | compliance (GST) | `FiledReturn` marks: GST return filed per form / period / GSTIN (`docs/features/compliance.md`) |
| `accounts` | ledger | user-added `Account` rows (`src/lib/ledger/accounts.ts`); default accounts are constants, never stored |
| `vouchers` | ledger | manual `ManualVoucher` rows, amounts in integer paise (`src/lib/ledger/vouchers.ts`) |
| `cheques` | cheques (6.26) | `Cheque` (`src/types/cheques.ts`) — received / issued cheques, lifecycle, linked payment ids (`docs/features/cash-planning.md`) |
| `advances` | advances (5.3) | `AdvanceRecord` (`src/types/advances.ts`) — advance receipt vouchers `ADV/FY…`, GST snapshot, refunds `RFV/FY…`; adjustments are `transactions` rows with `advance_id` (`docs/features/advances.md`) |
| `cheque_print` | cheques (6.26) | cheque print layout + mm offsets (object, `src/lib/cheque-print.ts`) |
| `fixed_assets` | ledger | `FixedAsset` register rows (`src/lib/ledger/assets.ts`) |
| `cost_centres` | cost centres (6.16) | `CostCentre` master (`src/lib/cost-centres.ts`); documents point at it via optional `cost_centre_id` (`docs/features/cost-centres-budgets.md`) |
| `budgets` | budgets (6.17) | `Budget` rows: FY × account × optional cost centre, 12 monthly amounts in paise (`src/lib/ledger/budgets.ts`) |
| `assets` | storage (`src/lib/assets.ts`) | `{id, data}`: logo / signature data URLs stored once, keyed by content hash (schema v3) |
| `att_<id>` (one key per file) | attachments (6.12, `src/lib/attachments.ts`) | `{id, mime, size, created_at, data}`: a receipt photo / PDF stored once by content hash; referenced by `attachments: AttachmentRef[]` on `invoices` / `purchases` (and the draft). Not a table: one key per file so a write commits only that file (`listKeys` enumerates them) |
| `sync_state` | folder sync (5.7) | object: Lamport clock, per-key row versions `{h,t,d,vv,o,del}`, peers, declined locked-period changes, last report. **Not backed up** (`SYNC_META_KEYS`) |
| `sync_conflicts` | folder sync (5.7) | `SyncConflict[]` (`src/lib/sync-engine.ts`): both versions of a concurrently edited row / singleton, locked-period changes, duplicate numbers. **Not backed up** |
| `sync_audit` | folder sync (5.7) | `{ [deviceId]: { name, rows: AuditEntry[] } }`: other devices' audit chains, kept apart so each verifies on its own. **Not backed up** |
| `custom_fields` | custom fields (6.23, `src/lib/custom-fields.ts`) | `CustomFieldDef` (`src/types/custom-fields.ts`); values live on the records: `custom_fields` map on clients / vendors / catalogue items, `custom_values` snapshot on invoices and their lines |
| `price_levels` | pricing (6.9, `src/lib/pricing.ts`) | `PriceLevel {id, name, percent_off?, rates?}` (rates keyed by catalogue item id); clients point at one via optional `price_level` |
| `schemes` | pricing (6.9) | `Scheme` buy-X-get-Y rows (item, buy / free qty, optional date window, `active`); free goods are ₹0 invoice lines (`scheme_id`, `free_of`) |
| `pos_day_close` | POS (6.8, `src/lib/pos.ts`) | `PosDayClose` cash-drawer count per day (opening float, expected / counted cash, difference, tender totals); POS bills themselves are normal `invoices` with `pos: true` (`docs/features/pos-barcode-pricing.md`) |

### Snapshot images by reference (schema v3)
Invoice and recurring `sender` snapshots store `logo` / `signature` as `asset:<id>` instead of the data URL; the
image lives once in `assets`. `setTable('invoices' | 'recurring')` interns inline images (assets written first, so a
reference never dangles) and `getTable` resolves references back to the identical data URL, so every reader —
templates, preview, PDF, client copy, e-invoice print — receives exactly what was saved (Critical Rule 3). Code that
reads these tables must go through `getTable` (or `localDb`), never `JSON.parse(readRaw(...))`. The id is a
synchronous content hash (length + two 32-bit passes) because `setTable` is synchronous (`crypto.subtle` is
async-only); interning compares full content and suffixes `~n` on a collision, so a reference cannot resolve to
the wrong image. A reference with no asset resolves to `''` (no image). Profiles in `settings` keep their own
inline image. Unreferenced assets (after deleting invoices) are not pruned yet.

## Schema versions & migrations

`mrchartist_inv_schema_version` holds the last migration applied. `runMigrations()` (`src/lib/migrations.ts`) runs
in `main.tsx` before the first render: a fresh install is stamped with the latest version, existing data runs each
newer migration in order, a throwing migration rolls every key back and leaves the version unchanged, and data from
a newer app version is never touched. Restores reload the page, so restored data is migrated the same way.
To change a stored shape, append a `Migration` (next version number, idempotent, additive, never changes what an
invoice's `sender` snapshot renders) and cover it in `tests/migrations.test.ts`.

| version | migration |
|---|---|
| 1 | flat settings → multi-profile shape |
| 2 | audit log: seal pre-chain rows with a `chain_start` anchor (4.5) |
| 3 | inline snapshot logos / signatures (`invoices`, `recurring`) → `assets` table + `asset:<id>` references, deduplicated by content. Raw-JSON based, idempotent, leaves unresolvable references and unreadable tables untouched; rolls back with the rest of the run on failure (`tests/assets.test.ts`). |

## Integration
Feature modules are **self-contained**: they export a page/component and (optionally) a pure
`lib` API. The lead wires routes, navigation and cross-links in the shared shell
(`src/App.tsx`, `src/layouts/DashboardLayout.tsx`, `src/pages/*`). Feature agents must not
edit shared shell files; describe the exact wiring in `docs/features/<module>.md`.
