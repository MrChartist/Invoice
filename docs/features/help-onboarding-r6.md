# Round 6 · R6-A — First run, help and feedback

Spec: `docs/prd/round-6.md` §4 R6-A1…A6, §5, §6. Lead decisions applied (§7): no fixed WhatsApp number or e-mail;
F1 opens Help everywhere except the POS and the Gateway (wired by R6-B in the shell; the `?` key stays with the
shortcuts overlay); the version comes from `package.json` at build time. Help text describes what the app does —
statutory screens keep "verify with your CA" and cite `docs/CA_REVIEW.md` ids.

## A1 Business-aware setup checklist v3

- `src/lib/checklist-steps.ts` — step catalogue (`STEP_ORDER`: profile, opening, import, client, item, posbill, invoice,
  packFirst, whatsapp, payment, gstPeriod, backup), applicability by business type / packs / modules / role, `allSteps`
  (every applicable step, skipped marked), `cardSteps` (at most 7, open steps take the slots first, shown in catalogue
  order), `showCard`, `readChecklistInputs` (counts from the shared parsed rows: openings, import runs, stock items, POS
  bills, the pack's first table, compliance rows).
- `packFirst` is one step per active pack, key `packFirst:<pack>`, done on the first row of `PACK_FIRST_TABLE`
  (`consignment_notes`, `ra_measurements`, `fee_plans`, `donations`, `leases`, `sales_channels`); link = the pack's
  first `PACK_TABS` row.
- `import` is done when `import_runs` (`IMPORT_RUNS_TABLE`) has a row. **R6-C3 should append one row per import run
  there** (or change the constant); until then the step can be skipped.
- `gstPeriod` is done when the company's `compliance` table has a row (a return marked filed; R6-C4's `downloaded_at`
  rows count too).
- `src/lib/checklist.ts` — `buildChecklist(facts, ctx, progress?)` returns the v3 card; `buildChecklist(facts)` keeps the
  v2 seven steps (regression test).
- Dashboard card (`DashboardStart.tsx`): "n of m", **Skip** per open step ("skipped" counts as done), **Hide** (asks once
  and says Help → "Setup checklist" brings it back). Viewers never see it; clerks see client / item / invoice / POS bill /
  payment only.
- Help → "Setup checklist" (`components/help/SetupChecklistPanel.tsx`): every step, skipped ones with "Undo skip", and
  "Show the card on the Dashboard again".
- Per user (QA7 G10): the owner's Skip / Hide is the company-level state; a clerk's goes to `byUser[<user id>]` and
  changes only that clerk's card (`loadSetupProgress` / `saveSetupProgress` pick the slot from the signed-in user).
- Storage: company object `mrchartist_inv_setup_progress` `{ skipped: string[], hidden_at?: string, byUser?: { [userId]:
  { skipped, hidden_at? } } }` (`byUser` additive, QA7 G10; an object without it reads as before) — backed up and
  synced like every company key (a non-array value, so the sync engine treats it as a singleton, last writer wins); not
  audited (viewing state); `TABLE_ACTIONS.setup_progress = 'doc.create'` (owner and clerk); described in
  `open-export-schema.ts`. Facts are always derived from data, so work done on another device counts.

## A2 "On this screen" help

- `src/lib/help/registry.ts` — topic ids are `<route>[:<tab>[:<view>]]` (`/` → `dashboard`, `/invoice/<id>` → `invoice`).
  `topicKey`, `candidates` (most specific first), `areaOf` (PACK_TABS rows → `packs`, else the route's area),
  `helpFor(pathname, search)` / `topicById(id)` (async, falls back to the route topic), `helpIndex()` (every topic with
  its href — for Help search and R6-B's palette "Help topics" group), `hrefOfKey`.
- Six lazy data files: `topics-sales`, `topics-purchase`, `topics-books`, `topics-statutory`, `topics-packs`,
  `topics-settings` (`t(id, title, hiTitle, what, when, extra?)`, ~210 topics). English text with a Hindi title per topic
  (shown when the interface is Hindi); statutory topics carry `statutory: { ca: true, caItems, forms?, due? }` — due
  dates are text pointing at the Compliance tab, never computed.
- `components/layout/HelpModal.tsx` — "On this screen: <title>" (`ScreenHelp`: what / when / steps / "Verify with your
  CA" box with "CA checklist: G1, G16" / related links), then `HelpSearch` (the `search.ts` tokeniser and scorer), then
  links: Keyboard shortcuts (opens the overlay), What's new, Beta guide, Setup checklist, Report a problem; handy keys
  (Ctrl+K, F1, ?), the version and the legal footer. Props: `topic?` (open a given topic: R6-B's `openHelp(topic)`, the
  About strips' "More") and `view?` (open on What's new / Beta guide / Setup checklist).
- GST reports keeps `?tab=` in the URL in step with the shown tab, so Help, the About strip and a copied link follow it.
- **Coverage rule** (`tests/help-registry.test.ts`): every `App.tsx` route, every `GST_TABS` id, every `PACK_TABS` row
  and the tab ids of TDS / Payroll / Books / Manufacturing / Expenses / Receivables / Reports / Settings / Inventory /
  Distribution / Recurring / Time / Reconcile resolve to their own topic; ids are unique and sit in the file their area
  loads; every `caItems` id exists in `CA_REVIEW.md`; Hindi titles present; no ₹ / % value without "as the app applies
  it". **A new tab needs a help topic.**
- F1 (not on `/pos`, `/gateway` or in fields), the help event and the route-trail push are the shell's lines (R6-B).
  `HelpModal` reads a topic asked through `openHelp(topic)` with `takeHelpTopic()` when it opens; the `topic` prop wins.
  The coverage test reads the tab lists from R6-B's `src/pages/page-tabs.ts` (`TAB_PAGES`) and every sidebar entry.

## A3 Statutory tab explainers, glossary, empty states

- `components/help/AboutStrip.tsx` — one line under the tab bar of `/gst-reports`, `/tds`, `/payroll` with the topic's
  `what`; **More** opens Help on the topic; **Hide strips** turns all strips off on this device
  (`mrchartist_help_strips`, `lib/help/strips.ts`); Help → On this screen offers "Show tab explanations" again.
- GST page: the 70-word disclaimer became one line "Working paper — Verify with your CA before filing." with the full
  text behind "Scope and limits" (a `<details>`), and is summarised in the GST Help topic.
- `src/lib/help/glossary.ts` (own lazy chunk, 35 terms, English + Hindi definition and "in this app", CA ids) and
  `components/help/Term.tsx` (dotted underline; tap / Enter opens a popover; Esc or a click outside closes it).
- Terms applied: GST section headings (B2B, B2CL, B2CS, CDNR, CDNUR, EXP, Nil, HSN, set-off, GSTR-2B, ISD, e-Way Part B,
  LUT on the export desk), GSTR-3B table codes 3.1 / 4A / 4B(1) / 4B(2) / 4C (`Gstr3bView.tsx`), the TDS / TCS headings of
  the TDS overview (`TdsTabs.tsx`).
- Empty states: GST reports with no sales or purchases in the period ("No sales or purchases dated in <period>" +
  Change period / New invoice / Add bill); TDS overview with no deductions (what TDS on payables is + "Add a bill with
  TDS"). Payroll's existing "no employees" state is kept.
- Not done: terms inside the GST tab *buttons* (a button inside a tab button is invalid and would steal the tab click —
  the heading of the open tab carries the term instead) and in the compliance calendar / payroll statutory headings
  (files outside R6-A's list).

## A4 What's new and the real version

- `vite.config.ts` `define: { __APP_VERSION__: JSON.stringify(pkg.version) }`; `src/lib/app-version.ts` exports
  `APP_VERSION` (`0.0.0-dev` under `node:test`). Help ("Version 3.1.0 · Offline-first"), the diagnostic report and What's
  new read it. "Version 3.0" is gone (`setup.ts` `version` takes `{v}`).
- `src/lib/whats-new.ts` — `WHATS_NEW` newest first (`version`, `date`, `label`, items with Hindi titles and optional
  in-app `href`), `compareVersions`, `shouldShowCard(stored, current, hadData)`. Seed entries: 3.1.0 Round 6, 3.0.3
  Round 5, 3.0.2 ITA 2025 labels, 3.0.1 Round 4 (the older version numbers are labels for the notes; package.json was
  3.1.0 throughout).
- `scripts/check-whats-new.mjs` runs in `postbuild`: the build fails when the newest entry is not the package.json
  version. **A version bump needs a notes entry.**
- Help → What's new lists every entry; the Dashboard card (`dashboard/WhatsNewCard.tsx`) shows the newest entry's first
  three items once after an upgrade. Device-local `mrchartist_whats_new_seen`: a fresh install records the current version
  silently and never shows the card; a device whose company already has invoices but no stored version is treated as an
  upgrade from before Round 6.

## A5 Report a problem v2 and "Suggest an idea"

- `ReportProblemDialog.tsx`: Problem / Idea / Question; area (prefilled with the current screen's help title, a select of
  route topics); "What did you do?" (or "Your idea" / "Your question"); expected / actual / severity for a problem only;
  the full text preview; **Copy**, **WhatsApp** (`https://wa.me/?text=…`), **E-mail** (`mailto:?subject=…&body=…`) and
  **Share** (Web Share, when the browser has it). No recipient is filled in (lead decision); `FEEDBACK_CONTACT` in
  `src/lib/feedback.ts` is the single empty constant for a future contact.
- `src/lib/feedback.ts` — `composeTyped` / `composeFeedback`, `capForShare` (link text ≤ 1,800 characters **once
  encoded** for the link, QA7 G5; the diagnostics are shortened first, line by line, then the typed text by code points,
  never inside a surrogate pair, QA7 G4; the full report is copied to the clipboard with a note), `whatsappLink`,
  `mailtoLink`, `parseDraft`. The dialog builds its links inside try / catch (Copy / Share stay if one fails).
- `src/lib/diagnostics.ts` — `scrubTyped` (the existing scrubber + 4+ digit runs + "Rs / INR <n>" amounts; QA7 G6:
  Devanagari digits read as digits, UPI IDs `name@bank`, Indian-grouped amounts "1,250" / "1,25,000", "12.5k" / "2 lakh",
  numbers next to rupees / रुपये, lower- and mixed-case PANs; section codes such as 194C stay readable) and a
  "[Screens before]" section from the route trail.
- `src/lib/route-trail.ts` — the last 10 routes of the session, memory only, ids masked, only `tab` / `view` values
  kept. The shell pushes it on every route change.
- Device-local unsent draft `mrchartist_feedback_draft` (try / catch), cleared on Share / Clear.

## A6 In-app beta guide and one-time screen tips

- `src/lib/help/beta-guide.ts` + `components/help/BetaGuide.tsx` — the nine `##` sections of `docs/BETA_GUIDE.md`
  (headings kept in step by `tests/help-tips.test.ts`), flow links A–E, and "Report a problem" from §9. When R6-C6
  rewrites the guide, update the TypeScript copy with it.
- `src/lib/help/tips.ts` + `components/help/ScreenTip.tsx` — one dismissible line in normal flow (never an overlay),
  once per device (`mrchartist_tips_seen`), "Don't show tips" turns all off (`mrchartist_tips_off`). Mounted by R6-A on
  Dashboard, GST reports, TDS, Payroll, Clients, Expenses, POS and the editor (one lazy line each); Books, Inventory,
  Reports, Gateway and Invoices (`books`, `inventory`, `reports`, `gateway`, `invoices`) at integration. Every tip must
  be mounted (`tests/help-tips.test.ts`).

## Storage summary

| Key | Kind | Backed up | Synced |
|---|---|---|---|
| `mrchartist_inv_setup_progress` | company object `{skipped, hidden_at?, byUser?}` | yes | yes (singleton) |
| `mrchartist_help_strips` | device-local `'on' \| 'off'` | no | no |
| `mrchartist_whats_new_seen` | device-local version | no | no |
| `mrchartist_feedback_draft` | device-local JSON draft | no | no |
| `mrchartist_tips_seen`, `mrchartist_tips_off` | device-local | no | no |

## Bundle (measured with `npm run build && npm run check:size`)

| Budget | Before (`b67d9fb`) | After | Delta | R6-A allowance |
|---|---|---|---|---|
| Initial JS (gz) | 183.0 kB | 183.1 kB | +0.1 kB | +0.2 kB |
| Entry chunk (gz) | 69.5 kB | 69.6 kB | +0.1 kB | — |
| Total JS (gz) | 2441.4 kB | 2486.2 kB | **+44.8 kB** | +28 kB |

Every new screen is lazy (HelpModal and its sub-views, Term, AboutStrip, ScreenTip, WhatsNewCard, the topic files, the
glossary). Total JS is **over the R6-A allowance**: the largest chunks are the glossary (6.0 kB, Hindi definitions),
the six topic files (17.4 kB together), the report dialog (+3.5 kB) and the help strings / CSS (2.9 kB). Devanagari text
compresses poorly per chunk. Options for the lead: accept it inside the round's +60 kB if R6-B / R6-C stay under theirs,
or cut the Hindi "in this app" lines of the glossary and the older What's-new entries. No budget was changed.

## Tests

- `tests/help-registry.test.ts` (coverage rule, fallbacks, CA ids, Hindi titles, no promised values)
- `tests/help-glossary.test.ts` (terms used exist, en + hi, no values without "as the app applies it", CA ids)
- `tests/help-tips.test.ts` (tip routes, mounts, seen / off, beta-guide headings = `docs/BETA_GUIDE.md`)
- `tests/whats-new.test.ts` (order, unique versions, newest = package.json, `shouldShowCard`, hrefs are routes)
- `tests/onboarding.test.ts` (checklist v3 per business type, packs, skip / hide, clerk / viewer, v2 regression)
- `tests/diagnostics.test.ts` (typed text scrubbed, idea without expected / actual, trail masked, links capped, no
  recipient)
- e2e `tests/e2e/smoke.mjs` step "R6-A help" (About strip on CDNUR, Help "On this screen: CDNUR" with CA ids, version,
  B2CL popover).

## Follow-ups

- R6-C3: append a row to `import_runs` per import run so the checklist's `import` step completes.
- Integration (done): F1, `pushRoute`, `takeHelpTopic()` in `HelpModal`, the palette "Help topics" group, the
  `SampleDataChooser` mount in `DashboardStart.tsx`, tip mounts on R6-B's pages, AGENTS.md / ARCHITECTURE.md keys and rules.
