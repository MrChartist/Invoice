# Round 6 · R6-B — Discoverability, empty states and sample data

Spec: `docs/prd/round-6.md` §4 R6-B1…B5, §5 (package), §6 (shared files). Decisions from the lead: the sidebar may grow
to 26 entries (Distribution and Manufacturing added); a screen that hosts an active pack's tab stays visible in shop
mode; sample data always goes to the separate, resettable Demo company — never into a real company.

No new route, rule table, storage key or lucide icon. Strings live in `src/i18n/areas/discover-r6.ts` (screens) and
`src/i18n/areas/discover-r6-tabs.ts` (palette tab names), English + Hindi.

## B1 Ctrl+K finds every tab and portal term

- `src/pages/page-tabs.ts` — the tab lists of Books, Manufacturing, Payroll, Expenses, Receivables, Reports, Inventory,
  Distribution, Time, Recurring, Reconcile and Settings, moved out of the pages (no behaviour change; labels and icons
  stay in the pages, which map ids to them with a `Record<Tab, …>` so a new id without a label fails to compile). One
  data-only module with type imports only, so pages and the palette share one small chunk (each extra chunk costs
  first-paint bytes in the preload map). Deviation from the PRD's "one `*-tabs.ts` per page": same content, one file.
  TDS keeps its list in `Tds.tsx` (R6-A's page): `TDS_TAB_IDS` in `tab-index.ts` is pinned to it by a static scan. GST
  reads `GST_TAB_ROWS`, a copy of `GST_TAB_GROUPS` pinned by a test (importing `gst-tabs.ts` split it out of the GST
  page chunk).
- `src/lib/palette/tab-index.ts` — `TAB_PAGES` (route + ids per page) and `buildTabIndex(settings)`: one `StaticEntry`
  per tab `{ title, subtitle: page name, href: route?tab=id, keywords }`. A tab of a screen shop mode hides still shows,
  marked "(hidden)". Tabs that belong to a pack are the R5 "Industry packs" group's rows (`PACK_TABS`, "(pack off)"
  there); they are left out of the Tabs group and get the same synonyms through `withSynonyms`. QA7 G8: a page carries
  its route's access action (`need`, as the sidebar / `RequireAccess`) and Settings tabs their own; `buildTabIndex(settings,
  allow)` leaves out what the role cannot open, and `tabDestinations()` / `featureDestinations()` pass `can`.
- `src/lib/palette/synonyms.ts` — words per tab href: GSTR-1 sections (b2cl / large, cdnur …), 3B / 2B, RCM, LUT, IRN,
  e-Way; TDS (26q, 24q, 27eq, 16a, challan, 194c …, 393); Books (tb, p&l, bs, day book, ledger, brs); packs (lr / bilty /
  consignment, ra bill / boq / retention, 80g / 10bd / donation, fee / tuition, lease / rent / cam, settlement / payout /
  amazon / flipkart / meesho); a few Hindi words (तलपट, रोकड़, बकाया …). Sub-views inherit their tab's words.
- `src/components/command/tab-destinations.ts` — the lazy group module (tabs, Settings → Features rows, labels,
  `searchRows`). `CommandPalette.tsx`: one dynamic import on first open; Tabs results are inserted before the Pages /
  Actions groups and after any document group that scores better ("below an exact document match, above other pages");
  a "Features" group follows. The empty palette shows "Try: GSTR-3B · 12.5k · a GSTIN · LR · Alt+P POS · F1 help".
- Help search: "help <words>" or "? <words>" searches only help topics: R6-A's `helpIndex()` (lazy
  `lib/help/registry.ts`, loaded on the palette's first open; Hindi title when the interface is Hindi, mapped on every
  open by `helpRows(raw, lang)` so a language switch shows at once, QA7 G9); choosing one calls `openHelp(id)`.
- Tests: `tests/palette-tabs.test.ts` — every tab id of every page registry is findable (Tabs group or pack group) and
  has a title; "3b", "GSTR-3B", "consignment", "LR", "80g", "trial balance" (and tb, p&l, 26q, b2cl, cdnur, ra bill,
  amazon, तलपट) each find their tab; "(hidden)" for a kirana; the pages read `page-tabs.ts`; `page-tabs.ts` has type
  imports only; the GST copy equals `GST_TAB_GROUPS`; every synonym key is a real tab.

## B2 Sidebar reach and the "features hidden" hint

- `DashboardLayout.tsx`: Distribution (`/distribution`, `Truck`) after Receivables, Manufacturing (`/manufacturing`,
  `Layers`) after Inventory — 26 entries plus the pinned Settings. When shop mode hides at least one entry this role may
  use, the nav ends with "N more features — Show" (`/settings?tab=features`); not for viewers, POS-only cashiers or a
  company with no filter. The phone "More" menu is the same drawer, so it shows there too.
- Practice desk (a CA tool) shows only for a company without a business type (existing companies), `full`, or when the
  device has more than one company (U10).
- Shell key lines (§6): F1 opens Help (not on `/pos`, where F1 recalls held bills, and not while typing; Alt+F1 in Books
  is untouched; not on `/gateway`, which has its own Tally keys); `pushRoute(location)` into R6-A5's route trail
  (`src/lib/route-trail.ts`); the `mrchartist:open-help` window listener.
- `src/lib/help-event.ts`: `OPEN_HELP_EVENT`, `openHelp(topic?)` (dispatches the event) and `takeHelpTopic()` (the topic
  the last `openHelp` asked for, cleared once read) — R6-A's `HelpModal` calls `takeHelpTopic()` when it opens.
- `src/lib/shop-mode.ts`: `PATH_MODULE['/distribution'] = 'inventory'`; `PACK_ROUTES` (route → packs, from `PACK_TABS`
  incl. `alsoPacks`: `/gst-reports` = fees, nonprofit, leases); `PACK_OF_TYPE_INLINE` + `impliedPacks(settings)` (own-key
  lookup); `isPathVisible(path, modules, packs?)` (additive argument: without it nothing changes); `countHidden`.
- Tests: `tests/industry-packs.test.ts` (pin of both inline copies, `impliedPacks` = `activePacks`, transport sees
  `/distribution`, contractor sees `/time` with `time` off, regression for every path and type) and
  `tests/reach-8h.test.ts` (sidebar entries and order, kirana hidden count > 0, full = 0, the shell lines are wired).

## B3 Empty states

| Screen | Empty when (`src/lib/empty-states.ts`) | Shows | Actions |
|---|---|---|---|
| Books (day, cash, vouchers, ledger, TB, P&L, BS, cash flow, reports, bill-wise, registers, ratios) | `booksEmpty`: no voucher (documents or manual) in the period, no cash / bank / ledger opening, no opening bill | "Books build themselves…" | Opening balances (`/books?tab=coa&m=opening-tb`) · Import from Tally · Learn more |
| Inventory | no stock item (existing state) | existing text | Add first item · Import from catalogue · **Import items** (Settings → Data) · Learn more; header **Landed cost** link (`/manufacturing?tab=landed`, R6-C1's line) |
| Reports (all tabs but Expenses) | `reportsEmpty`: no sales document dated in the period | "Reports read your saved invoices…" | Change period (focuses the period bar) · New invoice |
| Exports | `exportsState`: no live document or bill at all → "empty"; only drafts → "drafts-only" | one line above the export cards | Change period (focuses `#ex-period-sel`) |
| Distribution → Masters | `distributionEmpty`: no area, beat or route | "Beats group parties…" | Add area (focuses the masters form) · Learn more |
| Practice | `practiceEmpty`: one company on the device | "The practice desk shows every company…" | Add company (Settings → Data) · Learn more |
| Reconcile | no statement imported (existing import screen) | "Import your bank statement…" | Import statement · Add bank account · Learn more |
| Gateway | no ledger voucher yet | one-line Tally-keys hint | Keys (Ctrl+/) |

- Exports checks the whole company, not the export period (the period lives inside `ExportCenter`, not a B file).
- "Learn more" (`components/discover/LearnMore.tsx`) calls `openHelp(topic)` with topics `books`, `inventory`,
  `distribution`, `practice`, `reconcile` (all in the R6-A registry).
  `components/discover/index.ts` is the one door for `LearnMore` and the predicates (one shared chunk).
- R6-A6 `ScreenTip` lines are mounted on Books, Inventory, Reports (tip `reports`, added at integration), Gateway and
  Invoices (`Transactions.tsx`).
- Tests: `tests/empty-states.test.ts` (each predicate with a non-empty counter-case).

## B4 Sample data v2: one Demo-company path, per business type

- One path: the wizard, Settings → Data (`SampleDataCard` now renders `SampleDataChooser variant="card"`) and the
  Dashboard (`components/demo/SampleDataChooser.tsx`, mounted by R6-A in `DashboardStart.tsx` in place of the old inline
  CTA, §6) all call `startDemoCompany()`. There is no "add samples to this company" option (lead decision); a browser
  that cannot hold a second company (no IndexedDB) gets no samples and says so. A company that still has samples from an
  earlier version can remove them from the chooser or the old banner.
- `components/onboarding/demo-company.ts`: the pending flag (`mrchartist_demo_pending`, device-local, unchanged key) now
  reads `id|business_type|pack,pack` (a plain id still reads); `fillDemo` copies the business type and packs into the
  Demo company and loads the profile's dataset; `resetDemoSamples()` (Demo company only) removes every sample row and
  builds it again with today's dates; `isDemoCompanyOpen()`. An existing Demo company finishes the pending fill from the
  Dashboard banner (`useDemoPending` in `DemoNotice`), not only from the wizard.
- `DemoNotice` in the Demo company: "Sample company — nothing here is real · Switch to <my company> · Reset samples".
  "Switch to" goes back to the company the Demo company was opened from (`from` on its registry entry), else the first
  own company.
- QA7 G1/G2 (Demo company marker): the Demo company is the registry entry with `demo: true` (written by
  `startDemoCompany`, never matched by name; a user's company called "Demo" is a normal company and a new Demo company
  is then named "Demo 2") AND a database with `settings.demo_company: true` (written by `takePending` on its first open,
  only while it holds no invoice of the user's own). "Am I in Demo" reads the company this tab's database belongs to
  (`activeCompanyId()` is pinned when the database opens), never the live registry another tab may have switched;
  a pending request is taken only by the tab whose database is the requested Demo company. `loadDemoData` refuses
  (`not_demo_company`) anywhere else, `confirm` or not. A Demo company made by the earlier flow (exactly "Demo", created
  by that flow: still fresh with the pending request, or holding sample rows only and no profile of its own) is adopted
  on open. The Demo company is not counted toward "several companies" (Practice desk, All companies search: `realCompanies()`, QA7 G7).
- `src/lib/demo-data.ts`: `DemoProfile` (`counter | services | trading | transport | works`), `demoProfileFor(settings)`
  (pack first, then type: kirana / restaurant → counter, services → services, else trading), `DemoExtras`, and
  `DEMO_EXTRA_TABLES` (`stock_items`, `pos_shifts`, `time_entries`, `retainers`, `vehicles`, `consignment_notes`,
  `trips`, `ra_measurements`, `doc_links`) — filtered by `demo: true` on removal. `loadDemoData({ extras })` writes the
  profile rows inside the same audit / recycle-bin / series snapshot, so samples still reserve no number and never reach
  the recycle bin.
- `src/lib/demo/profiles.ts` + one chunk per profile (a kirana never downloads the works rows):
  - counter: the sample goods as stock items (opening 300), six paid POS bills (`pos: true`, `DEMOPOS/…`) over three
    days, yesterday's closed shift with its totals;
  - services: eight time entries on two sample projects, one monthly retainer (the recurring schedule is in the base);
  - trading: the existing set;
  - transport (pack on only): a lorry, two LRs (`DEMOLR/…`) on one open trip, the freight bill (`DEMOFR/…`, reverse
    charge, SAC / rate from `transport-works-rules.ts`) for the delivered one;
  - works (pack on only): a three-line BOQ (sales order `DEMOBOQ/…`, 5% retention term), its first measurement and RA
    bill (`DEMORA/…`, progress stage + `doc_links` "progress", retention deducted, release after 12 months).
  The transport bill and the RA retention are built without the packs' modules (they stay in their own chunks);
  `tests/demo-data.test.ts` pins them to `buildFreightBill` / `derivedLiable` and `computeDeductions` /
  `withDeductions` / `addMonthsDay`.
- Tests (`tests/demo-data.test.ts`): each profile loads, the trial balance has debit = credit, no stock goes negative, no
  series number is reserved, removal leaves no sample row in any table and nothing in the recycle bin; transport / works
  rows only with the pack on; a reset leaves no row of the old run; the pending flag round-trips.

## B5 Settings → Features

- `src/lib/features-catalog.ts`: `FEATURE_ROWS` — the 13 modules (`ALL_MODULES`), the 6 packs and 21 advanced options
  (batches, serials, godowns, branches, approvals, credit-limit policy, loyalty, offers, price levels, cost centres,
  multi-currency, e-Invoice AATO, composition, vault, folder sync, local users, Gateway, POS shifts, restaurant tables,
  pharma, weighing scale). Each row: `href` (where it is set), `isOn(settings)` read where the setting already lives
  (`true` / `false` / `'n/a'`), and `toggle` for the one plain flag (pharma). Nothing moves.
- `components/settings/FeaturesPanel.tsx` (lazy, `?tab=features`, label in the Settings tab strip): search box (pre-filled
  from `?q=`, which Ctrl+K's Features rows use), three tables (modules, packs, advanced) with who-needs-it, On / Off and
  Turn on / off (modules and packs through the page's Save bar, as Settings → Defaults does) or Open settings. Clerks and
  viewers see it read-only. The tab's role is `view`; switching needs `settings.manage`. Settings now follows a `?tab=`
  change while it is open (the sidebar hint links there from any Settings tab).
- Tests: `tests/features-catalog.test.ts` (every row has text; every deep link is a route and, with `?tab=`, a real tab;
  `isOn` agrees with `isMultiGodown`, a batch-tracked stock item, a non-empty `branches` table, `vaultEnabled`, the pharma
  / approval / credit readers; modules and packs follow shop mode; composition / e-Invoice read the active profile).

## E2E

`tests/e2e/smoke.mjs` step "R6-B discoverability" (before the last, folder-sync step): Ctrl+K "3b" → Enter → GSTR-3B;
the sidebar has Distribution and Manufacturing; kirana → "more features" → Settings → Features → Show all features; a
fresh company's Books shows "Opening balances" and Inventory "Add first item" / "Import items".

The step "QA-3 F4 / F5" clicks the Dashboard's "Open a separate Demo company (recommended)" (`SampleDataChooser`,
mounted in `DashboardStart.tsx` in place of the old inline button) and reads the Demo company's invoices.

## Size (gzip, `npm run build && npm run check:size`)

| | Before (`b67d9fb`) | After | Delta | PRD budget |
|---|---|---|---|---|
| Initial JS (first paint) | 182.96 kB (187,352 B) | 183.58 kB (187,989 B) | **+0.62 kB** | +0.4 kB |
| Entry chunk | 69.5 kB | 70.1 kB | +0.6 kB | — |
| Total JS | 2441.4 kB | 2468.4 kB | **+27.0 kB** | +18 kB |

- First paint: about +0.47 kB is the shell (two nav rows and their names, `PACK_ROUTES` / `impliedPacks`, the hint, Practice
  rule, F1, the route-trail line, the help listener); the rest is the preload map in the entry chunk, which names every
  new lazy chunk (tab lists, empty-state door, the areas, demo company). Already trimmed: the 12 tab files merged into one
  module, the GST groups copied, the pack modules kept out of the demo profiles (29 → 12 new chunks). A lazy hint
  component was tried and cost more than the inline link. Over the PRD’s +0.4 kB by ~0.2 kB; the hard 185 kB budget
  passes with 1.4 kB left.
- Total: the palette's tab names in English and Hindi (≈ 8.4 kB `tab-destinations`), the B area (≈ 6 kB, who-lines
  shortened), the five demo profiles (≈ 4.4 kB, each only for its business) and the Features panel (≈ 3 kB). Over the
  PRD's +18 kB; the 2600 kB budget passes.

## Open / follow-ups

- §7 Q6 (move samples already loaded into a real company to a Demo company) is not built: such a company sees "Remove
  sample data" only.
