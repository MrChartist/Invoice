# Perf round 4 — scale audit (verify step)

Status: **before** numbers, no code changed. Audit of the production build with a realistic large company in
IndexedDB, to hand two fix packages (PERF-1, PERF-2) to the fix agents. Date: 2026-10-26, commit `b27b7f9`.

## TL;DR

At 3 years / ~15.7k sales documents the app is not usable on a phone and is sluggish on desktop. Nearly every
slowdown has the same root: **the 36 MB `invoices` JSON string is parsed again and again** (`getTable` has no
parsed cache; only 42 of ~790 call sites use `peekTable`). On top of that sit several derived computations
that run on every render, every keystroke or on a timer: stock positions, notifications, SmartFind scoring.

| Worst offenders (desktop, prod build) | Measured | Target |
|---|---|---|
| SmartFind keystroke (palette open, typing "ganesh 1435") | median **3.0 s**, p95 7.0 s per key (phone 12 s / 36 s) | < 300 ms |
| Notification bell refresh (on window focus, every 60 s, every cross-tab change) | **5.0 s** single long task (phone **20–38 s**) | < 50 ms |
| Cold start to a quiet dashboard | first paint 3.9 s, main thread busy until **14.2 s** (phone 6.4 s / **~56 s**) | 2.5 s / 5 s |
| Save an invoice | click → saved **6.7 s**, busy 18.7 s (phone 20 s / 97 s) | < 300 ms |
| Editor: typing the client name | **395 ms** median per key (phone 1.5 s, p95 15 s) | < 50 ms |

## Setup (reusable by the fix agents)

All scripts live in the scratchpad; nothing under `src/` was touched.

```
P=/tmp/claude-0/-home-user-Invoice/c401a5ec-398d-5b90-84fd-5f6b9cfff692/scratchpad/perf
```

| File | What it does |
|---|---|
| `$P/gen-dataset.ts` | **Dataset generator.** Builds rows with the app's own code (`makeDraft` + `withTotals`, `setTable` so sender logos become `asset:<id>` refs, the real audit hash chain via `rowHash`, `schema_version` stamped current) and writes every `mrchartist_inv_*` key → JSON string to `$P/dataset.json`. `--scale=0.5` etc. for smaller sets. Run: `cd /home/user/Invoice && node --experimental-strip-types --no-warnings --import ./tests/hooks/register.mjs $P/gen-dataset.ts [out.json] [--scale=1]` (~12 s). |
| `$P/lib.mjs` | Harness: serves a dist dir with the real `_headers`, injects the dataset straight into IndexedDB `mrchartist_inv_kv` / store `data` with the `__meta__` marker (+ `storage_backend=idb`, auth + session in local/sessionStorage, the way a migrated install looks), long-task observer, CPU profiler + summariser that maps unminified chunks back to `src/` modules, and an optional `JSON.parse/stringify` spy that logs every call over 50 KB with its caller. |
| `$P/run-suite.mjs` | The measured tour (cold start → invoices → editor → save → receivables → GST → Books → annual pack → POS → SmartFind → backup export/restore). `--phone` = 390×844 mobile + 4× CPU throttle; `--spy` JSON spy; `--prof --dist=dist-prof` CPU profile per step. Writes `$P/out/suite-<tag>.json` and `$P/out/<tag>-<step>.cpuprofile`. |
| `$P/extras.mjs` | Cold start ×N in fresh contexts (median), isolated bell refresh (window `focus`), palette open from a light page, empty-app heap. |
| `$P/incl.mjs` | `node incl.mjs <cpuprofile> '<regex>'` → inclusive ms of matching functions and their top callees. |
| `$P/perf-scaled.test.ts` | `tests/perf.test.ts` with `N` from `PERF_N` (default 15000), for the Node comparison. |
| `$P/dist-prof/` | Same build with `--minify false` (readable names in profiles). Rebuild: `npx vite build --minify false --outDir $P/dist-prof --emptyOutDir`. |

Dataset produced (scale 1, Nov 2023 – Oct 2026, 4 Indian FYs touched, 60 MB of JSON in 19 keys):

| Table | Rows | Size |
|---|---|---|
| `invoices` (12.5k tax invoices B2B/B2C intra/inter-state, 2,464 POS bills `pos:true`, 668 credit notes linked in `doc_links`, quotations/challans, drafts, cancelled; 1–8 lines, 30% batch lines) | 15,668 | 36.2 MB |
| `transactions` (receipts with `receipt_number`) | 25,512 | 3.7 MB |
| `purchases` (6k bills with stock lines + batches/expiry, 2k expenses) / `purchase_payments` | 8,000 / ~6,000 | 8.0 / 1.2 MB |
| `clients` / `vendors` / `stock_items` (30% batch-tracked) / `items_catalog` | 1,500 / 300 / 2,000 / 2,000 | 0.35 / 0.08 / 0.56 / 0.36 MB |
| `vouchers` (JV/CV/PV/RV) / `stock_moves` | 3,000 / 1,000 | 0.76 / 0.14 MB |
| `audit_log` 4,999 rows + `audit_archive_0001…0004` 4,500 rows each (valid hash chain) | 22,999 | 2.2 + 4×1.9 MB |

Environment: headless Chromium (Playwright) on a **shared 4-vCPU container that had other agents' builds
running** (load average ~10). Absolute numbers carry ±30–50 % noise; cold start was repeated (3× desktop,
2× phone) and medians are shown. Hot-spot attribution comes from CPU profiles and the JSON spy, which are
stable across runs. "busy" = time until the last long task of the interaction ended.

## Metrics — before

Targets: cold start < 2.5 s desktop / < 5 s phone; editor keystroke < 50 ms; every other interaction < 300 ms.
✗ = misses target.

| Interaction | Desktop | Phone (4× CPU) | Target | |
|---|---|---|---|---|
| Cold start: dashboard heading painted | 3.95 s (1.9–6.1) | 6.4 s (6.2–6.6) | 2.5 s / 5 s | ✗ |
| Cold start: main thread quiet (dashboard interactive) | **14.2 s** (12.7–17.7), max long task 1.9–2.7 s | **55.9 s** (53–58), max long task 8–9 s | 2.5 s / 5 s | ✗ |
| Invoices list open | 1.18 s busy (max LT 0.95 s) | not captured cleanly¹ | 300 ms | ✗ |
| Invoices list scroll (15 screens) | 82 ms / frame median, 140 ms max | 257 ms / frame, 320 ms max | 300 ms (16 ms ideal) | ~ |
| Invoices search, per keystroke | 105 ms median, 156 ms p95 | 455 ms / 550 ms | 300 ms | ✗ phone |
| Editor open (new invoice) | 1.6 s | 6.2 s | 300 ms | ✗ |
| Editor keystroke — client name | **395 ms** median, 516 ms p95 | **1.53 s** median, **15.2 s** p95 | 50 ms | ✗ |
| Editor keystroke — item name | 76 ms median, 268 ms p95 | 314 ms / 594 ms | 50 ms | ✗ |
| Editor keystroke — quantity (10 lines) | 24 ms median, 54 ms p95 | 144 ms / 151 ms | 50 ms | ✗ phone |
| Save invoice (click → saved) | **6.7 s** (busy 18.7 s, max LT 6.2 s) | **20.4 s** (busy 97 s, max LT 19 s) | 300 ms | ✗ |
| Receivables / khata open | 2.4 s | 8.2 s | 300 ms | ✗ |
| GSTR-1 open (current month) | 0.81 s | 2.7 s | 300 ms | ✗ |
| GSTR-1/3B switch period to full FY | 0.66 s | 1.6 s | 300 ms | ✗ |
| GSTR-3B tab | 0.15 s | — (tabs are a select on phone) | 300 ms | ✓ |
| Books P&L (ledger) | ready 2.5 s, busy 3.0 s² | 11.3 s | 300 ms | ✗ |
| Books balance sheet / trial balance (after P&L) | 0.44 s / 0.14 s | 1.5 s / 0.77 s | 300 ms | ✗ / ✓ desktop |
| Annual pack open / ZIP build | 2.3 s / 0.14 s | 9.3 s / 0.6 s | 300 ms | ✗ / ✓ |
| POS open | 2.6 s | 9.0 s | 300 ms | ✗ |
| POS scan → line | 48–141 ms | 168–238 ms (one 12 s outlier: bell poll²) | 300 ms | ✓ |
| SmartFind open (first / cached index) | 1.15 s / 0.09 s | 4.4 s / 0.13 s | 300 ms | ✗ first |
| SmartFind keystroke (text) | **3.0 s** median, 7.0 s p95 | **12.0 s** median, 36 s p95 | 300 ms | ✗ |
| SmartFind keystroke (amount `>50k`) | 136 ms median, 2.0 s p95 | 303 ms / 6.6 s | 300 ms | ✗ |
| Notification bell refresh (focus / 60 s poll / cross-tab) | **5.0 s** one long task | **20–38 s** | 50 ms | ✗ |
| Backup export (click → file) | 2.5 s (busy 6.9 s), 69 MB file | 30 s (busy 38.7 s) | 300 ms³ | ✗ |
| Backup restore: pick file → confirm dialog | 3.9 s | 13.0 s | 300 ms³ | ✗ |
| Backup restore: confirm → dashboard after reload | 7.1 s | 19.2 s | 2.5 s / 5 s | ✗ |
| JS heap: empty app / dashboard / after the tour | 6 / **159** / 197 MB | same | — | |

¹ The phone run's settle window overlapped the previous step; parse + sort cost from the profile puts it at ~4 s.
² Interactions that ran when the bell's 60 s poll fired took several seconds more (first desktop P&L run: 9.2 s busy). The poll is hot spot H2.
³ Backup is a deliberate action, so seconds are tolerable; the problem is that the main thread freezes for all of it.

### Node comparison (`tests/perf.test.ts`)

The unit perf test uses pure functions on in-memory arrays (no IndexedDB, no asset decoding, one FY, sender
without logo), so it badly under-states the app. At the same 15k scale its storage test **fails its own cap**:

| perf.test.ts measure | N = 5,000 (as committed) | N = 15,000 (`perf-scaled.test.ts`) | In the browser at 15.7k |
|---|---|---|---|
| `localDb.invoices.getAll` ×10 | 680 ms | **2,859 ms — fails cap 2,500** | 230–290 ms per parse; **26 parses** of the 36 MB table during cold start, 53 while typing a client name |
| `receivables.buildReceivables` | 149 ms | 274 ms | 184 ms (+ 576 ms payment scores + 265 ms late-fee lookup) |
| `books.buildVouchers + dayBook + cashBook` | 325 ms | 707 ms | 350 ms self in `buildVouchers` at cold start |
| `books.profitAndLoss` | 208 ms | 363 ms | 544 ms `getProfitSnapshot` at cold start |
| `books.balanceSheet + gstSummary` | 293 ms | 782 ms | 0.44 s BS tab |
| `gst-reports.buildGstReport (FY)` | 587 ms | 1,355 ms | 310 ms (FY switch) |
| `inventory.computeStock` (200 items) | 507 ms | 1,051 ms | 2,000 items: 2.0 s per call, **3.1 s** at cold start (called 4×) |
| `stats.summarize` | 37 ms | 35 ms | fine |
| `calculateInvoice` 500 lines ×50 | 127 ms | 156 ms | fine (qty keystroke 24 ms) |

The pure engines are roughly linear; the app is slow because it calls them, and `JSON.parse` before them,
many times over. Recommendation for the fix agents: add a storage-level test to `tests/perf.test.ts` that
counts parses (see "Guard rails" below) instead of only timing pure functions.

## Hot spots

Ranked by user impact. Evidence is from `$P/out/desktop-spy-prof-*.cpuprofile` (unminified build, desktop)
and the JSON spy; `N×` = number of calls in that interaction.

### H1 — `getTable` re-parses the 36 MB invoices table on every call (root cause)

- **Where:** `src/lib/storage.ts` `getTable` (no cache; `peekTable` exists but has 42 callers vs ~750 `getTable`
  calls), `localDb.invoices.getAll()` / `localDb.payments.getAll()` (`src/lib/localDb.ts`), and every bulk reader.
- **Evidence (JSON spy):** one parse of `invoices` = 230–290 ms desktop, ~1 s phone, plus ~60 ms `decodeRows`
  (asset refs, `assets.ts mapRow`). Parses of the 36 MB table per interaction:
  cold start **26** (6.8 s of `JSON.parse`, plus 4.2–4.6 s of GC); typing 13 chars of a client name **13**
  (3.9 s); save **24** (8.6 s parse); backup export 10; palette open after a dashboard visit 18.
  Callers at cold start: `notifications.buildContext` 5×, `inventory.liveInputs` 6×, `NotificationBell
  ensureBusinessAlerts` 2×, `Dashboard` 2× (`useState` initialisers), `DashboardStart`, `RemindersPanel`,
  `books.loadBooksData` 2×, `ensureGstGuardAlerts`, `demoStatus` (parses all invoices to look for demo rows),
  `TodayPanel` (purchases 3×), `InsightsPanel`.
- **Fix:** make bulk reads share one parsed copy per stored version.
  1. Give `peekTable` a frozen-in-dev contract and add `peekJson(fullKey)`; add `tableStamp(...names)` (a cheap
     version token: the raw-string identity per key, or a per-key write counter bumped in `writeRaw/removeRaw`
     and on cross-tab refresh) and `memoOnTables(names, fn)` for derived results.
  2. Convert read-only bulk readers to `peekTable` (they build new arrays and never mutate rows):
     `notifications.buildContext`, `inventory.liveInputs` / `stockDb.*`, `stock-tracking.liveTrackingInputs`,
     `reorder.loadReorderStatus`, `books.loadBooksData`, `demo-data.demoStatus`, `khata-actions.loadReceivablesInput`,
     `interest.accruedInterestFor`, `party-balance`, `backup`/`storage-health.referencedAttachmentIds`
     (PERF-1) and the page-level readers listed in PERF-2.
  3. `localDb.invoices.save/remove`: start from `peekTable(...).slice()` and replace only the changed row with a
     copy, instead of `getTable` (removes one full parse per save; the stringify stays).
- **Expected gain:** −5 to −7 s of cold-start main-thread time desktop (−20 s phone), −3.9 s while typing a client
  name, −8 s per save; GC drops by a similar share. Memory: one shared parsed copy (~80–100 MB) instead of
  repeated transient ones — the heap peak should fall even though the steady state holds the parsed table.
- **Risk:** a caller that mutates peeked rows corrupts the shared copy. Mitigation: freeze in dev/test
  (`Object.freeze` deep on the cached rows when `import.meta.env.DEV` or under `node:test`) and keep `getTable`
  (copying) for writers.

### H2 — Notification bell recomputes everything on focus, every 60 s and on each cross-tab change

- **Where:** `src/components/command/NotificationBell.tsx` `refresh` (runs `loadVisibleNotifications` once, then
  again from each of the five `ensure*Alerts` callbacks), `setInterval(refresh, 60000)`, `focus` / `storage`
  listeners; `src/lib/notifications.ts` `buildContext`; `src/lib/stock-alerts.ts` (expiry + reorder provider →
  `inventory.loadPositions` + `reorder.loadReorderStatus` + `stock-tracking.loadTracking`).
- **Evidence:** isolated `window.dispatchEvent(new Event('focus'))` on an idle dashboard: **one 4.8–5.0 s long
  task** desktop, **19.8–21.6 s** phone. Cold start: `loadVisibleNotifications` 5.2 s inclusive of 14 s busy;
  `stock-alerts` provider 3.1–3.5 s (`loadPositions` → `computeStockDetailed` 2.0 s, `loadReorderStatus` 1.6 s,
  `loadTracking` 1.5 s). The 60 s poll landed inside other measurements (save: +5.2 s; POS scan on phone: a 12 s
  outlier).
- **Fix:** (a) one coalesced reload per tick (providers register, then a single `requestIdleCallback`/`setTimeout`
  reload); (b) skip `refresh` when `tableStamp(invoices, transactions, doc_links, clients, stock_items, purchases,
  stock_moves, cheques, compliance, collection_notes)` and the day have not changed — the 60 s poll and focus
  become no-ops on unchanged data; (c) memoise each provider's result on its tables (stock alerts on the stock
  inputs, see H3); (d) first run after first paint in idle time, never in the boot critical path.
- **Expected gain:** focus/poll freeze 5 s → ~0 ms when nothing changed (phone 20 s → 0); cold start −4 to −5 s
  desktop (−15 s phone); post-save freeze −5 s.

### H3 — Stock engine recomputed from scratch for every consumer (editor focus, POS, Books, dashboard)

- **Where:** `src/lib/inventory.ts` `liveInputs` / `loadPositions` / `computeStock(Detailed)` / `collectEvents`;
  `src/lib/stock-tracking.ts` `liveTrackingInputs` / `computeTracking` / `editorStockContext` / `loadTracking`;
  `src/lib/reorder.ts`; `src/components/creator/ItemsTable.tsx` (`stockTick` bumps on every item-name focus).
- **Evidence:** cold start `loadPositions` 3.1 s inclusive (called by `lowStockCount`, `DashboardTiles`, stock
  alerts, reorder). Editor: `editorStockContext` 1.0 s on open; save step (10 item names focused) **11×**
  recomputation = 7.5 s inclusive. POS open: `loadCounter` 2.4 s (`loadPositions` 1.1 s + `editorStockContext`
  0.9 s). Books P&L: `loadStockValuer` → `loadPositions` 0.87 s of 1.5 s. `collectEvents` self 0.7–1.6 s per
  interaction.
- **Fix:** memoise `liveInputs()`, `computeStock(...)` results per (`tableStamp` of `stock_items, stock_moves,
  invoices, purchases, doc_links, purchase_returns, job-work/boms/vouchers tables`, method, settings) and
  `computeTracking` per the same stamp + `excludeInvoiceId`; `editorStockContext` then costs a Map lookup when
  nothing changed. Keep the existing semantics (stock re-read on focus still sees another tab's sale, because
  the cross-tab refresh changes the stamp).
- **Expected gain:** editor item focus 1 s → < 5 ms on unchanged data; save −5 s; POS open −1.5 s; Books P&L
  −0.8 s; cold start −2 to −3 s (plus H2).

### H4 — SmartFind scores every index entry with un-cached folding and an O(m·n²) DP per keystroke

- **Where:** `src/lib/search.ts` `scoreFields` → `fuzzyMatch` (calls `fold(text)` on every field of every entry,
  then a subsequence DP that allocates two `m×n` arrays) and the typo pass `typoScore(fold(token),
  fold(f.text))` (`src/lib/smart-find.ts`, `split` + `editDistance` per word); `searchAll` runs synchronously in
  `src/components/command/CommandPalette.tsx` render on every keystroke, no deferral.
- **Evidence:** `smartFind:type` profile (11 keystrokes): `fold` **20.2 s self**, `fuzzyMatch` 6.1 s,
  `scoreFields` 3.4 s, `editDistance` 2.1 s, `typoScore` 1.2 s; `searchAll` 38.7 s inclusive. Per key 3.0 s median
  desktop, 12 s phone. The index itself is cached (open with a warm index: 90 ms) — scoring is the problem.
- **Fix:** (a) store `folded` text per field when the index is built (once per storage version) and make
  `fuzzyMatch` accept pre-folded text; (b) cheap rejection before the DP: substring check, then a single
  forward scan "all query chars appear in order" — only survivors run the DP, and the DP reuses one scratch
  buffer; (c) run the typo pass only for tokens ≥ 4 chars on entries that failed (a), on words pre-split at
  index time, and only when the group has fewer than `perGroup` hits; (d) incremental narrowing: when the new
  query extends the previous one, score only the previous matches; (e) `useDeferredValue(query)` (or a 1-frame
  debounce) in `CommandPalette` so the input paints first.
- **Expected gain:** keystroke 3.0 s → < 100 ms desktop (< 300 ms phone). `fold` alone is 52 % of the time;
  the prefilter removes most DP calls.

### H5 — Editor: client-name keystroke parses invoices + payments; client typeahead re-folds the directory

- **Where:** `src/components/creator/AdvanceNotice.tsx` (`useMemo` keyed on `clientName` →
  `localDb.invoices.getAll()` + `localDb.payments.getAll()` + `openAdvancesFor` on **every keystroke**, even when
  the company has no advances at all); `src/components/creator/PartiesSection.tsx` → `src/lib/suggest.ts`
  (`fuzzyMatch` folds every client label/extra field per keystroke); `src/components/ui/Typeahead.tsx`.
  Item name: `ItemsTable` → `suggest` over 2,000 catalogue rows (0.9 s across 8 keys) and the focus-time
  `editorStockContext` (H3).
- **Evidence:** `editor:typeClient` (13 keys): AdvanceNotice 4.2 s inclusive (13× invoices parse 3.85 s + 13×
  payments parse 0.32 s), suggest 2.0 s (`fold` 0.9 s, `fuzzyMatch` 0.5 s). Phone p95 15 s per key.
- **Fix:** AdvanceNotice: read `loadAdvances()` first and return `null` when there are no open advances for the
  party (no invoice/payment read at all); otherwise `peekTable` and debounce on the client id (not the typed
  name). Typeahead: pre-fold the directory/catalogue once per table version (`useMemo` on the peeked rows) and
  reuse H4's folded `fuzzyMatch`; `useDeferredValue` for the suggestion list.
- **Expected gain:** client keystroke 395 ms → < 30 ms desktop, 1.5 s → < 100 ms phone; item keystroke 76 → < 20 ms.

### H6 — Save path: full parse + full stringify of the table, audit log parse/rewrite, party snapshot, then re-render storm

- **Where:** `src/store/useInvoiceStore.ts` `saveInvoice`; `src/lib/localDb.ts` `invoices.save` (`getTable`
  parse 178–216 ms, `setTable` → `JSON.stringify` 36 MB 414–430 ms); `src/lib/audit.ts` `audit.record` →
  `readAll()` parses the 2.2 MB log and `writeCapped` re-stringifies it (509 ms incl. one archive roll-over),
  `drainEdits` a second `record` (368 ms); `src/lib/party-balance.ts` `nextPartyBalanceSnapshot` 443 ms;
  then the editor re-reads: `SendSheet`, `DocumentActions`, `khata-actions.loadReceivablesInput`,
  `interest.accruedInterestFor` 2×, `checkNumber`, `getById` each parse invoices again (≈ 2.4 s), and
  `editorStockContext` (H3).
- **Evidence:** `saveInvoice` itself 1.3 s inclusive; click → saved 6.7 s; 24 parses of the 36 MB table, 8.6 s of
  `JSON.parse`, 6.4 s GC in the save window.
- **Fix:** H1 (peek + copy-on-write for the row) removes the parse; cache parsed audit rows per raw (same
  pattern as `assetIndex`) so `record` appends without parsing; memoise the party-balance snapshot input on
  `tableStamp`; post-save readers use `peekTable`. Keep the one 36 MB stringify for now (see "Out of scope").
- **Expected gain:** click → saved 6.7 s → ~0.8 s desktop (~3 s phone); the trailing busy period mostly disappears.

### H7 — Dashboard does the same work several times at boot and on every render

- **Where:** `src/pages/Dashboard.tsx` (two `getAll()` in `useState` initialisers; `summarize`, `monthlyBilled`,
  `linkedCredits`, `pendingReminders`, `attentionList`, `recent` sort recomputed on **every render**, comment says
  "cheap at this scale"); `DashboardTiles.tsx` (`loadBooksData`, stock), `DashboardStart.tsx`, `RemindersPanel`
  (`paymentScores`, 0.9 s at boot), `TodayPanel` (purchases parsed 3×), `InsightsPanel`, `components/demo`
  `DemoNotice` → `demoStatus()` (parses invoices, payments, purchases to find demo rows).
- **Evidence:** cold start inclusive: DashboardTiles 2.1 s, Dashboard 1.2–1.4 s, RemindersPanel 1.2 s,
  TodayPanel 0.8 s, InsightsPanel 0.76 s, DemoNotice 0.29 s, DashboardStart 0.26 s.
- **Fix:** one `peekTable` read; `useMemo` the derived values on the rows; mount tiles/panels in idle time and
  sequentially (not all in the same frame); `demoStatus` reads a cheap "demo loaded" marker (or peeks) instead of
  scanning every table.
- **Expected gain:** −3 to −4 s of cold-start busy time desktop on top of H1–H3.

### H8 — O(parties × bills) and O(invoices × clients) loops in Receivables

- **Where:** `src/lib/payment-score.ts` `paymentScores` (`settled.filter(s => s.party === party)` inside a loop
  over ~1,500 parties ⇒ ~30 M comparisons); `src/lib/late-fee.ts` `lateFeeRuleFor` (linear `clients.find` + name
  fold per overdue invoice); `src/pages/Receivables.tsx`, `src/components/collections/aging-extras.ts`.
- **Evidence:** receivables open 1.5 s inclusive: `computeScores/paymentScores` 0.58 s, `lateFeeRuleFor` 0.27 s,
  `buildReceivables` 0.18 s, `loadData` 0.22 s. `paymentScores` also costs 0.9 s at cold start (RemindersPanel).
- **Fix:** group `settled` by party once (Map) and walk each group; build `Map<id, client>` and
  `Map<name|gstin, client>` once per clients version for `lateFeeRuleFor`; memo scores per `tableStamp`.
- **Expected gain:** receivables open 2.4 s → ~0.4 s desktop; cold start −0.9 s.

### H9 — Invoices list: localized compare in the sort comparator, full re-filter + re-sort per keystroke

- **Where:** `src/lib/invoice-list.ts` `sortInvoices` (`String.localeCompare(…, 'en', { numeric: true })` inside
  the comparator, ~200k calls for 15.7k rows) and `src/pages/Transactions.tsx` `rows` memo (six `.filter` passes
  + sort on every query change).
- **Evidence:** open: `sortInvoices` 0.53 s of 0.97 s; search: 0.42 s per filter change; scroll 82 ms / frame
  (`useVirtualRows` + `getBoundingClientRect` 0.25 s over 15 screens).
- **Fix:** one `Intl.Collator('en', { numeric: true })` (or precomputed sort keys; plain `<` for ISO dates);
  memo the sorted list on (`invoices`, `sort`) and apply the text filter to it (filtering keeps order);
  `useDeferredValue(query)`. Scroll: batch the row measurement in `useVirtualRows` (one read pass per frame).
- **Expected gain:** open 1.2 s → ~0.35 s; search keystroke 105 → < 30 ms desktop (455 → < 120 ms phone).

### H10 — Annual pack / balance sheet re-scan the whole ledger for each statement

- **Where:** `src/lib/ledger/reports.ts` `sums` / `balancesBefore` / `closingBalances` / `partyBalances`, called
  repeatedly from `src/lib/ledger/annual-pack.ts` `buildAnnualPack` and `notes-auto.ts` `buildNotes`.
- **Evidence:** annual pack open 1.35 s inclusive: `buildAnnualPack` 1.08 s, `sums` 0.74 s (self 0.41 s),
  `balancesBefore` 0.59 s, `buildNotes` 0.52 s; BS tab 0.23 s in `ledgerBalanceSheet`.
- **Fix:** per `Ledger` object (WeakMap), sort vouchers by date once and keep per-account running totals by date
  (and per party for control accounts); `closingBalances(date)` becomes a binary search + O(accounts).
- **Expected gain:** annual pack open 2.3 s → ~0.6 s; BS 0.44 → ~0.1 s.

### H11 — Backup export / restore: double work on 60–70 MB strings

- **Where:** `src/lib/backup.ts` `exportPlainBackup` (`JSON.stringify(collectBackup(), null, 2)` of 70 MB, then
  `download.ts downloadText` builds a Blob from it: stringify 1.07 s + Blob 1.44 s); `parseBackup` parses the
  70 MB file (0.44 s) then `validateBackupData` parses `invoices` twice (1.25 s + 0.35 s), `countRows` once more
  (0.21 s), `checkBackupAttachments` → `referencedAttachmentIds` again (0.22 s); `storage-health.measureStorage`
  parses invoices 2× when the Data tab opens. Restore then reloads and pays the full cold start.
- **Evidence:** export click → file 2.5 s (phone 30 s); pick → dialog 3.9 s (phone 13 s); spy above.
- **Fix:** export: no pretty-printing of the outer object (values are already JSON strings), build the Blob from
  parts (`new Blob(['{"…":', JSON.stringify(v), …])`) so the 70 MB string is never materialised; validate:
  parse each table once and pass the parsed rows to `countRows` / attachment checks; storage health: use
  `peekTable`. Optionally move parse/validate into a Worker (no new dependency).
- **Expected gain:** export 2.5 s → ~0.8 s; pick → dialog 3.9 s → ~1.2 s (phone 13 → ~4 s).

### H12 — POS, GST and editor open read tables through `getTable` at mount

- **Where:** `src/pages/Pos.tsx` `loadCounter` (`getAll` + stock, 2.4 s), `src/pages/GstReports.tsx` (`getTable`
  invoices/purchases/transactions in `useMemo`, 0.3 s of 0.48 s), `src/components/invoicing-ux/LastRateHints.tsx`
  and `MarginChip` (use `peekTable` already — they pay the first parse, fine once H1 shares it).
- **Fix:** `peekTable` for these readers (PERF-2); the stock part is H3.
- **Expected gain:** POS open 2.6 s → ~0.3 s; GST open 0.8 s → ~0.3 s; editor open 1.6 s → ~0.3 s.

### Memory

Dashboard heap 159 MB vs 6 MB for an empty app; 197 MB after the tour. The storage cache keeps the 60 MB of raw
JSON; the rest is transient parsed copies (cold start runs 4.2–4.6 s of GC, the save 6.4 s). H1 trades many
short-lived copies for one shared parsed copy per table. After PERF-1, re-measure with `extras.mjs` and keep the
dashboard heap under ~250 MB; if it grows past that, drop the raw string of a parsed, unchanged table from the
in-memory map (re-stringify on write only) — that is a follow-up, not part of these packages.

### Out of scope (noted, not proposed now)

- One key per table means every save writes 36 MB (stringify ~0.4 s desktop / ~1.6 s phone + the IndexedDB
  put). Row-level or chunked storage would fix it but changes the storage contract, backups and sync — a separate
  design round.
- Moving report engines into a Web Worker.

## Fix packages

Two packages with mostly disjoint files. Both may only add read-only `peekTable` call sites outside their list
when strictly needed; the only shared file is `storage.ts`, owned by PERF-1 (PERF-2 uses the `peekTable` that
already exists and does not depend on PERF-1 landing first).

### PERF-1 — data layer, background work, save path (H1, H2, H3, H6, H10, H11)

Owns:
- `src/lib/storage.ts` — `tableStamp(...)`, `memoOnTables(...)`, `peekJson`; dev/test freeze of peeked rows.
- `src/lib/localDb.ts` — `invoices.save/remove`, `payments.*` start from peeked rows (copy-on-write).
- `src/lib/audit.ts`, `src/lib/audit-edits.ts` — parsed-log cache, no parse per `record`.
- `src/lib/party-balance.ts` — memoised snapshot inputs.
- `src/lib/notifications.ts`, `src/components/command/NotificationBell.tsx`, `src/lib/stock-alerts.ts`,
  `src/lib/business-alerts.ts`, `src/lib/gst-guard-alerts.ts`, `src/lib/capture-alerts.ts` — coalesced, idle,
  stamp-gated refresh; peeked inputs.
- `src/lib/inventory.ts`, `src/lib/stock-tracking.ts`, `src/lib/reorder.ts` — memoised `liveInputs`,
  `computeStock`, `computeTracking`, `editorStockContext`.
- `src/lib/books.ts` (`loadBooksData`), `src/lib/ledger/index.ts` (`loadStockValuer`), `src/lib/ledger/reports.ts`,
  `src/lib/ledger/annual-pack.ts`, `src/lib/ledger/notes-auto.ts` — peeked inputs, running-balance index.
- `src/lib/backup.ts`, `src/lib/download.ts`, `src/lib/storage-health.ts`, `src/lib/attachments.ts`
  (`referencedAttachmentIds`), `src/components/settings/DataPanel.tsx` — single-parse validate, streamed export.
- `src/lib/khata-actions.ts`, `src/lib/interest.ts`, `src/lib/demo-data.ts` (`demoStatus`) — peeked reads.
- Tests: extend `tests/perf.test.ts` (see guard rails), `tests/storage-idb.test.ts`, audit/backup tests as needed.

Acceptance (desktop / phone, this dataset): bell focus refresh on unchanged data < 50 ms; save click → saved
< 1 s / < 3 s; editor item-name focus < 20 ms; Books P&L < 1.5 s / < 5 s; annual pack < 0.8 s / < 3 s; backup
pick → dialog < 1.5 s / < 5 s; cold-start parses of `invoices` ≤ 3.

### PERF-2 — UI layer: SmartFind, editor typing, pages (H4, H5, H7, H8, H9, H12)

Owns:
- `src/lib/search.ts`, `src/lib/smart-find.ts`, `src/components/command/CommandPalette.tsx` — pre-folded index,
  prefilter, scratch-buffer DP, incremental narrowing, deferred query.
- `src/lib/suggest.ts`, `src/components/ui/Typeahead.tsx`, `src/components/creator/PartiesSection.tsx`,
  `src/components/creator/AdvanceNotice.tsx`, `src/components/creator/ItemsTable.tsx` (typeahead only; the
  `stockTick` re-read becomes cheap through PERF-1 — do not change its trigger).
- `src/pages/Dashboard.tsx`, `src/components/dashboard/*` (`DashboardTiles`, `DashboardStart`),
  `src/components/invoicing-ux/TodayPanel.tsx`, `src/components/invoicing-ux/InsightsPanel.tsx`,
  `src/components/share/RemindersPanel.tsx`, `src/components/demo/*` — one peek, memoised derived values,
  idle-mounted panels.
- `src/pages/Receivables.tsx`, `src/components/collections/aging-extras.ts`, `src/lib/payment-score.ts`,
  `src/lib/late-fee.ts` — grouped scores, client index.
- `src/pages/Transactions.tsx`, `src/lib/invoice-list.ts`, `src/hooks/useVirtualRows.ts` — collator, split memo,
  deferred query, batched measurement.
- `src/pages/Pos.tsx` (`loadCounter` reads), `src/pages/GstReports.tsx` — peeked reads.
- Tests: `tests/search.test.ts`, `tests/suggest.test.ts`, `tests/invoice-list.test.ts`,
  `tests/payment-score.test.ts`, `tests/receivables.test.ts` (behaviour unchanged; add scale cases).

Acceptance (desktop / phone): SmartFind keystroke p95 < 150 ms / < 400 ms; client-name keystroke p95 < 50 ms /
< 150 ms; item-name keystroke p95 < 50 ms; invoices search keystroke p95 < 50 ms / < 150 ms; receivables open
< 0.5 s / < 2 s; POS open < 0.5 s / < 2 s; together with PERF-1, cold start interactive < 2.5 s / < 5 s.

### Coordination

- Only conflict surface: both packages convert `getTable` → `peekTable` in files they own; neither edits the
  other's files. If PERF-2 needs a stamp before PERF-1 lands, it uses `readRaw(DB_PREFIX + name)` identity
  (what `peekTable` already compares).
- `peekTable` rows are shared and read-only: never mutate, copy (`{ ...row }`) before editing.
- Re-run after each package:
  `node $P/run-suite.mjs` (desktop), `node $P/run-suite.mjs --phone`, `RUNS=3 node $P/extras.mjs`, and
  `node $P/run-suite.mjs --spy --prof --dist=dist-prof` (after rebuilding `dist-prof`) to confirm parse counts.

### Guard rails to add (either package, in its own test file)

- A parse-count test: wrap `JSON.parse` in `tests/perf.test.ts`, seed 15k invoices, run
  `loadVisibleNotifications` twice, `editorStockContext` twice and `searchAll('ganesh')` three times; assert the
  invoices string is parsed at most once per stored version.
- Raise the scale of `tests/perf.test.ts` storage section to 15k (it already fails its 2.5 s cap there) once H1
  lands, so the cap means something again.

## Raw outputs

`$P/out/suite-desktop.json`, `suite-phone.json`, `suite-desktop-spy-prof.json` (per-step profile top lists and
JSON-spy groups), `extras-desktop.json`, `extras-phone.json`, `perf-test-5000.txt`, `perf-test-15000.txt`,
`*.cpuprofile` (open in Chrome DevTools → Performance).
