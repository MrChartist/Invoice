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
  Viewing preferences of one device use keys outside the prefix (`mrchartist_*`, never backed up or synced; full list in
  `AGENTS.md`), e.g. Rounds 2–3 `mrchartist_statement_prefs` (R2-A statement style), `mrchartist_display_prefs` (R2-C
  text size / contrast / motion, read by `public/theme-init.js` before first paint), `mrchartist_kot_printers` (R3-A KOT
  printer per station), `mrchartist_editor_layout` (R3-C live preview), `mrchartist_checklist_default` (R3-C) and
  `mrchartist_pos_branch` (R4-B3 "This counter is branch …"); Round 6 (R6-A) `mrchartist_help_strips` ("About this
  tab" strips on / off), `mrchartist_whats_new_seen` (last What's-new version shown), `mrchartist_feedback_draft`
  (unsent "Report a problem" draft), `mrchartist_tips_seen` / `mrchartist_tips_off` (one-time screen tips). The R6-B
  Demo-company flag `mrchartist_demo_pending` may read `id|business_type|pack,pack`. Rounds 4–6 add no
  `DEVICE_LOCAL_KEYS` entry.
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
- **Table-write hook (WP-7).** `setTable` reports each successful write to ONE observer installed with
  `onTableWrite(hook)` — `(name, prevRaw, rows)`; `writeRaw` does not report. Only the audit edit log
  (`src/lib/audit-edits.ts`) uses it; errors in the observer are swallowed so it never breaks a save.
  Since R4-C4 the same observer copies whole deleted rows of every watched table into `recycle_bin` (`binRows`;
  bookkeeping tables `doc_links`, `year_end`, `books_begin`, `gstr*` aside). A delete therefore reaches the bin only
  through `setTable` / the data-layer calls (`localDb.invoices.remove` bins invoices itself), never through `writeRaw`.
- **Parsed-rows cache (PERF-1).** Each table is parsed once per stored version (keyed on the identity of the
  stored string, plus the asset table for snapshot tables), so a `setTable`, `writeRaw`, restore, sync merge or
  another tab's change is seen by the very next read. `peekTable` returns the shared rows (read-only);
  `getTable` returns a new array of new top-level rows (`{ ...row }`) over them, so callers may push / splice /
  sort and assign row fields as before, but must replace nested values (`items`, `sender`, `client` …) rather
  than mutate them in place. In dev builds and under `node --test` the shared rows are deep-frozen, so such a
  write throws. `setTable` seeds the next version from the rows it was given (cached rows and
  unchanged `getTable` copies are reused, other rows go through a JSON round trip), so a save never parses the
  table back. In `table-memo.ts` (outside the shell): `tableStamp(...)` is a cheap version token, `memoOnTables(id, tables, fn, extra)` /
  `memoOnReads(id, fn, extra)` memoise derived results (the latter on every key `fn` read, nested memos
  included) — results are shared and read-only; `storageVersion()` moves on any write (the notification bell
  reuses its providers' result while it and the day are unchanged, recomputing at least every 5 minutes).
  `tableParseCount` / `resetParseCounts` are test seams. `storageVersion()`, `peekTable` and the freeze live in
  `storage.ts`; memoised results are frozen the same way, so treat them as read-only too. Hot readers on big tables
  (bell providers, stock engine, Books, dashboards) should read through `peekTable` + a memo instead of `getTable`.
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
| `invoices` | core | `InvoiceRecord` (`src/types/invoice.ts`); additive Rounds 2–4 fields: `payment_terms` snapshot, `note_kind: 'financial'` / `financial_reason` / `financial_account` (R2-A `FCN/FY…` notes); `milestones`, `progress_of`, `revision_of` / `revision_no`, `proposal_sections`, `attention`, line `optional` / `selected` / `alt_group` / `progress_line_of` (R2-B, `src/types/sales-r2.ts`); `table_order_id`, `split_of`, line `modifier_of` / `note` / `seat` (R3-A); `annexure` timesheet snapshot (R3-B4); `delivery_proof`, line `image` (R3-C2); export fields `incoterm` / `port_of_loading` / `port_of_discharge` / `country_of_origin` / `country_of_destination` / `pre_carriage` / `vessel_flight` / `marks_numbers` / `export_payment_terms` (R4-C1, `src/types/trade-r4.ts`); `channel_id` / `channel_order_id` / `channel_import_id` (R5-A3); `lr_ids`, `ra_no` / `ra_final` / `boq_id` / `ra_deductions` / `ra_net_payable` / `retention_release_on` / `boq_terms`, line `boq_ref` (R5-B, `src/types/transport-works-r5.ts`); `fee_plan_id` / `fee_instalment` (R5-C1). Every new key is in `RECORD_KEYS` / `normalizeRecord` |
| `clients` | core | `Client`; additive `payment_terms_id` / `reminder_mode` (R2-A), `contacts` / `addresses` (R2-B), `doc_defaults` (R3-B5), `gst_tds_deductor` (R5-B5), `roll_no` / `class_label` / `guardian` / `enrolments` / `donor` (R5-C1 / C3) |
| `items_catalog` | core | `InvoiceItem`; additive catalogue-only `barcode` / `sku` / `mrp` (6.7) and `qty_slabs` (6.9); `net_weight` / `gross_weight` / `weight_unit` (R2-C4); `unavailable_on` (R3-A "86") |
| `transactions` | core | `Payment` (payments received; `advance_id` marks an advance adjusted against the invoice, not new money; additive `receipt_number` stamped at record time). Rows that moved no money: `gift_voucher_id` (R4-B1), `deposit_adjustment_id` (R5-C6) and `ra_journal_id` (R5-B5, with `ra_kind`) — cash / bank readers skip them; additive `trip_id` (R5-B3) |
| `vendors` | purchases | `Vendor` (`src/types/purchases.ts`); additive `transporter_194c6` (R5-B3 194C(6) declaration) |
| `purchases` | purchases | `PurchaseRecord`; additive `boe_duty` (R4-C3 Bill of Entry snapshot + `voucher_id`), `trip_id` (R5-B3), `itc_use` (R5-C2 Rule 42 / 43; absent = common) |
| `recurring` | recurring | defined by that module; additive `lease_id` / `escalation` (R5-C5) |
| `reminders` | reminders-share | defined by that module |
| `doc_links` | documents | defined by that module |
| `stock_items` | inventory | `StockItem` (`src/lib/inventory.ts`); opt-in `track_batches` / `track_serials` / `warranty_months` / `opening_serials`; additive `barcode` (6.7); additive `aliases` (earlier names, recorded on rename); `min_order_qty` / `reorder_by_godown` (Phase 7); `group_id` / `category_id` / `alt_units` / `standard_costs` / `selling_prices` (WP-8); `net_weight` / `gross_weight` / `weight_unit` (R2-C4); `qc_on_receipt` (R4-A4) |
| `stock_moves` | inventory | `StockMove` (manual adjustments), additive `godown_id` / `batch_no` / `mfg_date` / `expiry_date` / `serials`; `unit` / `unit_factor` (7M alternate units) |
| `godowns` | inventory (6.10) | `Godown` (`src/types/stock.ts`); the default "Main" godown is implicit (stored only if renamed); additive `parent_id` (WP-8 hierarchy); `job_worker` / `vendor_id` (7M: a job worker's premises — still our stock); `kind` is the shared union `van` / `expiry` / `wip` / `qc` / `transit` / `site` (R4-A adds the "Shop floor (WIP)" and "QC hold" godowns, R5-B6 works sites); `nonSaleableGodowns` = expiry / wip / qc / transit / site; additive `replenish_from` (R4-B5), `boq_id` / `cost_centre_id` (R5-B6) |
| `stock_transfers` | inventory (6.10) | `StockTransfer` vouchers `STR/FY<yy-yy>/<seq>` between godowns; quantity only, never posted to Books / ledger; lines take `unit` / `unit_factor` (7M); additive `production_order_id` (R4-A issue / return / QC release); `request_id` / `leg` (`out` dispatch / `in` receipt, R4-B4) |
| `boms` | manufacturing (Phase 7, `src/lib/manufacturing.ts`) | `Bom` (`src/types/manufacturing.ts`): components per `batch_qty` finished units (scrap %, godown), by-/co-products / scrap, `is_default` per item |
| `manufacturing_vouchers` | manufacturing (Phase 7) | `ManufacturingVoucher` `MFG/FY<yy-yy>/<seq>`: finished item + qty, consumed lines (batch / godown), outputs, additional costs, display-only `cost_snapshot`; read by the stock engine, never by Books / ledger; additive `production_order_id` (R4-A output) |
| `stock_journals` | manufacturing (Phase 7) | `StockJournal` `SJ/FY<yy-yy>/<seq>`: source → destination lines (conversion / repacking). Godown-only moves are refused here and saved as `stock_transfers`; additive `production_order_id` (R4-A WIP write-off); `request_id` (R4-B4 transit loss); `cost_centre_id` (R5-B6 site consumption) |
| `job_work_orders` | job work (7M, `src/lib/job-work.ts`) | `JobWorkOrder` `JWO/FY<yy-yy>/<seq>` (`src/types/job-work.ts`): direction out / in, party, process, goods expected back, BOM (`docs/features/job-work.md`) |
| `job_work_out` | job work (7M) | `MaterialOut` `JWC/FY…`: Rule 55 challan to a job worker; goods move to the job worker's godown (read by the stock engine through `events-job-work.ts`) |
| `job_work_in` | job work (7M) | `MaterialIn` `JWR/FY…`: consumed / processed / scrap / returned / lost / 5C-supplied lines, job charges (stock cost only) |
| `job_work_principal` | job work (7M) | `PrincipalMovement` `JWP/FY…`: principal's goods received / returned (Job Work In; never our stock) |
| `rejections_in` | sales (7M, `src/lib/rejections-in.ts`) | `RejectionIn` `RJI/FY…`: goods a customer rejected from a delivery challan before invoicing; stock back, challan balance reduced |
| `physical_stock` | manufacturing (Phase 7) | `PhysicalStockVoucher` `PHY/FY<yy-yy>/<seq>`: counted lines with `book_qty` and `diff` fixed at save; the diff is posted as an adjustment at the end of that day |
| `production_plans` | manufacturing (7S, `src/lib/mrp.ts`) | `ProductionPlan` `PP/FY<yy-yy>/<seq>`: planned finished items; the material requirement (MRP) is recomputed live from default BOMs, stock and open POs / GRNs — moves no stock, posts nothing |
| `einvoice_meta` | einvoice | defined by that module; additive `eway_generated_at`, `eway_cargo`, `eway_distance_km`, `vehicle_history[]`, `transporter_history[]` (R3-C5 e-Way desk; validity rules in `src/lib/eway-validity.ts`) |
| `design_prefs` | templates-studio | defined by that module; additive `labels` / `labels_by_type` / `title_suffix` (R2-C5), `show_item_images`, `margins_mm`, `letterhead`, `footer_image` (R3-C; artwork stored in `assets`) |
| `purchase_payments` | purchases | `{id, purchase_id, amount, date, method, reference}`; additive `tds_amount` (TDS deducted on the payment) and `group_id` (multi-bill payment) (Phase 7) |
| `purchase_orders` | purchases (POs) | `PurchaseOrder` (`src/types/purchases.ts`); received qty derived from bills with `po_id` (`src/lib/purchase-orders.ts`) |
| `audit_log` | audit | `AuditEntry` (`src/types/audit.ts`) — written by module calls and, for every books / masters table, by the `onTableWrite` edit log (WP-7, `src/lib/audit-edits.ts`); past 5,000 live rows the oldest move to an archive segment |
| `audit_archive_<nnnn>` (one key per segment) | audit (WP-7) | `AuditEntry[]`: archived oldest rows, still hash-chained with the live log (`audit.fullRows()`), in backups, not synced (`docs/features/migration-audit.md`) |
| `year_end` | year-end (WP-7, `src/lib/year-end.ts`) | `YearEndRecord {id: 'FY25-26', marks}`: reviewed year-end checklist steps per FY (R4-C5 adds the `auditor_pack` step) |
| `bank_statements` | reconcile | imported statement lines + match state (`docs/features/reconcile-reports.md`) |
| `book_opening` | books | opening cash/bank balances |
| `export_prefs` | exports | last-used export options |
| `notif_state` | notifications | read / snoozed / dismissed notice ids |
| `tds_certificates` | receivables (TDS) | Form 16A received flag per deductor × quarter (`TdsCertificate`, `src/lib/tds-register.ts`) |
| `gstr2b_actions` | GST reports (2B match) | `Gstr2bAction` IMS decision per return period + section + supplier GSTIN + normalised document no. (`src/lib/gstr2b.ts`); additive `itc_reduction` / `declared_itc` / `remark` (R2-C3 IMS) |
| `time_entries` | time (6.13) | `TimeEntry` (`src/types/time.ts`); billed state derived from `invoiced_in` (`docs/features/time-expenses.md`); additive `work_type_id` / `task_id` (R3-B1/B2) and `retainer_id` / `retainer_period` (stamped on retainer close, R3-B3) |
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
| `cost_centres` | cost centres (6.16) | `CostCentre` master (`src/lib/cost-centres.ts`); documents point at it via optional `cost_centre_id` (`docs/features/cost-centres-budgets.md`); additive project fields `hourly_rate` / `budget_minutes` / `fee_budget` / `start` / `due` / `status` (R3-B2); kinds `vehicle` (R5-B3) and `fund` with additive `fund` details (R5-C4) |
| `budgets` | budgets (6.17) | `Budget` rows: FY × account × optional cost centre, 12 monthly amounts in paise (`src/lib/ledger/budgets.ts`) |
| `assets` | storage (`src/lib/assets.ts`) | `{id, data}`: logo / signature data URLs stored once, keyed by content hash (schema v3) |
| `att_<id>` (one key per file) | attachments (6.12, `src/lib/attachments.ts`) | `{id, mime, size, created_at, data}`: a receipt photo / PDF stored once by content hash; referenced by `attachments: AttachmentRef[]` on `invoices` / `purchases` (and the draft). Not a table: one key per file so a write commits only that file (`listKeys` enumerates them) |
| `sync_state` | folder sync (5.7) | object: Lamport clock, per-key row versions `{h,t,d,vv,o,del}`, peers, declined locked-period changes, last report. **Not backed up** (`SYNC_META_KEYS`) |
| `sync_conflicts` | folder sync (5.7) | `SyncConflict[]` (`src/lib/sync-engine.ts`): both versions of a concurrently edited row / singleton, locked-period changes, duplicate numbers. **Not backed up** |
| `sync_audit` | folder sync (5.7) | `{ [deviceId]: { name, rows: AuditEntry[] } }`: other devices' audit chains, kept apart so each verifies on its own. **Not backed up** |
| `custom_fields` | custom fields (6.23, `src/lib/custom-fields.ts`) | `CustomFieldDef` (`src/types/custom-fields.ts`); values live on the records: `custom_fields` map on clients / vendors / catalogue items, `custom_values` snapshot on invoices and their lines |
| `price_levels` | pricing (6.9, `src/lib/pricing.ts`) | `PriceLevel {id, name, percent_off?, rates?}` (rates keyed by catalogue item id); clients point at one via optional `price_level` |
| `schemes` | pricing (6.9) | `Scheme` buy-X-get-Y rows (item, buy / free qty, optional date window, `active`); free goods are ₹0 invoice lines (`scheme_id`, `free_of`) |
| `series_counters` | numbering (`src/lib/series-counters.ts`) | `SeriesCounter {id: 'STR/FY26-27', seq}`: highest sequence ever issued per voucher series × FY (STR / PO / ADV / RFV / RCPT; Rounds 2–4 add FCN, PKL, WO, LCV, GV, TRQ; Round 5 adds LR, TRP, DON), so a deleted latest number is never reused. Since R4-C4 `localDb.invoices.remove` and `deleteVoucher` record invoice / voucher high-water marks too, and `nextNumber` / `nextVoucherNumber` count them as issued. Backed up (`RECORD_TABLES` / `ID_TABLES`); written alongside a guarded save (`TABLE_ACTIONS`: `books.edit`) |
| `employees` / `employee_groups` | payroll (Phase 7, `src/lib/payroll/store.ts`) | `Employee` / `EmployeeGroup` (`src/types/payroll.ts`); owner-only (`payroll.view`) — `docs/features/payroll.md` |
| `pay_heads` | payroll | `PayHead` (Tally calculation types; starter set `ph_*` used until the first save) |
| `salary_structures` | payroll | `SalaryStructure` per employee or group with `effective_from` |
| `attendance_types` / `attendance` | payroll | production types; monthly LOP days + units per employee |
| `payroll_runs` | payroll | `PayrollRun` with a payslip snapshot per employee; final runs post a Payroll voucher (`PRL/FY…`) to the ledger, derived on the fly |
| `payroll_payments` | payroll | `PayrollPayment` salary / PF / ESI / PT / TDS payments (`PYP/FY…`) clearing the payables |
| `payroll_settings` (object) | payroll | PF establishment code, ESI employer code, TAN |
| `payroll_arrears` | payroll depth (7P, `src/lib/payroll/depth-records.ts`) | `ArrearsRecord`: back-dated revision arrears per employee (`from_month`, `pay_month`, per-month earnings / PF / ESI differences), paid with that month's run; `PAYROLL_WRITE` (`books.edit` + `payroll.view`) |
| `employee_loans` | payroll depth (7P) | `EmployeeLoan` `LOAN/FY…` loan / salary advance to an employee: amount, interest % (reducing), EMI, start month, paid-from ledger, disbursement `payroll_payments` row; sync DATED + NUMBERED (not the business loans of `business_loans`) |
| `leave_types` | payroll depth (7P) | `LeaveType {id, code, name, paid, accrual, encashable, carry_cap?}` |
| `leave_entries` | payroll depth (7P) | `LeaveEntry` opening / taken / encash / adjust days per employee × leave type (encashment paid in `month`) |
| `payroll_adjustments` | payroll depth (7P) | `PayrollAdjustment` one-off earning / deduction (reimbursement, bonus, other) on one employee's payslip of `month` |
| `perquisites` | payroll depth (7P) | `Perquisite` monthly taxable value (s. 17(2)): accommodation / car / meals / gift / other, `from_month`–`to_month` |
| `fnf_settlements` | payroll depth (7P) | `FnfSettlement` `FNF/FY…` full & final: reason, notice recover / pay, leave encashment, gratuity, loan recovery, other items, paid with the run of `pay_month`; sync NUMBERED (dated by `pay_month`) |
| `payroll_relief89` | payroll follow-ups (7T, `src/lib/payroll/followups-records.ts`) | `Relief89Record` relief u/s 89(1) (Form 10E) working per employee × FY of receipt, earlier-year rows, `apply_tds` |
| `actuarial_valuations` | payroll follow-ups (7T) | `ActuarialValuation` `ACT/FY…` gratuity / leave figures (AS-15 / Ind AS 19) and the journal posted from them (`voucher_id`); sync DATED + NUMBERED |
| `pos_day_close` | POS (6.8, `src/lib/pos.ts`) | `PosDayClose` cash-drawer count per day (opening float, expected / counted cash, difference, tender totals); POS bills themselves are normal `invoices` with `pos: true` (`docs/features/pos-barcode-pricing.md`) |
| `pos_shifts` | cashier shifts (8E, `src/lib/pos-shifts.ts`) | shift per cashier: opening float, `bill_ids` billed while open, X / Z (shift) report, closing cash count; sync DATED by `day`; `doc.create` |
| `tds_challans` | TDS on payables (Phase 7, `src/lib/tds-payables.ts`) | `TdsChallan` ITNS 281 challan (TDS / TCS, BSR code, serial, date, tax / interest / fee / others, `deduction_keys` it deposits); posted to the ledger as a payment (`docs/features/tds-payables.md`) |
| `tds_deductions` | TDS on payables (Phase 7) | `ManualTdsDeduction` register-only deductions booked outside bills (not posted to the ledger) |
| `tds_returns` | TDS on payables (Phase 7) | `TdsReturnMark` filed marks `26Q:<fy>-Q<n>` / `27EQ:…` with filing date and token |
| `vendor_payments` | bill-wise payables (Phase 7, `src/lib/billwise.ts`) | `VendorPayment` (`src/types/purchases.ts`): supplier Advance / On Account / New Ref money not yet against a bill, with `allocations` adjusting it against bills later |
| `purchase_returns` | purchase returns (WP-3, `src/lib/purchase-returns.ts`) | `PurchaseReturn` (`src/types/purchases.ts`): debit notes `DN/FY…` and supplier credit notes received, Agst Ref the bill via `adjusted_amount` (`docs/features/purchase-returns.md`) |
| `receipt_notes` | receipt notes (WP-3, `src/lib/receipt-notes.ts`) | `ReceiptNote`: GRN `GRN/FY…` (stock in before the bill) and Rejections Out `RJO/FY…`; billed qty derived from bill lines' `grn_line_id` |
| `deposit_slips` | banking (WP-5, `src/lib/deposit-slip.ts`) | `DepositSlip` pay-in slips `PIS/FY<yy-yy>/<seq>`: cheque ids, cash denomination counts, totals (`docs/features/banking.md`) |
| `bank_accounts` | banking (WP-5, `src/lib/bank-accounts.ts`) | `{id, name, number?, opening?, opening_as_of?, active}` (+ `od` for an overdraft account); the main account (`DEFAULT_BANK_ID`, ledger 3510) always exists, others are ledgers `bank:<id>` synthesised in `bank-ledgers.ts`; payments / vouchers / statements carry optional `bank_account_id`; `master.edit`; additive `clearing` (R5-A2 marketplace / R5-B5 "RA deductions clearing": not a real bank, left out of cheque / e-pay / BRS pickers by `pickableBankAccounts`) and `fcra` (`designated` / `utilisation`, R5-C4) |
| `fx_bank_moves` | banking 7U (`src/lib/forex-bank.ts`) | Forex bank entries (in / out / revalue) on a foreign-currency bank account, each with its Journal id; key `pharma_settings` and device-local `mrchartist_pos_printer` are 7U too (`docs/features/business-extras.md`) |
| `epay_batches` | banking 7U (`src/lib/epay-confirm.ts`) | Downloaded e-payment batches `EPB/FY<yy-yy>/<seq>`: rows sent / paid / failed, UTR, payment group id (`docs/features/banking.md`) |
| `sales_agents` | business extras 7U (`src/lib/sales-commission.ts`) | Agent master: flat % / % by stock group, basis on invoice / on receipt |
| `commission_postings` | business extras 7U (`src/lib/sales-commission.ts`) | Commission payable journals per agent and period (never overlapping) |
| `dist_areas` / `dist_routes` / `dist_beats` | distribution 8F (`src/lib/distribution.ts`) | Area, route and beat masters (beat: salesman, visiting weekdays); parties carry `area_id` / `beat_id` / `agent_id` |
| `van_settlements` | distribution 8F (`src/lib/van.ts`) | `VST/FY<yy-yy>/<seq>` day settlement of a van godown: return transfer id, bills, cash counted vs received |
| `order_pad_outbox` / `order_pad_imports` | distribution 8F (`src/lib/order-pad.ts`) | Salesman's unsent orders; office log of imported order ids (dedupe) → sales order |
| `expiry_claims` | pharma 8F (`src/lib/expiry-ops.ts`) | Breakage / expiry claim per supplier: its debit notes, pending / credited / rejected |
| `expiry_receipts` | pharma 8F (`src/lib/expiry-ops.ts`) | `BER/FY<yy-yy>/<seq>` customer returns of expired goods into the expiry godown (+ replacement), with their stock move ids |
| `business_loans` | loans 8H (`src/lib/loans.ts`) | `BusinessLoan` `LOAN/FY<yy-yy>/<seq>`: lender, principal, rate, tenure, first EMI, loan ledger id, disbursement voucher id and `payments` (EMI n, principal, interest, voucher id) (`docs/features/loans.md`) |
| `currency_rates` | currency master 8H (`src/lib/currency-rates.ts`) | `CurrencyRate {id, currency, date, rate, source}` — ₹ per unit by date; FX documents pick the latest on or before their date |
| `cash_tally` | banking (WP-5, `src/lib/cash-tally.ts`) | `CashTally` day-end cash count by denomination vs the Books cash balance, one row per day |
| `pos_returns` | POS returns (WP-9, `src/lib/pos-returns.ts`) | `PosReturn` per return: bill, credit note, settlement (`refund` / `exchange` / `account`), refunds by tender, voucher id, exchange bill; read by the Z report (`docs/features/business-extras.md`) |
| `approvals` | approvals (WP-9, `src/lib/approvals.ts`) | `ApprovalLogRow` decision log (approved / rejected, by whom, note); the live state is `approval` on the invoice. Policy object under the key `approval_policy` |
| `branches` | branches (WP-9, `src/lib/branch.ts`) | `Branch {id, name, code?, gstin?, state_code?, profile_id?, godown_id?, address?, inactive?}`; additive `branch_id` on invoices / purchases / vouchers; additive `price_level_id` (R4-B3 store price list) |
| `loyalty_adjustments` | loyalty (WP-9, `src/lib/loyalty.ts`) | manual points corrections; accrual is derived from invoices, redemption is `loyalty_redeem` on the bill. Programme object under the key `loyalty_program` (date-keyed rules; additive `tiers` / `expiry_months`, R4-B2 `retail/loyalty-tiers.ts`) |
| `amc_contracts` | AMC (WP-9, `src/lib/amc.ts`) | `AmcContract` with `visits` log, `renewed_from` link |
| `gst_setoffs` | GST set-off (WP-6, `src/lib/gst-setoff.ts`) | `GstSetOffRecord` per 3B period × GSTIN: posted figures by head + the journal it wrote through `saveVoucher` (`docs/features/gst-setoff.md`) |
| `gst_challans` | GST set-off (WP-6) | `GstChallan` PMT-06: CPIN, CIN / BRN, dates, major × minor head amounts; a paid challan's payment voucher id |
| `rcm_documents` | reverse charge (7O, `src/lib/rcm-self-invoice.ts`) | recipient-issued RCM documents: self-invoices `RCM/FY…` (Rule 46, per bill or consolidated per month) and payment vouchers `RPV/FY…` (Rule 52); records only, nothing posts; sync DATED + NUMBERED (series scoped by `kind`); `books.edit` |
| `hsn_master` | GST depth (WP-6, `src/lib/hsn-master.ts`) | `HsnMasterRow` code, description, UQC, goods / services, dated `rates` history (append-only by convention) |
| `gst_pmt09` | cash ledger depth (7R, `src/lib/gst-cash-refunds.ts`) | `Pmt09Transfer` PMT-09: date, from / to major × minor head, amount, ARN; nothing posts (one cash-ledger account) |
| `gst_refunds` | GST refunds (7R) | `GstRefundClaim` RFD-01: category, period, relevant date, ARN, claimed / provisional / sanctioned / rejected by head, status trail, receipt voucher id when paid (`docs/features/gst-setoff.md`) |
| `isd_documents` | Input Service Distributor (7R, `src/lib/isd.ts`) | `IsdDoc` INWARD (invoices received by the ISD) / DISTRIBUTION (`ISD/FY…`) / RECEIVED (credit received by our unit → 3B 4A(4)) |
| `tds_justifications` | TRACES import (7R, `src/lib/traces-justification.ts`) | `JustificationImport`: file name, TAN / FY / quarter / form read from the report, capped findings matched to register keys, resolved flags (`docs/features/tds-payables.md`) |
| `stock_groups` / `stock_categories` | inventory masters (WP-8, `src/lib/stock-groups.ts`) | `StockTreeNode {id, name, parent_id?}` (nested); items point via `group_id` / `category_id`; `master.edit` (`docs/features/inventory-masters.md`) |
| `units` | inventory masters (WP-8, `src/lib/units.ts`) | `UnitMaster`: simple unit (symbol, name, UQC, decimals; a built-in symbol is an override) or compound (`first` / `factor` / `second`); `master.edit` |
| `gst_followups` | GST guards (8D, `src/lib/gst-followup.ts`) | `FollowUpMark` per 2B period × supplier GSTIN: followed-up day, channel (WhatsApp / e-mail / PDF), items, ITC at risk (`docs/features/gstr2b.md`) |
| `gstr2b_itc` | GST guards (8D) | `Itc2bPush` 2B effect (books / restricted / at risk / per 2B) pushed to the GSTR-3B view per period × GSTIN |
| `gstr1_snapshots` | GST guards (8D, `src/lib/gst-guards.ts`) | `Gstr1Snapshot` GSTR-1 as filed (docs, B2CS, 3B Table 3.2) per period × GSTIN → GSTR-1A diff (`docs/features/gst-reports.md`) |
| `doc_inbox` | bill capture (8C, `src/lib/doc-inbox.ts`) | `InboxDoc`: unprocessed supplier bill / receipt photo or PDF (attachment ref), decoded e-invoice QR, status, intent bill / expense, `draft_id` once drafted; nothing touches the books (`docs/features/bill-capture.md`); `books.edit` |
| `purchase_drafts` | bill capture (8C, `src/lib/purchase-drafts.ts`) | `PurchaseRecord` shape with `status: 'draft'` + `draft` meta (source capture / recurring / approval / manual, held approval): bills outside the books until posted through `purchasesDb.save`; `books.edit` |
| `recurring_bills` | recurring bills (8C, `src/lib/recurring-bills.ts`) | `RecurringBill` schedule (rent, subscriptions …) using the recurring-invoice date rules; only ever writes drafts into `purchase_drafts`; `books.edit` |
| `bank_rules` | bank rules (8C, `src/lib/bank-rules.ts`, writes in `bank-rules-apply.ts`) | rule with ALL / ANY conditions on imported statement lines and one action (expense, voucher, receive against invoices, contra, ignore); memory suggestions are derived, not stored (`docs/features/banking.md` § Bank rules); `books.edit` |
| `payment_requests` | purchase approvals (8C, `src/lib/purchase-approvals.ts`) | `PaymentRequest` supplier payment held for the owner's approval (bill, amount, TDS, date, method, bank account, requested by); approving records the payment; `books.edit` |
| `payment_terms` | collections (R2-A1, `src/lib/payment-terms.ts`) | `PaymentTerm` (Net N, EOM + N, day of next month, instalments, early-pay discount); starter set used until the first save; documents snapshot `payment_terms`; `master.edit` (`docs/features/collections-r2.md`) |
| `collection_notes` | collections (R2-A4, `src/lib/collections.ts`) | `CollectionNote {party_key, kind, outcome, date, promise?, next_action?}`: follow-ups and promises to pay; sync DATED by `date`; `payment.record` |
| `write_off_recoveries` | collections (R2-A3, `src/lib/write-off.ts`) | `WriteOffRecovery`: same-FY and earlier-FY recoveries of bad debts written off (on the 8G `write_off` payment flag); DATED; `books.edit`, API owner-only |
| `reminder_settings` (object) | collections (R2-A5, `src/lib/reminder-settings.ts`) | reminder schedule `{upcoming_days, polite_after, firm_after, final_after, cooldowns, templates}`; defaults = the old behaviour |
| `collection_settings` (object) | collections (R2-A2, `src/lib/settlement.ts`) | `{gst_variant, clerk_cap_abs, clerk_cap_pct, short_pay_account}` for settlement discounts / kasar |
| `batch_runs` | sales docs (R2-B1, `src/lib/batch-invoices.ts`) | `BatchRun`: issue date, source, party keys, invoice / held ids, totals, status (re-run guard, undo); DATED by `date`; `doc.create` (`docs/features/sales-r2.md`) |
| `proposal_snippets` | sales docs (R2-B3, `src/lib/proposal-sections.ts`) | `ProposalSnippet {id, title, body, place}`: reusable quotation sections; `doc.create` |
| `notes_to_accounts` | annual pack (R2-C1, `src/lib/ledger/annual-pack.ts`) | `{id: 'FY25-26', notes: {[noteId]: {text?, extra?}}, entity_type, updated_at}`: edited notes to accounts per FY; `books.edit` (`docs/features/books-output-r2.md`) |
| `deferrals` | deferrals (R2-C2, `src/lib/deferrals.ts`) | deferred revenue / prepaid expense schedules; journals are ordinary `vouchers` (class `Deferral`) keyed in `posted`; DATED by the source date; `books.edit` |
| `packing_lists` | packing (R2-C4, `src/lib/packing.ts`) | packing list `PKL/FY<yy-yy>/<seq>` with its own line snapshot (the invoice is never changed); DATED + NUMBERED; `doc.create` |
| `package_types` | packing (R2-C4) | `PackageType {id, name, length_cm, breadth_cm, height_cm, tare_kg}`; `master.edit` |
| `dining_areas` / `dining_tables` | restaurant (R3-A, `src/lib/restaurant/orders-store.ts`) | `DiningArea {id, name, price_level_id?, service_charge_pct?, sort?}`, `DiningTable {id, name, seats, area_id, sort?}`; a starter Dine-in area with tables 1–10 is used until the first save; `master.edit` (`docs/features/restaurant.md`) |
| `table_orders` | restaurant (R3-A) | `TableOrder` (`src/types/restaurant.ts`): running order with lines, KOTs (`K<n>` per local day), event log, payer rows. Not an invoice; settled into POS invoices carrying `table_order_id` / `split_of`. DATED by `day`; `doc.create`; day / shift close refuse while one is open |
| `modifier_groups` | restaurant (R3-A) | `ModifierGroup` with min / max and options (price, optional `item_id`), linked to items / stock groups; `master.edit` |
| `restaurant_settings` (object) | restaurant (R3-A) | `service_charge_default`, `token_reset`, `stations`, `station_names`, `cancel_cap`, `auto86` |
| `work_types` | rate cards (R3-B1, `src/lib/rate-cards.ts`) | `WorkType {id, name, rate, sac?, inactive?}`; `master.edit` (`docs/features/service-billing-r3.md`) |
| `project_tasks` | projects (R3-B2, `src/lib/projects.ts`) | `ProjectTask` on a project cost centre (column, estimate, assignee, rate, due, sort); "Invoiced" is derived from billed time; `books.edit` |
| `project_settings` (object) | projects (R3-B2) | `{columns: string[]}` board columns (default To do / Doing / Done) |
| `retainers` | retainers (R3-B3, `src/lib/retainers.ts`) | `Retainer` per client (hours per period, fee, rollover cap, overage rate, `closes[]`); coverage derived; covered entries stamped `retainer_id` / `retainer_period` on close; DATED by `start`; `books.edit` |
| `quiet_settings` (object) | quiet customers (R3-B7, `src/lib/quiet-customers.ts`) | `{threshold_days, snoozed: {[party_key]: until}, excluded}` |
| `gst_portal_files` | portal files (R3-C4, `src/lib/gst-portal-files.ts`) | read GSTR-1 error reports / downloaded GSTR-1: kind, period, GSTIN, file hash, counts, findings (≤ 2,000), resolved; `books.edit` (`docs/features/docs-compliance-r3.md`) |
| `dsc_register` | practice desk (R3-C6, `src/lib/dsc-register.ts`) | DSC rows `{holder, role, dsc_class?, token?, issuer?, valid_from?, valid_to, notes?}` with an expiry bell; `books.edit` |
| `client_checklist` | practice desk (R3-C6, `src/lib/client-checklist.ts`) | monthly checklist `{id: 'YYYY-MM', items: {id, label, done_at?, by?, carried?}[]}`; `books.edit` |
| `checklist_template` (object) | practice desk (R3-C6) | company checklist template (string list); the device default is the device-local `mrchartist_checklist_default` |
| `production_orders` | production (R4-A1, `src/lib/production/orders.ts`) | `ProductionOrder` `WO/FY<yy-yy>/<seq>` (`src/types/production-r4.ts`): item, BOM, planned qty, due, SO + line, plan, cost centre, WIP / store / output godown, `output_to_qc`, status milestones, exploded `materials`, `log`, `standard_conversion`; issued / output / held derived from STR / MFG / SJ rows tagged `production_order_id`; DATED + NUMBERED; `books.edit` (`docs/features/production-r4.md`) |
| `qc_results` | QC hold (R4-A4, `src/lib/production/qc.ts`) | `QcResult` pass / fail per lot: item, batch, QC godown, source doc, qty, inspector, release STR / rejection id; DATED; `books.edit` |
| `qc_settings` (object) | QC hold (R4-A4) | `{hold_all, alert_days}` |
| `recall_notices` | genealogy (R4-A3, `src/lib/production/genealogy.ts`) | `RecallNotice {id, date, batch_keys, note, notified: {party, at}[]}`; DATED; `books.edit` |
| `landed_cost_vouchers` | landed cost (R4-A5, `src/lib/landed-voucher.ts`) | `LandedCostVoucher` `LCV/FY<yy-yy>/<seq>`: method, charges (bill line / memo), targets (bill / GRN), `allocation_snapshot`; applied live by `liveInputs()` (engine copies of bills / GRNs with `__landed_extra`), never posted to Books; DATED + NUMBERED; `books.edit` |
| `gift_vouchers` | gift vouchers (R4-B1, `src/lib/retail/gift-vouchers.ts`, `gift-voucher-core.ts`) | `GiftVoucher` `GV/FY<yy-yy>/<seq>` (`src/types/stores-r4.ts`): code, value, balance, `issued_on` / `expires_on`, promo uses, status; sale = a receipt voucher to "Gift vouchers outstanding"; redemptions are `transactions` rows with `gift_voucher_id`; DATED (`issued_on`) + NUMBERED; `doc.create` (cancel `doc.deleteIssued`) (`docs/features/retail-chains-r4.md`) |
| `gift_voucher_settings` (object) | gift vouchers (R4-B1) | `GiftVoucherSettings {validity_months, allow_partial, prefix}`; `settings.manage` checked in code |
| `branch_prices` | store price lists (R4-B3, `src/lib/retail/store-prices.ts`) | `BranchPrice {branch_id, item_id, from, rate}`: dated store price override (precedence in `resolvePrice`); `master.edit` |
| `transfer_requests` | transfer requests (R4-B4, `src/lib/retail/transfer-requests.ts`) | `TransferRequest` `TRQ/FY<yy-yy>/<seq>`: lines, log, exceptions, status; dispatch / receipt are `stock_transfers` with `request_id` / `leg`, transit losses `stock_journals` with `request_id`; DATED + NUMBERED; `doc.create` (dispatch / receive `books.edit`, approve `doc.approve`) |
| `lut_register` | trade desk (R4-C1, `src/lib/trade/lut-register.ts`) | `LutRow {fy, gstin, arn, filed_on, valid_from, valid_to}` (`src/types/trade-r4.ts`); `settings.manage` (`docs/features/trade-trust-r4.md`) |
| `export_irms` | export desk (R4-C2, `src/lib/trade/export-register.ts`) | `ExportIrm` inward remittance / e-BRC with allocations to export invoices; DATED (`date`); `books.edit` |
| `export_incentives` | export desk (R4-C2, `src/lib/trade/export-incentives.ts`) | `ExportIncentive` RoDTEP / drawback / IGST-refund claim, credit, scrip uses and sale, journals via `saveVoucher`; DATED (claim `date`); `books.edit` |
| `export_writeoffs` | export desk (R4-C2) | `ExportWriteOff` unrealised export proceeds written off with a reason; DATED (`date`); `books.edit` |
| `recycle_bin` | recycle bin (R4-C4, capture `binRows` in `audit-edits.ts`, `src/lib/trust/recycle-bin.ts`) | `{table, row_id, deleted_at, deleted_by?, row, attachments?}`: whole rows deleted from any `WATCHED_TABLES` table (and `localDb.invoices.remove`); restore goes through the target table's own guarded save; purged after `bin_settings.days` / 5 MB. Backed up, **not synced** (`EXCLUDED` in `sync-engine.ts`), no `TABLE_ACTIONS` entry (checked per target table); an `ATTACHMENT_OWNER_TABLES` member, so binned files are kept |
| `bin_settings` (object) | recycle bin (R4-C4) | `{days}` 7–90 (default 30); `settings.manage` checked in code |
| `setup_progress` (object) | setup checklist v3 (R6-A1, `src/lib/checklist-steps.ts`) | `{skipped: string[], hidden_at?}`: skipped checklist steps and when the Dashboard card was hidden (done-ness is always derived from data). Backed up; synced as a singleton (non-array value, last writer wins); not audited (viewing state, not in `WATCHED_TABLES`); `TABLE_ACTIONS` `doc.create` |
| `sales_channels` | marketplace (R5-A2, `src/lib/marketplace/channels.ts`) | `SalesChannel` (`src/types/marketplace-r5.ts`): marketplace, operator GSTIN / TAN, operator party, clearing bank account, saved file mappings, bucket rules, claim windows; `master.edit` (`docs/features/marketplace-r5.md`) |
| `channel_skus` | marketplace (R5-A2, `src/lib/marketplace/sku-map.ts`) | `ChannelSku` channel SKU / listing id → catalogue item, `qty_per_unit`; `master.edit` |
| `marketplace_imports` | marketplace (R5-A3, `src/lib/marketplace/sales-import.ts`) | `MarketplaceImport` batch: file, counts, document ids (undo = cancel the batch); DATED (`imported_at` day); `doc.create` |
| `settlements` | marketplace (R5-A4, `settlement-{import,recon,post}.ts`) | `Settlement` payout: lines by bucket, posting (receipts into the clearing account, journal, payout contra); DATED (`deposit_date`); `doc.create` (post `books.edit`) |
| `eco_credits` | marketplace (R5-A5, `src/lib/marketplace/tcs-credit.ts`) | `EcoCredit` GSTR-8 / GSTR-7 portal row per month: accept (journal) / reject; DATED (`month`-01); `books.edit` |
| `marketplace_returns` | marketplace (R5-A6, `src/lib/marketplace/returns-desk.ts`) | `MarketplaceReturn` returns / RTO / claims desk row with claim deadline; DATED (`expected_on`, else created); `doc.create` |
| `consignment_notes` | transport (R5-B1, `src/lib/transport/consignment-notes.ts`) | `ConsignmentNote` LR / bilty `LR/FY<yy-yy>/<seq>` (`src/types/transport-works-r5.ts`): places, lines, charges, POD, `trip_id`; DATED + NUMBERED; `doc.create` (`docs/features/transport-works-r5.md`) |
| `gta_options` | transport (R5-B1, `src/lib/transport/gta-option.ts`) | `GtaOptionRow {fy, option, filed_on?, arn?}`: RCM / forward-charge option per FY; `settings.manage` |
| `vehicles` | transport (R5-B3, `src/lib/transport/vehicles.ts`) | `Vehicle`: reg. no., own / hired (`owner_id` = the lorry owner's vendor), documents with expiry, cost centre of kind `vehicle` for own vehicles; `master.edit` |
| `trips` | transport (R5-B3, `src/lib/transport/trips.ts`) | `Trip` `TRP/FY<yy-yy>/<seq>`: vehicle, LRs, driver advances (payment vouchers), settlement journal, hire bill; trip P&L derived; DATED (`start_date`) + NUMBERED; `doc.create` |
| `ra_measurements` | works (R5-B4, `src/lib/works/measurements.ts`) | `RaMeasurement`: this-bill quantities per BOQ line for a measured RA bill; DATED (`date`); `doc.create` |
| `boq_coefficients` | works (R5-B6, `src/lib/works/sites.ts`) | `BoqCoefficient {boq_id, line_id, item_id, qty_per_unit}`: material per unit of a BOQ line (site consumption); `master.edit` |
| `fee_plans` | fees (R5-C1, `src/lib/institutions/fee-plans.ts`) | `FeePlan` (`src/types/institutions-r5.ts`): heads (exempt / nil / taxable), instalments, fines, concessions; `master.edit` (`docs/features/institutions-property-r5.md`) |
| `fee_runs` | fees (R5-C1, `src/lib/institutions/fee-billing.ts`) | `FeeRun`: fee documents issued for a plan × instalment (idempotent on `fee_plan_id` / `fee_instalment`); DATED (`date`); `doc.create` |
| `common_credit_runs` | common credit (R5-C2, `src/lib/institutions/common-credit.ts`) | `CommonCreditRun` Rule 42 / 43 working per period and its journal (class "ITC reversal — Rule 42 / 43", read into GSTR-3B 4(B)(1) through `itcReversals`); DATED (`date`); `books.edit` |
| `donations` | donations (R5-C3, `src/lib/nonprofit/donations.ts`) | `Donation` receipt `DON/FY<yy-yy>/<seq>`: donor, section (80G / 35), type, mode, fund; DATED + NUMBERED; `doc.create` |
| `form_10bd_filings` | donations (R5-C3, `src/lib/nonprofit/form-10bd.ts`) | `Form10bdFiling {fy, arn?, filed_on?, rows_snapshot}`; a donation in a filed FY is not edited (cancel + new); `books.edit` |
| `form_10be` | donations (R5-C3) | `Form10beRow {fy, donor_id, cert_no, cert_date?, sent_on?}`: 10BE certificates; `books.edit` |
| `properties` | leases (R5-C5, `src/lib/property/properties.ts`) | `Property` with units (commercial / residential dwelling); `master.edit` |
| `leases` | leases (R5-C5, `src/lib/property/leases.ts`) | `Lease`: property units, tenant, rent / CAM heads, escalation, GST class, TDS (194-I), `deposit_id`; billed by a recurring schedule (`schedule_id`; the schedule carries `lease_id`); DATED (`start`); `master.edit` |
| `security_deposits` | deposits (R5-C6, `src/lib/property/deposits.ts`) | `SecurityDeposit` with movements (receive / pay / adjust / forfeit / refund); an adjustment settles an invoice through a receipt row with `deposit_adjustment_id`; DATED (`date`); `books.edit` |

### Industry packs (Round 5)
Vertical features (R5-A marketplace, R5-B transport / works, R5-C fees / non-profit / leases) sit behind packs
(`src/lib/industry-packs.ts`, `PackId` = `marketplace` / `transport` / `works` / `fees` / `nonprofit` / `leases`).
`activePacks(settings)`: an explicit `settings.industry_packs` array wins (unknown ids dropped, `[]` = none); absent →
the packs `PACK_OF_TYPE` implies for `business_type` (`ecommerce`, `transport`, `contractor`, `institution`,
`nonprofit`, `property`); neither → none, so existing companies see no change (`tests/industry-packs.test.ts`).
"Show all features" does not turn packs on. A pack that is off hides its tabs (`visibleTabs`; the URL still opens
the tab with a "pack off" line) and its bell notices, and its tables are not read (`tests/{marketplace,transport-works,r5c}-pack-gate.test.ts`); no data is deleted. `PACK_TABS` is the one Ctrl+K "Industry packs" list,
one appended block per package (`// R5-A`, `// R5-C`, `// R5-B`), labels resolved by the lazy
`components/marketplace/palette-destinations.ts`; GST tool tabs use `PACK_GST_TABS` (`gst-tabs.ts`). New pack
screens must be lazy and gated, add their rows to `PACK_TABS`, and add no route.

Other Rounds 4–5 settings fields: `industry_packs`, `npo_admin_accounts` / `npo_accumulated` (R5-C4) on the
settings object; `iec` / `ad_code` / `ad_bank` (R4-C1) and `npo` (R5-C3 registrations) on each sender profile.
Statutory values of these packages are date-keyed, append-only `Versioned` tables kept out of the first-paint
`tax-rules.ts`: `src/lib/trade/trade-rules.ts` (R4-C), `src/lib/transport-works-rules.ts` (R5-B),
`src/lib/r5c-rules.ts` (R5-C); section / form labels of the Income-tax Act 2025 in `src/lib/ita2025.ts`
(`ACT_REF_RULES`, `FORM_REF_RULES`, `OLD_CODE_SHOWN_RULES`: labels by date, stored codes never renamed).

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

### Help, discoverability and version (Round 6)
- **Help registry** (R6-A2, `src/lib/help/registry.ts`): topic ids are `<route>[:<tab>[:<view>]]`, six lazy topic
  files by area, `helpFor` / `topicById` fall back to the route topic, `helpIndex()` feeds Help search and the Ctrl+K
  "Help topics" group. `HelpModal` opens on the current screen, on a `topic` / `view` prop, or on the topic asked through
  `openHelp(topic)` (`src/lib/help-event.ts`, read once with `takeHelpTopic()`). F1 opens it everywhere except `/pos`
  (F1 = held bills), `/gateway` (Tally keys) and while typing. **A new route or tab needs a help topic**:
  `tests/help-registry.test.ts` walks every `App.tsx` route, every sidebar entry, `GST_TABS`, `PACK_TABS` and every tab
  list of `src/pages/page-tabs.ts` (`TAB_PAGES` in `src/lib/palette/tab-index.ts`, the list Ctrl+K indexes).
- **Tab lists** (R6-B1): page tab registries live in `src/pages/page-tabs.ts` (type imports only), the TDS ids in
  `tab-index.ts`, the GST rows in `gst-tabs.ts`; a new tab needs a title in `discover-r6-tabs.ts` and a help topic.
- **Route trail** (R6-A5, `src/lib/route-trail.ts`): the shell pushes every route change; the last 10, ids masked, memory
  only, for "Report a problem".
- **Screen tips** (R6-A6, `src/lib/help/tips.ts`): one lazy `<ScreenTip id>` line per page; every tip must be mounted
  (`tests/help-tips.test.ts`).
- **Sample data** (R6-B4): always a separate, resettable Demo company (`startDemoCompany`, `SampleDataChooser` on the
  Dashboard, Settings → Data and the wizard); never rows in a real company.
- **Version** (R6-A4): `__APP_VERSION__` comes from `package.json` (`vite.config.ts` `define`, `src/lib/app-version.ts`);
  the newest `WHATS_NEW` entry (`src/lib/whats-new.ts`) must match it — `scripts/check-whats-new.mjs` fails the
  `postbuild` otherwise, so a version bump needs a notes entry.
