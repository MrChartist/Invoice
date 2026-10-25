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
  idle timeout, session, `last_backup`, `storage_backend`, interface language `lang` (5.4)) and the
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
| `transactions` | core | `Payment` (payments received; `advance_id` marks an advance adjusted against the invoice, not new money; additive `receipt_number` stamped at record time) |
| `vendors` | purchases | `Vendor` (`src/types/purchases.ts`) |
| `purchases` | purchases | `PurchaseRecord` |
| `recurring` | recurring | defined by that module |
| `reminders` | reminders-share | defined by that module |
| `doc_links` | documents | defined by that module |
| `stock_items` | inventory | `StockItem` (`src/lib/inventory.ts`); opt-in `track_batches` / `track_serials` / `warranty_months` / `opening_serials`; additive `barcode` (6.7); additive `aliases` (earlier names, recorded on rename); `min_order_qty` / `reorder_by_godown` (Phase 7) |
| `stock_moves` | inventory | `StockMove` (manual adjustments), additive `godown_id` / `batch_no` / `mfg_date` / `expiry_date` / `serials` |
| `godowns` | inventory (6.10) | `Godown` (`src/types/stock.ts`); the default "Main" godown is implicit (stored only if renamed) |
| `stock_transfers` | inventory (6.10) | `StockTransfer` vouchers `STR/FY<yy-yy>/<seq>` between godowns; quantity only, never posted to Books / ledger |
| `boms` | manufacturing (Phase 7, `src/lib/manufacturing.ts`) | `Bom` (`src/types/manufacturing.ts`): components per `batch_qty` finished units (scrap %, godown), by-/co-products / scrap, `is_default` per item |
| `manufacturing_vouchers` | manufacturing (Phase 7) | `ManufacturingVoucher` `MFG/FY<yy-yy>/<seq>`: finished item + qty, consumed lines (batch / godown), outputs, additional costs, display-only `cost_snapshot`; read by the stock engine, never by Books / ledger |
| `stock_journals` | manufacturing (Phase 7) | `StockJournal` `SJ/FY<yy-yy>/<seq>`: source → destination lines (conversion / repacking). Godown-only moves are refused here and saved as `stock_transfers` |
| `physical_stock` | manufacturing (Phase 7) | `PhysicalStockVoucher` `PHY/FY<yy-yy>/<seq>`: counted lines with `book_qty` and `diff` fixed at save; the diff is posted as an adjustment at the end of that day |
| `einvoice_meta` | einvoice | defined by that module |
| `design_prefs` | templates-studio | defined by that module |
| `purchase_payments` | purchases | `{id, purchase_id, amount, date, method, reference}`; additive `tds_amount` (TDS deducted on the payment) and `group_id` (multi-bill payment) (Phase 7) |
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
| `gstr4_manual` | GST reports (composition, 5.9) | `Gstr4Manual` typed-in GSTR-4 Tables 7-9 (TDS/TCS credit rows, tax / interest / late fee paid, refund claimed, GSTR-4 filing date), one row per FY × GSTIN, `id` = `${fyStart}|${GSTIN}` (`src/lib/gstr4-annual.ts`) |
| `compliance` | compliance (GST) | `FiledReturn` marks: GST return filed per form / period / GSTIN (`docs/features/compliance.md`) |
| `accounts` | ledger | user-added `Account` rows (`src/lib/ledger/accounts.ts`); default accounts are constants, never stored |
| `vouchers` | ledger | manual `ManualVoucher` rows, amounts in integer paise (`src/lib/ledger/vouchers.ts`); additive variant fields `variant` (OPTIONAL / MEMO), `post_dated`, `reverse_on`, `voucher_class`, `regularised_at` (Phase 7) |
| `cheques` | cheques (6.26) | `Cheque` (`src/types/cheques.ts`) — received / issued cheques, lifecycle, linked payment ids (`docs/features/cash-planning.md`) |
| `advances` | advances (5.3) | `AdvanceRecord` (`src/types/advances.ts`) — advance receipt vouchers `ADV/FY…`, GST snapshot, refunds `RFV/FY…`; adjustments are `transactions` rows with `advance_id` (`docs/features/advances.md`) |
| `cheque_print` | cheques (6.26) | cheque print layout + mm offsets (object, `src/lib/cheque-print.ts`) |
| `groups` | masters (WP-1) | `UserGroup` rows: user groups / sub-groups under the Schedule III primaries (`src/lib/ledger/accounts.ts`, `docs/features/masters.md`) |
| `ledger_openings` | masters (WP-1) | `LedgerOpening` `{ledger_id, dr, cr}` in paise, one per account / party ledger (`src/lib/ledger/openings.ts`) |
| `books_begin` | masters (WP-1) | one row `{id: 'books_begin', date}`: books beginning date of the openings |
| `opening_bills` | masters (WP-1) | `OpeningBill` bill-wise opening outstandings per party, receivable / payable (`src/lib/opening-bills.ts`) |
| `fixed_assets` | ledger | `FixedAsset` register rows (`src/lib/ledger/assets.ts`) |
| `closing_stock` | reports engine | closing-stock source `{mode?, opening?, entries}` — one JSON object, not rows (`src/lib/ledger/closing-stock.ts`); report prefs / period are device-local outside the prefix |
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
| `series_counters` | numbering (`src/lib/series-counters.ts`) | `SeriesCounter {id: 'STR/FY26-27', seq}`: highest sequence ever issued per voucher series × FY (STR / PO / ADV / RFV / RCPT), so a deleted latest number is never reused. Backed up (`RECORD_TABLES` / `ID_TABLES`); written alongside a guarded save (`TABLE_ACTIONS`: `books.edit`) |
| `employees` / `employee_groups` | payroll (Phase 7, `src/lib/payroll/store.ts`) | `Employee` / `EmployeeGroup` (`src/types/payroll.ts`); owner-only (`payroll.view`) — `docs/features/payroll.md` |
| `pay_heads` | payroll | `PayHead` (Tally calculation types; starter set `ph_*` used until the first save) |
| `salary_structures` | payroll | `SalaryStructure` per employee or group with `effective_from` |
| `attendance_types` / `attendance` | payroll | production types; monthly LOP days + units per employee |
| `payroll_runs` | payroll | `PayrollRun` with a payslip snapshot per employee; final runs post a Payroll voucher (`PRL/FY…`) to the ledger, derived on the fly |
| `payroll_payments` | payroll | `PayrollPayment` salary / PF / ESI / PT / TDS payments (`PYP/FY…`) clearing the payables |
| `payroll_settings` (object) | payroll | PF establishment code, ESI employer code, TAN |
| `pos_day_close` | POS (6.8, `src/lib/pos.ts`) | `PosDayClose` cash-drawer count per day (opening float, expected / counted cash, difference, tender totals); POS bills themselves are normal `invoices` with `pos: true` (`docs/features/pos-barcode-pricing.md`) |
| `tds_challans` | TDS on payables (Phase 7, `src/lib/tds-payables.ts`) | `TdsChallan` ITNS 281 challan (TDS / TCS, BSR code, serial, date, tax / interest / fee / others, `deduction_keys` it deposits); posted to the ledger as a payment (`docs/features/tds-payables.md`) |
| `tds_deductions` | TDS on payables (Phase 7) | `ManualTdsDeduction` register-only deductions booked outside bills (not posted to the ledger) |
| `tds_returns` | TDS on payables (Phase 7) | `TdsReturnMark` filed marks `26Q:<fy>-Q<n>` / `27EQ:…` with filing date and token |
| `vendor_payments` | bill-wise payables (Phase 7, `src/lib/billwise.ts`) | `VendorPayment` (`src/types/purchases.ts`): supplier Advance / On Account / New Ref money not yet against a bill, with `allocations` adjusting it against bills later |
| `purchase_returns` | purchase returns (WP-3, `src/lib/purchase-returns.ts`) | `PurchaseReturn` (`src/types/purchases.ts`): debit notes `DN/FY…` and supplier credit notes received, Agst Ref the bill via `adjusted_amount` (`docs/features/purchase-returns.md`) |
| `receipt_notes` | receipt notes (WP-3, `src/lib/receipt-notes.ts`) | `ReceiptNote`: GRN `GRN/FY…` (stock in before the bill) and Rejections Out `RJO/FY…`; billed qty derived from bill lines' `grn_line_id` |
| `deposit_slips` | banking (WP-5, `src/lib/deposit-slip.ts`) | `DepositSlip` pay-in slips `PIS/FY<yy-yy>/<seq>`: cheque ids, cash denomination counts, totals (`docs/features/banking.md`) |
| `cash_tally` | banking (WP-5, `src/lib/cash-tally.ts`) | `CashTally` day-end cash count by denomination vs the Books cash balance, one row per day |
| `pos_returns` | POS returns (WP-9, `src/lib/pos-returns.ts`) | `PosReturn` per return: bill, credit note, settlement (`refund` / `exchange` / `account`), refunds by tender, voucher id, exchange bill; read by the Z report (`docs/features/business-extras.md`) |
| `approvals` | approvals (WP-9, `src/lib/approvals.ts`) | `ApprovalLogRow` decision log (approved / rejected, by whom, note); the live state is `approval` on the invoice. Policy object under the key `approval_policy` |
| `branches` | branches (WP-9, `src/lib/branch.ts`) | `Branch {id, name, code?, gstin?, state_code?, profile_id?, godown_id?, address?, inactive?}`; additive `branch_id` on invoices / purchases / vouchers |
| `loyalty_adjustments` | loyalty (WP-9, `src/lib/loyalty.ts`) | manual points corrections; accrual is derived from invoices, redemption is `loyalty_redeem` on the bill. Programme object under the key `loyalty_program` (date-keyed rules) |
| `amc_contracts` | AMC (WP-9, `src/lib/amc.ts`) | `AmcContract` with `visits` log, `renewed_from` link |

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
