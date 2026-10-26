# PRD — Round 6: consolidation and beta-tester productivity

Status: draft for build · Drafted 2026-10-26 · Baseline: branch `claude/elegant-cannon-cwapiv` at `3765b16` (Phases 0–8,
Rounds 2–5, QA rounds 3 and 5, PERF-1 / PERF-2 and the Income-tax Act 2025 labels all merged).

Companion documents:
- `docs/CA_REVIEW.md` — the consolidated CA checklist: 160 items, 34 marked priority.
- Raw research (URLs and the claim taken from each):
  `/tmp/claude-0/-home-user-Invoice/c401a5ec-398d-5b90-84fd-5f6b9cfff692/scratchpad/r6/round6-sources.md`.
- Browser audit script, log and screenshots: `/tmp/claude-0/-home-user-Invoice/c401a5ec-398d-5b90-84fd-5f6b9cfff692/scratchpad/r6/`
  (`audit.mjs`, `audit.log`, `shots/`). Below, `shots/` means that folder.

Every item follows `AGENTS.md`:
- local-first and serverless (no network; `wa.me` / `mailto:` links only when the user taps them);
- vanilla CSS Modules with tokens;
- invoice snapshots never change;
- Indian-FY numbering;
- bare dates parsed as local days;
- statutory outputs labelled as working papers ("verify with your CA").

---

## 1. Problem statement

Rounds 2–5 added a very large surface:
- 23 routes;
- 32 GST tabs, 18 Books tabs, 14 Manufacturing tabs, 13 Payroll tabs;
- six industry packs;
- a Tally Gateway;
- more than 80 date-keyed statutory rule tables.

The beta is now limited by two things other than features.

1. **Testers cannot find or understand what is there.**
   - Ctrl+K does not find "GSTR-3B" or "consignment" (0 results, `audit.log`).
   - Distribution and Manufacturing have no sidebar entry. A company set up as a transporter lands on
     `/distribution?tab=transport` and then cannot get back to it from the menu.
   - Help is a static "about" box. It lists three shortcuts and an outdated version ("Version 3.0", while
     `package.json` says 3.1.0).
   - No statutory screen says what its tab is for.
   - There is no "what's new".
2. **The open work is scattered.**
   - 62 open roadmap rows and feature-doc follow-ups were checked against the code. 16 of them (a quarter) are
     already done or merged (§2.1).
   - The roadmap still calls R4-B / R4-C "planned" and PERF-1 / PERF-2 "in progress". It has no Round 5 or QA-5 rows.
   - The statutory assumptions a CA must confirm are spread over 30 documents. They are now gathered in
     `docs/CA_REVIEW.md`.

**Goal of Round 6:** ship **17 items in three parallel work packages with mostly disjoint files**:
- **R6-A** first run, help and feedback (6 items);
- **R6-B** discoverability, empty states and sample data (5 items);
- **R6-C** open-roadmap closures that change testers' numbers or block their migration, and the docs refresh
  (6 items).

No new vertical, route or rule table is added.

### Budgets the packages must respect

Measured on `3765b16` with `npm run build && npm run check:size`:

| Budget | Now | Limit | Headroom |
|---|---|---|---|
| Initial JS (first paint, gz) | **183.0 kB** | 185 kB | 2.0 kB |
| Entry chunk (gz) | 69.5 kB | 90 kB | 20.5 kB |
| Total JS (gz) | **2441.1 kB** | 2600 kB | 158.9 kB |

Rules:
- **Everything is lazy.**
  - There is no new route.
  - New UI is a lazy component inside an existing lazy chunk (Help, palette, Settings, Dashboard start), or a lazy
    dialog.
- **First-paint delta:**
  - R6-B (owns the shell edits in §6) ≤ +0.4 kB gz;
  - R6-A ≤ +0.2 kB;
  - R6-C ≤ +0.1 kB;
  - combined ≤ +0.7 kB, so initial JS stays ≤ 183.7 kB and at least 1.3 kB is left for Round 7.
- **Total-JS delta for the round ≤ +60 kB gz:** A ≤ 28 kB (help text in two languages is most of it), B ≤ 18 kB,
  C ≤ 14 kB.
- **Help text is data, not code.**
  - The screen-help registry (A2) and the glossary (A3) are split per area into chunks that load only when Help or a
    term opens.
  - Hindi rows are required by `defineArea`. Statutory wording that is not certain stays English ("verify with your
    CA"), per `docs/features/i18n.md`.
- **Icons: reuse only.** Every `lucide-react` icon lands in the first-paint vendor chunk. Already imported and
  suggested:
  - R6-A: `HelpCircle`, `BookOpen`, `Info`, `MessageSquare`, `History`, `ListChecks`, `CheckCircle2`, `Circle`,
    `Copy`, `Share2`;
  - R6-B: `Search`, `Compass`, `Eye`, `SlidersHorizontal`, `Layers`, `Store`, `Truck`, `Wand2`;
  - R6-C: none new.

  A new icon name fails review.
- Each package records before / after numbers in its feature doc. No budget may be raised without the lead.

### Non-goals

- No new statutory feature. The six industry packs stay as built.
- No server-side feedback, analytics, crash reporting or auto-update check. Feedback stays a user-copied or
  user-shared text.
- No video hosting. Help links may point to `mrchartist.com` pages only as user-tapped external links, like the
  existing "Source on GitHub" link.
- No statutory value changes. CA answers to `docs/CA_REVIEW.md` arrive as later dated rows, one PR per answer.

---

## 2. Findings

### 2.1 Open-roadmap sweep (verified against `src/`)

Each row was checked by grep on `3765b16`.
- **Open** — still missing.
- **Stale** — done in code but still listed as open.
- **By design** — a stated limit that is not planned work.
- **R6** — taken into this round.

#### ROADMAP rows marked ⏳ / 🟡

| Row | Open item | Evidence | Verdict |
|---|---|---|---|
| 5.4 | i18n beyond core screens (Gujarati / Tamil / Bengali / Telugu / Kannada; `src/lib` messages) | `docs/features/i18n.md` § Coverage | Open (not this round) |
| 7.9 tail | P1-21 import of ledgers / vendors / openings in the CSV wizard | `ImportKind = 'clients' \| 'items' \| 'invoices'` (`import-mapping.ts:6`) | **Open → R6-C3** |
| 7.9 tail | P2 cost categories; interest report screen | no `cost_categor`; `ledgerInterest` has no UI caller | Open |
| 7.19 | Bill-wise refs, voucher classes, single-entry mode on Gateway voucher entry | no bill / class handling in `gateway/voucher-entry.ts` | Open |
| 7.28 | "Still open: 9C Table 12 split" | built in 7.127 (`gstr9c-extra.ts`) | **Stale** |
| 7.49 | Tally import of inventory vouchers (quantities) | `tally-import.ts:333` only detects `INVENTORYENTRIES`; no quantities imported | Open |
| 7.49 | Excel TB template; audit segment compression; archive old FYs to a "history" company; TDS challans in the Tally export | no `CompressionStream` in `audit*.ts`; no `challan` in `tally-books.ts` / `tally-xml.ts` | Open |
| 7.49 | Per-FY auditor export with chain head | `trust/auditor-pack.ts` (R4-C5) | **Stale** |
| 7.131 | 15CA / 15CB, surcharge, 195A grossing-up, 27Q FVU, TRACES flags in Deductions, IGST export refund, ISD postings, GSTR-6 amendments, 9C books column, GSTR-9 Table 13, operator Table 15 | `tds-27q.ts:15` lists them as not built | Open |
| 7.149 | 17(2)(viia) accretion, Form 12BA, late-deduction 201(1A), arrear ECR validation, plan assets, Rule 3 variants | `followups.ts:350` "noted only"; no `12BA` | Open |
| 7.158 | EEFC supplier payments, bank response presets, revaluation reversal, 194H on commission, per-customer offers, ESC/POS QR / logo, Schedule X book | `sales-commission.ts:15` "194H not computed"; no ESC/POS QR | Open. *Agent on POS bills* is done in 8.81 (stale part) |
| 7.167 | Serial counts on Physical Stock; MRP lead times; e-Way sub-type 6; ITC-04 JSON check; cost-centre closing stock | `EWAY_SUB_JOB_WORK_RETURN` defined (`eway.ts:32`) but never used | Open |
| 7.167 | Price lists on POS | `Pos.tsx:44` imports `priceListRate` (8.145) | **Stale** |
| 8.7 | Balance snapshot on recurring / converted / late-fee documents; statement page from list rows; non-INR khata | snapshot taken only in `khata-actions.ts:130` and the editor; `documents.ts` clears it | **Open → R6-C5** (snapshot part) |
| 8.7 | Per-party reminder language | `message-langs.ts` (8.121) | **Stale** |
| 8.27 | iOS share target, remembered BLE printer, Payment-in quick pay, tiles for price-list items, held carts across devices | platform limits | By design / open |
| 8.46 | PDF QR reading, multi-line GST split from the QR, GST on rule vouchers, memory for receipts, payment approval in e-payment batches | no PDF engine | Open |
| 8.66 | Table 3.2 split for composition / UIN; GSTR-1A JSON; IRN cancel from the bulk response; time bar for GSTR-6 / 7 / 8; one-off extensions | no GSTR-1A JSON builder | Open |
| 8.88 | Debit note across several bills; kit shortfall warning; order-pad partial import | as stated in `distribution.md` | Open |
| 8.88 | POS decoding of weighed-goods codes | `Pos.tsx:40` `parseScaleBarcode` (8.140) | **Stale** |
| 8.111 | PDF month-end pack, instalments on recurring templates, insights per branch, signature pad in POS | no `SignaturePad` in POS | Open |
| 8.130 | Bengali / Telugu / Kannada keys; loan prepayment re-schedule and interest certificates; per-voucher-type rights; catalogue cart for non-INR | `loans.ts:15` "not modelled" | Open |
| 8.151 | Scale labels with price check digit, USB-HID scales, VFD pole display, drawer hand-over, short codes on stock-only items, Option+P | no `handover` | Open |
| 8.164 | Per-form preflight (3B without HSN checks); "Mark filed" for IFF / CMP-08 in the strip; remember the downloaded step | `GstReports.tsx:266` keeps `downloaded` in component state; `toggleFiled` takes only `'GSTR1' \| 'GSTR3B'` | **Open → R6-C4** |
| R4-A6 | `applyQcHold` in the bill save path; margin chip / insights from `liveInputs()`; Inventory → Landed cost link; pre-filled debit note from a QC reject | `applyQcHold` is called only in `receipt-notes.ts:332`; `margin.ts` reads raw bills | **Open → R6-C1** |
| R4-B, R4-C | "planned" | merged (`f8c9eaf`, `977dca9`); feature docs `retail-chains-r4.md`, `trade-trust-r4.md` | **Stale** (ROADMAP status) |
| PERF-1, PERF-2 | "in progress" | merged (`cedc584`, `a1a0998`) | **Stale** |
| QA-5, Round 5, ITA 2025 | not in the roadmap | merged (`0eda057`, `06f5ec2`, `0721a67`, `0cb5230`, `d57c65d`, `a0d59fa`) | **Missing rows → R6-C6** |

#### Feature-doc "open / follow-up / known limit / deviation" items still open

Items already covered by a roadmap row above are not repeated. Rows marked **Stale** are fixed in the docs by
R6-C6.

| Doc | Item | Evidence | Verdict |
|---|---|---|---|
| `advances.md` | Advances not matched to bank-statement lines; cess on advances; Notification 40/2017 | `bank-recon.ts` mentions advances only for receipts already recorded | Open |
| `attachments-custom-fields.md` | Custom fields on bills / expenses / recurring / GST outputs; per-line item fields | no `custom_values` in `components/purchases/BillModal.tsx` | Open |
| `banking.md` | Bank picker on Gateway / VoucherEditor; per-bank dashboard tiles | `dashboard-tiles.ts:21` has one `cashBank` tile | Open |
| `business-extras.md` | Refund voucher has no bank-account tag; refunds missing from receivables statements | no `bank_account_id` in `pos-returns.ts` | **Open → R6-C2** (bank tag) |
| `cash-planning.md` | "Cheques link to one document" | `Cheque.allocations` (`types/cheques.ts:60`, WP-5) | **Stale** |
| `cash-planning.md` | Forecast ignores GST / TDS / loans / salaries; unapplied credit notes not deducted | as stated | Open |
| `cost-centres-budgets.md` | "Tally XML does not export cost-centre allocations" | `tally-xml.ts:875` `COSTCENTREALLOCATIONS.LIST` (7.46) | **Stale** |
| `cost-centres-budgets.md` | % split across centres; budgets not locked | as stated | Open |
| `inventory.md` | "Tally XML does not export batch allocations / stock transfers" | `tally-xml.ts:962` `BATCHALLOCATIONS.LIST`; transfers as Stock Journal (7.46) | **Stale** |
| `inventory.md` | Importers do not re-validate serials / batches; deleting a stock adjustment is not dependency-checked | as stated | Open |
| `freight-fx.md` | "No per-date rate table" | currency master `currency-rates.ts` (8.125) | **Stale** |
| `freight-fx.md` | Tally receipts at the invoice rate (no realised rate) | no `realised_rate` in `tally*.ts` | Open |
| `gst-setoff.md` | "HSN master defaults are not yet applied automatically in the editors" | `useHsnDefaultRate` in `InvoiceCreator.tsx`; `hsn-defaults` in `BillModal.tsx` | **Stale** |
| `gst-setoff.md` | IGST export refund not tracked; ISD postings; 9C books column | (= 7.131) | Open |
| `institutions-property-r5.md` | GSTR-9 / compliance / report pack do not pass `itcReversals` | `itcReversals` read only in `gst-reports.ts` | **Open → R6-C4** |
| `khata.md` | "No per-party default reminder language" | `message-langs.ts` | **Stale** |
| `marketplace-r5.md` | A refund in a later settlement shows the customer in credit on Receivables | as stated | Open |
| `masters.md` | Payable opening bills not read by bill-wise payables | no `openingBillsFor` in `billwise.ts` | **Open → R6-C2** |
| `masters.md` | Customer TDS not booked when the receipt is a voucher allocation | as stated | **Open → R6-C2** |
| `manufacturing.md` | Physical Stock counts serial items with an adjustment | (= 7.167) | Open |
| `payroll.md` | International workers, voluntary PF, PT challans, leave calendar | as stated | Open |
| `printing.md` | Design Studio has no copies / pre-printed controls; dot-matrix mode | as stated | Open |
| `printing.md` | "e-Invoice modal does not read `invoice.transport`" | `EwbDtls` from `invoice.transport` (7.56) | **Stale** |
| `purchase-returns.md` | TDS / GSTR-9 / late-fee base ignore notes | 7.93 / 7.94 | **Stale** |
| `purchase-returns.md` | Editing a bill below already-returned quantities is not blocked; serial pick on returns | no check in `purchases.ts` / `BillModal.tsx` | Open |
| `receivables.md` | TDS register: credit notes do not reduce TDS expected; no manual pairing | `tds-register.ts:200` skips credit notes | Open (CA item T12) |
| `reports-engine.md` | TB / BS comparative columns; horizontal BS; NRV | as stated | Open |
| `security.md` | Viewer still sees some secondary controls (writes refused) | as stated | Open |
| `time-expenses.md` | "No per-client or per-project default rates" | rate cards R3-B1 (`rate-cards.ts`) | **Stale** |
| `transport-works-r5.md` | A cancelled RA bill's number is issued again | as stated | Open |
| `docs-compliance-r3.md` | Live-preview typing latency never measured | as stated | Open (QA task) |
| `audit-lock.md`, `sync.md`, `security.md` "Honest limits" | Device-only tamper evidence; Chrome-only sync; PIN is not encryption | design | By design |
| `calc-extensions.md` | `discount_applies_to: 'total'` | skipped on purpose (GST valuation) | By design |
| `pwa-backup.md` / `einvoice.md` | Unreferenced `assets` never pruned; GSTIN status not checked offline | no prune function | Open / by design |

**Totals:** 62 rows checked (28 roadmap, 34 feature-doc). 16 are stale (done in code or merged, still listed as open), 9 are
taken into R6-C, 35 stay open for later rounds and 2 are limits by design.
rounds. 4 are limits by design.

### 2.2 How the best invoicing apps onboard and help (research)

Primary sources were preferred. Where only secondary sources exist, the row says so. Raw notes are in
`round6-sources.md`.

| Pattern | QuickBooks Online | Zoho Books / Invoice | FreshBooks | Vyapar / myBillBook | Ours today (evidence) |
|---|---|---|---|---|---|
| **First-run guidance** | Setup checklist: tasks in any order, skippable, progress saved, each with a guide and a video (secondary); remaining items stay on the dashboard (official AU blog) | Org setup → **Getting Started page** (official) | Business details + industry, then a short dashboard walkthrough (secondary) | Short "make your first bill" videos (official site) | 5-step wizard with business type (`onboarding.ts`); a 7-step "Get set up" card the same for every business type (`checklist.ts`), no skip / hide (`DashboardStart.tsx`) |
| **Empty states** | — | Module pages with a create button and **module FAQs** in the menu (official) | Dashboard prompts the first invoice (partner page) | — | 38 files use `EmptyState`; **GST reports, Books, Inventory, Reports, Exports, Distribution, Practice and Gateway** have none (`audit.log`, `shots/full-*.png`) |
| **Contextual help / "what's this"** | Help (?) panel with search and an assistant; "contact a human" (official) | Help icon → docs; module FAQs (official) | Help in the top toolbar (official) | Guides end with "Still stuck?" → support (official) | Help (?) opens a static about box (`HelpModal.tsx`); no per-screen or per-tab help; no term explanations; one disclaimer paragraph on GST |
| **In-app tips** | 50+ keyboard shortcuts with a guide on Ctrl+Alt+? (official release notes) | Quick Create shortcuts (official) | — | — | Ctrl+K button with a hint (desktop); a shortcuts overlay (Ctrl+/); Help lists only 3 shortcuts |
| **Sample data** | Test Drive sample company, changes not kept (official + textbook) | — | — | — | "Try with sample data" in the **current** company (Dashboard) and in a separate Demo company (wizard): two paths that behave differently; one dataset for every business type (`demo-data.ts`) |
| **Progressive disclosure** | — | Settings per module | — | Advanced item fields (batch / serial / expiry) are opt-in checkboxes in Settings (official) | Shop mode hides modules; packs hide tabs; "Show all features" in Settings → Defaults. **The sidebar never says something is hidden**, and Distribution / Manufacturing have no sidebar entry at all |
| **What's new** | Release notes newest first, per area; in-product "What's New" (official) | Dashboard "Recent Updates" + "Announcements" tabs (official) | — | PC: Help → "Check for updates" (official FAQ) | None. A "New version ready — Reload" toast only |
| **Report a problem** | Settings → Feedback (official) | Forums, phone, e-mail (official) | — | Phone / WhatsApp / e-mail with hours (official) | Help → Report a problem: a masked diagnostic text with Copy (`ReportProblemDialog.tsx`). No fields for steps; no share button; the "beta feedback channel" is not named in the app |

**What carries over to an offline app:**
- a business-aware, skippable checklist that stays on the dashboard;
- help that knows the current screen, with no network;
- term explanations on the GST / TDS screens;
- a release-notes list bundled with the build;
- a separate, resettable demo company (the Xero / QuickBooks pattern);
- one list of "features you can switch on" (the Vyapar settings pattern);
- feedback as a prepared message the user shares through WhatsApp or e-mail.

### 2.3 Audit of our app (Playwright, production build)

Fresh companies were created as CA / full (desktop, 1366 × 768), Kirana (phone, 390 × 844) and Transport (desktop).
23 routes were visited and Help, Ctrl+K and the shortcuts overlay were opened. The script is `audit.mjs`. There were
no page errors.

| # | Sev | Finding | Evidence |
|---|---|---|---|
| U1 | P1 | A **transport** company lands on `/distribution?tab=transport`, but Distribution is **not in the sidebar**. Nor is Manufacturing, for any business type. The pack's own screen is reachable only by URL or Ctrl+K. | `audit.log` "[transport] sidebar"; `DashboardLayout.tsx` nav list; `shop-mode.ts` `PATH_MODULE` has no `/distribution` |
| U2 | P1 | Ctrl+K finds no tab of the 32-tab GST page by its portal name: "GSTR-3B", "consignment" and "LR" give 0 results. Pack tabs are found only by their label. | `audit.log` "ctrl+k"; `CommandPalette.tsx` destinations come from per-round lists; `GST_TABS` is not one of them |
| U3 | P2 | The "Get set up" checklist is the same for a kirana, a CA and a transporter (no POS bill step, no LR step, no opening balances step). It cannot be skipped or hidden. Its "item" step goes to Settings → Items even for a stock business. | `checklist.ts`; `shots/kirana-phone-home.png` |
| U4 | P2 | Help shows "Version 3.0" (`setup.ts:41`) while the build is 3.1.0. It lists 3 shortcuts and does not mention Ctrl+K, the shortcuts overlay, the beta guide or what's new. | `shots/full-help.png` |
| U5 | P2 | Statutory screens explain nothing per tab. The GST page opens with one 70-word disclaimer, a turnover box and 32 tabs. The TDS page has an ITA-2025 banner only. Terms (B2CL, CDNUR, IMS, 4(B)(1), 26AS, AATO) are never explained. | `shots/full-gst-reports.png`, `shots/full-tds.png` |
| U6 | P2 | Empty company: Books, GST reports, Inventory, Reports, Exports and Distribution show zero-filled tables with no "what to do first". | `shots/full-books.png`, `full-inventory.png`, `full-reports.png` |
| U7 | P2 | Two sample-data paths behave differently. The wizard puts samples in a separate Demo company. The Dashboard puts them in the **current** company. The Dashboard text says they can be removed "from Settings → Data". | `DashboardStart.tsx` `loadSample`; `SetupWizard.tsx`; `BETA_GUIDE.md` §4 |
| U8 | P2 | Report a problem gives a diagnostic to copy and tells the tester to "paste it into the beta feedback channel", which is not named or linked. There are no fields for steps / expected / actual, and no WhatsApp or e-mail share. | `ReportProblemDialog.tsx`; `i18n/areas/beta.ts` |
| U9 | P3 | No what's new. After an update the tester cannot tell what changed, so a "missing" feature is reported as a bug. | — |
| U10 | P3 | A Kirana company's phone "More" menu shows "Practice desk" (a CA tool). Its sidebar has no hint that Books / GST are hidden by shop mode. | `audit.log` "[kirana-phone] more menu" |

---

## 3. Ranked list: what to close now

Value runs 1–5: 5 = blocks or misleads most beta testers. Effort: S = 1, M = 2, L = 3. Score = value ÷ effort,
ties broken by value. "Kind" is UX (beta productivity), FIX (open item that changes numbers or blocks migration) or
DOC.

| Rank | Id | Gap | Kind | Value | Effort | Score | Package |
|---|---|---|---|---|---|---|---|
| 1 | R6-B2 | Sidebar reach: Distribution / Manufacturing entries, pack routes always visible, "N features hidden" hint (U1, U10) | UX | 5 | S | 5.0 | B |
| 2 | R6-B1 | Ctrl+K finds every tab and portal term (U2) | UX | 5 | S | 5.0 | B |
| 3 | R6-A5 | Report a problem v2: fields, share, named channel (U8) | UX | 4 | S | 4.0 | A |
| 4 | R6-C6 | Roadmap, beta guide and CA pack refresh (§2.1 stale rows) | DOC | 4 | S | 4.0 | C |
| 5 | R6-A4 | What's new + real version number (U4, U9) | UX | 3 | S | 3.0 | A |
| 6 | R6-C5 | Party-balance snapshot on documents issued outside the editor (8.7) | FIX | 3 | S | 3.0 | C |
| 7 | R6-A2 | "On this screen" help in the Help dialog (U4, U5) | UX | 5 | M | 2.5 | A |
| 8 | R6-A3 | Statutory tab explainers + glossary terms (U5) | UX | 5 | M | 2.5 | A |
| 9 | R6-C3 | Import vendors, ledgers and opening balances from CSV / XLSX (P1-21) | FIX | 5 | M | 2.5 | C |
| 10 | R6-A1 | Business-aware, skippable setup checklist (U3) | UX | 4 | M | 2.0 | A |
| 11 | R6-B3 | Empty states on every main screen (U6) | UX | 4 | M | 2.0 | B |
| 12 | R6-C2 | Payables completeness: payable opening bills in bill-wise, TDS on voucher receipts, refund bank tag | FIX | 4 | M | 2.0 | C |
| 13 | R6-C4 | Filing strip: IFF / CMP-08 marks, remembered download; `itcReversals` in GSTR-9 / compliance / pack | FIX | 4 | M | 2.0 | C |
| 14 | R6-C1 | QC hold on bills, landed cost in margin / insights, QC-reject debit note (R4-A6) | FIX | 3 | M | 1.5 | C |
| 15 | R6-B4 | Sample data v2: one Demo-company path, per business type (U7) | UX | 3 | M | 1.5 | B |
| 16 | R6-B5 | Settings → Features: one list of modules, packs and advanced options | UX | 3 | M | 1.5 | B |
| 17 | R6-A6 | In-app beta guide and one-time screen tips | UX | 3 | M | 1.5 | A |
| 18 | — | Gateway bill-wise references / voucher classes (7.19) | FIX | 3 | M | 1.5 | later (Gateway users are a minority of testers) |
| 19 | — | GSTR-1A JSON (8.66) | FIX | 3 | M | 1.5 | later (needs the CA's answer to G14) |
| 20 | — | Tally import of inventory vouchers (7.49) | FIX | 3 | L | 1.0 | later |
| 21 | — | i18n tail (5.4) | UX | 3 | L | 1.0 | later |

Everything ranked 1–17 is taken. The cut-off is score 1.5 with value ≥ 3 that a tester meets in the first week; rows
18–21 fall below it on tester reach, not on score.

---

## 4. Specifications (17 items)

Conventions for every item:

- **Logic and tests.** Pure logic goes in `src/lib/**/*.ts`, tested with `node:test` in `tests/*.test.ts`. UI checks
  that need a browser are added as steps to `tests/e2e/smoke.mjs` (a section per package, §6).
- **Strings.** Strings go in the package's own i18n area (`defineArea(en, hi)`):
  - `src/i18n/areas/help-r6.ts` (A; help text lives in the `src/lib/help/` data files below, which also use
    `defineArea`);
  - `discover-r6.ts` (B);
  - `closures-r6.ts` (C).
- **Storage.**
  - Company data is a new `mrchartist_inv_<key>` read through `getTable` / `getJson`, and registered in backup / sync /
    audit / roles like every Round 5 table.
  - Device-local viewing state uses a key **outside** the prefix (`mrchartist_*`) and is added to the AGENTS.md list
    by the lead.
- **Guards.** Destructive calls use `requireAccess`; writes in a locked period use `assertUnlocked`; money goes
  through `round2`.
- **No shell imports** of any R6 module except the B2 lines listed in §6.

### R6-A — First run, help and feedback

#### R6-A1 Business-aware setup checklist v3

*Seen in:* QuickBooks setup checklist (tasks in any order, skippable, stays on the dashboard); Zoho Getting Started;
FreshBooks "make your first invoice, enable payments, track time".

*Today:* `buildChecklist` (`src/lib/checklist.ts`) returns the same 7 steps for every company, shown until all are
done (`DashboardStart.tsx`).

**User story.** As a kirana owner testing the beta, I want my first steps to be "add items, make a POS bill, take a
backup" — not "send an invoice on WhatsApp" — and I want to hide the card once I know my way around.

**Acceptance criteria.**
1. `buildChecklist(facts, ctx)`, where `ctx = { businessType, packs, modules, role }`, returns steps from a catalogue
   of step ids:

   | Step | When it applies | Done when | Link |
   |---|---|---|---|
   | `profile` | always | profile has name + UPI or bank | `/settings` |
   | `opening` | `full`, `wholesale`, `manufacturer`, any pack | `ledger_openings` or `opening_bills` has a row | `/books?tab=coa&m=opening-tb` |
   | `import` | `full`, `wholesale` | any import run recorded (clients / items / vendors / openings, C3) | `/settings?tab=data&import=1` |
   | `client` | not `kirana` | ≥ 1 client | `/clients?new=1` |
   | `item` | always | ≥ 1 catalogue item, or a stock item when `inventory` is on | `/inventory?new=1` when inventory is on, else `/settings?tab=items` |
   | `posbill` | `kirana`, `restaurant` | ≥ 1 invoice with `pos: true` | `/pos` |
   | `invoice` | not `kirana` | ≥ 1 issued sales document | `/invoice` |
   | `packFirst` | per active pack | the pack's first record (LR, RA bill, fee plan, donation, lease, channel) | the pack's `PACK_TABS` row |
   | `whatsapp` | `services`, `kirana`, `wholesale` | a reminder / share log row | `/transactions` |
   | `payment` | always | ≥ 1 receipt | `/transactions?filter=unpaid&pay=1` |
   | `gstPeriod` | GST-registered and `gst` module on | a GSTR-1 JSON downloaded or a period marked filed | `/gst-reports` |
   | `backup` | always | `last_backup` set | `/settings?tab=data` |

   At most 7 steps are shown, in the order above.
2. Each step can be **skipped** (it counts as done and shows "skipped"). The card has **Hide** (asks once, explains
   Help → "Setup checklist" brings it back) and shows "n of m".
3. A step done by someone else on another device is recognised from the data (facts are derived; only `skipped` /
   `hidden` are stored).
4. Viewer role: the card is not shown. Clerk role: only `client`, `item`, `invoice`, `posbill`, `payment`.
5. Help → "Setup checklist" (A2) lists the full checklist with the hidden ones and an "Un-hide card" button.

**Files.**
- New: `src/lib/checklist-steps.ts` (step catalogue, applicability).
- Edit: `src/lib/checklist.ts` (signature `buildChecklist(facts, ctx)`, keeps the old one as a wrapper);
  `src/components/dashboard/DashboardStart.tsx` (card UI, skip / hide);
  `src/i18n/areas/reach.ts` (new step keys, en + hi).

**Storage.** `mrchartist_inv_setup_progress` (object, company): `{ skipped: ChecklistId[], hidden_at?: string }`.
Backed up, synced (last-writer-wins singleton), not audited (viewing state), writable by `settings.manage` and
`doc.create`.

**Bundle.** Inside the lazy `DashboardStart` chunk. First paint 0.

**Tests.** `tests/onboarding.test.ts` (extend):
- each business type gives its documented steps;
- a pack adds `packFirst`;
- skipped counts as done;
- hidden hides;
- a clerk sees only the five steps;
- old `buildChecklist(facts)` returns the old 7 (regression).

#### R6-A2 "On this screen" help

*Seen in:* QuickBooks Help (?) panel with search; Zoho module FAQs in each module's menu; Vyapar guides ending "Still
stuck?".

*Today:* `HelpModal.tsx` is a static about box. The `?` key opens the shortcuts overlay.

**User story.** As a tester on GST reports → CDNUR, I press the Help button and see what CDNUR is, when it is filled,
what the app takes into it, the common mistakes and where to go next — without leaving the screen or going online.

**Acceptance criteria.**
1. **Registry.** `src/lib/help/registry.ts` exports `helpFor(pathname, search): HelpTopic | null`, matching route +
   `tab` (+ `view`) to a topic id. The topics live in per-area data files that are lazily imported:
   - `help/topics-sales.ts` (Dashboard, Invoices, editor, Clients, Receivables, Recurring, Time, POS, Tables);
   - `help/topics-purchase.ts` (Expenses tabs, Inventory, Manufacturing tabs, Distribution);
   - `help/topics-books.ts` (Books tabs, Gateway, Reconcile, Cheques, Loans, Reports, Exports);
   - `help/topics-statutory.ts` (every GST tab, every TDS tab, every Payroll tab, Practice);
   - `help/topics-packs.ts` (every `PACK_TABS` row);
   - `help/topics-settings.ts`.

   A topic is:
   ```ts
   {
     id; title; what; when;
     steps?: string[];          // ≤ 5 lines
     statutory?: {
       forms?: string;
       due?: string;            // text, not computed
       ca: true;                // prints the CA line
       caItems?: string[];      // CA_REVIEW ids, e.g. ['G1', 'G16']
     };
     related?: { label: string; href: string }[];
   }
   ```
2. **Coverage.** Every route in `App.tsx`, every id in `GST_TABS`, the TDS / Payroll / Books / Manufacturing /
   Expenses / Receivables / Reports / Settings tab lists and every `PACK_TABS` row has a topic. A test fails when a new
   tab id has none.
3. **Help dialog.**
   - Opening Help shows, first, **"On this screen: <title>"** with what / when / steps / related.
   - For statutory topics it shows a "Verify with your CA" box naming the `CA_REVIEW.md` item ids (shown as "CA
     checklist: G1, G16").
   - Then a search box over all topics (same tokeniser as `search.ts`).
   - Then links: Keyboard shortcuts (opens the overlay), What's new (A4), Beta guide (A6), Setup checklist (A1),
     Report a problem (A5).
   - The legal footer stays.
4. The "?" button in the top bar and the phone "More → Help & about" open this dialog. **F1** opens it on every screen
   except POS (POS keeps its own F1 = recall held bills) and fields where F1 is in use. The shortcuts overlay keeps `?`.
5. Topics in Hindi wherever the screen itself is in Hindi; otherwise English with the Hindi title.
6. No topic text promises a statutory value. Values in help text are phrased "as the app applies it" and point to the
   CA item.

**Files.**
- New: `src/lib/help/registry.ts`, `src/lib/help/topics-*.ts` (6 files), `src/components/help/ScreenHelp.tsx`,
  `HelpSearch.tsx`, `help.module.css`.
- Edit: `src/components/layout/HelpModal.tsx` (layout; reads `useLocation`).

**Storage.** None.

**Bundle.** The `HelpModal` chunk gains the registry (route map only, ≤ 3 kB gz). Each topics file is its own chunk,
loaded on open. First paint 0 (`HelpModal` is already lazy). The F1 key is handled in B2's key line (§6).

**Tests.** `tests/help-registry.test.ts`:
- every `App.tsx` route path, every `GST_TABS` id, every `PACK_TABS` path and the tab ids of the pages listed above
  resolve to a topic (static scan like `tests/wiring.test.ts`);
- every `caItems` id exists in `docs/CA_REVIEW.md`;
- every topic has en + hi titles.

E2E step: open `/gst-reports?tab=cdnur`, press F1, see "On this screen: CDNUR".

#### R6-A3 Statutory tab explainers and glossary terms

*Seen in:* Zoho module FAQs; QuickBooks "Learn more" links; Tally's report legends.

*Today:* the GST page shows one long disclaimer. Tabs carry portal codes (B2B, B2CL, CDNUR, 11A / 11B) with no
explanation.

**User story.** As a shop owner who is not an accountant, I want each GST / TDS / payroll tab to say in one line what
it is and when it is due, and to tap "B2CL" or "4(B)(1)" to see what it means.

**Acceptance criteria.**
1. **About strip.** On `/gst-reports`, `/tds` and `/payroll`, under the tab bar, a one-line "About this tab" strip
   reads `topic.what` from the A2 registry. It has:
   - **More** (opens Help on the topic);
   - **Hide strips** (device-local, all tabs).

   The long GST disclaimer moves into the strip's "More" and the Help topic. A shorter fixed line stays: "Working
   paper — verify with your CA before filing".
2. **Glossary.** A `Term` component (`<Term id="b2cl">B2CL</Term>`) renders the text with a dotted underline. A tap or
   focus opens a small popover: definition, "in this app", CA item ids.

   Initial glossary (≥ 30 terms): B2B, B2CL, B2CS, CDNR, CDNUR, EXP, nil / exempt / non-GST, HSN / SAC, UQC, ITC, RCM,
   IMS, GSTR-2B, GSTR-3B 3.1 / 4(A) / 4(B)(1) / 4(B)(2) / 4(C), set-off, PMT-06, Rule 86B, IFF / QRMP, AATO, IRN, e-Way
   Part B, LUT, ISD, TDS, TCS, 26AS / AIS, Form 16A, 206AA, 43B(h), Udyam, Sec 393 (ITA 2025).
3. Terms are applied in: GST tab labels and section headings, 3B table row labels, TDS overview cards, payroll
   statutory headings, the compliance calendar.
4. **Empty states on statutory screens.** These pages are owned by A, so A adds them:
   - GST reports with no documents in the period: "No sales or purchases dated in September 2026. GSTR-1 and 3B are
     built from saved invoices and bills" + Change period / New invoice / Add bill;
   - TDS with no deductions: what TDS on payables is + "Add a bill with TDS";
   - Payroll with no employees already exists — keep it.

**Files.**
- New: `src/lib/help/glossary.ts`, `src/components/help/Term.tsx`, `src/components/help/AboutStrip.tsx`.
- Edit (statutory pages, owned by A this round):
  - `src/pages/GstReports.tsx` (strip, terms in labels, empty state, disclaimer move — **not** the filing strip, §6);
  - `src/pages/Tds.tsx`;
  - `src/pages/Payroll.tsx`;
  - `src/components/gst-reports/Gstr3bView.tsx` (row-label terms only);
  - `src/components/tds/TdsTabs.tsx` (overview card terms only).

**Storage.** Device-local `mrchartist_help_strips` (`'on' | 'off'`).

**Bundle.** `Term` and `AboutStrip` are small lazy components inside the GST / TDS / Payroll route chunks
(≤ 1.5 kB gz). The glossary is its own chunk, loaded on the first popover. First paint 0.

**Tests.** `tests/help-glossary.test.ts`:
- every glossary id used in `src/` exists;
- every term has en + hi;
- no glossary text contains a percentage or rupee amount without "as the app applies it" (keeps statutory values out
  of help text).

E2E step: tap B2CL on GST reports and see the popover.

#### R6-A4 What's new and the real version number

*Seen in:* QuickBooks release notes per release with an in-product What's New; Zoho dashboard "Recent Updates".

*Today:* no release notes in the app. `setupT('version')` hard-codes "Version 3.0". The diagnostic report reads its
own version.

**User story.** As a beta tester who just tapped "Reload" for a new version, I want to see what changed in two lines,
so I can try the new thing and not report a fix as a bug.

**Acceptance criteria.**
1. **Version.** The app version comes from `package.json` at build time (Vite `define: { __APP_VERSION__ }`, a lead
   edit to `vite.config.ts` per §6). Help, the diagnostic report and the What's-new list read it. The string "Version
   3.0" is removed.
2. **Data.** `src/lib/whats-new.ts` holds entries `{ version, date, items: { title, text?, href? }[] }`, newest first.
   - Each round's lead adds one entry at merge; the build fails if the newest entry's `version` ≠ `__APP_VERSION__`
     (a check in `scripts/check-whats-new.mjs`, run by `npm run build` via `postbuild`).
   - Seed entries: Round 6, Round 5 (industry packs), Round 4 (production, stores, trade desk), ITA 2025 labels.
3. **Display.**
   - Help → "What's new" lists all entries; each item with an `href` opens that screen.
   - After the first load of a new version, a dismissible card on the Dashboard shows the newest entry's first three
     items ("What's new in 3.2 · See all").
4. **Seen state.** Device-local `mrchartist_whats_new_seen` = the last version whose card was dismissed. A fresh
   install never shows the card. It shows only after an upgrade, when the stored version is older.

**Files.**
- New: `src/lib/whats-new.ts`, `src/components/help/WhatsNew.tsx`, `src/components/dashboard/WhatsNewCard.tsx`,
  `scripts/check-whats-new.mjs`.
- Edit: `src/components/layout/HelpModal.tsx` (link); `src/components/dashboard/DashboardStart.tsx` (mounts the card
  lazily); `src/i18n/areas/setup.ts` (`version` key takes `{v}`); `src/lib/diagnostics.ts` caller in
  `ReportProblemDialog.tsx` (passes `__APP_VERSION__`).
- Shared (lead): `vite.config.ts` `define`, `src/vite-env.d.ts` declaration, `package.json` `postbuild` line.

**Storage.** Device-local `mrchartist_whats_new_seen`.

**Bundle.** `__APP_VERSION__` is a literal (bytes ≈ 0). The card is lazy in `DashboardStart`. First paint ≤ +0.05 kB.

**Tests.** `tests/whats-new.test.ts`:
- entries are sorted newest first with unique versions;
- `shouldShowCard(stored, current)`: fresh install → no; older → yes; same → no;
- every `href` resolves to a route in `App.tsx`.

#### R6-A5 Report a problem v2 and "Suggest an idea"

*Seen in:* QuickBooks Settings → Feedback; Vyapar / myBillBook WhatsApp support; our BETA_GUIDE §9.

*Today:* `ReportProblemDialog.tsx` builds a masked diagnostic text with Copy only.

**User story.** As a tester, I want one dialog where I type what I did, what I expected and what happened, pick the
area, and then share it to the beta WhatsApp group or e-mail in one tap — with the masked diagnostics attached and
nothing sent behind my back.

**Acceptance criteria.**
1. **Kinds.** Problem / Idea / Question.
   - **Fields:** area (prefilled from the A2 topic of the current screen; a select of topic titles), "What did you
     do?", "What did you expect?" (Problem only), "What happened instead?" (Problem only), severity (Blocks me /
     Annoying / Cosmetic).
   - The diagnostic block is appended unchanged (`buildDiagnostics`), with its masking rules.
2. **Route trail.** The last 10 routes visited in this session, with record ids masked the same way as `pathname`, kept
   in memory only (`src/lib/route-trail.ts`, pushed from B2's one shell line). Shown in the report under "Screens
   before".
3. **Share.**
   - **Share** uses Web Share (text). Fallbacks are **WhatsApp** (`https://wa.me/<number>?text=`) and **E-mail**
     (`mailto:<address>?subject=&body=`), built only when `VITE_BETA_WHATSAPP` / `VITE_BETA_EMAIL` are set at build time.
     Without them, only Copy and Web Share show.
   - The text above the buttons names the channel ("Beta WhatsApp group (+91 …)").
   - The `wa.me` / `mailto:` texts are capped at 1,800 characters (diagnostics shortened first, with a "full report
     copied" note).
4. **Privacy unchanged.**
   - The report holds no names, amounts, numbers, GSTINs or table contents (the existing scrubber is applied to the
     typed fields too).
   - The dialog says "Nothing is sent until you tap Share".
5. The last unsent draft is kept device-local until sent or cleared (`mrchartist_feedback_draft`, try / catch).

**Files.**
- New: `src/lib/route-trail.ts`, `src/lib/feedback.ts` (compose, cap, links).
- Edit: `src/components/layout/ReportProblemDialog.tsx`, `src/lib/diagnostics.ts` (route-trail section, scrub typed
  text), `src/i18n/areas/beta.ts`.
- `.env.example` documents the two `VITE_BETA_*` variables (lead, §6).

**Storage.** Device-local `mrchartist_feedback_draft`. No company data.

**Bundle.** Report dialog chunk only. `route-trail.ts` is ≤ 0.2 kB and imported by the shell (B2 line), so it counts
against A's first-paint budget.

**Tests.** `tests/diagnostics.test.ts` (extend):
- typed text is scrubbed (a GSTIN, a phone and an amount in "What did you do?" are masked);
- the trail masks ids;
- `wa.me` / `mailto` links are built only with the env set and stay under the cap;
- an Idea report has no expected / actual block.

#### R6-A6 In-app beta guide and one-time screen tips

*Seen in:* Vyapar task videos and guides; QuickBooks onboarding pathways; our `docs/BETA_GUIDE.md`.

*Today:* the beta guide exists only as a repo Markdown file. Testers never see it in the app.

**User story.** As a new tester, I want the "what to test first" list and the known limits inside the app, and one
short tip the first time I open a busy screen.

**Acceptance criteria.**
1. **Beta guide.** Help → "Beta guide" shows a lazy article built from a TypeScript copy of the guide's sections
   (`src/lib/help/beta-guide.ts`, en + hi):
   - what the app is;
   - back up first / use a test company;
   - test flows A–E with "Open" links to the screens;
   - known limits (from C6's refreshed list);
   - how to report (opens A5).

   A test keeps the section headings in step with `docs/BETA_GUIDE.md`.
2. **Tips.** One tip per screen, shown once per device as a dismissible line above the content, for 10 screens:

   | Screen | Tip |
   |---|---|
   | Dashboard | Ctrl+K |
   | Invoices | filters and amounts in search |
   | Editor | Alt+R repeat last bill; split Save |
   | POS | F9 save, F1 held bills |
   | Clients | ₹ Received / Remind |
   | Expenses | Scan bill |
   | Books | Alt+F2 period, F12 options |
   | GST reports | the filing strip |
   | Gateway | Ctrl+/ keys |
   | Inventory | groups / units |

   "Don't show tips" turns all off (device-local).
3. Tips never cover a form field or a button. They render in normal flow, not as overlays (no coach-mark library).

**Files.**
- New: `src/lib/help/beta-guide.ts`, `src/lib/help/tips.ts`, `src/components/help/BetaGuide.tsx`,
  `src/components/help/ScreenTip.tsx`.
- Edit: `HelpModal.tsx` (link).
- The tip **mount** is one lazy line per page and belongs to the page's owner (§6). B mounts the tip on the pages it
  owns, and A on GST / TDS / Payroll.

**Storage.** Device-local `mrchartist_tips_seen` (ids) and `mrchartist_tips_off`.

**Bundle.** Lazy. First paint 0.

**Tests.** `tests/help-tips.test.ts`:
- every tip's route exists;
- seen / off logic;
- `beta-guide.ts` headings match `docs/BETA_GUIDE.md` `##` headings.

### R6-B — Discoverability, empty states and sample data

#### R6-B1 Ctrl+K finds every tab and portal term

*Seen in:* QuickBooks search and shortcut guide; Zoho global search with module filters.

*Today:*
- Ctrl+K searches documents (SmartFind), pages, quick actions and per-round destination lists.
- No GST, TDS, Payroll or Books tab appears by its own name, so "GSTR-3B" gives 0 results (U2).
- Pack tabs are found only by their label.

**User story.** As a tester who heard "check your 3B", I press Ctrl+K, type "3b" and land on GST reports → GSTR-3B for
the current period.

**Acceptance criteria.**
1. **Tab index.** `src/lib/palette/tab-index.ts` builds `StaticEntry[]` from the existing tab registries:
   - `GST_TABS` (`gst-tabs.ts`);
   - the Books, Manufacturing, Payroll, TDS, Expenses, Receivables, Reports, Inventory, Distribution, Time,
     Recurring and Settings tab lists (each page's exported tab array; where a page keeps its list inline, B moves it
     to an exported `const` in a `*-tabs.ts` file next to the page — no behaviour change);
   - `PACK_TABS`.

   Each entry is `{ title, group: page title, href, keywords }`.
2. **Synonyms.** Synonyms live in `palette/synonyms.ts`:
   - GST: "gstr1 / gstr-1 / r1", "3b / gstr3b", "2b", "b2cl / large", "cdnur", "hsn", "itc", "rcm", "lut", "irn",
     "eway";
   - TDS: "26q", "27eq", "form 16a", "challan", "194c" … "393";
   - Books: "tb / trial balance", "p&l / profit", "bs / balance sheet", "day book", "ledger", "brs";
   - packs: "lr / bilty / consignment", "ra bill / boq / retention", "80g / 10bd / donation", "fee / tuition",
     "lease / rent / cam", "settlement / payout / amazon / flipkart / meesho";
   - Hindi synonyms where the area has them.
3. **Behaviour.**
   - Tab entries rank below an exact document match and above other pages.
   - A tab of a module hidden by shop mode or a pack that is off still shows, marked "(hidden)" or "(pack off)", and
     opens.
   - The R5 "Industry packs" group stays.
4. **Empty query.** The palette's empty state lists "Try: GSTR-3B · 12.5k · a GSTIN · LR · Alt+P POS · F1 help"
   (one line).
5. **Help search.** "help <words>" or "?" + words searches A2's topic titles and opens Help on the topic. B reads A's
   exported `helpIndex()` lazily. If A has not merged yet, the group is simply empty (guarded import).

**Files.**
- New: `src/lib/palette/tab-index.ts`, `src/lib/palette/synonyms.ts`, `src/components/command/tab-destinations.ts`,
  and `src/pages/*-tabs.ts` extractions where a page keeps its tab list inline (Books, Manufacturing, Payroll,
  Expenses, Receivables, Reports, Inventory, Distribution, Time, Recurring, Settings — a move only).
- Edit: `src/components/command/CommandPalette.tsx` (one lazy group, empty-state line).

**Storage.** None.

**Bundle.** The palette chunk +≤ 4 kB gz. First paint 0. The tab-list extractions must not pull page code into the
palette: each `*-tabs.ts` imports types only.

**Tests.** `tests/palette-tabs.test.ts`:
- every `?tab=` id found in the page tab registries has an entry (static scan);
- "3b", "GSTR-3B", "consignment", "LR", "80g", "trial balance" each return ≥ 1 tab entry;
- the hidden / pack-off label;
- no `*-tabs.ts` imports a component.

E2E step: Ctrl+K "3b" → Enter → GSTR-3B tab.

#### R6-B2 Sidebar reach and the "features hidden" hint

*Seen in:* Vyapar's settings-driven menus; Zoho's module list; our own shop mode (8H) and packs (R5).

*Today:* Distribution and Manufacturing have no sidebar entry (U1). Shop mode hides modules silently (U10).
`isPathVisible` knows nothing about packs.

**User story.** As a transporter, my LRs and trips are one click away in the menu. As a kirana owner, I can see that
Books and GST exist and how to turn them on.

**Acceptance criteria.**
1. **New sidebar entries.**
   - Manufacturing (`/manufacturing`, module `inventory`) after Inventory.
   - Distribution (`/distribution`) after Receivables, with `PATH_MODULE['/distribution'] = 'inventory'`.
   - Existing icons only (`Layers`, `Truck`).
2. **Pack routes stay visible.** A route that hosts a tab of an **active** pack is visible even when shop mode hides
   its module:
   - `/distribution` (transport), `/time` (works), `/recurring` (fees, leases), `/books` (nonprofit),
     `/gst-reports` (fees);
   - `/receivables` is core.

   `shop-mode.ts` gains `PACK_ROUTES` (path → pack ids) and `impliedPacks(settings)` — a 6-entry inline copy of
   `PACK_OF_TYPE` plus the explicit `industry_packs` array. `isPathVisible(path, modules, packs?)` takes the packs as
   an additive argument. A test pins the inline copy to `industry-packs.ts`.
3. **Hidden hint.** When the modules filter hides at least one sidebar entry, the sidebar's last group ends with "N
   more features — Show" (and the phone More sheet the same). It opens Settings → Features (B5). It is not shown to
   viewers or for `full`.
4. **Kirana phone menu.** Practice desk is hidden unless the company registry has more than one company or the
   business type is `full` (a CA tool).
5. **Key lines owned here (§6).**
   - F1 → open Help (A2), skipped on `/pos` and in fields;
   - one `pushRoute(location)` call for A5's route trail;
   - the `OPEN_HELP_EVENT` listener (`window` event `mrchartist:open-help`, `detail: { topic? }`) so empty states and
     tips can open Help on a topic without importing it.

**Files.**
- Edit: `src/layouts/DashboardLayout.tsx` (two nav entries, hidden-count link, F1, route-trail line, event listener);
  `src/lib/shop-mode.ts` (`PACK_ROUTES`, `impliedPacks`, additive `isPathVisible` argument, `/distribution` in
  `PATH_MODULE`).
- New: `src/lib/help-event.ts` (the event name and a `openHelp(topic?)` dispatcher, ~0.1 kB, imported by empty states
  and tips).

**Storage.** None.

**Bundle.** Shell: two nav rows, `PACK_ROUTES` (≈ 120 bytes), the hint (≈ 150 bytes), F1 and the listener. ≤ +0.35 kB
gz first paint (B's +0.4 kB includes B3's event helper).

**Tests.** `tests/reach-8h.test.ts` (extend, shop mode) and `tests/industry-packs.test.ts` (pin):
- a transport company sees `/distribution`;
- a contractor sees `/time` with `time` off;
- kirana hidden count > 0, full = 0;
- the inline `PACK_ROUTES` / implied packs equal `PACK_TABS` / `PACK_OF_TYPE` (pin);
- `isPathVisible` without packs is unchanged for every existing path (regression).

E2E (in the existing kirana step): the "more features" link shows and opens Features.

#### R6-B3 Empty states on every main screen

*Seen in:* Zoho module pages (create button + FAQs); FreshBooks first-invoice prompt.

*Today:* Books, Inventory, Reports, Exports, Distribution, Practice, Reconcile (statement area) and Gateway show
zero-filled panels with no first step (U6).

**User story.** As a tester on an empty company, every screen tells me in one sentence what fills it and gives me the
one button that starts it.

**Acceptance criteria.**
1. Each listed screen shows the shared `EmptyState` when its data is empty for the selected period:

   | Screen | Empty when | Text (shortened) | Primary action | Secondary |
   |---|---|---|---|---|
   | Books (every statement tab) | no ledger voucher in the period and no openings | "Books build themselves from your invoices, receipts and bills. Starting mid-year? Enter opening balances." | Opening balances (`/books?tab=coa&m=opening-tb`) | Import from Tally · Learn more |
   | Inventory | no stock item | "Track stock by adding items; sales and bills then move it." | Add item | Import items · Learn more |
   | Reports (each tab) | no sales docs in the period | "Reports read your saved invoices and bills for the period." | Change period | New invoice |
   | Exports | no documents in the period | "Pick a period that has documents, or include drafts." | Change period | — |
   | Distribution (Masters) | no area / beat / route | "Beats group parties by the salesman's round." | Add area | Learn more |
   | Practice | one company | "The practice desk shows every company on this device. Add a client's company to see it here." | Add company | Learn more |
   | Reconcile | no statement imported | "Import your bank statement (CSV / XLSX) to match it with your books." | Import statement | Add bank account |
   | Gateway | no vouchers yet | a one-line Tally-keys hint over the menu | — | Keys (Ctrl+/) |

2. "Learn more" calls `openHelp(topic)` (B2's event). It does nothing visible if A2 is not merged, and is hidden by
   feature detection on the topic registry.
3. Screens owned by A (GST reports, TDS, Payroll) are covered by A3.
4. The tip mount (A6) is added by B on the pages B edits here, one lazy line each.

**Files.** Edit:
- `src/pages/Books.tsx`, `src/pages/Inventory.tsx`, `src/pages/Reports.tsx`, `src/pages/Exports.tsx`,
  `src/pages/Distribution.tsx`, `src/pages/Practice.tsx`, `src/pages/Reconcile.tsx`, `src/pages/Gateway.tsx`;
- `src/components/books/ledger/ReportViews.tsx` (shared empty block for statement tabs);
- strings in `discover-r6.ts`.

**Storage.** None.

**Bundle.** Route chunks only (the `EmptyState` component is already shared). First paint 0.

**Tests.** `tests/empty-states.test.ts`: pure "is empty" predicates for Books (period, openings), Reports (period),
Exports (period, drafts), Practice (registry size), each with a non-empty counter-case.

E2E (fresh company): Books shows "Opening balances"; Inventory shows "Add item".

#### R6-B4 Sample data v2: one Demo-company path, per business type

*Seen in:* the QuickBooks Test Drive and the Xero Demo Company (separate, resettable, never mixed with real books).

*Today:*
- The wizard can create a separate Demo company (`demo-company.ts`).
- The Dashboard's "Try with sample data" loads into the **current** company (`DashboardStart.tsx` → `loadDemoData`).
- One dataset serves every business type (U7).

**User story.** As a kirana owner, "Try with sample data" shows me a shop with POS bills and stock in a company I can
throw away, and one tap brings me back to my own (empty) company.

**Acceptance criteria.**
1. **One path.** "Try with sample data" (Dashboard and Settings → Data) asks:
   - "Open a separate Demo company (recommended)" — creates or opens it, as the wizard does;
   - "Add samples to this company" — today's behaviour, marked "removable later".

   The default is the Demo company.
2. **Datasets by business type.** `buildDemoDataset(today, profile)` with `profile ∈ counter | services | trading |
   transport | works`:
   - **counter**: POS bills, stock, a shift;
   - **services**: time, retainers, recurring;
   - **trading**: the existing full set;
   - **transport**: LRs, a freight bill, a trip — when the transport pack is on;
   - **works**: BOQ, an RA bill with retention — when the works pack is on.

   The Demo company takes the user's business type and packs from the current company.
3. **Banner.** In a Demo company the existing `DemoNotice` banner shows "Sample company — nothing here is real ·
   Switch to <my company> · Reset samples". Reset rebuilds the dataset with today's dates (the Xero pattern).
4. Sample rows still never reserve real series numbers or reach the recycle bin (R4-C rule kept).

**Files.**
- Edit: `src/lib/demo-data.ts` (profiles), `src/components/onboarding/demo-company.ts` (reset, profile pass-through),
  `src/components/demo/*` (banner actions).
- New: `src/components/demo/SampleDataChooser.tsx`.
- The Dashboard CTA moves out of `DashboardStart.tsx` into `SampleDataChooser`, which A mounts with one lazy line
  (§6).

**Storage.** No new key; the registry entry for the Demo company is unchanged.

**Bundle.** The demo chunks only (already lazy). Datasets per profile are split so a kirana never downloads the works
dataset.

**Tests.** `tests/demo-data.test.ts` (extend):
- each profile builds and balances (TB = 0, stock never negative);
- the transport / works profiles create pack rows only with the pack on;
- reset leaves no row of the old run;
- "add to this company" still never consumes a series number.

#### R6-B5 Settings → Features: one list of what can be switched on

*Seen in:* Vyapar settings toggles (additional item fields, charges, roles); Zoho per-module preferences.

*Today:* switches are spread over Settings → Defaults (shop mode, packs), Inventory (batches, serials, godowns),
Approvals, Branches, Loyalty, Restaurant settings, Pharma and POS retail settings. A tester cannot tell what exists.

**User story.** As a tester, one Settings tab lists every module, pack and advanced option with one line on who needs
it, whether it is on, and a button that turns it on or takes me to where it is set.

**Acceptance criteria.**
1. **Tab.** Settings → **Features** (`?tab=features`), owner only (`settings.manage`); clerks see it read-only.
2. **Sections.**
   - Modules: the `ALL_MODULES` list with the shop-mode switch per module and "Show all features".
   - Industry packs: R5 checkboxes, reusing `ShopModePanel`'s pack block.
   - Advanced options, each row `{ title, who, on: boolean | 'n/a', action }`, where the action is a toggle when the
     setting is a simple flag or "Open settings" with a deep link. The options: batches / expiry, serials, multiple
     godowns, branches, approvals, credit-limit policy, loyalty, offers, price levels, cost centres, multi-currency,
     e-invoice AATO, composition, vault mode, folder sync, local users, Gateway (Tally keys), POS shifts, restaurant
     tables, pharma pack, weighing scale.
3. **Search.** A search box filters rows. B1 adds every row to Ctrl+K under "Features".
4. **Reach.** The sidebar "N more features" link (B2) lands here.
5. **No setting moves.** Rows read and write through the existing setters, so nothing changes for code that reads
   them.

**Files.**
- New: `src/lib/features-catalog.ts` (rows, `isOn(settings)` readers, deep links), `src/components/settings/FeaturesPanel.tsx`.
- Edit: `src/pages/Settings.tsx` (one tab line + lazy panel).

**Storage.** None (existing settings only).

**Bundle.** Settings chunk +≤ 3 kB gz. First paint 0.

**Tests.** `tests/features-catalog.test.ts`:
- every row's deep link resolves to a route / tab;
- `isOn` agrees with the existing readers (batches on a stock item, `branches` table non-empty, `vault` record);
- every module in `ALL_MODULES` and every `PackId` has a row.

### R6-C — Open-roadmap closures and the docs refresh

#### R6-C1 R4-A follow-ups: QC hold on bills, landed cost everywhere, QC-reject debit note

*Today (verified):*
- `applyQcHold` runs only for GRNs (`receipt-notes.ts:332`), so a bill entered without a GRN puts QC items straight
  into saleable stock.
- The margin chip and insights read raw bills, without landed-cost vouchers (`production-r4.md` deviations 3–6).

**User story.** As a maker who books bills directly, QC items still go to the QC godown, and my margin chip shows the
landed cost my stock reports already use.

**Acceptance criteria.**
1. `purchasesDb.save` applies `applyQcHold(lines)` to new **stock** bill lines that have no `grn_line_id`, using the
   same rule as GRNs (`qc_on_receipt` item, no explicit godown). An edit never moves goods already released.
2. `margin.ts` and `insights.ts` (stock-at-risk, margin erosion) read purchases through `liveInputs().purchases`, so
   landed-cost vouchers count. `tests/purchase-contract.test.ts` gains both readers.
3. A QC reject offers "Debit note to supplier" that opens `/expenses?tab=returns&new=dn&bill=<id>&lines=<…>` with the
   lines and quantities filled. `ReturnsTab` reads the new `bill` / `lines` params (additive).
4. The Inventory → "Landed cost" link is added on the Inventory header by B (one line, §6), pointing to
   `/manufacturing?tab=landed`.

**Files.** Edit:
- `src/lib/purchases.ts` (save path, one guarded call);
- `src/lib/margin.ts`, `src/lib/insights.ts`;
- `src/components/production/QcTab.tsx` (button);
- `src/components/purchases/ReturnsTab.tsx` (params).

**Storage.** None.

**Bundle.** Lazy chunks only.

**Tests.** `tests/qc-hold.test.ts` (extend):
- a bill-only receipt of a `qc_on_receipt` item lands in QC;
- an edit does not re-hold released goods.

`tests/margin-landed.test.ts` (new): a landed-cost voucher raises the cost the chip uses. Prefill: param parsing.

#### R6-C2 Payables completeness

*Today (verified):*
- Payable opening bills post to the ledger but `billwise.ts` never reads them (`masters.md` "Not done").
- A customer's TDS on a voucher-allocated receipt is not booked to TDS receivable.
- POS refund vouchers carry no `bank_account_id` (`business-extras.md`).

**User story.** As a business starting on the app mid-year, my supplier openings show in payables ageing, and every
rupee of TDS my customers deducted reaches the TDS register however I recorded the receipt.

**Acceptance criteria.**
1. `billwisePayables` includes `openingBillsFor(vendorId, 'payable')`:
   - they age from their own date;
   - they can be settled Agst Ref by supplier payments (`vendor_payments` allocations with `opening_bill_id`,
     additive);
   - the payables total equals the ledger creditor balance in a test with openings + bills + payments.
2. A voucher receipt allocation (`bill-allocation.ts`) with a TDS amount stamps `tds_amount` on the created
   `transactions` row, so `tds-register.ts` and the ledger book TDS receivable as for invoice receipts.
3. A POS refund voucher takes the bank account of the original receipt (or the picker default), so multi-account BRS
   sees it.

**Files.** Edit:
- `src/lib/billwise.ts`, `src/lib/opening-bills.ts` (read helper only);
- `src/lib/bill-allocation.ts`;
- `src/components/masters/BillAllocation.tsx` (TDS field);
- `src/lib/pos-returns.ts`;
- `src/components/purchases/*Payment*.tsx` (opening bills in the picker).

**Storage.** Additive `opening_bill_id` on `vendor_payments.allocations[]`; `tds_amount` on voucher-created
transactions (an existing field).

**Bundle.** Lazy.

**Tests.** `tests/billwise-openings.test.ts` (new):
- opening payable bills age and settle;
- payables total = ledger.

`tests/openings.test.ts`: the voucher-receipt TDS reaches the register. `tests/business-extras.test.ts` (extend): the refund bank
tag. `tests/purchase-contract.test.ts` row unchanged (`billwise` is already listed).

#### R6-C3 Import vendors, ledgers and opening balances (P1-21)

*Today (verified):* the CSV / XLSX wizard imports only clients, items and invoices (`ImportKind`,
`import-mapping.ts:6`). Testers moving from Excel, Vyapar or Busy must type suppliers and openings by hand.

**User story.** As a tester migrating from Vyapar, I import my supplier list and my 31 March trial balance from Excel,
check a dry run, and start testing with real openings in ten minutes.

**Acceptance criteria.**
1. **Kinds.** `ImportKind` gains `vendors`, `ledgers` (account name, group / sub-group, opening Dr / Cr) and
   `opening_bills` (party, side, ref, date, due, amount).
2. **Presets.** Mapping presets for the existing sources (Vyapar, Busy, Marg, QuickBooks, Xero, Refrens, ClearOne) where
   their exports carry these columns. A generic "Trial balance (Name, Group, Debit, Credit)" preset.
3. **Dry run.**
   - The difference in opening balances is shown before saving (it posts to 1090, as `saveOpenings` already does).
   - Unknown groups map to the nearest Schedule III primary, with a warning.
   - Duplicate vendor names / GSTINs are matched, not duplicated.
4. **Writing.**
   - Writes go through `saveOpenings` / `saveOpeningBillsFor` / `vendorsDb.save`.
   - The whole import is all-or-nothing (`withTablesRollback`), with one undo copy like the Tally import.
   - The period lock on the opening day is respected.
5. Setup checklist step `import` / `opening` (A1) turns done.

**Files.** Edit:
- `src/lib/import-mapping.ts` (kinds, presets, `scoreHeader` synonyms);
- `src/lib/importers.ts` (row parsers);
- `src/components/import/wizard-state.ts` and step components (kind picker, dry-run panel for openings).

New: `src/lib/import-openings.ts` (validation, group mapping, apply).

**Storage.** None new (existing `vendors`, `accounts`, `groups`, `ledger_openings`, `opening_bills`).

**Bundle.** Import chunk only (already lazy; `xlsx.ts` stays a dynamic import).

**Tests.** `tests/import-openings.test.ts`:
- a TB file with a Dr / Cr mismatch shows the difference;
- group mapping;
- vendor de-duplication by GSTIN;
- all-or-nothing on a bad row;
- the locked opening day is refused;
- a Vyapar party export splits into clients and vendors.

#### R6-C4 Filing strip follow-ups and Rule 42 / 43 reversals everywhere

*Today (verified):*
- `GstReports.tsx` keeps "downloaded" in component state (`:266`), so it is lost on reload.
- `toggleFiled` handles only GSTR-1 / 3B (`:298–303`), although `compliance.ts` knows IFF / CMP-08.
- `itcReversals` (the Rule 42 / 43 journals) reach the GSTR-3B tab only; GSTR-9, the Compliance estimates and the
  month-end pack miss them (`institutions-property-r5.md`).

**User story.** As a QRMP filer, the strip shows IFF in months 1–2 and remembers that I downloaded the JSON. As a
clinic, my common-credit reversal shows in GSTR-9 and the interest estimate too.

**Acceptance criteria.**
1. The filing strip moves into `src/components/gst-reports/FilingStrip.tsx` (a pure move, then changes):
   - The forms follow the period: GSTR-1 + 3B (monthly), IFF in QRMP months 1–2, CMP-08 for composition quarters.
   - Mark filed uses `compliance.ts` marks for each.
   - "Downloaded" is stored on the compliance mark as additive `downloaded_at` and survives reloads.
2. **Per-form preflight.** IFF skips the HSN checks. CMP-08 runs only the composition checks (`gst-preflight.ts`
   gains a `form` argument).
3. `buildGstr9`, the Compliance tab's late-fee / interest base (`compliance.ts`) and the month-end pack
   (`report-pack.ts`) pass `itcReversals: journalItcReversals(...)` the same way `GstReports.tsx` does. A test proves
   that GSTR-9 Table 7 and the 3B 4(B)(1) of the month agree.

**Files.**
- New: `src/components/gst-reports/FilingStrip.tsx`.
- Edit: `src/pages/GstReports.tsx` (replace the inline strip block with the component — §6 region rule);
  `src/lib/gst-preflight.ts`; `src/lib/compliance.ts` (additive field); `src/lib/gstr9.ts` (option pass-through);
  `src/components/gst-reports/Gstr9Modal.tsx`; `src/lib/report-pack.ts`.

**Storage.** Additive `downloaded_at` on `compliance` rows.

**Bundle.** GST route chunk; first paint 0.

**Tests.** `tests/gst-filing.test.ts` (extend):
- QRMP month 1 shows IFF;
- composition shows CMP-08;
- `downloaded_at` round-trips;
- the IFF preflight has no HSN rule.

`tests/common-credit.test.ts`: GSTR-9 Table 7 includes the journal reversal.

#### R6-C5 Party-balance snapshot on documents issued outside the editor (8.7)

*Today (verified):* `party_balance_snapshot` is taken in the editor's save and in `khata-actions.ts:130`. Recurring
runs, conversions (`documents.ts` clears it) and late-fee drafts never take it, so with "show party balance" on, those
bills print no balance block.

**User story.** As a shop owner with "Previous balance" printed on bills, my monthly recurring invoices and converted
challans show it too.

**Acceptance criteria.**
1. When a recurring occurrence is **issued**, a document is converted to an issued type, or a late-fee draft is issued,
   the snapshot is taken with `partyBalanceSnapshotFor(record)` at that moment. It is frozen like the editor's (a
   reprint never changes).
2. Drafts take none. Legacy documents still print nothing.
3. Batch invoices (R2-B1) take one snapshot per party.

**Files.** Edit: `src/lib/recurring.ts` (issue path), `src/lib/documents.ts` (conversion), `src/lib/late-fee.ts`,
`src/lib/batch-invoices.ts` (one call each through a shared helper in `khata-actions.ts`).

**Storage.** None new (`party_balance_snapshot` exists).

**Bundle.** Lazy chunks only.

**Tests.** `tests/khata.test.ts` (extend):
- a recurring issue, a conversion, a late-fee issue and a batch issue each carry a snapshot equal to the party's open
  balance before the document;
- a draft carries none;
- a reprint after a later payment is unchanged.

#### R6-C6 Roadmap, beta guide and CA pack refresh

*Today:* §2.1 lists 16 stale rows. The roadmap header and Round 4 / 5 sections are out of date. `BETA_GUIDE.md` §8
lists a "main ones" set that includes done items (7.28) and misses Round 5.

**User story.** As a beta tester and as the CA, the documents tell me the truth about what is built and what is not.

**Acceptance criteria.**
1. **`docs/ROADMAP.md`.**
   - Status line updated.
   - R4-B / R4-C / PERF-1 / PERF-2 marked ✅ with their feature docs.
   - New sections for QA round 5, Round 5 (R5-A / B / C) and the ITA 2025 labels, each with one row per item.
   - Every stale row in §2.1 struck through with "done in …".
   - A Round 6 section with the 17 items.
   - The "Summary timeline" gains v6.x Round 5 and Round 6.
2. **Feature docs.** Each stale item in §2.1 is struck through with the item that closed it (`cash-planning.md`,
   `cost-centres-budgets.md`, `inventory.md`, `freight-fx.md`, `gst-setoff.md`, `khata.md`, `printing.md`,
   `purchase-returns.md`, `time-expenses.md`).
3. **`docs/BETA_GUIDE.md`.**
   - §6 lists every interface language.
   - §7 gains flow F "Industry pack" (pick one pack in a test company).
   - §8 "Known limitations" is regenerated from the open rows of §2.1 (top 10 by tester impact).
   - §9 matches A5 (fields, Share, the channel).
   - §4 matches B4 (Demo company).
4. **`docs/CA_REVIEW.md`.** Kept as the single CA list. Each later CA answer adds the date, the answer and the PR. Feature
   docs' "Verify with your CA" sections gain one line, "Consolidated in `docs/CA_REVIEW.md` (ids …)".
5. **`AGENTS.md`.** The lead adds the new device-local keys and the `setup_progress` company key after merge
   (§6).

**Files.** `docs/ROADMAP.md`, `docs/BETA_GUIDE.md`, `docs/CA_REVIEW.md`, the nine feature docs above. These are owned by
C this round, except the ones in §6.

**Tests.** `tests/docs-links.test.ts` (new, small):
- every `docs/features/*.md` path named in ROADMAP exists;
- every CA id cited in `src/lib/help/*` exists in CA_REVIEW (shared with A2's test, guarded if A2 is not merged).

---

## 5. Work packages

Three packages, each buildable by one agent in its own worktree. **Merge order: R6-B → R6-A → R6-C.** B owns the shell
lines that A uses (help event, F1, route trail), and C edits `GstReports.tsx` after A.

### R6-A — First run, help and feedback (6 items)

Items:
- **A1** setup checklist v3;
- **A2** "On this screen" help;
- **A3** statutory explainers + glossary + statutory empty states;
- **A4** what's new + version;
- **A5** report a problem v2;
- **A6** beta guide + tips.

Owned files (new):
- `src/lib/help/*` (registry, topics ×6, glossary, beta-guide, tips)
- `src/lib/checklist-steps.ts`, `src/lib/whats-new.ts`, `src/lib/route-trail.ts`, `src/lib/feedback.ts`
- `src/components/help/*`, `src/components/dashboard/WhatsNewCard.tsx`
- `scripts/check-whats-new.mjs`
- `src/i18n/areas/help-r6.ts`
- `docs/features/help-onboarding-r6.md`
- tests `help-registry`, `help-glossary`, `help-tips`, `whats-new`, extended `onboarding`, `diagnostics`

Owned files (edit):
- `src/lib/checklist.ts`, `src/components/dashboard/DashboardStart.tsx`
- `src/components/layout/HelpModal.tsx`, `src/components/layout/ReportProblemDialog.tsx`, `src/lib/diagnostics.ts`
- `src/i18n/areas/{reach,setup,beta}.ts`
- `src/pages/Tds.tsx`, `src/pages/Payroll.tsx`, `src/components/gst-reports/Gstr3bView.tsx`,
  `src/components/tds/TdsTabs.tsx`

Shared (§6): `src/pages/GstReports.tsx` (A regions), `vite.config.ts` / `src/vite-env.d.ts` / `package.json` /
`.env.example` (lead lines).

Icons (reuse): `HelpCircle`, `BookOpen`, `Info`, `MessageSquare`, `History`, `ListChecks`, `CheckCircle2`, `Circle`,
`Copy`, `Share2`.

Budget: first paint ≤ +0.2 kB gz (`route-trail.ts`, the version literal); total JS ≤ +28 kB gz.

### R6-B — Discoverability, empty states and sample data (5 items)

Items:
- **B1** Ctrl+K tab index;
- **B2** sidebar reach + hidden hint + shell key lines;
- **B3** empty states;
- **B4** sample data v2;
- **B5** Settings → Features.

Owned files (new):
- `src/lib/palette/{tab-index,synonyms}.ts`, `src/components/command/tab-destinations.ts`
- `src/pages/*-tabs.ts` (tab-list extractions)
- `src/lib/help-event.ts`, `src/lib/features-catalog.ts`
- `src/components/settings/FeaturesPanel.tsx`, `src/components/demo/SampleDataChooser.tsx`
- `src/i18n/areas/discover-r6.ts`
- `docs/features/discoverability-r6.md`
- tests `palette-tabs`, `empty-states`, `features-catalog`, extended `reach-8h`, `industry-packs`, `demo-data`

Owned files (edit):
- `src/layouts/DashboardLayout.tsx`, `src/lib/shop-mode.ts`
- `src/components/command/CommandPalette.tsx`
- `src/pages/{Books,Inventory,Reports,Exports,Distribution,Practice,Reconcile,Gateway,Settings}.tsx` and their inline
  tab lists (moved to `*-tabs.ts`), `src/components/books/ledger/ReportViews.tsx`
- `src/lib/demo-data.ts`, `src/components/onboarding/demo-company.ts`, `src/components/demo/*`

Shared (§6): the A6 tip mount lines on B's pages, C1's Inventory link line.

Icons (reuse): `Search`, `Compass`, `Eye`, `SlidersHorizontal`, `Layers`, `Store`, `Truck`, `Wand2`.

Budget: first paint ≤ +0.4 kB gz (nav rows, `PACK_ROUTES`, hint, F1, event listener, `help-event.ts`); total JS
≤ +18 kB gz.

### R6-C — Open-roadmap closures and the docs refresh (6 items)

Items:
- **C1** R4-A follow-ups;
- **C2** payables completeness;
- **C3** import vendors / ledgers / openings;
- **C4** filing strip + `itcReversals`;
- **C5** party-balance snapshot;
- **C6** docs refresh.

Owned files (new):
- `src/lib/import-openings.ts`, `src/components/gst-reports/FilingStrip.tsx`
- `src/i18n/areas/closures-r6.ts`
- `docs/features/closures-r6.md`
- tests `import-openings`, `docs-links`, `margin-landed`, `billwise-openings`, extended `qc-hold`, `openings`,
  `business-extras`, `gst-filing`, `common-credit`, `khata`

Owned files (edit):
- `src/lib/{purchases,margin,insights,billwise,opening-bills,bill-allocation,pos-returns,import-mapping,importers,gst-preflight,compliance,gstr9,report-pack,recurring,documents,late-fee,batch-invoices,khata-actions}.ts`
- `src/components/production/QcTab.tsx`, `src/components/purchases/ReturnsTab.tsx` and the payment dialogs,
  `src/components/masters/BillAllocation.tsx`, `src/components/import/*`, `src/components/gst-reports/Gstr9Modal.tsx`
- `docs/ROADMAP.md`, `docs/BETA_GUIDE.md`, `docs/CA_REVIEW.md`, the nine feature docs in C6

Shared (§6): `src/pages/GstReports.tsx` (C region), `tests/purchase-contract.test.ts`.

Icons: none new.

Budget: first paint ≤ +0.1 kB gz (nothing in the shell is planned); total JS ≤ +14 kB gz.

**Combined:** ≤ +0.7 kB gz first paint (≤ 183.7 of 185 kB) and ≤ +60 kB gz total JS (≤ ~2501 of 2600 kB). Each package
runs `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` and `npm run check:size`, and records the numbers
in its feature doc. If B's first paint exceeds +0.4 kB, the hidden-features hint moves into the lazy Quick-create
chunk before review.

---

## 6. Shared-file protocol

Merge order: **R6-B → R6-A → R6-C**. Each later package rebases and resolves the append-only conflicts mechanically
(keep both sides).

| File | Who | Rule |
|---|---|---|
| `src/layouts/DashboardLayout.tsx` | B (owner) | B adds: the Manufacturing and Distribution nav rows; the hidden-count link; F1 → `openHelp()` (skipped on `/pos` and in fields); `pushRoute(location)` from `src/lib/route-trail.ts` (A's file — B imports it, guarded by a stub that B commits as `export function pushRoute() {}` if A has not merged; A replaces the body); the `mrchartist:open-help` listener. A and C do not edit the layout. |
| `src/lib/shop-mode.ts` | B | `PATH_MODULE['/distribution']`, `PACK_ROUTES`, `impliedPacks`, the additive `isPathVisible` argument. Nothing else. |
| `src/lib/help-event.ts` | B (owner) | Event name + `openHelp(topic?)`. A's `HelpModal` handles the topic. A does not edit the file. |
| `src/lib/route-trail.ts` | A (owner) | B commits the stub only if needed (above). A's version wins on rebase. |
| `src/pages/GstReports.tsx` | A, then C | A edits the regions above the filing strip (about strip, terms in tab labels, empty state, the disclaimer move) and below the tab panels. C replaces **only** the filing-strip `<ol>` block and its state (`downloaded`, `toggleFiled`, `returnFor`, `isFiled`) with `<FilingStrip … />`. Neither touches the other's region. |
| `src/pages/Inventory.tsx` | B (owner), C | C1's "Landed cost" header link is one line that **B adds** (C names the href in its doc; B adds it in B3 with the empty state). |
| Page tip mounts (A6) | page owner | One lazy `<ScreenTip id="…" />` line per page, added by the page's owner: B on Books, Inventory, Reports, Gateway and Invoices (`Transactions.tsx`, one line); A on GST, TDS, Payroll, Dashboard; Clients, Expenses, POS and editor tip lines are added by A (single line each, no other edit there). |
| `src/components/dashboard/DashboardStart.tsx` | A (owner) | A mounts B's `SampleDataChooser` with one lazy line in place of the old inline CTA. B does not edit the file. |
| `src/components/command/CommandPalette.tsx` | B | One lazy "Tabs" group, one "Help topics" group (reads A's `helpIndex()` through a guarded dynamic import), and the empty-state line. |
| `src/pages/Settings.tsx` | B | One `features` tab line + lazy panel. |
| `vite.config.ts`, `src/vite-env.d.ts`, `package.json`, `.env.example` | lead | Lead adds `define: { __APP_VERSION__: JSON.stringify(pkg.version) }`, its type declaration, the `check-whats-new` postbuild step and the two `VITE_BETA_*` variables, as a small commit **before** the packages branch. The `rolldownOptions` block is not touched. |
| `src/i18n/areas/*` | each its own | A: `help-r6.ts`, `reach.ts`, `setup.ts`, `beta.ts`. B: `discover-r6.ts`. C: `closures-r6.ts`. No package edits another's area. |
| `tests/purchase-contract.test.ts` | C | C adds `margin.ts` and `insights.ts` reader rows (one appended block). |
| `tests/e2e/smoke.mjs` | A, B, C | One appended `step(...)` block each, at the end, in merge order: B "R6-B discoverability", A "R6-A help", C "R6-C import openings". |
| `src/lib/backup.ts`, `audit-edits.ts`, `access.ts`, `sync-engine.ts` | A | Only `setup_progress` (A1) is new company data. A registers it: `RECORD_TABLES` / `ID_TABLES` as an object key, not in `WATCHED_TABLES` (viewing state), `TABLE_ACTIONS`: `doc.create`, synced as a singleton. |
| `docs/ROADMAP.md`, `docs/BETA_GUIDE.md`, `docs/CA_REVIEW.md` | C | Only C edits them this round. A and B describe their changes in their own feature docs, and C folds them in after rebasing on A and B. |
| `AGENTS.md`, `docs/ARCHITECTURE.md` | lead | After merge: storage keys `mrchartist_inv_setup_progress` (company), device-local `mrchartist_help_strips`, `mrchartist_whats_new_seen`, `mrchartist_feedback_draft`, `mrchartist_tips_seen`, `mrchartist_tips_off`; the `__APP_VERSION__` rule; the help-registry coverage rule ("a new tab needs a help topic"). |

Every package must pass `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` and `npm run check:size` on
its own branch, and again after rebasing on the previous package. No new runtime dependencies. No new lucide icon
names.

### New storage summary

| Key | Package | Kind | Backed up | Synced |
|---|---|---|---|---|
| `mrchartist_inv_setup_progress` | A | company object `{skipped, hidden_at}` | yes | yes (singleton) |
| `downloaded_at` on `mrchartist_inv_compliance` rows | C | additive field | yes | yes |
| `opening_bill_id` on `vendor_payments.allocations[]` | C | additive field | yes | yes |
| `mrchartist_help_strips` | A | device-local | no | no |
| `mrchartist_whats_new_seen` | A | device-local | no | no |
| `mrchartist_feedback_draft` | A | device-local | no | no |
| `mrchartist_tips_seen`, `mrchartist_tips_off` | A | device-local | no | no |

No new numbered series and no new rule table.

---

## 7. Open questions

1. **Feedback channel (lead).** Which WhatsApp number / group link and e-mail should `VITE_BETA_WHATSAPP` /
   `VITE_BETA_EMAIL` carry for the beta build? Should the public build ship without them (Copy + Web Share only)?
2. **F1 for Help (product).** F1 is POS's "recall held bills". The proposal keeps POS as is and uses F1 for Help
   everywhere else, matching most desktop apps. Is F1 also expected to mean anything in the Gateway (Tally uses F1 for
   "Select company")?
3. **Sidebar length (product).** Adding Manufacturing and Distribution makes the full sidebar 26 entries. Should
   Distribution sit under Sales and Manufacturing under Purchases & stock (proposed), or should both live as Inventory
   sub-items on desktop?
4. **Help text ownership (CA).** Help topics for statutory tabs only describe what the app does and cite
   `CA_REVIEW.md` ids. Should the CA review the 32 GST and 7 TDS topic texts before release, as part of the CA pack?
5. **What's-new cadence (lead).** One entry per merged round (proposed) or per version bump? The build check ties the
   newest entry to `package.json`, so a version bump without notes fails the build.
6. **Demo company default (product).** B4 makes the separate Demo company the default for "Try with sample data". Do
   testers who already loaded samples into their real company need a one-tap "Move samples to a Demo company"?
7. **Import scope (C3).** Should the opening-balance import also accept stock opening quantities with value (stock
   items' `opening_qty` / rate), or stay with ledgers and bills this round?
8. **CA pack.** The 34 ★ items in `docs/CA_REVIEW.md` are those testers' numbers most depend on. Should the lead send
   only those first, with the rest after the beta?
