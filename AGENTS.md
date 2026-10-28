# Invoice — AI Context File
# Read this FIRST before making any changes.

## Project Identity
- **Name**: Mr. Chartist Invoice
- **Type**: Frontend SPA — professional, offline-first invoice generator
- **Brand**: @MrChartist · reference site https://mrchartist.com (no separate invoice subdomain launch)
- **Owner**: Rohit Singh (SEBI Registered Research Analyst, INH000015297)
- **Features**: invoicing + light accounting for Indian businesses — 26 templates + Design Studio, GST
  (CGST/SGST/IGST, cess, TCS, TDS, export/LUT), credit notes & conversions, recurring, receivables,
  purchases/ITC, inventory, books, GSTR-1/3B papers, e-Invoice/e-Way JSON, Tally XML, CSV import,
  PWA + encrypted/auto backups; also POS / restaurant tables & KOT, collections (terms, follow-ups, write-offs),
  projects / retainers / timesheets, payroll, manufacturing & production orders, annual accounts pack, GST portal-file /
  e-Way / practice desks, store chains (gift vouchers, store prices, transfer requests), export desk, recycle bin &
  auditor pack, Income-tax Act 2025 labels, industry packs (marketplace seller, transport / works contracts, fees /
  non-profits / leases). Module contract: `docs/ARCHITECTURE.md`; per-module notes: `docs/features/`.
- **Brand source of truth**: mrchartist.com (logo `public/branding/*`, tokens in `src/index.css`; app palette = blue/gold `--pal-*`, orange kept only for the logo and the Ember template).

## Stack
- **React 19** + **TypeScript** + **Vite 8** (rolldown bundler — `vite.config.ts` uses
  `rolldownOptions`, which is correct for Vite 8; do not change it to `rollupOptions`).
  Chunking (R15-A / R16-A): `codeSplitting.groups` = vendor-react, vendor-ui, app-initial (`$initial`), nine "safe" family
  groups `f-*` and `lazy-leaves` (`scripts/vite-safe-groups.mjs` — a module joins only if nothing it imports can be dragged
  in). Hindi strings are split out at build time (`scripts/vite-hi-split.mjs`): every `defineArea(en, hi)` must pass a
  literal Hindi object; Hindi lives in `lang-hi-*` packs (plus `lang-regional`) listed under `langs` in
  `dist/lang-manifest.json`, precached only on devices set to that language. Budgets: first paint 185 kB, core 3,300 kB,
  Hindi pack 400 kB, Hindi left in English chunks ≤ 36 kB (`scripts/check-bundle-size.mjs`). HTML escaping: `escHtml`
  (`src/lib/html-esc.ts`, escapes `'` too).
- **State**: Zustand — `src/store/useInvoiceStore.ts` is the single live global store.
- **Styling**: Vanilla CSS + CSS Modules (`*.module.css`); tokens in `src/index.css`.
- **PDF**: `html-to-image` + `jspdf`. **QR**: `qrcode.react`. **Icons**: `lucide-react`.

## Architecture / Key files
- `index.html` → `src/main.tsx` → `src/App.tsx` (PIN gate + React Router shell).
- `src/pages/` — one file per route (Dashboard, InvoiceCreator, Transactions, Clients, Settings, LoginPage,
  Expenses, Receivables, Books, GstReports, Exports, Inventory, Recurring, Payroll). Design Studio lives in
  `src/components/design/`. Every page except Dashboard and Login is `React.lazy` in `src/App.tsx`; the editor chunk is prefetched on idle.
- `src/store/useInvoiceStore.ts` — Zustand store (current invoice + actions).
- `src/lib/localDb.ts` — data layer (over `src/lib/storage.ts`) + Indian-FY invoice numbering.
- `src/lib/storage.ts` — sync key/value API; data tables live in IndexedDB behind an in-memory cache loaded by
  `initStorage()` in `main.tsx` (localStorage fallback). See `docs/ARCHITECTURE.md` → Storage layer.
- `src/lib/auth.ts` — local PIN gate (PBKDF2-hashed, lockout, idle lock; `login`/`verifyPin` are async).
- `src/lib/stats.ts` — dashboard maths; `isRevenueDoc` is the single definition of "revenue".
- `src/lib/utils.ts` — `cn`, `formatCurrency`, `formatDate`, `amountInWords` (Indian system).
- `src/components/templates/{TemplateEngine.tsx,registry.ts}` — 26 templates via layouts
  (`classic`/`corporate`/`minimal`/`centered`/`gst`/`receipt`/`letterhead`) × CSS variables
  (`accent`, `fontFamily`); optional `design` prop applies Design Studio prefs (`src/lib/design-prefs.ts`).
- `src/components/{preview,modals,layout,ui}/` — preview/export, search modals, shell, primitives.

## Storage keys (do not rename — breaks existing users' data)
Same names whether a key lives in IndexedDB (data tables, via the storage cache) or localStorage (device-local
keys listed in `DEVICE_LOCAL_KEYS`, and `theme`). Never use `localStorage` directly for app data.
- `mrchartist_inv_*` (via `DB_PREFIX`): `clients`, `items_catalog`, `invoices`, `transactions`, plus the
  feature tables listed in `docs/ARCHITECTURE.md` (`vendors`, `purchases`, `recurring`, `doc_links`, `stock_moves`,
  `assets` …). Since schema v3 invoice/recurring sender snapshots hold `asset:<id>` for logo/signature; `getTable`
  resolves them, so read those tables through `getTable`/`localDb`, never raw JSON.
  Backup collects every `mrchartist_inv_*` key except device-local ones (PIN session, lockout, idle timer).
- `mrchartist_inv_settings` — multi-profile sender identities (array).
- `mrchartist_inv_template` — selected template id.
- `mrchartist_inv_auth` — hashed PIN credential of the Owner (legacy plaintext is migrated on first unlock). `theme` — light/dark.
- `mrchartist_inv_auth_users` / `mrchartist_inv_auth_guard_users` — local clerk/viewer users (hashed PINs) and their
  lockouts (6.21). Device-local, never in backups. Role checks: `can()` / `requireAccess()` in `src/lib/access.ts`
  (convenience access control, not security); new destructive data-layer calls should call `requireAccess`.
- `mrchartist_inv_companies` — device-local company registry (6.20); each company is its own IndexedDB database
  (`mrchartist_inv_kv`, `mrchartist_inv_kv__<id>`) with the same keys inside. A tab is pinned to the company whose
  database it opened (`activeCompanyId()`, QA7 G1): another tab's switch never changes it; the tab shows "This tab is on
  another company — reload" (`companyMoved()`, `CrossTabNotice`). Entries may carry `demo: true` + `from` (QA7 G2,
  additive, set only by `demo-company.ts`).
- Folder sync (5.7, `docs/features/sync.md`): `mrchartist_inv_sync_device` (device-local id/name), and per company
  `sync_state` / `sync_conflicts` / `sync_audit` (`SYNC_META_KEYS`: never in a backup, removed by restore/erase).
- `mrchartist_inv_lang` — device-local interface language (`en` default / `hi`, 5.4); never in backups. UI strings go
  through `t()` / `useT()` (`src/i18n/`, how-to + Hindi glossary in `docs/features/i18n.md`).
- Phase 7 company data (backed up and synced like every `mrchartist_inv_*` key):
  `mrchartist_inv_audit_archive_<0001…>` — MCA edit-log archive segments (WP-7, `AUDIT_ARCHIVE_PREFIX` in `audit.ts`;
  validated on restore, never edited in place); `mrchartist_inv_year_end` — reviewed year-end checklist steps per FY
  (WP-7); `mrchartist_inv_closing_stock` — report-time closing-stock source `{mode?, opening?, entries}` (WP-2). When
  valuation is on, closing-stock journals (year-end wizard class "Year-end closing stock") are netted off it in every
  statement (`loadStockValuer` → `netOfStockJournals`), so stock is never counted twice; use `loadStockValuer()` for
  any P&L / balance sheet so Books, the Gateway and ratios agree.
- Device-local viewing preferences, outside the `mrchartist_inv_` prefix (never backed up or synced):
  `mrchartist_report_prefs` (F12 report options per report) and `mrchartist_report_period` (shared report period,
  Alt+F2); `mrchartist_tally_terms` (Gateway "Tally terms"); POS counter prefs `mrchartist_pos_printer`, `mrchartist_pos_scale`
  (weighing-scale profile) and `mrchartist_pos_keys` (function-key overrides, 8E).
  `mrchartist_report_views` / `mrchartist_report_pack` (8G saved
  views and month-end pack schedule). `mrchartist_inv_save_choice` (editor split-Save choice) is in `DEVICE_LOCAL_KEYS`.
  `mrchartist_plus_one_tap` (phone "+" opens a new invoice
  directly, 8H) and `mrchartist_demo_pending` (wizard "explore with sample data" across the Demo-company reload, 8H).
  Rounds 2–3: `mrchartist_statement_prefs` (statement style + ageing strip, R2-A), `mrchartist_display_prefs` (text size /
  contrast / motion, applied before first paint by `public/theme-init.js`, R2-C), `mrchartist_kot_printers` (KOT printer
  per kitchen station, R3-A), `mrchartist_editor_layout` (live-preview toggle, R3-C) and `mrchartist_checklist_default`
  (practice-desk default checklist, R3-C); `mrchartist_pos_branch` (POS "This counter is branch", R4-B).
  Round 6 (R6-A): `mrchartist_help_strips` ("About this tab" strips on / off), `mrchartist_whats_new_seen` (last What's-new
  version shown), `mrchartist_feedback_draft` (unsent "Report a problem" draft), `mrchartist_tips_seen` /
  `mrchartist_tips_off` (one-time screen tips). R6-B: `mrchartist_demo_pending` may carry `id|business_type|pack,pack`
  (a plain id still reads).
- Round 6 company data: `mrchartist_inv_setup_progress` — object `{skipped, hidden_at?, byUser?}` (R6-A1 setup checklist v3;
  top level = the owner's; QA7 G10 `byUser[<local user id>]` = each clerk's own skips / Hide;
  backed up, synced as a singleton, not audited, `TABLE_ACTIONS` `doc.create`; done-ness is derived from data).
  R6-C3 table `import_runs` (one row per import run of every kind; backed up, synced, audited, in `TABLE_ACTIONS` and the
  open-export schema; the checklist's import step reads it). R6-C4 compliance rows carry `downloaded_at` (portal file
  downloaded, survives reload); only a filled filed date counts as filed. Vendor payment allocations may carry
  `opening_bill_id` (settles a supplier opening bill, R6-C2).
- Round 8 (trading) company data: names in `src/lib/trade/tr-shared.ts` (tables / objects of all three packages, series
  `TCL`, `PDR`, `ARR`, `PAT`, `IND`), all backed up and synced; record / line fields in `src/types/trade-r8.ts` (kept by
  `R8_RECORD_KEYS` / `R8_LINE_KEYS`). Their `TABLE_ACTIONS` rights and audit labels are registered at runtime by
  `src/lib/trade/tr-registry.ts` (kept off first paint): **every module that writes a Round 8 table must
  `import './tr-registry'`** (`tests/tr-registry.test.ts`). Trade profile = business type `wholesale` + packs
  `distributor` / `commodity` / `agency` (tabs on `/distribution`). Agency (arhatiya) sales post as normal sales and the
  bikri patti journal moves them to the principal; principals' goods sit in `consignment` godowns outside stock costing.
- Round 9 (retail) company data: names in `src/lib/retail/rt-shared.ts` (12 tables of RT-A … RT-E, object
  `retail_settings`, series `URD`, `ALT`, `SVC`, `KAR`), all backed up and synced; record / line fields in
  `src/types/retail-r9.ts` (kept by `R9_RECORD_KEYS` / `R9_LINE_KEYS`). Rights and audit labels are registered at runtime by
  `src/lib/retail/rt-registry.ts`: **every module that writes a Round 9 table must `import './rt-registry'`**
  (`tests/rt-registry.test.ts`). Retail profile = business type `kirana` + `settings.retail_kind` + packs `pharmacy` /
  `apparel` / `electronics` / `jewellery` (one desk tab each on `/inventory`; `PACK_OF_TYPE` / `PACK_ROUTES` unchanged).
  Rule values in `src/lib/retail-rules.ts` (lazy only). `PurchaseLine.free_qty`: stock = paid + free, cost spread over
  both, GST / ITC on the paid value (`readPurchaseLines` `quantity` / `paidQty` / `freeQty`, docs/features/retail-r9.md).
- Round 10 (services) company data: names in `src/lib/services/sv-shared.ts` (SV-A tables `appointments`,
  `service_staff`, `commission_plans`, `staff_payouts`, `payer_claims` (series `CLM`; `OPD` / `IPD` / `LAB` / `MEM` reserved),
  object `service_settings`), all backed up and synced; settings `service_kind` (profile under business type `services`,
  packs `clinic` / `salon` / `fitness` / `workshop` — desk tabs on `/time`; `PACK_OF_TYPE` / `PACK_ROUTES` unchanged).
  Rights and audit labels are registered at runtime by `src/lib/services/sv-registry.ts`: **every module that writes a
  Round 10 table must `import './sv-registry'`** (`tests/sv-registry.test.ts`). Round 10 document snapshots live under ONE
  record key `sv` and ONE line key `sv` (`src/types/services-r10.ts`, appended to `R9_RECORD_KEYS` / `R9_LINE_KEYS`) —
  never add keys. A 0% line with `sv.exempt` is reported in its own Table 8 column (exempt / nil / non-GST); without it,
  nil-rated as before. Rule values in `src/lib/service-rules.ts` (lazy only, `tests/sv-rules.test.ts`). Notes:
  `docs/features/services-r10.md`.
- Round 12 (agriculture) company data: names in `src/lib/agri/ag-shared.ts` (AG-A tables `farm_batches`,
  `quality_cut_tables`, `farmer_cycles` (series `CYB`), object `agri_settings`; `FPV` farmer purchase vouchers on
  `purchases`; `WBS` / `MDS` / `CMR` / `CSR` / `GPO` / `LAS` / `SHC` reserved for AG-B … D), all backed up and synced;
  settings `agri_kind` / `mill_kind` (a wizard card, not a business type: `manufacturer`, or `kirana` + `retail_kind:
  'general'` for input dealers; packs `agri` / `dairy` / `mill` / `coldstore` / `agri_inputs` / `fpo` — desk tabs on
  `/inventory`; `PACK_OF_TYPE` / `PACK_ROUTES` unchanged). Rights and audit labels are registered at runtime by
  `src/lib/agri/ag-registry.ts`: **every module that writes a Round 12 table must `import './ag-registry'`**
  (`tests/ag-registry.test.ts`). Round 12 invoice snapshots live under ONE record key `ag` (`R12_RECORD_KEYS`, spread into
  `R9_RECORD_KEYS`; weighing reuses the R8 line key `wt`) — never add keys. Farmers are vendors / clients with `ag`
  (Aadhaar last 4 only) and `principal_kind: 'agriculturist'`; farmer set-offs reuse `exchange_purchase_id`, never a new
  no-cash marker; Rule 6DD(e) goes through `agri/ag-cash.ts`. Rule values in `src/lib/agri-rules.ts` (lazy only,
  `tests/ag-rules.test.ts`). Notes: `docs/features/agri-r12.md`.
- Round 13 (manufacturing) company data: names in `src/lib/mfg/mf-shared.ts` (MF-A tables `work_centres`, `routings`,
  `job_cards` (series `JCD`, one row per production order per operation with an `entries` array), object `mfg_settings`;
  MF-B / MF-C series `FAI` / `PES` / `CUT` / `KPB` in `MF_SERIES`; see `docs/features/mfg-r13.md` for each package's tables), all backed up and synced; settings `mfg_kind` / `mfg_sub` (a wizard
  card, not a business type: `manufacturer`, `other` unchanged; packs `shopfloor` / `fabrication` / `garments` / `plastics` /
  `press` / `foodmfg` in union with the company's packs — desk tabs on `/manufacturing` via `MFG_PACK_TABS`; `PACK_OF_TYPE` /
  `PACK_ROUTES` unchanged). Rights and audit labels are registered at runtime by `src/lib/mfg/mf-registry.ts`: **every
  module that writes a Round 13 table must `import './mf-registry'`** (`tests/mf-registry.test.ts`). Round 13 invoice
  snapshots live under ONE record key `mf` (`R13_RECORD_KEYS`, spread into `R9_RECORD_KEYS`; no line key) — never add keys.
  The Udyam line / MSE clause / FSSAI line print from the sender snapshot (`msme_category`, `udyam_print`, `fssai_no`).
  Release copies the default routing onto the order (`ProductionOrder.mf.ops`, `mfg/mf-ops.ts`) only with `shopfloor`;
  job-card scrap kg reaches stock once through `buildOutputVoucher`'s optional `{ scrapLines, conversion }` (without it
  the journal is unchanged). Conversion absorption (MF-D5) is a dated setting, off by default; karigars are vendors,
  piece-rate employees stay in payroll. Rule values in `src/lib/mfg-rules.ts` (lazy only, `tests/mf-rules.test.ts`).
  Notes: `docs/features/mfg-r13.md`.
- Round 14 (professional firms) company data: names in `src/lib/prof/ps-shared.ts` (PS-A tables `engagements` (series
  `ENG`), `conflict_checks`, object `prof_settings`; `CMV` reserved for PS-B), all backed up and synced; settings `prof_kind` /
  `prof_sub` (a profile under business type `services` + `service_kind: 'professional'`, packs `practice` / `cafirm` / `legal` /
  `design` / `media` / `svcexport` / `partners` — desk tabs on `/time`, mounted by file name through `import.meta.glob` over
  `components/prof/*Desk.tsx`; `PACK_OF_TYPE` / `PACK_ROUTES` unchanged). The firm form is the annual pack's entity type
  (`notes_to_accounts.entity_type`), never a second field. A matter IS a project cost centre with `CostCentre.ps`. Rights and
  audit labels are registered at runtime by `src/lib/prof/ps-registry.ts`: **every module that writes a Round 14 table must
  `import './ps-registry'`** (`tests/ps-registry.test.ts`). Round 14 invoice snapshots live under ONE record key `ps`
  (`R14_RECORD_KEYS`, spread into `R9_RECORD_KEYS`; per-line particulars in `ps.lines[lineId]`) — never add keys; pure-agent
  disbursement lines carry `charge_head_id: 'rule33'`. Write-downs are derived from `bill_refs` (`ps-writedown.ts`), never a
  per-entry table; a WIP write-off stamps `TimeEntry.ps.wo` / `PurchaseRecord.ps.wo` (the Unbilled list leaves them out).
  Rule values in `src/lib/prof-rules.ts` (lazy only, `tests/ps-rules.test.ts`). Notes and the B–D API: `docs/features/prof-r14.md`.
- Round 15 (travel, tour & events) company data: names in `src/lib/travel/tv-shared.ts` (R15-B table `travel_bookings`,
  object `travel_settings`), all backed up and synced; settings `travel_kind` (a profile under business type `services` +
  `service_kind: 'travel'`, packs `travel` / `events` — desk tab `trips` on `/time`). A trip / event IS a project cost
  centre with `CostCentre.tv`; billed state is derived from `line_ref`, never stored. Rights and audit labels are registered
  at runtime by `src/lib/travel/tv-registry.ts`: **every module that writes a Round 15 table must `import './tv-registry'`**.
  Round 15 invoice snapshots live under ONE record key `tv` (spread into `R9_RECORD_KEYS`) — never add keys; pass-through
  bookings reuse the pure-agent `charge_head_id: 'rule33'`. A supplier bill tagged to a 5 % tour-operator trip has ITC
  unticked; claiming it needs an audited reason. Rule values in `src/lib/travel-rules.ts` (lazy only, date-keyed).
  R15-A: party netting posts receipts with the existing `exchange_purchase_id` marker + `method: 'netting'`
  (`src/lib/netting.ts`, `Vendor.client_id`); audit appends are coalesced per task — call `audit.flush()` before reading the
  raw audit key outside `audit.ts`. Notes: `docs/features/travel-r15.md`.
- Round 17 (security, facility-management & manpower agencies) company data: names in `src/lib/manpower/mp-shared.ts`
  (object `manpower_settings`; B / C add `site_musters` / `site_compliance`), all backed up and synced; settings
  `manpower_kind` (a profile under business type `services` + `service_kind: 'manpower'`, packs `manpower` / `security` —
  desk tab `deploy` on `/time`, mounted by file name through `import.meta.glob` over `components/manpower/*Desk.tsx`;
  `PACK_OF_TYPE` / `PACK_ROUTES` unchanged). A site IS a project cost centre with `CostCentre.mp` (posts inside); the firm
  form is the annual pack's entity type, never a second field. Rights and audit labels are registered at runtime by
  `src/lib/manpower/mp-registry.ts`: **every module that writes a Round 17 table must `import './mp-registry'`**
  (`tests/mp-registry.test.ts`). Round 17 invoice snapshots live under ONE record key `mp` (`R17_RECORD_KEYS`, spread
  into `R9_RECORD_KEYS`) — never add keys; Sl. 66 lines reuse the R10 line key `sv.exempt`, RCM bills the existing
  `reverse_charge` / `rcm_tax_excluded` (one regime per invoice: `mp-regime.ts` `splitPosts`). Build group `f-manpower`
  (`vite.config.ts`; `mp-registry.ts` excluded, a lazy leaf, since sync / recycle bin import it): engines in `src/lib/manpower/` import only first-paint modules, `manpower-rules.ts` and each
  other; anything else goes through a bridge `mp-*-io.ts` (≤ 4; `mp-payroll-io.ts` is the only Round 17 writer of payroll
  tables — by the store's rules through `storage.ts`, never importing `payroll/store.ts`, which would split the shared
  payroll chunk and grow the entry preload map). R17-B musters: one `site_musters` row per site × month (rows inside,
  dated `date` = month end); billing and the payroll push read locked musters only; billed state is derived from
  `mp.muster_id` / `mp.muster_ids` (`billsOf` leaves credit / debit notes out). R17-C `site_compliance` (one per site × month,
  shares of the FINAL payroll run by duties, read by `mp-payroll-io.ts` `readRunForMonth`; UAN last four, never bank fields;
  a client hold is shown, never posted). R17-D arrears go through `createDebitNote` (DBN, `doc_links`) with `mp.arrear`
  and no `muster_id`; licence notices come from `mp-alerts.ts` behind the bell's `manpower` gate. Rule values in `src/lib/manpower-rules.ts` (lazy only, `tests/mp-rules.test.ts`; no wage amounts). Notes:
  `docs/features/manpower-r17.md`.
- Round 18 (co-operative housing societies, apartment owners' associations & RWAs) company data: names in
  `src/lib/society/hs-shared.ts` (R18-A table `society_units` (not dated, `master.edit`), object `society_settings`
  (`settings.manage`, audited on save, a singleton; absent = nothing society — `societyDefaultsFor` fills what is not
  stored); B adds `society_runs`, dated by the bill date), all backed up and synced. Settings `society_kind` (`chs` /
  `aoa` / `rwa` / `commercial` / `agency`): a wizard card, not a business type — business type `nonprofit` (`services`
  for `agency`) with an EXPLICIT `industry_packs` list ∪ `society` (the type's donations pack is never switched on by
  it); desk tab `society` on `/recurring` (`RECURRING_TABS`, lazy `components/society/SocietyDesk.tsx`, views in
  `&view=`: A `units` / `heads`; B–D add `bills`, `gst`, `dues`, `funds`, `registers` — views, never tabs); Books
  `funds` and GST `common-credit` take `society` in `alsoPacks`; `PACK_OF_TYPE` / `PACK_ROUTES` unchanged. A unit's
  member is a client (`Client.hs` = units + role, re-linked by `hs-units-save.ts`); a tenant is recorded, never billed.
  Rights and audit labels are registered at runtime by `src/lib/society/hs-registry.ts`: **every module that writes a
  Round 18 table must `import './hs-registry'`**, and so do `sync-engine.ts` and `trust/recycle-bin.ts`
  (`tests/hs-registry.test.ts`). Round 18 invoice snapshots live under ONE record key `hs` (`R18_RECORD_KEYS`, spread
  into `R9_RECORD_KEYS`) — never add keys; pass-through statutory dues reuse `charge_head_id: 'rule33'`, the SAC sits in
  `hsn`. Build group `f-society` (`vite.config.ts`, `familyRe('society', 'society-rules', 'society-r18', 'hs-registry')`
  — the registry a lazy leaf): engines in `src/lib/society/` import only first-paint modules, `society-rules.ts` and
  each other; shared lazy code goes through bridges `hs-*-io.ts` (≤ 4). Rule values in `src/lib/society-rules.ts`
  (lazy only, date-keyed, `tests/hs-rules.test.ts`); **State society rules are data rows (`STATE_SOCIETY_RULES`, by
  State code and date), never code** — a bill not in force (KA 2026) carries `in_force: false` and applies only once the
  user confirms it (`society_settings.confirmed`); State checks are hints. Notes: `docs/features/society-r18.md`.
- Round 19 (freight forwarders, customs brokers (CHA), courier franchisees & 3PL warehouses) company data: names in
  `src/lib/logistics/lg-shared.ts` (R19-A table `lg_jobs` (dated by `date`, `doc.create`, series `JOB` — `JOB/FY26-27/0001`,
  branch prefix `JOB-BOM`), object `logistics_settings` (`settings.manage`, audited on save, a singleton; absent = nothing
  logistics — `lgDefaultsFor` fills what is not stored); D adds `lg_manifests` / `lg_storage` (dated by the month end)),
  all backed up and synced. **A job is a `lg_jobs` row, never a cost centre**; documents point at it by `lg.job_id`.
  Settings `logistics_kind` (`forwarder` / `cha` / `courier` / `warehouse` / `multi`): a wizard card, not a business type —
  business type `transport` with EXPLICIT `modules` (the transport preset ∪ `time`; unregistered drops `gst`) and an
  EXPLICIT `industry_packs` list from `logistics` / `customs` / `courier` / `warehouse` (the R5-B `transport` pack only when
  "We also run our own lorries" is ticked). Desk tab `shipments` on `/time` (`TIME_TABS`, mounted by file name through
  `import.meta.glob` over `components/logistics/*Desk.tsx`; views in `&view=`: A `jobs` / `rates`; B `billing` / `costing`,
  C `customs`, D `agents` / `courier` / `storage` — views, never tabs); the R14 `exportsvc` tab takes `logistics` in
  `alsoPacks`; `PACK_OF_TYPE` / `PACK_ROUTES` unchanged. Rights and audit labels are registered at runtime by
  `src/lib/logistics/lg-registry.ts`: **every module that writes a Round 19 table must `import './lg-registry'`**, and so do
  `sync-engine.ts` and `trust/recycle-bin.ts` (`tests/lg-registry.test.ts`). Round 19 invoice snapshots live under ONE
  record key `lg` (`R19_RECORD_KEYS`, spread into `R9_RECORD_KEYS`) — never add keys; pure-agent recoveries reuse
  `charge_head_id: 'rule33'`, the SAC sits in `hsn`, each line's head in `lg.heads[lineId]`. Build group `f-logistics`
  (`vite.config.ts`, `familyRe('logistics', 'logistics-rules', 'logistics-r19', 'lg-registry')` — the registry a lazy leaf):
  engines in `src/lib/logistics/` import only first-paint modules, `logistics-rules.ts` and each other; shared lazy code
  goes through bridges `lg-*-io.ts` (≤ 4: issue / tax / books / recv). Batch billers (month-end jobs, courier manifests,
  storage) use `localDb.invoices.saveMany`. R19-C adds no table: a disbursement is a `purchases` expense with
  `lg.on_behalf` (0 %, no ITC, pure agent, billable; billed while a live invoice line's `bill_refs` names it), a duty
  deposit an advance with `pass_through` + `lg.job_id` (applied by the existing `advance_id` row), through the one C
  bridge `lg-recv-io.ts`; B's "Bill job" bills them through `billExtras` (`disbCharges`, billed by row via `bill_refs`). Rule values in `src/lib/logistics-rules.ts` (lazy only, date-keyed, keyed rows
  read with `keyedAt`, `tests/lg-rules.test.ts`); GTA rates, the intermediary rule, TDS sections and Act labels stay in
  their own files, read through `lg-tax-io.ts`. CA ids `LG1`–`LG44` (`LG` sits before `G` in every CA-id regex). R19-B: job bills via `lg-issue-io.ts`
  (one `saveMany`; regimes `lg-regime.ts`; C / D add lines only through `billExtras` in `lg-bill.ts`); a POS-96 document with
  `lg.regime: 'export_freight'` and a valid client GSTIN is B2B, not EXP, in `gst-reports.ts` / `einvoice.ts` (LG15). Notes:
  `docs/features/logistics-r19.md`.
- 8H company data: `business_type` / `modules` on the settings object (shop mode, absent = full), tables `business_loans`
  and `currency_rates`; finer user rights live on the device-local user record (`rights`, never backed up).
- Rounds 2–5 company data (backed up and synced; each registered in `backup.ts`, `access.ts` `TABLE_ACTIONS`,
  `audit-edits.ts` and, when dated / numbered, `sync-engine.ts`; rows in `docs/ARCHITECTURE.md`):
  R2-A `payment_terms`, `collection_notes`, `write_off_recoveries` + objects `reminder_settings`, `collection_settings`;
  R2-B `batch_runs`, `proposal_snippets`; R2-C `notes_to_accounts`, `deferrals`, `packing_lists`, `package_types`;
  R3-A `dining_areas`, `dining_tables`, `table_orders`, `modifier_groups` + object `restaurant_settings`;
  R3-B `work_types`, `project_tasks`, `retainers` + objects `project_settings`, `quiet_settings`;
  R3-C `gst_portal_files`, `dsc_register`, `client_checklist` + object `checklist_template`;
  R4-A `production_orders`, `qc_results`, `recall_notices`, `landed_cost_vouchers` + object `qc_settings`;
  R4-B `gift_vouchers`, `branch_prices`, `transfer_requests` + object `gift_voucher_settings`;
  R4-C `lut_register`, `export_irms`, `export_incentives`, `export_writeoffs`, `recycle_bin` (backed up, **not synced**,
  no `TABLE_ACTIONS` entry) + object `bin_settings`;
  R5-A `sales_channels`, `channel_skus`, `marketplace_imports`, `settlements`, `eco_credits`, `marketplace_returns`;
  R5-B `consignment_notes`, `gta_options`, `vehicles`, `trips`, `ra_measurements`, `boq_coefficients`;
  R5-C `fee_plans`, `fee_runs`, `common_credit_runs`, `donations`, `form_10bd_filings`, `form_10be`, `properties`,
  `leases`, `security_deposits`. Settings fields `industry_packs`, `npo_admin_accounts`, `npo_accumulated`.
  New `series_counters` series: `FCN` (financial credit notes), `PKL`, `WO`, `LCV`, `GV`, `TRQ`, `LR`, `TRP`, `DON`. Additive record fields come by
  declaration merging in each package's types file (`src/types/{sales-r2,contacts,books-r2,restaurant,service-r3,docs-r3,production-r4,stores-r4,trade-r4,marketplace-r5,transport-works-r5,institutions-r5}.ts`),
  e.g. `InvoiceRecord.annexure` / `delivery_proof` / `table_order_id`, `Client.doc_defaults` / `contacts`,
  `TimeEntry.work_type_id / task_id / retainer_id / retainer_period` (R2-A's `payment_terms`, `note_kind` … sit in
  `src/types/invoice.ts`). New `InvoiceRecord` keys must also go into `RECORD_KEYS` and `normalizeRecord`.

## Critical Rules — DO NOT BREAK
1. **Local-first & serverless.** No backend, DB, or network calls. Do not add axios/express
   or a server DB. Everything runs in the browser; data lives in IndexedDB/localStorage via `src/lib/storage.ts`.
2. **No TailwindCSS.** Vanilla CSS + CSS Modules only. Use CSS variables, not raw hex, in components.
3. **Invoice snapshotting.** On save, the invoice embeds a snapshot of the selected sender
   profile. The preview must read from `invoice.sender` first (fall back to global settings only
   for legacy invoices) so historical invoices never change.
4. **Indian Financial Year numbering** (Apr 1 – Mar 31), format `INV/FY25-26/0001`. Do not switch
   to calendar-year numbering. Regression-tested in `tests/localDb.test.ts`.
5. **Template engine.** Never hardcode colors in layouts; always use the `accent` prop/variable.
6. **PDF stack** stays `html-to-image` + `jspdf` (no `@react-pdf/renderer`, no server-side PDF).
7. Keep dependencies minimal; verify `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` before committing.
8. **Parse bare dates as local days** (`YYYY-MM-DD`), never `new Date(str)` — UTC parsing shifts the financial year.
9. **Purchases contract.** Modules that read `purchases` must understand `src/types/purchases.ts`;
   `tests/purchase-contract.test.ts` guards this. Add new reader modules to that test.
10. GST/e-Invoice/Tally outputs are working papers, not portal-validated — keep the "verify with your CA" wording.

## Commands
```bash
npm install      # install deps (run once after cloning / after dep changes)
npm run dev      # Vite dev server
npm run build    # tsc -b && vite build (production)
npm run preview  # preview the production build
npm run typecheck# tsc -b (no emit)
npm run lint     # eslint .   (lint:fix to auto-fix)
npm test         # node:test on tests/**  (zero extra deps; needs Node >= 22)
npm run test:coverage # same, with a coverage table for src/
npm run test:e2e # Playwright smoke against dist/ (run `npm run build` first)
```

## Environment
No runtime secrets or environment variables are required (see `.env.example`). Any future
build-time config must use Vite's `VITE_` prefix.

## Known tech debt
- `src/` compiles with `strict: true`; `tests/` are typechecked too (`tsconfig.test.json`, non-strict —
  fixtures use partial records). ESLint `no-explicit-any` stays a warning.
- `react-hooks/set-state-in-effect` kept as a warning — the app's correct localStorage-hydration
  pattern triggers it; rewriting needs care.
- Purchases are read through the shared `readPurchase` + `splitLumpTax` (`purchase-normalize.ts`);
  `gst-reports`, `books` and `export-shared` only adapt the result to their own field names.
- Statutory values that change over time (B2CL threshold, GST slabs, TDS/TCS presets) live in
  `src/lib/tax-rules.ts`, keyed by effective date — add new values there, never overwrite old ones. Package rule files
  with the same shape stay out of first paint: `src/lib/eway-validity.ts` (R3-C), `src/lib/trade/trade-rules.ts` (R4-C),
  `src/lib/transport-works-rules.ts` (R5-B), `src/lib/r5c-rules.ts` (R5-C), `src/lib/trading-rules.ts` (R8-C: 206C(1) /
  206C(1F) / 194Q buyer test / RCM notified goods / composition alerts).
  Exception: GST interest / late-fee tables live in `src/lib/gst-penalties.ts` (same date-keyed shape) so they
  stay out of the early-loading notifications chunk, and payroll statutory values (EPF / ESI / PT / TDS u/s 192) live in
  `src/lib/payroll-rules.ts` (same shape) so the lazy payroll route does not grow the first-paint bundle.
- Recommended but not yet notified changes (57th GST Council …) are notes, never rule rows: `src/lib/pending-changes.ts`
  (R16-D4, lazy, shown by `components/ui/PendingNote.tsx` and Help → What's new). No rule file or reader imports it
  (`tests/pending-changes.test.ts`); on notification append the dated rule row and set the row's `notified`.
- Income-tax Act 2025 (from 1 Apr 2026): screens and exports label TDS / TCS sections and forms by the document /
  transaction date through `src/lib/ita2025.ts` (date-keyed, append-only); stored codes (`194C-1`, `26Q:2026-Q1` …)
  are never renamed.
- Industry packs (`src/lib/industry-packs.ts`): an explicit `settings.industry_packs` list wins, else the packs implied
  by `business_type`, else none. Pack screens are lazy, listed in `PACK_TABS`, and read nothing while their pack is off.
- Clearing bank accounts (`BankAccount.clearing`: marketplace settlements, "RA deductions clearing") are not real banks:
  cheque / e-payment / BRS pickers must use `pickableBankAccounts`, which never offers them.
- Recycle bin (R4-C4): deletes go through data-layer calls (`setTable` on a watched table, `localDb.invoices.remove`,
  `deleteVoucher`), which copy the row to `recycle_bin`; never delete by `writeRaw` or resurrect rows by hand. A
  deleted invoice / voucher number stays reserved in `series_counters`.
- Help (Round 6): **a new route or tab needs a help topic** in `src/lib/help/topics-*.ts` — `tests/help-registry.test.ts`
  walks every route, sidebar entry, GST / pack tab and every list in `src/pages/page-tabs.ts` (page tab lists live
  there; a new tab also needs its Ctrl+K title in `discover-r6-tabs.ts`). Open Help from anywhere with
  `openHelp(topic)` (`src/lib/help-event.ts`); F1 opens it except on `/pos`, `/gateway` and in fields.
- Version (Round 6): `__APP_VERSION__` comes from `package.json`; **the newest `WHATS_NEW` entry
  (`src/lib/whats-new.ts`) must match the package.json version** (`scripts/check-whats-new.mjs` fails `postbuild`).
- Sample data goes only into the separate Demo company (`startDemoCompany` / `SampleDataChooser`), never a real one.
  The Demo company is identified by a durable marker, never by its name (QA7 G1/G2): `demo: true` on its registry entry
  AND `settings.demo_company: true` inside its own database, both written only by `demo-company.ts`. `loadDemoData`
  refuses (`not_demo_company`) unless `demoDatabaseOpen()` — `confirm` never bypasses it. The Demo company does not count
  as one of the user's companies (`realCompanies()`: Practice desk, All companies search).
- Dialogs (QA7 G3): every `Modal` registers in `src/lib/modal-stack.ts`; only the top one acts on Escape / Tab, and F1
  does nothing while an `[aria-modal]` dialog is open.
- Every lucide icon lands in the first-paint `vendor-ui` chunk: reuse an icon that is already imported somewhere
  instead of adding a new name.
- `/practice` reads other companies' databases through `peekCompliance` (`company-peek.ts`): a version-less,
  read-only open that aborts any upgrade, so a missing or older database is never created or upgraded. Keep it that way.
- `Godown.kind` (`src/types/stock.ts`) is a shared, append-only union (`'van' | 'expiry' | 'wip' | 'qc' | 'transit' |
  'site' | 'consignment' | 'used'`); `nonSaleableGodowns` (`godowns.ts`) treats expiry / wip / qc / transit / site /
  consignment as non-saleable (a sale line naming its agency lot `arrival_id` may still sell from consignment) — decide
  that for any new kind. R9: `'used'` (second-hand goods bought by exchange / buy-back, old gold) is **saleable**; a sale
  from it is flagged for the margin scheme (`usedGoodsGodowns`, RT-D3 / RT-E3).
- Batch issuing (R18 platform fix): `localDb.invoices.saveMany(list)` validates, numbers and holds each document exactly
  like `save` but writes the invoices table once (`save(x)` = `saveMany([x])[0]`); `issueBatch` uses it for service-only
  batches (stock batches still save one by one); so do the marketplace sales import, freight bills and agency
  commission bills (QA21 W10). Any new bulk writer must use it, never a loop of `save`. A society bill's place of supply
  is the building's State (`BatchContext.pos`, QA21 W2).
- Recurring schedules in draft mode create **unnumbered** drafts; the number is taken on issue (`numberOnIssue` in
  `localDb.ts`), so no gap reaches GSTR-1 Table 13. Drafts numbered before QA round 3 keep their numbers.
- Financial credit notes (`note_kind: 'financial'`, `FCN/FY…`, R2-A) carry no GST by default: GST / e-Invoice / e-Way
  readers skip them via `isNonGstFinancialNote` (`financial-note.ts`) — new GST outputs must do the same.
- Landed-cost vouchers (R4-A) reach the stock engine through `liveInputs()` (engine copies of bills / GRNs); readers
  that take raw bills (the editor margin chip, insights) do not see them yet.
- The bill / PO / GRN line editor sets `PurchaseLine.item_id` when a stock item is picked (WP-8) and the stock engine
  matches on it first; older lines (and typed names) still match by name + HSN, so keep that fallback.
- Alternate units: a line typed in another unit keeps quantity / rate as typed and snapshots `unit_factor` (invoice,
  bill / GRN / return, POS, stock move, stock transfer, stock journal and job-work lines); every stock reader must
  convert with `lineFactor` / `PurchaseLineCore.unitFactor` (`src/lib/units.ts`).
- Receipt rows that moved no money: `gift_voucher_id` (R4-B, settles against "Gift vouchers outstanding"),
  `deposit_adjustment_id` (R5-C6, settled from a security deposit), `ra_journal_id` (R5-B5, GST TDS / labour cess on
  an RA bill), `exchange_purchase_id` (R9, settled by the customer's old device / old gold on a URD purchase voucher —
  "Sundry creditors — exchange"), plus `write_off` and `advance_id`. (R9 COD cash tagged `rider_id` DID move: it posts to
  the "Cash with riders" ledger until the rider settles — not a no-cash row.) Every cash / bank reader (cash book, Today, bank reco, cash tally, payment
  modes, Z report, Tally / CSV receipts, collection lag) must skip them with the ONE predicate `movedNoCash(p)`
  (`src/lib/no-cash.ts`, imported via `advance-tax.ts`), never its own marker checks; `tests/no-cash-readers.test.ts`
  guards new readers.
- Credit notes are linked to invoices through the `doc_links` table; GSTR credit/debit-note sections
  treat them as standalone documents.
- A 4-6 digit PIN is a lock screen, not encryption of the stored data; optional vault mode (`src/lib/vault.ts`) encrypts the IndexedDB store at rest. Never write the `__vault__` record or sealed (`mcv1:`) values outside `storage.ts`.
- `.xlsx` is handled by our own minimal reader/writer (`src/lib/zip.ts` + `src/lib/xlsx.ts`, native
  `DecompressionStream`/`CompressionStream`): no `.xls`/`.ods`/encrypted/ZIP64 workbooks, no styles beyond a bold
  header row on export. Imports read the first non-empty sheet. Keep it out of the shell (dynamic import).
