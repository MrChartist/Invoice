# PRD — Round 5: industry packs for Indian SMB verticals

Status: draft for build · Drafted 2026-10-26 · Baseline: branch `claude/elegant-cannon-cwapiv` (Phases 0–8, Rounds 2–3,
R4-A merged; R4-B stores and R4-C trade desk & trust in progress — **Round 5 starts after R4-B and R4-C are merged**).
Raw sources (URLs and the claim taken from each):
`/tmp/claude-0/-home-user-Invoice/c401a5ec-398d-5b90-84fd-5f6b9cfff692/scratchpad/research/round5-sources.md`.

Every item follows `AGENTS.md`:
- local-first and serverless: no network, no marketplace / portal / bank APIs — report **files** (CSV / XLSX) only;
- vanilla CSS Modules with tokens;
- invoice snapshots never change;
- Indian-FY numbering;
- bare dates parsed as local days;
- statutory values date-keyed in `src/lib/tax-rules.ts` / `tds-rules.ts`;
- GST / income-tax / FCRA outputs labelled as working papers ("verify with your CA").

---

## 1. Problem statement

Rounds 1–4 matched the daily apps, Tally, the established suites, the freelancer apps and the maker / chain / exporter
tools. The engine is now broad: GST with RCM both ways, ECO tagging and GSTR-1 Table 14, TDS payable and receivable with a
26AS reconciler, recurring and batch billing, progress billing, projects and cost centres, advances, multiple bank
ledgers, godowns, kits, CSV / XLSX import. Round 5 looks at six **verticals** whose owners still keep a second tool or
an Excel sheet next to the app, because the engine has the parts but not the vertical's words, documents and checks:

| Vertical | What they use today | What they miss here (one line) |
|---|---|---|
| **E-commerce sellers** (Amazon, Flipkart, Meesho) | Unicommerce, EasyEcom, Excel; Vyapar / myBillBook have no marketplace reconciliation | Import the marketplace's sales and settlement files, see what each order really paid, claim TCS / TDS credit |
| **Transporters (GTA)** | TallyPrime + cost centres, TruckBilty, AIM Transport, Vyapar transport | Consignment notes (LR / bilty), freight bills from LRs, RCM vs forward-charge choice per FY, trip P&L |
| **Contractors** | TallyPrime, Excel RA sheets, myBillBook construction, Odoo modules | BOQ with measured RA bills, the deduction table (retention, advance recovery, TDS, GST TDS, cess), material at site |
| **Clinics, schools, coaching** | Teachmint, Practo Ray, Excel | Fee plans with instalments and concessions, exempt-supply handling and the common-credit reversal |
| **NGOs & trusts** | Tally + Excel, Eklavya, Vyapar NPO page | 80G receipts, Form 10BD file, fund-wise (restricted / FCRA) statements |
| **Landlords / rentals** | Excel, RentOk, Mynd | Leases with escalation and CAM, 194-I on the receipt, security deposits that are not income |

Section 2 cites the code for each finding. The pattern is the same in every vertical: **the engine exists, a thin
layer is missing**. The gaps:

1. **Marketplace money is invisible.**
   - ECO tagging (`eco_gstin` / `eco_section`, `src/lib/eco.ts`), GSTR-1 Table 14 (`src/lib/eco-amend.ts`,
     `EcoView.tsx`) and a TCS **estimate** for composition dealers (`src/lib/gstr4-annual.ts:5–13`, `ecoTcsRate`) exist.
   - Missing:
     - a channel master and a channel-SKU → item map (only one `sku` per catalogue row,
       `src/types/invoice.ts:175`);
     - import of the marketplace's own sales report (MTR / sales report) with the operator's invoice numbers;
     - **settlement** import and payout reconciliation (a grep for `marketplace`, `Amazon`, `Flipkart`, `Meesho`,
       `payout` in `src` finds nothing);
     - GST TCS credit (GSTR-8, portal "TDS and TCS credit received") matching and its move to the electronic cash
       ledger (no `tcs` in `src/lib/gst-setoff.ts`);
     - 194-O TDS receivable that is not on an invoice (`tds-register.ts` counts only invoices with `tds_amount`);
     - return / RTO / claim tracking with claim windows.
2. **Transporters cannot issue their core document.**
   - Transport details on a sales document exist (`TransportDetails`, `src/types/invoice.ts:437–452`;
     `src/lib/transport.ts` labels LR / RR / AWB / B/L) and outward RCM is complete (`src/lib/rcm.ts`).
   - Missing: a **consignment note** as its own numbered document (consignor, consignee, packages, weight, freight
     basis, paid / to-pay / to-be-billed, person liable for tax), a freight bill that gathers LRs, the FY-wise GTA
     option (Annexure V), trips, vehicle documents and hired-lorry TDS with the 194C(6) transporter exemption (grep
     `194C(6)` / `goods carriage`: nothing).
3. **Contractors bill by measurement, net of deductions.**
   - Progress billing by %, amount or line exists (`src/lib/progress-billing.ts`, R2-B2) and projects / cost centres
     exist (`src/lib/cost-centres.ts`, `projects.ts`).
   - Missing: a BOQ abstract with **previous / this bill / cumulative** measured quantities; the RA deduction table
     (retention, mobilisation-advance recovery, 194C, GST TDS u/s 51, labour cess); retention as a receivable that
     falls due after the defect-liability period; site godowns (`Godown.kind`, `src/types/stock.ts:31`, has no `site`).
     Grep `retention`, `BOQ`, `RA bill`, `section 51`, `labour cess`: nothing in invoicing.
4. **Institutions bill fees, not invoices.**
   - Bill of Supply, `exempt_kind` (`src/types/invoice.ts:343, 587`), batch billing (`batch-invoices.ts`), recurring
     schedules (`recurring.ts`) and custom fields (`custom-fields.ts`) exist. Rule 42 / 43 is only a **reason tag** on a
     purchase (`ItcReversalReason`, `src/types/purchases.ts:444`) feeding GSTR-9 Table 7.
   - Missing: a fee plan with heads, instalments, concessions and fines per student / patient; the defaulter list; the
     Rule 42 / 43 **computation** of common credit to reverse for a mixed (exempt + taxable) supplier.
5. **NGOs have no donation side at all.** A grep for `donat`, `80G`, `10BD`, `FCRA`, `fund accounting` finds nothing
   (the `12A` hits are GSTR-9C table numbers). Cost centres have kinds `project | department | branch` only
   (`src/lib/cost-centres.ts:19`).
6. **Landlords have recurring invoices but no lease.**
   - Recurring schedules have no escalation (`RecurringSchedule`, `src/lib/recurring.ts:90–114`; grep `escalat` finds
     only payroll).
   - TDS 194-I thresholds are date-keyed for payers (`src/lib/tds-rules.ts:78–93`); "Security deposits" exists only as
     a ledger (`src/lib/ledger/accounts.ts:455`), with no register of deposits received or paid.

**Goal of Round 5:** ship 18 items in three parallel work packages with mostly disjoint files, each vertical behind an
**industry pack** that is off for every existing company:

- **R5-A** industry packs + marketplace seller pack (6 items);
- **R5-B** transport and works-contract pack (6 items);
- **R5-C** institutions, non-profits and property pack (6 items).

### How a pack switches on (no clutter for others)

- 8H shop mode already filters the sidebar by **business type → modules** (`src/lib/shop-mode.ts`,
  `src/lib/shop-presets.ts`). Round 5 adds six business types and one additive company setting `industry_packs`.
- A pack only **adds tabs on existing routes** and a few fields in existing dialogs. It never adds a route or a
  sidebar item, so `PATH_MODULE`, `ALL_MODULES` and the shell are untouched.
- Rule: a pack is on when `settings.industry_packs` lists it; when `industry_packs` is **absent**, the packs implied by
  `business_type` are on; with neither, **no pack is on**. Every existing company therefore sees exactly what it saw.
- A tab whose pack is off is not listed, but its URL (`?tab=…`) still opens it and Ctrl+K lists it under "Industry
  packs" — the same "progressive disclosure, never removal" rule as shop mode.

### Budgets the packages must respect

| Budget | Now | Limit | Source |
|---|---|---|---|
| Initial JS (first paint, gz) | **≈ 182 kB** | 185 kB | `scripts/check-bundle-size.mjs` |
| Entry chunk (gz) | — | 90 kB | `scripts/check-bundle-size.mjs` |
| Total JS (gz) | **≈ 2280 kB** | 2400 kB | `scripts/check-bundle-size.mjs` |

Rules:
- **Everything is lazy.** No new route. Every screen is a tab on an existing lazy route or a lazy dialog. The shell may
  gain only:
  - type-only additions (the `BusinessType` union — zero bytes);
  - `RECORD_KEYS` strings (§6);
  - bell gates of the existing `ensure…Alerts` shape (`src/components/command/NotificationBell.tsx`).
- **First-paint delta per package ≤ +0.2 kB gz** (A, B and C each). Combined ≤ +0.6 kB, so initial JS stays ≤ ~182.6 kB.
- **Total-JS delta for the whole round ≤ +100 kB gz:** A ≤ 38 kB, B ≤ 34 kB, C ≤ 28 kB. Total JS stays ≤ ~2380 kB.
- **Icons: reuse only.** Every `lucide-react` icon lands in the first-paint vendor chunk. Icons already imported and
  suggested here:
  - R5-A: `ShoppingCart`, `Store`, `FileUp`, `FileSpreadsheet`, `Scale`, `PackageX`, `RotateCcw`, `Percent`;
  - R5-B: `Truck`, `Car`, `MapPin`, `Ruler`, `ClipboardList`, `Building2`, `HandCoins`;
  - R5-C: `CalendarClock`, `Users`, `Heart`, `HandCoins`, `PiggyBank`, `Building`, `Landmark`, `ReceiptText`.
  A new icon name fails review.
- Each package records before / after numbers from `npm run build && npm run check:size` in its feature doc. No budget
  may be raised without the lead.

### Non-goals

Anything that needs a server or the network. This drops:
- marketplace APIs (Amazon SP-API settlement / MTR reports, Flipkart and Meesho seller APIs), live inventory sync to
  channels, order download, label printing from the channel;
- GST portal actions (filing Annexure V, accepting TCS credit, GSTR-7 / GSTR-8, RFD), TRACES / 26AS download, the
  income-tax portal (Form 10BD upload, 10BE download), the FCRA portal (FC-4);
- GPS / FASTag vehicle tracking, fuel-card feeds, driver apps;
- school / clinic portals for parents or patients, online fee collection gateways;
- tenant portals and online rent collection.

Local substitutes are named where they exist: report-file import (CSV / XLSX, `src/lib/csv.ts`, `src/lib/xlsx.ts`),
working-paper CSVs shaped like the portal templates, `wa.me` / Web Share reminders, and folder sync.

---

## 2. Per-competitor findings

Status:
- **B** = built (cited);
- **P** = partial;
- **M** = missing;
- **R2 / R3 / R4** = specified in an earlier round (not re-proposed);
- **X** = dropped (network / server).

Proposed items carry their Round 5 id.

| Vertical / competitor | Feature / UX pattern | Our status (evidence) | Round 5 |
|---|---|---|---|
| **Shop mode (ours)** | Business type picks modules; Settings toggles | B — six types (`src/lib/shop-presets.ts:7`), filter in shell (`shop-mode.ts`) | R5-A1 adds six types + packs |
| **Unicommerce** (e-commerce) | Settlement report per order: commission, fixed / closing fee, shipping, collection fee, TCS, TDS, net | M — no settlement object; grep `payout` = bank only | R5-A4 |
| | Match settlement totals to bank deposits | P — bank statements + matching (`bank-recon.ts`); no settlement level | R5-A4 |
| | Returns checked against inventory; claims for lost / damaged with windows (Amazon 60 days, Flipkart SPF 14 days) | P — credit notes restock (`credit-restock.ts`), damaged godown possible (`godowns.ts`); no claim tracker | R5-A6 |
| | Marketplace order / inventory sync | X | — |
| **EasyEcom** | "Import Payments": channel + settlement reference + CSV (order no., selling price, transferred amount) | M | R5-A4 |
| | Reconciliation tabs: completed returns, pending returns, extra deductions, unsettled orders, cancelled | M | R5-A4, R5-A6 |
| | "Amount settled %" = transferred ÷ invoice | M | R5-A4 |
| **Amazon (report files)** | MTR B2B / B2C: invoices issued in the seller's name, refunds, cancellations | P — invoice import keeps given numbers (`importers.ts:604–606`); no MTR preset, no channel tag | R5-A3 |
| | Settlement V2: long format (`amount-type`, `amount-description`, `amount`) | M | R5-A4 (preset) |
| **Flipkart (report files)** | Settlement workbook: Orders / Non-order SPF / Storage & recall / Ads / TDS / Tax sheets | M | R5-A4 (preset, sheet pick) |
| **Meesho (report files)** | Payments and returns reports per sub-order | M | R5-A4, R5-A6 (generic mapping) |
| **Vyapar / myBillBook** | Marketplace integration requested by users ("In Review"); none shipped | — (parity by A3–A6) | — |
| **GST TCS u/s 52** | 0.5% of net value from 10 Jul 2024; credit in cash ledger after "TDS and TCS credit received" is filed | P — rate rule (`tax-rules.ts:380`), estimate for GSTR-4 only; no matching or cash-ledger move | R5-A5 |
| **TDS 194-O** | 0.1% from 1 Oct 2024; shows in 26AS under the operator's TAN | P — payer side (`tds-rules.ts:38, 250`); receivable side only through invoices | R5-A5 |
| | One seller SKU vs channel SKU / ASIN / FSN, pack-of-N listings | P — one `sku`, kits (`events-kits.ts`) | R5-A2 |
| **TallyPrime (GTA)** | LR / RR no. and vehicle on the bill; loading / unloading charges | B — `TransportDetails`, `TransportBlock.tsx`; charges as lines | — |
| | GTA rate chosen per ledger (5% without ITC / 18% with ITC); RCM to GSTR-1 | P — RCM per document (`rcm.ts`); no FY GTA option | R5-B1 |
| | Vehicle / route / trip as cost centre; break-up report | P — cost centres (`cost-centres.ts`, kinds project / department / branch) | R5-B3 |
| | e-way single / bulk, Part B update, validity extension | B — `eway.ts`, R3-C5 desk (`eway-desk.ts`, `eway-validity.ts`) | — |
| **TruckBilty / AIM Transport / FreightFlow** | Consignment note (LR / bilty) with consignor, consignee, goods, weight, freight | M — LR only as a number on a sales document | R5-B1 |
| | POD with shortage / damage / detention | M | R5-B1 (POD fields) |
| | Trip P&L, driver advances, fleet maintenance | M | R5-B3 |
| **Vyapar transport** | Trip-wise invoices, vehicle log book, fuel / toll / repair by category | P — expenses with categories + cost centre (`purchases.ts` `cost_centre_id`) | R5-B3 |
| **GST GTA law** | Consignment note is what makes a GTA; contents (serial, consignor, consignee, vehicle, goods, origin, destination, person liable) | M | R5-B1 |
| | Annexure V forward-charge option per FY; RCM by notified recipients | M | R5-B1, R5-B2 |
| **Income tax 194C(6)** | No TDS on a transporter owning ≤ 10 goods carriages with PAN declaration | M | R5-B3 |
| **myBillBook construction** | Milestone + RA bills, advance adjustment, retention | P — progress billing (`progress-billing.ts`), advances (`advances.ts`); no retention | R5-B4, R5-B5 |
| **Zoho (partner build)** | BOQ tracker; RA bill with no., % done, cumulative, retention, net payable | P — SO / quotation lines as BOQ; no cumulative abstract | R5-B4 |
| **Odoo construction modules** | Measurement sheets previous / current / cumulative; retention capped; advance recovery linear / threshold | M | R5-B4, R5-B5 |
| | Variation orders, liquidated damages | P — quote revisions (R2-B3); LD as a deduction line | R5-B5 |
| **GST TDS u/s 51** | 2% by govt / PSU recipients on value excl. GST; GSTR-7A credit to cash ledger | M — only a GSTR-4 Table 7 typed row (`gstr4-annual.ts:39`) | R5-B5 |
| **BOCW labour cess** | 1% deducted on civil works bills | M | R5-B5 |
| | Material at site; site stock | P — godowns, transfers, stock journals; no `site` kind / site report | R5-B6 |
| **Teachmint / Academia ERP** | Fee structure per class, one-time + recurring heads, concessions per student, fines, instalment reminders, receipts | P — batch + recurring billing, receipts (`receipts.ts`), reminders; no fee plan / concession | R5-C1 |
| **Practo Ray** | Clinic billing, payments, outstanding | P — POS / editor + Bill of Supply; patient = client | R5-C1 (patient register fields) |
| **GST exemptions** | Entry 74 health care, entry 66 education exempt; coaching 18% | P — `exempt_kind` per document; no per-head default | R5-C1, R5-C2 |
| | Rule 42 / 43 common-credit reversal for mixed suppliers | P — reason tag only (`purchases.ts:444`) | R5-C2 |
| **Eklavya / NGO tools** | 80G receipts, Form 10BD / 10BE, utilisation certificate, FCRA module | M | R5-C3, R5-C4 |
| **Rule 18AB / Form 10BD** | Statement by 31 May; donor id, section, donation type, mode, amount | M | R5-C3 |
| **ICAI NPO guide / FCRA** | Restricted / unrestricted / corpus funds; FCRA designated account; FC-4 statements | M — cost-centre kinds lack `fund`; bank accounts lack an FCRA flag | R5-C4 |
| **Mynd / RentOk** | Base rent + CAM + GST per lease; late fee; reminders | P — recurring schedules; no lease / escalation | R5-C5 |
| **GST on rent** | Commercial 18%; residential to a registered business under RCM; unregistered landlord → RCM (entry 5AB, 10 Oct 2024) | P — RCM per bill both ways; no lease-level classification | R5-C5 |
| **194-I** | Tenant deducts; landlord reconciles 26AS | B — invoice `tds_section` + 26AS recon (`tds-register.ts:501, 645`) | R5-C5 (default on lease) |
| **Security deposit** | Not consideration until applied (Sec 2(31) proviso) | P — ledger 3200 only | R5-C6 |

---

## 3. Gap list ranked by user value / effort

Value runs 1–5 (5 = asked for daily by many users of that vertical). Effort is S = 1, M = 2, L = 3. Score = value ÷
effort; ties broken by value. Every item is local-only.

| Rank | Id | Gap | Seen in | Value | Effort | Score | Package |
|---|---|---|---|---|---|---|---|
| 1 | R5-A1 | Industry packs: six business types + pack switch | 8H shop mode | 4 | S | 4.0 | A |
| 2 | R5-A2 | Channels, clearing account and channel-SKU map | Unicommerce, EasyEcom | 3 | S | 3.0 | A |
| 3 | R5-C6 | Security deposits register (received / paid), apply / refund | GST Sec 2(31), lease practice | 3 | S | 3.0 | C |
| 4 | R5-C3 | Donations: 80G / 35 receipts, donor ids, Form 10BD CSV, 10BE tracking | Eklavya, Rule 18AB | 5 | M | 2.5 | C |
| 5 | R5-C5 | Leases: rent + CAM + escalation, GST class, 194-I default, expiry alerts | Mynd, RentOk | 5 | M | 2.5 | C |
| 6 | R5-B1 | Consignment notes (LR / bilty) + GTA option per FY | TruckBilty, AIM, Tally, GST law | 5 | M | 2.5 | B |
| 7 | R5-B5 | RA deductions: retention, advance recovery, 194C, GST TDS 51, labour cess | Odoo, myBillBook, Zoho build | 5 | M | 2.5 | B |
| 8 | R5-C1 | Fee plans: heads, instalments, concessions, fines, defaulters | Teachmint, Academia | 5 | M | 2.5 | C |
| 9 | R5-A3 | Marketplace sales & returns import (MTR / sales report) | Amazon MTR, Octa importer | 4 | M | 2.0 | A |
| 10 | R5-A5 | GST TCS (GSTR-8) and 194-O TDS credit matching | GST portal guide, 26AS | 4 | M | 2.0 | A |
| 11 | R5-B2 | Freight bills from LRs (to-be-billed), RCM / forward charge | Tally GTA, TruckBilty | 4 | M | 2.0 | B |
| 12 | R5-B4 | BOQ with measured RA bills (previous / this / cumulative) | Odoo, Zoho build | 4 | M | 2.0 | B |
| 13 | R5-C4 | Funds (restricted / corpus / FCRA), FCRA account flag, fund statement | ICAI NPO guide, FCRA | 4 | M | 2.0 | C |
| 14 | R5-A4 | Settlement import and payout reconciliation | Unicommerce, EasyEcom, Amazon / Flipkart files | 5 | L | 1.7 | A |
| 15 | R5-A6 | Returns, RTO and claims desk with windows | Unicommerce, EasyEcom | 3 | M | 1.5 | A |
| 16 | R5-C2 | Rule 42 / 43 common-credit working for mixed suppliers | GST law (clinics, schools, NGOs) | 3 | M | 1.5 | C |
| 17 | R5-B6 | Sites: site godowns, material issued vs BOQ, site cost | Tally godowns, contractor practice | 3 | M | 1.5 | B |
| 18 | R5-B3 | Trips, vehicles, hired lorries with 194C(6) | Vyapar, FreightFlow, Tally | 4 | L | 1.3 | B |
| 19 | — | Subcontractor RA bills on the purchase side (mirror of B4 / B5) | Odoo subcontracts | 3 | M | 1.5 | later |
| 20 | — | Channel-wise profitability (per SKU after fees and returns) | Unicommerce, EasyEcom | 3 | M | 1.5 | later (needs A4 data) |
| 21 | — | Appointment book / token queue for clinics | Practo Ray | 2 | M | 1.0 | later |
| 22 | — | Utilisation certificate per grant (CSR / donor format) | Eklavya | 3 | M | 1.5 | later (C4 follow-up) |
| 23 | — | Income-tax Act 2025 section labels (Sec 393 table items) across TDS screens | ITA 2025 from 1 Apr 2026 | 4 | M | 2.0 | cross-cutting — lead, not a pack (§7 Q1) |

**Overlap with earlier rounds (not re-specified):**
- Progress billing by % / amount / line: R2-B2. R5-B4 adds only a **measured cumulative** basis and the abstract.
- Batch invoices (one template × many parties): R2-B1. R5-C1 reuses it for instalments.
- Projects, rate cards, retainers: R3-B1 – B3. R5-B4 links BOQs to projects; it adds no project engine.
- e-Way desk, validity, Part B: R3-C5. R5-B1 only pre-fills it from an LR.
- Gift vouchers, store prices, transfers: R4-B. Landed cost: R4-A5. Export desk: R4-C.

**Dropped (network or server):** marketplace APIs and inventory sync; GST / income-tax / FCRA portal actions; vehicle
GPS / FASTag; parent / patient / tenant portals; online fee or rent collection.

---

## 4. Specifications (18 items)

Conventions for every item (same as Round 4, plus the pack rule):

- **Logic and tests.** Pure logic goes in `src/lib/**/*.ts`, tested with `node:test` in `tests/*.test.ts` (no browser
  APIs in tested modules).
- **Strings.** Strings go in the package's own i18n area file (`defineArea(en, hi)`; typecheck requires Hindi):
  `src/i18n/areas/packs-marketplace-r5.ts` (A), `packs-transport-works-r5.ts` (B), `packs-institutions-r5.ts` (C).
  Vertical words keep their trade names in both languages (LR / bilty, RA bill, BOQ, 80G, CAM).
- **Pack gate.** Every new tab, dialog field and bell gate checks `isPackOn(settings, '<pack>')` from
  `src/lib/industry-packs.ts` (R5-A1). With the pack off, no new UI is rendered and no new table is read.
- **New data.** New persisted data is a new `mrchartist_inv_<table>` read and written through `getTable/setTable`.
  Fields are snake_case and additive.
- **New fields on existing records** come by **declaration merging** in the package's own types file:
  `src/types/marketplace-r5.ts` (A), `src/types/transport-works-r5.ts` (B), `src/types/institutions-r5.ts` (C).
  `src/types/invoice.ts`, `purchases.ts`, `stock.ts` (except the one `Godown.kind` line, §6) are not edited. New
  `InvoiceRecord` keys go into `RECORD_KEYS` under the line-per-package rule in §6.
- **Engines are reused, not copied.**
  - Documents are ordinary `InvoiceRecord`s (`localDb.invoices.save`), so GST returns, receivables, books, Tally and
    e-invoice see them unchanged.
  - Receipts are ordinary payments (`localDb.payments.record`).
  - Ledger postings go through `saveVoucher` (`src/lib/ledger/vouchers.ts:228`: period lock, audit, roles). Helper
    accounts are created by name like `ensureCommissionAccount` (`src/lib/sales-commission.ts:236`).
  - Imports reuse `parseTable` (`csv.ts`), the XLSX reader (`xlsx.ts`, dynamic import), `scoreHeader`
    (`import-mapping.ts:269`), `parseDate` / `parseNumber` (`importers.ts`).
- **Guards and series.**
  - Destructive calls use `requireAccess` (`src/lib/access.ts`).
  - Writes in a locked period use `assertUnlocked` (`src/lib/period-lock.ts`).
  - Numbered series use `src/lib/series-counters.ts` with Indian-FY labels.
  - Money goes through `round2` / paise (`src/lib/invoice-calc.ts`).
- **Purchases contract.** Any new module that reads `purchases` is added to `tests/purchase-contract.test.ts`
  (Critical Rule 9).
- **Stock readers** convert alternate units with `lineFactor` / `unitFactor` (`src/lib/units.ts`).
- **Registries.** New tables are registered in `RECORD_TABLES` / `ID_TABLES` (`src/lib/backup.ts`), `WATCHED_TABLES`
  (`src/lib/audit-edits.ts`), `TABLE_ACTIONS` (`src/lib/access.ts`), and `DATED` / `NUMBERED`
  (`src/lib/sync-engine.ts`) for dated or numbered tables.
- **Statutory values** (rates, thresholds, windows, due dates) are date-keyed `Versioned<…>` rows appended at the end
  of `src/lib/tax-rules.ts` (GST) or `src/lib/tds-rules.ts` (income tax). Old values are never overwritten.
- **Bundle rule.** No R5 module may be imported statically by `main.tsx`, `App.tsx`, `DashboardLayout.tsx`,
  `Dashboard.tsx`, `useInvoiceStore.ts` or `NotificationBell.tsx`. The bell adds only lazy `ensure…Alerts` gates. Each
  item states its chunk.

### R5-A — Industry packs & marketplace seller

#### R5-A1 Industry packs: six business types and the pack switch

*Seen in:* 8H shop mode (ours): business type → modules, "Show all features".

*Today:* six business types (`kirana`, `restaurant`, `wholesale`, `services`, `manufacturer`, `full`;
`src/lib/shop-presets.ts:7`), module presets and wizard defaults (`BUSINESS_DEFAULTS`, `shop-presets.ts:56–63`). Nothing
can show a vertical's tab to one company and hide it from another.

**User story.** As a transporter setting up the app, I want to say "I run a transport company" and see LRs and trips,
while my cousin's kirana shop on the same app never sees them.

**Acceptance criteria.**
1. **Business types.** Six new values: `ecommerce`, `transport`, `contractor`, `institution` (clinic / school /
   coaching), `nonprofit`, `property`. Added to the `BusinessType` union in `shop-mode.ts` (type only) and to
   `BUSINESS_TYPES`, `PRESETS`, `BUSINESS_DEFAULTS` in `shop-presets.ts`:

   | Type | Modules | Implied pack | Template | Landing |
   |---|---|---|---|---|
   | `ecommerce` | purchases, inventory, accounts, banking, reports, gst, tds | `marketplace` | `gst_tax_invoice` | `/receivables?tab=marketplace` |
   | `transport` | purchases, accounts, banking, reports, gst, tds, payroll, loans | `transport` | `gst_tax_invoice` | `/distribution?tab=transport` |
   | `contractor` | purchases, inventory, accounts, banking, reports, gst, tds, payroll, time | `works` | `corporate_navy` | `/time?tab=works` |
   | `institution` | recurring, purchases, accounts, reports, gst, payroll | `fees` | `freelancer_light` | `/recurring?tab=fees` |
   | `nonprofit` | recurring, purchases, accounts, banking, reports, tds, payroll | `nonprofit` | `classic_orange` | `/receivables?tab=donations` |
   | `property` | recurring, accounts, banking, reports, gst, tds | `leases` | `gst_tax_invoice` | `/recurring?tab=leases` |

   Default due days: ecommerce 0, transport 30, contractor 30, institution 10, nonprofit 0, property 7.
2. **Packs.** New lazy module `src/lib/industry-packs.ts`:
   - `type PackId = 'marketplace' | 'transport' | 'works' | 'fees' | 'nonprofit' | 'leases'` (all six declared here
     once, so B and C never edit this file);
   - `PACK_OF_TYPE: Partial<Record<BusinessType, PackId[]>>`;
   - `activePacks(s)` → `industry_packs` when it is an array (unknown ids dropped), else the packs implied by
     `business_type`, else none;
   - `isPackOn(s, id)`;
   - `PACK_TABS` — the list Ctrl+K uses: `{ pack, path, labelKey }` for every pack tab (A, B and C append their rows,
     §6).
3. **Settings.** Settings → Defaults → Shop mode (`ShopModePanel.tsx`) gains "Industry packs": six checkboxes with a
   one-line description each. Saving writes `industry_packs` on the company settings and fires the existing
   `SHOP_MODE_EVENT`. "Show all features" does **not** turn packs on (packs add work screens; they are opt-in).
4. **Wizard.** The first-run "What do you do?" step lists the six new types after the existing ones, with the same
   card component. Picking one applies modules, due days, template and landing as today.
5. **Ctrl+K.** One command group "Industry packs" lists every `PACK_TABS` row; rows of packs that are off show
   "(pack off)" and still open the tab.
6. **Never removal.** Turning a pack off hides its tabs and bell gates only. No data is deleted; documents made by a
   pack (LR, freight bill, RA bill, fee invoice, donation receipt) stay in Transactions and every report.

**Files.**
- New: `src/lib/industry-packs.ts`; `src/types/marketplace-r5.ts` (declares `industry_packs?: PackId[]` on the settings
  type by merging); `src/i18n/areas/packs-marketplace-r5.ts` (pack names + descriptions for all six);
  `docs/features/industry-packs.md`.
- Edit: `src/lib/shop-mode.ts` (union only), `src/lib/shop-presets.ts`, `src/components/settings/ShopModePanel.tsx`,
  `src/components/onboarding/SetupWizard.tsx` (type cards), `src/components/command/CommandPalette.tsx` (one group).

**Storage.** Additive `industry_packs?: PackId[]` on `mrchartist_inv_settings` (company, backed up, synced). No new key.

**Bundle.** `shop-mode.ts` gains only a type. Everything else is in lazy chunks (Settings, wizard, palette group loads
`PACK_TABS` lazily). First paint: +0.0 kB.

**Tests.** `tests/industry-packs.test.ts`:
- absent `industry_packs` + absent / old business type → no pack;
- each new type → its pack; explicit `industry_packs: []` beats the type;
- unknown ids dropped;
- `applyBusinessType` for each new type (modules, defaults);
- `isPathVisible` unchanged for every existing path (regression);
- `PACK_TABS` paths all resolve to existing routes in `App.tsx` (static list check).

#### R5-A2 Sales channels, clearing account and channel-SKU map

*Seen in:* Unicommerce / EasyEcom channel masters and SKU mapping; Amazon ASIN / seller SKU, Flipkart FSN / listing
SKU, Meesho SKU; "pack of 2" listings.

*Today:* one `sku` and `barcode` per catalogue row (`src/types/invoice.ts:172–175`), kits (`events-kits.ts`), ECO GSTIN
validation (`checkEcoGstin`, `eco.ts:34`), several bank accounts each with its own ledger (`bank-accounts.ts`).

**User story.** As a seller on Amazon and Meesho, I want each marketplace set up once — its GSTIN, its settlement
account and its SKU names — so every report I import lands on the right item and the right ledger.

**Acceptance criteria.**
1. **Channel master** (Receivables → Marketplace → Channels). Fields: name, platform (`amazon | flipkart | meesho |
   other`), operator GSTIN per state (validated by `checkEcoGstin`; a TCS registration with `C` in place 14 is
   expected), operator TAN (for 194-O, validated by `isValidTan`), operator as a **party** (client row, created on
   save: "Amazon Seller Services Pvt Ltd" etc., used for fee bills), default godown (e.g. an FBA godown), default
   `eco_section` (`TCS_52`), and import presets (§A3 / A4).
2. **Clearing account.** Saving a channel creates a bank-account row with additive `clearing: true` ("Amazon
   settlement clearing"), so it is its own ledger under Cash & Bank (`bank:<id>`). Marketplace order receipts land
   there; the payout moves it to the real bank (§A4). Clearing accounts are hidden from cheque printing, bulk e-payment
   and BRS statement import pickers.
3. **SKU map.** Per channel rows `{ channel_sku, listing_id?, item_id, qty_per_unit, note? }`. `qty_per_unit` turns a
   "pack of 3" listing into 3 units of the item; a kit item maps once and explodes as kits do today.
   - Bulk fill: import a channel's listing file (CSV / XLSX: SKU, ASIN / FSN, title) and match by `sku`, `barcode`,
     `short_code`, then fuzzy title (shown as a suggestion, never auto-saved).
   - Unmapped SKUs met during an import are collected into an "Unmapped" list with "Map" and "Create item".
4. **Pack gate.** Tab `marketplace` on `/receivables` shows only with the `marketplace` pack on.

**Files.**
- New: `src/lib/marketplace/channels.ts` (store, validation, `ensureClearingAccount`), `src/lib/marketplace/sku-map.ts`
  (lookup, listing-file match, unmapped list); `src/components/marketplace/{MarketplaceTab,ChannelsPanel,SkuMapPanel}.tsx`,
  `marketplace.module.css`.
- Edit: `src/pages/Receivables.tsx` (one tab line + lazy panel, §6); `src/lib/bank-accounts.ts` (keep `clearing` in
  normalise; `pickableBankAccounts(purpose)` excludes clearing for cheques / e-payment / BRS import).

**Storage.**
- `sales_channels`: `{ id, name, platform, gstins: {state, gstin}[], tan?, party_id, clearing_bank_id, godown_id?, presets?: {sales?, settlement?, returns?}, active }`.
- `channel_skus`: `{ id, channel_id, channel_sku, listing_id?, item_id, qty_per_unit, note? }`.
- Additive `clearing?: boolean` on `bank_accounts` rows.
- `TABLE_ACTIONS`: `master.edit`. Not dated.

**Bundle.** Marketplace tab chunk. First paint 0.

**Tests.** `tests/marketplace-channels.test.ts`: GSTIN / TAN validation; clearing account created once and idempotent;
SKU lookup by channel SKU and listing id; pack-of-N quantity; kit mapping; listing-file match order (sku → barcode →
short code → title suggestion); clearing accounts excluded from the three pickers.

#### R5-A3 Marketplace sales and returns import

*Seen in:* Amazon MTR B2B / B2C (invoices, refunds, cancellations issued in the seller's name); Flipkart sales report;
third-party importers that turn the MTR into GSTR-1 data.

*Today:* the invoice importer keeps given numbers for opening invoices (`importers.ts:604–606`) but has no channel
preset, no ECO tag and no idempotency by order id. Sellers retype or summarise by hand; GSTR-1 Table 14 (`eco-amend.ts`)
is only as good as the tags.

**User story.** As a seller, I want to drop last month's Amazon MTR file into the app and get every order as a
document with Amazon's invoice number, tagged to Amazon's GSTIN, with refunds as credit notes — without duplicates when I
import the same month again.

**Acceptance criteria.**
1. **Import** (Marketplace → Import → "Sales / returns report"): pick channel, file (CSV / XLSX; workbook sheet picker),
   preset (Amazon MTR B2C, Amazon MTR B2B, Flipkart sales report, Meesho GST report, Generic). Each preset is a
   **column-synonym table** fed to `scoreHeader`; the user confirms or fixes the mapping (saved on the channel as
   `presets.sales`). Column names are not hard-coded beyond synonyms, since marketplaces change them.
2. **Rows → documents.**
   - A shipment / sale row becomes one `TAX_INVOICE` (B2B rows with buyer GSTIN) or `INVOICE` (B2C) with the
     **marketplace's invoice number and date as given** (like opening invoices), `eco_gstin` (the channel's GSTIN for
     the ship-from state), `eco_section: 'TCS_52'`, place of supply from ship-to state, lines from the SKU map (rate =
     taxable value ÷ qty; GST rate from the file, checked against the item's HSN rate with a warning), customer =
     "Amazon customer — <state>" walk-in party (B2C) or the GSTIN party (B2B), created on demand.
   - A refund / return row becomes a `CREDIT_NOTE` linked to the original (via `doc_links`) with `goods_returned`
     decided by the return type (customer return → true; price adjustment → false). Cancellation before invoicing →
     row skipped and listed.
   - Additive `channel_id`, `channel_order_id`, `channel_import_id` on every created document.
   - Optional **summary mode** for very large B2C months: one document per (state × GST rate × day) with the order ids
     kept in an annexure field; the user picks per import (default: per order up to 3,000 rows, then the dialog
     recommends summary).
3. **Idempotent.** A row whose (`channel_id`, `channel_order_id`, document kind, marketplace invoice no.) already
   exists is skipped and counted as "already imported". Re-importing a month changes nothing.
4. **Preview first.** The dry-run (existing `dryRunReport` shape) shows: documents to create per kind, totals by GST
   head, rows with unmapped SKUs (blocking per row, with "Map" inline), rate mismatches, rows in a locked period
   (refused), and a reconciliation line "file total = documents total" to the paisa.
5. **Stock.** Created documents move stock from the channel's godown (default godown when none), as any invoice does.
   Credit notes restock to the same godown, or to the damaged godown when the file says "damaged / unsellable".
6. **Undo.** The whole import is one batch; "Undo import" cancels (not deletes) every document it created, using the
   R2-B1 `undoBatch` pattern, refused when a document has a later payment.
7. **e-Invoice.** The import creates no IRN data. The preview notes that e-invoice applicability for B2B invoices the
   marketplace generated in the seller's name is a CA question (§7 Q4).

**Files.**
- New: `src/lib/marketplace/sales-import.ts` (presets, row normaliser, document builder, idempotency, summary mode);
  `src/components/marketplace/ImportPanel.tsx`.
- Edit: none outside the package (uses `localDb`, `doc_links`, the importer helpers read-only).

**Storage.**
- `marketplace_imports`: `{ id, channel_id, kind: 'sales' | 'settlement' | 'returns' | 'listings', file_name, period_from, period_to, imported_at, by, counts, doc_ids?, undone_at? }` (DATED by `imported_at`).
- Additive `channel_id?`, `channel_order_id?`, `channel_import_id?` on `invoices` (`RECORD_KEYS`, §6).

**Bundle.** Import panel chunk; the XLSX reader stays a dynamic import. ≈ 9 kB gz.

**Tests.** `tests/marketplace-sales-import.test.ts`: each preset's synonym table maps a fixture header row; B2C row →
`INVOICE` with ECO tag and state; B2B row → `TAX_INVOICE` with buyer GSTIN; refund → linked credit note with
`goods_returned`; cancellation skipped; idempotent re-import; summary mode totals equal per-order totals; locked period
refused; undo cancels and is refused after a payment; pack-of-3 quantity; GSTR-1 Table 14(a) totals match the file.

#### R5-A4 Settlement import and payout reconciliation

*Seen in:* Unicommerce reconciliation (settlement per order, bank match, discrepancy flags); EasyEcom Import Payments
(settlement id, order no., selling price, transferred amount; tabs completed / pending returns, extra deductions,
unsettled, cancelled; "amount settled %"); Amazon settlement V2 long format; Flipkart settlement workbook sheets.

*Today:* nothing between an invoice and a bank credit except a manual payment. Fees are typed as expenses, TCS / TDS
are not recorded, and nobody sees which orders were never paid.

**User story.** As a seller, I want to import each settlement file and see, per order, what I sold it for, what the
marketplace kept and why, what reached my bank, and which orders are still unpaid or over-charged — and have the books
done for me.

**Acceptance criteria.**
1. **Import** (Marketplace → Settlements → Import): channel, file (CSV / XLSX; for Flipkart the sheets Orders, Non-order
   SPF, Storage & recall, Ads are read together), preset (Amazon settlement V2, Flipkart settlement, Meesho payments,
   Generic). Long-format files (Amazon V2) are pivoted by order id + amount type.
2. **Classification.** Every amount is mapped to one **bucket**: `sale`, `refund`, `shipping_recovered`, `commission`,
   `fixed_fee`, `closing_fee`, `collection_fee`, `shipping_fee`, `reverse_shipping`, `storage`, `ads`, `gst_on_fees`,
   `tcs`, `tds_194o`, `reimbursement`, `claim`, `other`. Presets carry a description → bucket table; unknown
   descriptions go to `other` and are listed for the user to map once (saved on the channel).
3. **Settlement record.** Header `{ settlement_id, channel, period, deposit_date, payout }` and lines per order and
   bucket. Check: Σ lines = payout to the paisa, else the import is refused with the difference shown.
4. **Per-order view.** For each order: invoice value (from A3 documents), settled sale, fees, TCS, TDS, net received,
   **settled %**; statuses `settled`, `short` (net received < expected by more than a tolerance), `unsettled` (invoice
   older than the channel's payout cycle + 7 days, no settlement line), `refunded`, `excess fee` (fee % above the
   channel's expected fee % per item group, typed once on the channel). Filters by status; CSV export.
5. **Books (one click, "Post settlement").**
   - Receipts: for each order with a sale line, record a payment on its document into the channel's **clearing**
     account (`bank_account_id`, method "Marketplace settlement", reference = settlement id) for the settled sale
     amount; refunds reduce the credit note's balance the same way.
   - One journal per settlement via `saveVoucher`: Dr Marketplace fees (expense, `ensureMarketplaceFeesAccount`) for
     fees **net of GST** + Dr Input IGST / CGST + SGST for `gst_on_fees` **only when** the user ticks "fee tax invoice
     received" for that month (else Dr a "GST on marketplace fees — awaiting invoice" asset), Dr **GST TCS receivable**
     (new account under Duties & Taxes, `ensureTcsReceivableAccount`), Dr **TDS receivable** (2370, existing) for
     194-O, Dr / Cr reimbursements to Other income / claims receivable, Cr clearing.
   - Payout: one contra Dr bank / Cr clearing for the deposit amount on the deposit date.
   - Result: the clearing balance for a fully posted settlement is **0.00**; the panel shows it per settlement and in
     total, and a non-zero balance is the reconciliation exception.
   - "Unpost" reverses all three through the existing delete paths (period lock respected).
6. **Fee invoices.** "Record fee invoice" opens a purchase bill pre-filled from the month's fee buckets (vendor = the
   channel's party, ITC eligible, HSN 9985 / 9967 as the user picks); saving it re-classes the "awaiting invoice" GST
   to input credit with one journal. GSTR-2B matching then works as for any bill.
7. **Bank match.** The payout contra shows in BRS like any receipt, so the existing statement matcher pairs it with
   the bank credit (amount + date window).
8. **Bell.** Lazy gate: orders unsettled past the cycle, settlements imported but not posted for 7 days, non-zero
   clearing balance at month end.

**Files.**
- New: `src/lib/marketplace/settlement-import.ts` (presets, pivot, bucket map, sum check),
  `src/lib/marketplace/settlement-recon.ts` (per-order status, settled %), `src/lib/marketplace/settlement-post.ts`
  (payments + journal + contra, unpost), `src/lib/marketplace/marketplace-alerts.ts`;
  `src/components/marketplace/{SettlementsPanel,SettlementDetail,OrderReconTable,BucketMapDialog}.tsx`.
- Edit: `src/lib/ledger/accounts.ts` (no edit: accounts are user accounts created by name, like sales commission).

**Storage.**
- `settlements`: `{ id, channel_id, settlement_id, period_from, period_to, deposit_date, payout, lines: {order_id, doc_id?, bucket, amount, description, sku?}[], posted?: {payment_ids, journal_id, contra_id, at}, fee_invoice_id?, import_id }` (DATED by `deposit_date`).
- Additive on `sales_channels`: `payout_cycle_days`, `expected_fee_pct?: {group_id?, pct}[]`, `bucket_map`.
- `TABLE_ACTIONS`: `books.edit` (post / unpost), `doc.create` (import).

**Bundle.** Settlements chunk ≈ 12 kB gz. Bell gate ≈ 0.1 kB.

**Tests.** `tests/marketplace-settlement.test.ts`: Amazon V2 fixture pivots to orders; Flipkart multi-sheet sum =
payout; refusal on Σ ≠ payout; bucket map + unknown description; per-order statuses (settled, short, unsettled after
cycle, excess fee); posting creates payments into the clearing account, one balanced journal and one contra; clearing
balance 0.00; GST on fees parked until the fee invoice, then re-classed; unpost restores; period lock refusal.
`tests/integration/marketplace-books.test.ts`: trial balance stays balanced; receivables show the order paid;
`isRevenueDoc` totals unchanged by posting; Tally export lists the journal.

#### R5-A5 GST TCS / TDS credit (GSTR-8 / GSTR-7) and 194-O matching

*Seen in:* GST portal "TDS and TCS credit received" (accept / reject per operator row; credit reaches the electronic
cash ledger only after the statement is filed); 26AS for 194-O under the operator's TAN.

*Today:* the TCS rate is date-keyed (`ECO_TCS_RATE_RULES`, `tax-rules.ts:380`) and used only for the GSTR-4 estimate.
The 26AS reconciler (`parseTdsCsv` / `reconcileTds`, `tds-register.ts:501, 645`) only expects TDS written on invoices.
The cash ledger (`gst-setoff.ts` § electronic cash ledger, account 2360) never receives TCS / TDS credit.

**User story.** As a seller, every month I want to see the TCS Amazon should have deposited for me, the TCS my
settlements say they withheld, and what the portal shows — then accept it into my cash ledger in the books with one
click. At year end I want 194-O in 26AS to match.

**Acceptance criteria.**
1. **Three columns per operator GSTIN × month** (Marketplace → TCS / TDS credit):
   - **Books expected** = net value of documents tagged `TCS_52` with that `eco_gstin` (sales − returns, A3 + any typed
     documents) × `ecoTcsRate(date)`, split IGST / CGST + SGST by place of supply;
   - **Withheld** = Σ `tcs` bucket of that channel's settlements (A4) with deposit dates in the month;
   - **Portal** = rows typed or pasted from the portal's "TDS and TCS credit received" table (GSTIN of operator,
     month, gross value, returns, net value, IGST, CGST, SGST), CSV / paste with header mapping; or typed.
2. **Differences** flagged above ₹1 per head with the likely reason: value mismatch (portal net value vs books net
   value → GSTR-1 vs GSTR-8 mismatch, which becomes the supplier's liability if not fixed — §7 Q3), month shift, or
   missing operator row.
3. **Accept.** "Mark accepted on the portal" stores the decision per row (`accepted | rejected`, date). Accepted rows
   post one journal per month: Dr **GST electronic cash ledger** (2360) by head | Cr GST TCS receivable (A4 account).
   The set-off screen then sees the cash balance through its existing cash-ledger reader. Rejected rows post nothing
   and stay listed for follow-up.
4. **194-O.** Settlement `tds_194o` lines feed the TDS receivable register as **non-invoice expected lines**
   (deductor = channel TAN, quarter by deposit date, amount), so `reconcileTds` matches them against the imported 26AS
   rows with the operator's TAN. The 194-O expected amount is also estimated as gross sales × the 194-O rate
   (`TDS_194O_RULES` + a new date-keyed rate row, 1% → 0.1% from 1 Oct 2024) for a sanity column.
5. **GST TDS rows too.** The portal table also lists GST TDS deducted u/s 51 (GSTR-7). Rows carry `kind: 'tcs' | 'tds'`
   from day one: for `tds` rows the "books expected" column is the Σ of `gst_tds` deductions on invoices
   (`ra_deductions`, read by field name, no import from R5-B) and accepting moves the GST TDS receivable (account by
   name, created by B5) to the cash ledger. The panel is exported as a lazy component so R5-B mounts it in the Works tab
   (§6) — contractors do not need the marketplace pack.
6. **Working paper.** Every screen and CSV carries the "working paper — the portal statement is the authority; verify
   with your CA" line.

**Files.**
- New: `src/lib/marketplace/tcs-credit.ts` (expected, withheld, portal rows, diff, accept journal),
  `src/components/marketplace/TcsCreditPanel.tsx`.
- Edit: `src/lib/tds-register.ts` (accept optional `extraExpected: TdsExpectedLine[]` in `buildTdsRegister` /
  `reconcileTds` — additive parameter, existing callers unchanged); `src/components/receivables/TdsTab.tsx` (pass the
  marketplace lines when the pack is on, lazily); `src/lib/tds-rules.ts` (append `TDS_194O_RATE_RULES`).

**Storage.**
- `eco_credits`: `{ id, kind: 'tcs' | 'tds', operator_gstin (operator or deductor GSTIN), month (YYYY-MM), gross, returns, net, igst, cgst, sgst, source: 'typed' | 'paste', decision?: 'accepted' | 'rejected', decided_on?, journal_id? }` (DATED by `month` + "-01").
- `TABLE_ACTIONS`: `books.edit`.

**Bundle.** Panel chunk ≈ 5 kB gz.

**Tests.** `tests/marketplace-tcs-credit.test.ts`: expected TCS before / after 10 Jul 2024 (1% → 0.5%); returns reduce
the base; IGST vs CGST + SGST split; withheld from settlements; portal paste mapping; diff reasons; accept posts a
balanced journal into 2360 and is idempotent; reject posts nothing; 194-O expected lines reconcile with a 26AS fixture;
existing `tds-register` tests unchanged (regression).

#### R5-A6 Returns, RTO and claims desk

*Seen in:* Unicommerce (returns not restocked, return charges in another cycle, lost / damaged claims with windows:
Amazon 60 days, Flipkart SPF 14 days); EasyEcom (completed vs pending returns tabs).

*Today:* credit notes restock (`credit-restock.ts`) and a damaged / expiry godown exists (`Godown.kind`), but nothing
tracks a return from "initiated" to "received and checked" or a claim from "raised" to "reimbursed".

**User story.** As a seller, I want every return and RTO listed until I have physically received it, checked it, and
either restocked it or claimed for it before the window closes.

**Acceptance criteria.**
1. **Rows.** Created from a returns-report import (presets: Amazon returns / FBA returns, Flipkart returns, Meesho
   returns, Generic), from A3 refund rows, or by hand. Fields: channel, order id, document, type (`customer_return`,
   `rto`, `courier_lost`), expected date, received date, condition (`good`, `damaged`, `wrong_item`, `missing`),
   godown put to, claim fields (claim id, raised on, amount, status `open | approved | rejected | reimbursed`, settlement
   line that paid it).
2. **Statuses:** Pending receipt → Received → Restocked / Claimed → Closed. "Received good" with no credit note offers
   "Create credit note" (goods returned) when the invoice exists; for an RTO where the document exists, the same, and
   the screen states the GST position is a CA question (§7 Q5).
3. **Windows.** Claim deadline = event date + channel window (date-keyed per platform on the channel, defaults Amazon 60
   days, Flipkart 14 days, others typed). Bell gate: returns pending receipt beyond 15 days of the expected date; claims
   whose window closes in ≤ 3 days.
4. **Match.** A4 `claim` / `reimbursement` buckets match open claims by order id; matched claims become Reimbursed.
5. **Stock.** "Restock" saves the credit note (if new) with `goods_returned` to the chosen godown; "Damaged" uses the
   damaged / expiry godown so the goods are non-saleable (`nonSaleableGodowns`).

**Files.**
- New: `src/lib/marketplace/returns-desk.ts`; `src/components/marketplace/ReturnsPanel.tsx`.
- Edit: none outside the package.

**Storage.** `marketplace_returns`: `{ id, channel_id, order_id, doc_id?, credit_note_id?, type, expected_on?, received_on?, condition?, godown_id?, claim?: {id?, raised_on?, amount?, status, settlement_id?}, closed_on?, note? }` (DATED by `expected_on` or creation). `TABLE_ACTIONS`: `doc.create`.

**Bundle.** Panel chunk ≈ 5 kB gz; bell gate shared with A4 (`ensureMarketplaceAlerts`).

**Tests.** `tests/marketplace-returns.test.ts`: import presets; status machine; claim deadline by platform; reimbursement
match from a settlement; restock creates a linked credit note once; damaged goes to a non-saleable godown; bell rows.

### R5-B — Transport & works contracts

#### R5-B1 Consignment notes (LR / bilty) and the GTA tax option

*Seen in:* TruckBilty (loading slip, LR), AIM Transport (consignments, POD with shortage / damage / detention),
TallyPrime GTA (LR no. on the bill, GTA rate per ledger, RCM to GSTR-1); GST Council GTA flyer (the consignment note is
what makes a GTA; its contents).

*Today:* an LR is only a number inside `TransportDetails` on a sales document (`src/types/invoice.ts:437–452`). Outward
RCM is complete (`src/lib/rcm.ts`). Nothing records the FY-wise forward-charge option.

**User story.** As a transport company, I want to book a consignment at the counter — consignor, consignee, packages,
weight, freight, who pays — print the LR in three copies, and later bill it, with the GST treatment fixed by my
option for the year and by who the payer is.

**Acceptance criteria.**
1. **GTA option per FY** (Distribution → Transport → Settings): rows `{ fy, option: 'rcm' | 'fcm_5' | 'fcm_18', filed_on?, arn?, note }`.
   - The rate behind each option is a date-keyed rule `GTA_RATE_RULES` appended to `tax-rules.ts`
     (`rcm` 5% payable by recipient; `fcm_5` 5% without ITC; `fcm_18` 18% with ITC from 22 Sep 2025; `fcm_12` 12% with
     ITC before it — all "verify", §7 Q1).
   - A bell reminder from 1 Jan to 31 Mar for the next FY's option ("Annexure V / VI window"; window dates date-keyed,
     §7 Q1).
2. **Consignment note** (Distribution → Transport → LRs): own series `LR/FY26-27/0001` (series-counters; the user may set
   a prefix per branch). Fields:
   - date, from / to (place + state), consignor and consignee (party pickers, GSTIN shown), billing party;
   - goods lines: description, packages, packing type, actual weight, charged weight, value of goods (for insurance /
     e-way), HSN optional; invoice no(s). and e-way bill no(s). of the consignor;
   - vehicle (R5-B3 master or typed), driver;
   - freight basis (`fixed`, `per_kg`, `per_ton`, `per_package`, `per_trip`) and rate, plus charges (loading,
     unloading, hamali, detention, door delivery, statistical / LR charge);
   - payment basis `paid` (consignor pays at booking), `to_pay` (consignee pays at delivery), `tbb` (to be billed to
     the billing party);
   - **person liable for GST**, derived and shown: under `rcm` option and a recipient in the notified list
     (registered person, factory, society, co-operative, body corporate, partnership, casual taxable person —
     `GTA_RCM_RECIPIENT_KINDS`, date-keyed) → "recipient (reverse charge)"; otherwise the GTA. The user can override with
     a reason (logged);
   - POD: delivered on, received by, shortage / damage qty, detention days.
3. **Print.** A self-contained LR HTML (like `rcm-self-invoice.ts` `rcmDocsHtml`): three copies (Consignor / Consignee /
   Driver-office), "Person liable to pay GST", the GTA option line, and the declaration text; prints through the
   existing print path; Web Share / `wa.me` share.
4. **Paid / to-pay collection.** For `paid` and `to_pay`, "Collect freight" creates the GTA's tax document immediately
   (an `INVOICE` / `TAX_INVOICE` built by B2's builder, one LR) and records the cash receipt; for `tbb`, the LR waits
   for a freight bill (B2).
5. **e-Way.** "Use for e-way Part B" copies vehicle and LR no. / date into the consignor's e-way desk row when the
   consignor's invoice exists in this company; otherwise exports the R3-C5 Part-B update JSON for the given EWB numbers.
6. **States.** Booked → In transit (on a trip, B3) → Delivered (POD) → Billed (B2) / Cancelled (with reason; numbers never
   reused).

**Files.**
- New: `src/lib/transport/{gta-option,consignment-notes,lr-print}.ts`; `src/components/transport/{TransportTab,LrList,LrForm,GtaOptionCard}.tsx`, `transport.module.css`; `src/types/transport-works-r5.ts`; `src/i18n/areas/packs-transport-works-r5.ts`; `docs/features/transport-works.md`.
- Edit: `src/pages/Distribution.tsx` (tab `transport`, pack-gated, lazy); `src/lib/tax-rules.ts` (append `GTA_RATE_RULES`, `GTA_OPTION_WINDOW_RULES`, `GTA_RCM_RECIPIENT_KINDS`).

**Storage.**
- `consignment_notes`: `{ id, number, date, from, to, consignor_id, consignee_id, billing_party_id?, lines[], vehicle_id?, vehicle_no?, driver?, basis, rate, charges[], payment_basis, liable: 'recipient' | 'gta', liable_override_reason?, status, pod?, trip_id?, bill_id?, cancelled_reason? }` (DATED + NUMBERED `LR`).
- `gta_options`: `{ id, fy, option, filed_on?, arn?, note? }`.
- `TABLE_ACTIONS`: `doc.create` (LR), `settings.manage` (option).

**Bundle.** Transport tab chunk ≈ 9 kB gz (with B2). Bell gate (option window) ≈ 0.05 kB.

**Tests.** `tests/transport-lr.test.ts`: numbering across FY and per-branch prefix; freight by each basis; liable
person by option × recipient kind × date; override logged; status machine incl. cancel never reusing a number; print
contains the three copies and liable line; paid / to-pay creates one document + receipt; period lock refusal.

#### R5-B2 Freight bills from LRs

*Seen in:* TallyPrime GTA billing (RCM shown on the bill, GSTR-1 B2B with recipient liable); TruckBilty invoices with
terms; Vyapar trip-wise invoices.

*Today:* an invoice can be marked reverse charge (`reverse_charge`, `rcm_tax_excluded`) and print "tax payable by the
recipient"; nothing gathers LRs into a bill.

**User story.** As a transporter, at month end I want one freight bill per customer listing every to-be-billed LR, with
the right GST treatment, so the customer can pay and (under RCM) pay the tax themselves.

**Acceptance criteria.**
1. **Pick.** "Create freight bill" lists unbilled `tbb` LRs (and delivered `to_pay` LRs not yet collected) grouped by
   billing party and period; multi-select.
2. **Build.** One document per party: `TAX_INVOICE` (or `INVOICE` for an unregistered party), SAC 996791 (GTA) by
   default (date-keyed default in `GTA_RATE_RULES`), one line per LR (description "LR no. / date, from → to, packages,
   charged weight"; amount = freight + charges), detention / other charges as their own lines.
   - GST: from the LR's liable person. All LRs on one bill must share it; mixed selections are split into two bills.
     `recipient` → `reverse_charge: true` + `rcm_tax_excluded: true` at the option's RCM rate; `fcm_5` / `fcm_18` →
     forward charge at the option's rate.
   - An annexure (R3-B4 annexure path) lists the LRs with POD dates and shortages.
3. **Link.** Each LR stores `bill_id`; the bill keeps `lr_ids` (additive, `RECORD_KEYS`). Cancelling the bill frees the
   LRs. An LR cannot be on two live bills.
4. **ITC caution.** Under `fcm_5`, purchase bills of the GTA that claim ITC on inputs get a warning in the GTA's own
   purchase screen ("option without ITC this FY") via a pack-gated check in the bill guard (informational only).
5. **Receivables, GSTR-1, books, Tally** see a normal invoice — no reader changes.

**Files.**
- New: `src/lib/transport/freight-bill.ts` (grouping, split by liable person, document builder, link / unlink);
  `src/components/transport/FreightBillDialog.tsx`.
- Edit: `src/lib/bill-guard.ts` (one pack-gated warning, lazy import of the option).

**Storage.** Additive `lr_ids?: string[]` on `invoices` (`RECORD_KEYS`, §6); `bill_id` on `consignment_notes`.

**Bundle.** In the transport chunk.

**Tests.** `tests/transport-freight-bill.test.ts`: grouping by party and period; RCM bill excludes tax from total and
GSTR-1 marks `rchrg: 'Y'`; FCM 5% vs 18% by option and date; mixed liability splits; LR on two bills refused;
cancel frees LRs; annexure rows; ITC caution under `fcm_5`.

#### R5-B3 Trips, vehicles and hired lorries (194C(6))

*Seen in:* Vyapar transport (vehicle log book, fuel / toll / maintenance, service history); FreightFlow (per-trip P&L,
driver advances, fleet maintenance); TallyPrime (vehicle / trip as cost centre, hired-vehicle costs per trip).

*Today:* expenses and bills carry `cost_centre_id` (`src/types/purchases.ts:177, 385`); cost-centre kinds are
`project | department | branch`; vehicles exist only as a fixed-asset ledger (3040). TDS 194C payable exists
(`tds-rules.ts:28–29`) without the transporter exemption.

**User story.** As a fleet owner, I want each trip's freight, diesel, toll, driver advance and lorry hire in one place
to know what the trip earned, and an alert before a vehicle's permit or insurance lapses. When I hire a market lorry, I
want the app to know whether TDS applies.

**Acceptance criteria.**
1. **Vehicle master** (Transport → Vehicles): registration no. (cleaned by `cleanVehicle`), own / hired, type, capacity,
   owner (party), documents with expiry (`insurance`, `permit`, `fitness`, `puc`, `tax`, `national_permit`), linked
   fixed asset (optional). Each own vehicle gets a **cost centre** of new kind `vehicle` (one-line union change in
   `cost-centres.ts`, §6).
2. **Trip sheet** (`TRP/FY…`): vehicle, driver, start / end date and km, route, LRs carried (B1), and expenses (diesel
   litres × rate, toll, loading, police / RTO, food, repairs) recorded as normal expense rows (`purchases` quick
   expense) tagged with the vehicle cost centre and `trip_id`. Driver advance = a staff advance payment (`staffAdvances`,
   3615) tagged `trip_id`, settled against trip expenses on close; balance returned or carried.
3. **Trip P&L.** Freight of LRs on the trip (allocated by charged weight when an LR's freight is billed elsewhere) −
   expenses − lorry hire = margin; per trip, per vehicle, per month. Mileage (km ÷ litres) flagged when outside the
   vehicle's normal range (typed).
4. **Hired lorry.** A trip with a hired vehicle has a **lorry hire** payable (purchase bill from the owner, 194C).
   - The owner's party record gets additive `transporter_194c6: { declared_on, vehicles_owned, pan }`. When declared,
     ≤ 10 goods carriages (threshold date-keyed in `tds-rules.ts`) and PAN present, the bill's TDS defaults to **nil
     with reason "194C(6) declaration"** and the 26Q working paper reports it with the no-deduction reason code (§7 Q2).
   - Without the declaration, 194C individual / others applies as today.
5. **Documents bell.** Lazy gate: vehicle documents expiring in ≤ 15 days or expired; trips open > 10 days.

**Files.**
- New: `src/lib/transport/{vehicles,trips,trip-pnl,transport-alerts}.ts`; `src/components/transport/{VehiclesPanel,TripsPanel,TripSheet}.tsx`.
- Edit: `src/lib/cost-centres.ts` (kinds `vehicle` **and** C's `fund` added in one union change, §6); `src/lib/tds-payables.ts` (194C(6)
  branch: one guarded condition); `src/lib/tds-returns.ts` (26Q no-deduction reason for that branch);
  `src/lib/tds-rules.ts` (append `TDS_194C6_RULES`: max vehicles 10, from 1 Apr 2015 — verify).

**Storage.**
- `vehicles`: `{ id, reg_no, own, type?, capacity_kg?, owner_id?, docs: {kind, number?, expires_on}[], asset_id?, cost_centre_id?, km_per_litre?: {min, max} }`.
- `trips`: `{ id, number, vehicle_id, driver?, start_date, end_date?, start_km?, end_km?, route?, lr_ids[], advance_ids[], hire_bill_id?, status, closed_on? }` (DATED + NUMBERED `TRP`).
- Additive `trip_id?` on `purchases` rows and payments (declaration merging); additive `transporter_194c6?` on `clients`.
- `TABLE_ACTIONS`: `master.edit` (vehicles), `doc.create` (trips).

**Bundle.** Vehicles / trips chunk ≈ 7 kB gz. Bell gate ≈ 0.1 kB.

**Tests.** `tests/transport-trips.test.ts`: vehicle cost centre created once; trip P&L with allocation by weight;
driver advance settlement; mileage flag; 194C(6) nil TDS only with declaration, PAN and ≤ 10 vehicles, by date; 26Q
reason code; document expiry bell rows. Purchases contract test gains `trips.ts` / `trip-pnl.ts`.

#### R5-B4 BOQ and measured RA bills

*Seen in:* Odoo construction modules (BOQ, measurement sheets previous / current / cumulative, IPC billing, variation
orders); Zoho partner build (RA bill with RA no., % done, cumulative amount); myBillBook construction (RA bills).

*Today:* R2-B2 progress billing bills a quotation / sales order by %, amount or **line %**, keeps `progress_line_of`
on stage lines, and computes billed-so-far net of credit notes (`src/lib/progress-billing.ts`). There is no measured
quantity basis and no abstract showing previous / this / cumulative.

**User story.** As a civil contractor, I want my work order's BOQ in the app, enter this month's measured quantities per
item, and print RA bill no. 4 showing "up to previous bill / this bill / cumulative" for each item, exactly as the
client's engineer checks it.

**Acceptance criteria.**
1. **BOQ.** A sales order (or quotation) is the BOQ. Pack `works` adds BOQ fields to its lines through the editor's
   custom-field path: item no. (e.g. "2.1.3"), unit, BOQ quantity, rate — already line fields — plus `boq_ref` (additive
   line field) and an optional link to a project cost centre. A work order no. and date sit in the existing reference
   fields. Import of a BOQ from CSV / XLSX (item no., description, unit, qty, rate, HSN / SAC) creates the SO lines.
2. **Measurement.** Works → RA bills → "New measurement" for a BOQ: per line, **cumulative measured quantity to date**
   (or this-bill quantity; the other is derived), with optional MB page / ref. Previous cumulative comes from the last
   RA measurement. Cumulative may not exceed BOQ qty unless "excess / variation" is ticked with a reason (shown as a
   separate "extra item" line on the bill).
3. **RA bill.** Saving a measurement creates the stage invoice through R2-B2's builder with a new basis `measured`:
   this-bill quantity per line (quantity-scaled, so HSN, rate, GST rate stay the BOQ's), `progress_line_of` set,
   `ra_no` (1, 2, 3 … per BOQ) and `ra_final` on the last bill (additive fields, `RECORD_KEYS`). Billed-so-far and
   over-billing checks reuse R2-B2.
4. **Abstract print.** The invoice prints an **RA abstract** annexure: item no., description, unit, BOQ qty, rate,
   up to previous qty / amount, this bill qty / amount, cumulative qty / amount, % of BOQ; footer totals and the
   deductions table from B5. Rendered through the existing annexure path (no `TemplateEngine` edit).
5. **Register.** Works → RA register per BOQ: RA no., date, gross this bill, cumulative gross, deductions, net,
   received, balance; CSV.

**Files.**
- New: `src/lib/works/{boq,measurements,ra-abstract}.ts`; `src/components/works/{WorksTab,BoqPanel,MeasurementForm,RaRegister}.tsx`, `works.module.css`.
- Edit: `src/lib/progress-billing.ts` (basis `measured`: one branch in the quantity calculator; existing bases untouched);
  `src/types/transport-works-r5.ts` (declares `ProgressBasis` extension, line `boq_ref`, invoice `ra_no` / `ra_final`
  by merging); `src/store/invoice-defaults.ts` (`normalizeItem` keeps `boq_ref` — one line, §6); `src/pages/Time.tsx`
  (tab `works`, pack-gated, lazy).

**Storage.**
- `ra_measurements`: `{ id, boq_id (SO id), ra_no, date, lines: {line_id, cumulative_qty, this_qty, mb_ref?, extra?: {reason}}[], invoice_id?, status: 'draft' | 'billed' | 'cancelled' }` (DATED).
- Additive line `boq_ref?`; invoice `ra_no?`, `ra_final?`, `boq_id?` (`RECORD_KEYS`, §6).
- `TABLE_ACTIONS`: `doc.create`.

**Bundle.** Works tab chunk ≈ 8 kB gz (with B5, B6).

**Tests.** `tests/works-ra.test.ts`: cumulative ↔ this-bill derivation; exceed BOQ refused without reason; RA numbering
per BOQ; stage invoice lines keep HSN / rate / GST; billed-so-far with a credit note; abstract columns sum to the
invoice; final RA bills the remaining balance to the paisa (R2-B2 rule); BOQ import mapping.

#### R5-B5 RA deductions: retention, advance recovery, 194C, GST TDS (Sec 51), labour cess

*Seen in:* Odoo progress billing (retention capped, advance recovery linear / threshold, LD); Zoho build (retention,
net payable); myBillBook (advance adjustment, retention); GST Council Circular on TDS u/s 51 (2%, certificate,
GSTR-7); BOCW cess 1%.

*Today:* an invoice can carry income-tax TDS (`tds_enabled`, `tds_section`, `tds_rate`, `tds_amount`) which
`receivableBalance` already nets (`rcm.ts:57–64`); mobilisation advances are R5.3 advances (`advances.ts`) applied as
payments. Nothing models retention, GST TDS or cess, and the receivable ages the retained money as overdue.

**User story.** As a contractor billing a government department, I want RA bill no. 4 to show gross value, GST, and
then less retention 5%, less advance recovery 10%, less income-tax TDS 2%, less GST TDS 2%, less labour cess 1% = net
payable — and my receivables to show only the net as due now, with retention due after the defect-liability period.

**Acceptance criteria.**
1. **Deduction set on the BOQ** (defaults for its RA bills, editable per bill): rows `{ kind, basis, rate | amount, cap? }`:
   - `retention` — % of gross (before GST) or of gross incl. GST (contract's choice), cap as % of contract value,
     release after `dlp_months` from the completion date or on a typed date;
   - `advance_recovery` — % of each bill until the linked advance (`advances.ts`) is fully recovered, or "start after
     x% of work done" (threshold);
   - `it_tds` — income-tax TDS (194C default; uses the invoice's existing `tds_*` fields so receivables and the 26AS
     reconciler already work);
   - `gst_tds` — 2% (1% + 1% intra-state / 2% IGST inter-state) on the value **excluding GST**, only when the recipient
     is flagged as a Sec 51 deductor (additive client field `gst_tds_deductor`) and the contract value exceeds ₹2.5
     lakh — rate and threshold date-keyed in `tax-rules.ts` (`GST_TDS_51_RULES`);
   - `labour_cess` — 1% on the gross (date-keyed, state-agnostic default; §7 Q7);
   - `security_deposit`, `ld` (liquidated damages), `other` — amounts with a label.
2. **Snapshot.** The bill stores `ra_deductions: {kind, label, base, rate?, amount}[]` and `ra_net_payable` (additive,
   `RECORD_KEYS`); totals, GST and `total` are **unchanged** (GST is on the full value). The abstract (B4) prints the
   deduction table and "Net payable".
3. **Receivables.** A pack-aware reader `raDueSplit(invoice)` splits the balance into **due now** (net payable less
   payments) and **held** buckets (retention with its release date, GST TDS awaiting credit, cess, SD). Ageing in
   Receivables uses `due now` for RA bills when the pack is on (one guarded call in `receivables.ts`, §6); held buckets
   show in a "Retention & held" sub-view with release dates.
4. **Receipt.** The payment dialog for an RA bill pre-fills: cash = net payable; "deductions" rows record:
   - advance recovery → an advance adjustment (`advance_id`, existing path);
   - IT TDS → already on the invoice (no payment row);
   - GST TDS → a payment row with method "GST TDS (Sec 51)" into a **GST TDS receivable** account
     (`ensureGstTdsReceivableAccount`, name fixed in §6), later moved to the cash ledger (2360) by accepting the GSTR-7
     row in the A5 credit panel (`kind: 'tds'`), which B mounts in the Works tab;
   - labour cess → payment row with method "Labour cess deducted" into an expense account (`ensureLabourCessAccount`)
     or a recoverable, as the user picks per BOQ (§7 Q7);
   - retention → stays outstanding as the held bucket; "Release retention" records the later receipt against it.
5. **Bell.** Lazy gate: retention release dates within 30 days or passed and not received.

**Files.**
- New: `src/lib/works/{deductions,ra-receivable,works-alerts}.ts`; `src/components/works/{DeductionSetEditor,RetentionPanel}.tsx`.
- Edit: `src/lib/receivables.ts` (one guarded call to `raDueSplit` for documents with `ra_deductions`; the helper is a
  pure ≤ 1 kB function in `src/lib/works/ra-due.ts`. `receivables.ts` is not imported by the Dashboard / shell today,
  so this stays out of first paint — `check:size` confirms); `src/components/modals/PaymentModal.tsx` (pack-gated deductions block,
  lazy); `src/lib/tax-rules.ts` (append `GST_TDS_51_RULES`, `LABOUR_CESS_RULES`).

**Storage.** Additive on `invoices`: `ra_deductions?`, `ra_net_payable?`, `retention_release_on?` (`RECORD_KEYS`);
on `clients`: `gst_tds_deductor?`; on the BOQ (sales order): `ra_deduction_set?`, `dlp_months?`, `advance_id?`.

**Bundle.** Works chunk. `ra-due.ts` ≤ 1 kB gz in the receivables chunk. Bell gate ≈ 0.1 kB.

**Tests.** `tests/works-deductions.test.ts`: retention % with cap; advance recovery linear and with threshold, stops at
the advance balance; GST TDS only above ₹2.5 lakh contract value, on value excl. GST, IGST vs CGST + SGST; cess; net
payable = total − deductions; invoice `total` and GSTR-1 unchanged; `raDueSplit` buckets; receipt rows by kind; release
of retention; ageing uses due-now; existing receivables tests unchanged (regression).

#### R5-B6 Sites: material at site and site cost

*Seen in:* TallyPrime godowns per site; contractor practice (material issued to site, theoretical vs actual
consumption).

*Today:* godowns, transfers (`STR`), stock journals, cost centres on documents; `Godown.kind` is
`'van' | 'expiry' | 'wip' | 'qc' | 'transit'` (`src/types/stock.ts:31`).

**User story.** As a contractor with three sites, I want cement and steel sent to each site tracked as site stock,
consumption booked against the project, and a monthly statement comparing what the BOQ says should have been used with
what was.

**Acceptance criteria.**
1. **Site.** "Add site" on a BOQ creates a godown of new kind `site` (saleable: false) linked to the BOQ's project cost
   centre. Material sent = an ordinary stock transfer to the site godown (no engine change).
2. **Consumption.** Works → Site → "Book consumption" saves a consume-only stock journal from the site godown tagged
   with the project cost centre (stock journal `cost_centre_id`, additive by merging), valued by the stock engine.
3. **Theoretical consumption.** Optional coefficients per BOQ line (`{item_id, qty_per_unit}` — e.g. 0.4 bag cement
   per sq m of plaster), kept in their own table so BOQ lines gain no field. Statement for a period: issued, consumed, theoretical (Σ measured qty × coefficient from B4
   measurements), variance %, closing at site. CSV.
4. **Site cost.** Project cost (cost-centre report) gains the consumed stock value; the existing project P&L reads it
   through the stock journal's cost centre.

**Files.**
- New: `src/lib/works/sites.ts` (site godowns, consumption builder, theoretical statement);
  `src/components/works/SitesPanel.tsx`.
- Edit: `src/types/stock.ts` (`Godown.kind` gains `'site'` — the one allowed line, §6); `src/lib/godowns.ts`
  (`nonSaleableGodowns` includes `site`); `src/lib/cost-centres.ts` (nothing beyond B3's union line).

**Storage.** Godown `kind: 'site'`, additive `boq_id?`; table `boq_coefficients`: `{ id, boq_id, line_id, item_id,
qty_per_unit }`; additive `cost_centre_id?` on `stock_journals` (merging).

**Bundle.** Works chunk ≈ 3 kB gz.

**Tests.** `tests/works-sites.test.ts`: site godown non-saleable; transfer in, consumption out, closing at site; theoretical
from measurements × coefficients; variance; cost-centre report includes consumption; alternate units via `lineFactor`.

### R5-C — Institutions, non-profits & property

#### R5-C1 Fee plans: heads, instalments, concessions, fines

*Seen in:* Teachmint (class-wise structures, one-time + recurring heads, discounts per section / student, fines,
instalment reminders, receipts on "mark collected"); Academia ERP and OpenEduCat (instalments tied to academic dates,
automatic late fines); Practo Ray (clinic billing, outstanding).

*Today:* batch invoices (R2-B1, `batch-invoices.ts`: one template × many parties, `batchToRecurring`), recurring
schedules, receipts (`receipts.ts`), reminders, Bill of Supply with `exempt_kind`, custom fields per client
(`custom-fields.ts`), late-payment interest (informational, `interest.ts`).

**User story.** As a school / coaching centre / physiotherapy clinic, I want to define "Class 6 — ₹48,000 a year in four
instalments, transport extra, 10% sibling concession", enrol students (or patients on a package), and have each
instalment billed, receipted and chased — with tuition on a Bill of Supply and coaching on a tax invoice.

**Acceptance criteria.**
1. **Fee plan** (Recurring → Fees → Plans): name, academic year (label; FY numbering of documents is unchanged),
   heads `{ name, amount, sac?, tax: 'exempt' | 'nil' | 'taxable', gst_rate?, frequency: 'once' | 'per_instalment' }`
   and instalments `{ label, due_date, share% }` (shares sum to 100; once-heads go on the first instalment).
   - The head's tax class sets the document kind: all heads exempt / nil → `BILL_OF_SUPPLY` with `exempt_kind`; any
     taxable head → tax invoice. A mixed plan (exempt tuition + taxable item) produces **two documents per instalment**
     (BOS + tax invoice), never one mixed document (§7 Q8).
   - Plan-level preset "Educational institution (exempt)", "Coaching (18%)", "Clinic — health care (exempt)" fills the
     tax class with a "verify with your CA" note.
2. **Enrolment** (Fees → Students / Patients): a client row with pack fields (merging): roll / UHID no., class / batch,
   guardian name and phone, plus `enrolments: {plan_id, from, concessions: {kind: 'pct' | 'amount', head?, value, reason}[], transport_route?}[]`.
   Bulk enrol from CSV (name, roll no., class, guardian, phone) through the existing client importer mapping.
3. **Billing run.** "Bill instalment" for a plan × instalment × class picks enrolled students and builds drafts with the
   R2-B1 batch builder (concessions applied as line discounts with the reason printed), issues them in one batch, and is
   idempotent per (student, plan, instalment). Undo uses `undoBatch`.
4. **Fines.** Optional per plan: flat or per-day after a grace, with a cap. Fines are never added silently: the
   defaulter list shows "fine due ₹x", and "Add fine" creates a separate small document (taxable class per plan,
   §7 Q8) on click.
5. **Receipts.** Payment recorded at the counter prints the existing receipt with the student's roll no. and class
   (receipt HTML gains an optional "for" line, additive).
6. **Defaulters.** Fees → Dues: per class / batch, per instalment, amount due, days overdue, guardian phone; bulk
   `wa.me` reminder through the existing reminder templates; CSV.
7. **Clinic packages.** A plan with `frequency: 'once'` heads and "sessions" count works as a treatment package; each
   visit is a ₹0 consumption entry (sessions left shown on the patient). No appointment book (long tail).

**Files.**
- New: `src/lib/institutions/{fee-plans,enrolments,fee-billing,fee-dues}.ts`;
  `src/components/institutions/{FeesTab,FeePlanForm,EnrolmentsPanel,DuesPanel}.tsx`, `institutions.module.css`;
  `src/types/institutions-r5.ts`; `src/i18n/areas/packs-institutions-r5.ts`; `docs/features/institutions-property.md`.
- Edit: `src/pages/Recurring.tsx` (segment gains `fees`, `leases`; pack-gated, lazy); `src/lib/receipts.ts` (optional
  "for" line).

**Storage.**
- `fee_plans`: `{ id, name, year_label, heads[], instalments[], fine?: {kind, amount, grace_days, cap?}, preset? }`.
- `fee_runs`: `{ id, plan_id, instalment, date, batch_run_id, student_ids[] }` (DATED).
- Additive client fields `roll_no?`, `class_label?`, `guardian?`, `enrolments?` (merging).
- Additive `fee_plan_id?`, `fee_instalment?` on `invoices` (`RECORD_KEYS`, §6) — the idempotency key of a run.
- `TABLE_ACTIONS`: `master.edit` (plans), `doc.create` (runs).

**Bundle.** Fees chunk ≈ 8 kB gz. Bell gate (instalments due in 3 days / overdue count) ≈ 0.1 kB.

**Tests.** `tests/fee-plans.test.ts`: shares sum to 100; once-heads on the first instalment; exempt → BOS, taxable →
tax invoice, mixed → two documents; concessions pct / amount per head; idempotent run; undo; fine maths with grace and
cap; dues ageing; CSV enrol mapping; GSTR-1 Table 8 picks the BOS as exempt.

#### R5-C2 Exempt supplies and the Rule 42 / 43 common-credit working

*Seen in:* GST law for mixed suppliers (clinics with a pharmacy, schools with a canteen contractor, NGOs with taxable
events, landlords with residential + commercial units).

*Today:* exempt documents are classified (`exempt_kind`) and purchases can be tagged `itc_reversal_reason:
'RULE_42' | 'RULE_43'` (`src/types/purchases.ts:444–447`), which GSTR-9 Table 7C / 7D sums (`gstr9.ts:604`). Nobody
computes **how much** common credit to reverse.

**User story.** As a clinic that also sells medicines, I want the app to tell me each month how much of my common input
credit (rent, electricity bills, software) I must reverse because part of my turnover is exempt, post it, and true it
up at year end.

**Acceptance criteria.**
1. **Tagging.** Purchase lines (or whole bills) get an ITC use tag (additive by merging): `taxable_only` (T4 not
   reversed), `exempt_only` (T2 — ITC not taken), `non_business` (T1), `common` (C2). Default `common` for pack users
   when a company has any exempt turnover in the FY; editable in bulk.
2. **Monthly working** (GST reports → tab `common-credit`, pack `fees` / `nonprofit` / `leases`, or any company with
   exempt turnover): Rule 42 — C1 = T − (T1 + T2 + T3), C2 = C1 − T4, D1 = (E ÷ F) × C2, D2 = 5% of C2 for
   non-business (only when tagged), C3 = C2 − D1 − D2; E and F from the month's exempt and total turnover (GSTR-1
   data, `exempt_kind`, Table 8; exports and zero-rated count as taxable). Rule 43 for capital goods: Tc ÷ 60 per month
   of common capital goods, × E ÷ F.
3. **Post.** "Post reversal" saves one journal (Dr GST input credit reversed 6370 | Cr Input IGST / CGST / SGST / cess
   by head) and tags the month so GSTR-3B 4(B)(1) shows it (via the existing reversal reader; the journal carries
   `itc_reversal_reason: 'RULE_42'`).
4. **Annual true-up.** For the FY, recompute D1 on annual turnover; difference shown with "reverse more" / "reclaim"
   and the interest note; due by the date in `tax-rules.ts` (date-keyed, §7 Q9).
5. **Working paper** CSV with every figure and the formula line; "verify with your CA" on screen.

**Files.**
- New: `src/lib/institutions/common-credit.ts` (T1–T4, D1, D2, Rule 43, true-up), `src/components/institutions/CommonCreditView.tsx`.
- Edit: `src/lib/gst-tabs.ts` (one tab id `common-credit` in the Tools group, §6); `src/lib/gst-reports.ts` (none —
  the reversal reader already reads `itc_reversal_reason`); `src/lib/tax-rules.ts` (append `COMMON_CREDIT_TRUE_UP_RULES`).

**Storage.** Additive `itc_use?` on purchase lines / bills (merging, purchases contract); `common_credit_runs`:
`{ id, month, figures, journal_id?, kind: 'monthly' | 'annual' }` (DATED). `TABLE_ACTIONS`: `books.edit`.

**Bundle.** GST tab chunk ≈ 5 kB gz.

**Tests.** `tests/common-credit.test.ts`: the Rule 42 worked example (fixture with T, T1–T4, E, F); zero exempt →
no reversal; exports counted as taxable; Rule 43 per-month amount; posting is balanced and tagged; annual true-up both
directions; purchases contract test gains `common-credit.ts`.

#### R5-C3 Donations: 80G / 35 receipts, donor ids and the Form 10BD file

*Seen in:* Eklavya (auto 80G receipts, 10BD / 10BE), Vyapar NPO page; Rule 18AB (Form 10BD by 31 May after the FY,
10BE certificates to donors; late fee and penalty).

*Today:* nothing. Donations are typed as "other income" receipts or as invoices (wrong: a donation is not a supply).

**User story.** As a small trust with 80G approval, I want to issue a numbered donation receipt the moment money comes
in, warn me when a cash donation above ₹2,000 cannot be deducted, and at year end export the Form 10BD file and track
which donors got their 10BE.

**Acceptance criteria.**
1. **Registration profile** (Settings → Profile, pack `nonprofit`): PAN of the entity, 12A / 12AB registration no. and
   validity, 80G approval no. (URN) and validity, 35(1) approval if any, FCRA registration no. (C4). Expiry warnings
   date-keyed (approval valid to date typed).
2. **Donor** = client row with pack fields: id code (`pan | aadhaar | tan | passport | voter_id | driving_licence | ration_card | foreign_tax_id`) and id number (PAN / Aadhaar validated), donor type (individual, company, trust …),
   address.
3. **Donation receipt** (Receivables → Donations): own series `DON/FY26-27/0001`; date, donor, amount, mode (`cash`,
   `kind`, `electronic` incl. cheque / DD, `others`), reference, **donation type** (`corpus`, `specific_grant`,
   `others`), fund (C4), section (`80G`, `35(1)(ii)`, `35(1)(iia)`, `35(1)(iii)`, `none`), purpose, anonymous flag.
   - Warnings: cash above ₹2,000 → "not deductible under 80G" (threshold date-keyed); `kind` → "not eligible for 80G";
     missing donor id with section ≠ none → "cannot be reported in 10BD"; anonymous above the Sec 115BBC limit →
     warning (§7 Q10).
   - Books: one receipt voucher via `saveVoucher`: Dr cash / bank | Cr **Donations — corpus** (a fund / capital
     account) or **Donations received** (income), both created by name; with a fund tag (C4) as cost centre.
   - Print: self-contained receipt HTML with the entity's PAN, 80G URN and validity, the donor's id, mode, amount in
     words, and "Form 10BE will be issued after Form 10BD is filed" line; share by `wa.me` / Web Share.
   - A receipt is never edited after the FY's 10BD is marked filed; corrections go through cancel + new (logged).
4. **Form 10BD working file.** Per FY: CSV in the column order of the portal's 10BD template (Sr no., pre-acknowledgement
   no., ID code, unique identification no., section code, URN, date of issue of URN, name of donor, address, donation
   type, mode of receipt, amount), aggregated per donor × section × type × mode as the template expects; rows that
   cannot be reported listed separately. Column list date-keyed (`FORM_10BD_COLUMNS` in `tds-rules.ts`) because the
   income-tax portal template may change (§7 Q10). "Mark filed" stores ARN and date.
5. **10BE tracking.** After filing: per donor "10BE certificate no., date, sent on"; import a CSV of 10BE numbers if the
   user downloads them; bulk send reminder text. Bell: 10BD due (31 May, date-keyed) from 1 May; donors without 10BE
   sent by 30 June.

**Files.**
- New: `src/lib/nonprofit/{donations,donation-receipt,form-10bd,nonprofit-alerts}.ts`;
  `src/components/nonprofit/{DonationsTab,DonationForm,Form10bdPanel}.tsx`, `nonprofit.module.css`.
- Edit: `src/pages/Receivables.tsx` (one tab line `donations`, pack-gated, §6); `src/components/settings/ProfileEditor.tsx`
  (pack-gated, lazy "Registrations" block); `src/lib/tds-rules.ts` (append `DONATION_CASH_LIMIT_RULES`,
  `FORM_10BD_DUE_RULES`, `FORM_10BD_COLUMNS`).

**Storage.**
- `donations`: `{ id, number, date, donor_id, amount, mode, reference?, type, fund_id?, section, purpose?, anonymous?, voucher_id, cancelled?: {on, reason} }` (DATED + NUMBERED `DON`).
- `form_10bd_filings`: `{ id, fy, arn?, filed_on?, rows_snapshot }`; `form_10be`: `{ id, fy, donor_id, cert_no, cert_date?, sent_on? }`.
- Additive sender-profile fields `npo?: { pan, reg_12ab?, reg_12ab_valid_to?, urn_80g?, urn_80g_date?, urn_80g_valid_to?, approval_35?, fcra_reg? }` (merging).
- `TABLE_ACTIONS`: `doc.create` (donations), `books.edit` (filings).

**Bundle.** Donations chunk ≈ 8 kB gz. Bell gate ≈ 0.1 kB.

**Tests.** `tests/donations.test.ts`: numbering across FY; cash > ₹2,000 warning by date; kind / missing id rules;
corpus vs income posting balanced and fund-tagged; receipt HTML has URN and donor id; 10BD aggregation and column order;
unreportable rows; edit refused after filing; 10BE tracking; bell dates.

#### R5-C4 Funds: restricted, corpus and FCRA

*Seen in:* ICAI Technical Guide on Accounting for NPOs (restricted / unrestricted / corpus funds); FCRA practice
(designated FCRA account at SBI New Delhi Main Branch, utilisation accounts, FC-4 with I&E, balance sheet and receipts &
payments); Patron (tag receipts to a fund when banked; expenses to the same fund).

*Today:* cost centres with kinds `project | department | branch` on documents, vouchers and expenses
(`cost-centres.ts:19`); several bank ledgers (`bank-accounts.ts`). No fund notion, no FCRA flag.

**User story.** As a trust with a CSR grant, a foreign grant and general donations, I want every receipt and expense
tagged to its fund, a statement per fund (opening, received, spent, balance), FCRA money kept apart with a warning when
it touches a non-FCRA account, and the FC-4 figures ready for my CA.

**Acceptance criteria.**
1. **Fund** = cost centre of new kind `fund` (one-line union change in `cost-centres.ts`, §6) with additive
   `fund: { nature: 'unrestricted' | 'restricted' | 'corpus' | 'fcra', donor_id?, purpose?, start?, end?, budget? }`.
   A default "General fund" (unrestricted) is created when the pack is turned on.
2. **FCRA accounts.** Bank accounts get additive `fcra: 'designated' | 'utilisation'`. Warnings (not blocks):
   - a donation tagged to an `fcra` fund received into a non-FCRA account, or a non-FCRA donation received into the
     designated account;
   - a payment from an FCRA account to another person's account that is not an expense of an FCRA fund (FCRA 2020
     transfer prohibition — §7 Q11);
   - FCRA administrative expenses above the date-keyed cap (`FCRA_ADMIN_CAP_RULES`, 20% believed — §7 Q11) of FCRA
     receipts for the FY, using an "administrative" flag on expense accounts.
3. **Fund statement** (Books → tab `funds`): per fund for a period: opening, receipts (donations, grants, interest
   allocated), utilisation by account, transfers between funds (journals with both tags), closing; unrestricted
   funds may go negative only with a warning. CSV and print.
4. **FC-4 working paper.** For FCRA funds and accounts: receipts & payments, income & expenditure and balance-sheet
   extract for the FY, purpose-wise utilisation, interest on FC; "certified by a CA" line; due date date-keyed.
5. **Application tracker (Sec 11 — informational).** For the FY: total income, amount applied (expenses excluding corpus
   and capital as the user maps accounts), % applied against the date-keyed threshold (85% believed — §7 Q10), and
   amounts the user marks as accumulated (Form 10 working note). Labelled "estimate — verify with your CA".

**Files.**
- New: `src/lib/nonprofit/{funds,fund-statement,fcra-checks,fc4,application}.ts`; `src/components/nonprofit/{FundsTab,FundStatement,Fc4Panel}.tsx`.
- Edit: `src/lib/cost-centres.ts` (normalise keeps `fund?`; the `fund` kind itself is added by B, §6);
  `src/lib/bank-accounts.ts` (keep `fcra` in normalise — after A's `clearing`, §6); `src/pages/Books.tsx` (tab `funds`,
  pack-gated, lazy); `src/lib/tds-rules.ts` (append `NPO_APPLICATION_RULES`); `src/lib/tax-rules.ts` (none).

**Storage.** Cost-centre kind `fund` + additive `fund?`; bank account `fcra?`; account flag `admin_expense?` on user
accounts (merging). No new table.

**Bundle.** Funds tab chunk ≈ 6 kB gz.

**Tests.** `tests/funds.test.ts`: fund statement from donations, expenses and inter-fund journals; corpus excluded from
income; FCRA account warnings (three cases); admin cap by date; FC-4 totals tie to the ledger; application % with the
threshold by date; default General fund created once.

#### R5-C5 Leases: rent, CAM, escalation, GST class and 194-I

*Seen in:* Mynd (base rent + CAM + GST per lease, late fees, reminders); RentOk (GST-ready invoices, exports); GST on
rent (commercial 18%; residential to a registered person for business under RCM; unregistered landlord of commercial
property → RCM entry 5AB from 10 Oct 2024); 194-I deducted by the tenant (`tds-rules.ts:78–93`).

*Today:* a recurring schedule repeats one template forever (`RecurringSchedule`, `recurring.ts:90–114`), with no
escalation, no lease dates, no deposit, no GST class per property.

**User story.** As a landlord with six shops and two flats, I want each lease once — tenant, unit, rent, CAM, 5%
escalation every 12 months, lock-in, expiry — and the app to raise the right rent document every month (tax invoice for
the shops, nothing taxable for the flats), expect the tenant's 194-I, and warn me before escalation and expiry.

**Acceptance criteria.**
1. **Property & unit** (Recurring → Leases → Properties): property (address, state, own GSTIN / unregistered), units
   (name, area, use `commercial | residential_dwelling | other`).
2. **Lease:** unit(s), tenant (client), start / end, lock-in end, rent per month, CAM per month (or per sq ft × area),
   other monthly heads, billing day, due days; escalation `{ every_months, kind: 'pct' | 'amount', value, first_on? }`;
   deposit link (C6); GST class derived and shown:
   - commercial (landlord registered) → tax invoice, SAC 997212, 18% (date-keyed default);
   - residential dwelling to an unregistered tenant or for residence → exempt → no tax document or a Bill of Supply as
     the user picks;
   - residential dwelling to a registered tenant using it for business → tax invoice marked **reverse charge**
     (`reverse_charge`, `rcm_tax_excluded`);
   - landlord unregistered → a plain rent receipt / bill (no GST); the screen notes the registered tenant's RCM under
     entry 5AB (§7 Q12).
   194-I: tenant flagged "deducts TDS" → documents carry `tds_section` 194I-B (land / building) or 194I-A (plant), rate
   from the existing date-keyed table, so the 26AS reconciler works unchanged.
3. **Schedule.** Saving a lease creates (or updates) a normal **recurring schedule** with additive `lease_id` and
   `escalation`; the generator applies the escalation on each occurrence from the step date (pure function
   `escalatedAmount(lease, occurrenceDate)`), so issued documents are snapshots and never change. The schedule's
   `end_date` = lease end. Pro-rata first / last month by days (option).
4. **Late fee.** Optional informational interest (existing `interest.ts` rule per lease); never added silently.
5. **Bell.** Lazy gate: escalation due in 30 days ("rent goes from ₹x to ₹y on date"), lock-in ending, lease expiring in
   60 / 30 days, 194-I certificate (Form 16A) not received for last quarter (via the TDS register).
6. **Rent roll.** Leases → Rent roll: unit, tenant, current rent, next escalation, deposit held, dues; CSV.

**Files.**
- New: `src/lib/property/{properties,leases,escalation,lease-gst,lease-alerts}.ts`;
  `src/components/property/{LeasesTab,LeaseForm,RentRoll,PropertiesPanel}.tsx`, `property.module.css`.
- Edit: `src/lib/recurring.ts` (generator calls an optional `amountHook(schedule, date)` — one additive hook: when the
  schedule has `lease_id`, line amounts come from `escalatedAmount`; existing schedules unchanged);
  `src/pages/Recurring.tsx` (segment `leases`, same edit as C1).

**Storage.**
- `properties`: `{ id, name, address, state, gstin?, units: {id, name, area?, use}[] }`.
- `leases`: `{ id, property_id, unit_ids[], tenant_id, start, end, lock_in_end?, rent, cam?, cam_basis?, heads?, billing_day, due_days, escalation?, gst_class, tds?: {section, rate?}, deposit_id?, schedule_id, status: 'active' | 'ended' | 'terminated', terminated_on? }` (DATED by `start`).
- Additive `lease_id?`, `escalation?` on `recurring` rows (merging).
- `TABLE_ACTIONS`: `master.edit`.

**Bundle.** Leases chunk ≈ 7 kB gz (with C6). Bell gate ≈ 0.1 kB.

**Tests.** `tests/leases.test.ts`: escalation pct / amount at steps, first-step date; pro-rata months; GST class per
use × landlord × tenant registration × date (incl. entry 5AB from 10 Oct 2024); RCM documents exclude tax from total;
194-I fields on generated documents; schedule ends at lease end; generated documents never change after an escalation
edit; recurring tests unchanged (regression).

#### R5-C6 Security deposits register

*Seen in:* lease and contract practice; GST: a refundable deposit is not consideration until applied (proviso to Sec
2(31)); the "Security deposits" ledger 3200 (`accounts.ts:455`).

*Today:* a deposit is a manual journal; nobody knows which tenant's deposit is held, what was adjusted or refunded.

**User story.** As a landlord (or a tenant who paid one), I want each deposit recorded once, see the balance per party,
adjust arrears or damages against it with the right GST, and refund the rest with a receipt.

**Acceptance criteria.**
1. **Register** (Leases → Deposits; also usable without a lease from the C pack screen): direction `received` (we hold
   it: liability **Security deposits received**, new account under Other current liabilities, created by name) or
   `paid` (asset 3200), party, amount, date, mode, lease / contract link, interest terms (none / % p.a., informational).
2. **Movements:** `receive` / `pay` (receipt / payment voucher via `saveVoucher` with the party), `adjust` against
   dues, `forfeit`, `refund`.
   - **Adjust / forfeit** against rent or damages: the screen creates the **tax document** for the adjusted amount when
     the underlying supply is taxable (e.g. damages invoice 18%, or the unpaid rent invoice already exists → the
     adjustment is just a receipt against it), with the "applied as consideration — GST payable on the applied part"
     note (§7 Q12).
   - **Refund**: payment voucher; a refund receipt print.
3. **Balance** per deposit and party; deposit held shows on the rent roll and the party statement (note line only; the
   statement maths is unchanged).
4. **Year-end note.** Deposits outstanding list for the notes to accounts (R2-C1 annual pack reads the ledger; this adds
   the party-wise schedule CSV).

**Files.**
- New: `src/lib/property/deposits.ts`; `src/components/property/DepositsPanel.tsx`.
- Edit: none outside the package.

**Storage.** `security_deposits`: `{ id, direction, party_id, lease_id?, amount, date, mode, interest?, movements: {kind, date, amount, doc_id?, voucher_id, note?}[], status }` (DATED). `TABLE_ACTIONS`: `books.edit`.

**Bundle.** In the leases chunk ≈ 3 kB gz.

**Tests.** `tests/security-deposits.test.ts`: received vs paid postings balanced; adjust against an existing invoice
(receipt only) vs a new damages invoice (tax document created); forfeit creates a taxable document; refund; balances;
period lock refusal; party schedule CSV.

---

## 5. Work packages

Three packages, each buildable by one agent in its own worktree. Each file is owned by one package; the few shared
touchpoints are append-only (§6). **Preconditions:** R4-B and R4-C merged (they edit `Receivables.tsx`,
`ProfileEditor.tsx`, `tax-rules.ts`, `gst-tabs.ts`, `bank-accounts.ts` callers). **R5-A1 lands first** as its own small
commit on the A branch and is merged to the base before B and C branch off, so `isPackOn` / `PackId` exist for all three.

### R5-A — Industry packs & marketplace seller (6 items)

Items:
- **A1** industry packs (six business types, `industry_packs`, Settings, wizard, Ctrl+K);
- **A2** channels, clearing account, SKU map;
- **A3** sales & returns import;
- **A4** settlement import & payout reconciliation;
- **A5** GST TCS / TDS credit and 194-O matching;
- **A6** returns, RTO & claims desk.

Owned files (new):
- `src/lib/industry-packs.ts`
- `src/lib/marketplace/{channels,sku-map,sales-import,settlement-import,settlement-recon,settlement-post,tcs-credit,returns-desk,marketplace-alerts}.ts`
- `src/components/marketplace/*`
- `src/types/marketplace-r5.ts`
- `src/i18n/areas/packs-marketplace-r5.ts`
- `docs/features/industry-packs.md`, `docs/features/marketplace.md`
- tests `industry-packs`, `marketplace-*`, `integration/marketplace-books`

Owned files (edit):
- `src/lib/shop-mode.ts` (union only), `src/lib/shop-presets.ts`
- `src/components/settings/ShopModePanel.tsx`, `src/components/onboarding/SetupWizard.tsx`
- `src/lib/tds-register.ts` (`extraExpected` parameter), `src/components/receivables/TdsTab.tsx`

Shared (§6):
- `src/pages/Receivables.tsx` (tab `marketplace`)
- `src/lib/bank-accounts.ts` (`clearing`, picker helper — A first)
- `src/lib/tds-rules.ts` (append `TDS_194O_RATE_RULES`)
- `RECORD_KEYS`, registries, bell, Ctrl+K

Icons (reuse): `ShoppingCart`, `Store`, `FileUp`, `FileSpreadsheet`, `Scale`, `PackageX`, `RotateCcw`, `Percent`.

Budget: first paint ≤ +0.2 kB gz (three `RECORD_KEYS` strings + one bell gate); total JS ≤ +38 kB gz.

### R5-B — Transport & works contracts (6 items)

Items:
- **B1** consignment notes & GTA option;
- **B2** freight bills from LRs;
- **B3** trips, vehicles, hired lorries (194C(6));
- **B4** BOQ & measured RA bills;
- **B5** RA deductions & retention;
- **B6** sites: material at site.

Owned files (new):
- `src/lib/transport/{gta-option,consignment-notes,lr-print,freight-bill,vehicles,trips,trip-pnl,transport-alerts}.ts`
- `src/lib/works/{boq,measurements,ra-abstract,deductions,ra-due,ra-receivable,sites,works-alerts}.ts`
- `src/components/transport/*`, `src/components/works/*`
- `src/types/transport-works-r5.ts`
- `src/i18n/areas/packs-transport-works-r5.ts`
- `docs/features/transport-works.md`
- tests `transport-*`, `works-*`

Owned files (edit):
- `src/pages/Distribution.tsx` (tab `transport`), `src/pages/Time.tsx` (tab `works`)
- `src/lib/progress-billing.ts` (basis `measured`)
- `src/lib/bill-guard.ts` (one pack-gated warning)
- `src/lib/tds-payables.ts`, `src/lib/tds-returns.ts` (194C(6) branch)
- `src/lib/receivables.ts` (one guarded `raDueSplit` call)
- `src/components/modals/PaymentModal.tsx` (pack-gated deductions block)
- `src/lib/godowns.ts` (`site` non-saleable)

Shared (§6):
- `src/types/stock.ts` (`Godown.kind` gains `'site'`)
- `src/lib/cost-centres.ts` (kinds union — B then C)
- `src/store/invoice-defaults.ts` (`boq_ref` line key)
- `src/lib/tax-rules.ts`, `src/lib/tds-rules.ts` (appends)
- `src/lib/industry-packs.ts` (`PACK_TABS` rows)
- `RECORD_KEYS`, registries, bell

Icons (reuse): `Truck`, `Car`, `MapPin`, `Ruler`, `ClipboardList`, `Building2`, `HandCoins`.

Budget: first paint ≤ +0.2 kB gz (`RECORD_KEYS` strings, `boq_ref` line key, two bell gates); total JS ≤ +34 kB gz.

### R5-C — Institutions, non-profits & property (6 items)

Items:
- **C1** fee plans;
- **C2** Rule 42 / 43 common credit;
- **C3** donations & Form 10BD;
- **C4** funds & FCRA;
- **C5** leases;
- **C6** security deposits.

Owned files (new):
- `src/lib/institutions/{fee-plans,enrolments,fee-billing,fee-dues,common-credit}.ts`
- `src/lib/nonprofit/{donations,donation-receipt,form-10bd,nonprofit-alerts,funds,fund-statement,fcra-checks,fc4,application}.ts`
- `src/lib/property/{properties,leases,escalation,lease-gst,lease-alerts,deposits}.ts`
- `src/components/{institutions,nonprofit,property}/*`
- `src/types/institutions-r5.ts`
- `src/i18n/areas/packs-institutions-r5.ts`
- `docs/features/institutions-property.md`
- tests `fee-plans`, `common-credit`, `donations`, `funds`, `leases`, `security-deposits`

Owned files (edit):
- `src/pages/Recurring.tsx` (segments `fees`, `leases`), `src/pages/Books.tsx` (tab `funds`)
- `src/lib/recurring.ts` (`amountHook`)
- `src/lib/receipts.ts` (optional "for" line)
- `src/components/settings/ProfileEditor.tsx` (pack-gated registrations block)

Shared (§6):
- `src/pages/Receivables.tsx` (tab `donations`)
- `src/lib/gst-tabs.ts` (tab `common-credit`)
- `src/lib/cost-centres.ts` (kind `fund`, after B)
- `src/lib/bank-accounts.ts` (`fcra`, after A)
- `src/lib/tax-rules.ts`, `src/lib/tds-rules.ts` (appends)
- `src/lib/industry-packs.ts` (`PACK_TABS` rows)
- `RECORD_KEYS`, registries, bell

Icons (reuse): `CalendarClock`, `Users`, `Heart`, `HandCoins`, `PiggyBank`, `Building`, `Landmark`, `ReceiptText`.

Budget: first paint ≤ +0.2 kB gz (two `RECORD_KEYS` strings, two bell gates); total JS ≤ +28 kB gz.

**Combined:** ≤ +0.6 kB gz first paint (≤ ~182.6 of 185 kB) and ≤ +100 kB gz total JS (≤ ~2380 of 2400 kB). Each
package runs `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` and `npm run check:size` and records the
numbers in its feature doc. If a package's first-paint delta exceeds +0.2 kB, its bell gate moves behind the existing
lazy alerts chunk before review.

---

## 6. Shared-file protocol

Merge order: **R5-A1 (alone) → R5-A → R5-B → R5-C.** Each later package rebases and resolves the append-only conflicts
mechanically (keep both sides).

| File | Who | Rule |
|---|---|---|
| `src/types/invoice.ts`, `purchases.ts`, `manufacturing.ts` | none | Not edited. Fields come by declaration merging: `marketplace-r5.ts` (A: `InvoiceRecord.channel_id` / `channel_order_id` / `channel_import_id`; settings `industry_packs`; `BankAccount.clearing`), `transport-works-r5.ts` (B: `InvoiceRecord.lr_ids` / `ra_no` / `ra_final` / `boq_id` / `ra_deductions` / `ra_net_payable` / `retention_release_on`; `InvoiceItem.boq_ref`; `Client.gst_tds_deductor` / `transporter_194c6`; `PurchaseRecord.trip_id`; `StockJournal.cost_centre_id`), `institutions-r5.ts` (C: `InvoiceRecord.fee_plan_id` / `fee_instalment`; client enrolment fields; `SenderProfile.npo`; `BankAccount.fcra`; `RecurringSchedule.lease_id` / `escalation`; purchase-line `itc_use`). |
| `src/lib/shop-mode.ts` | A | `BusinessType` union gains all six types in A1 (type only). `ALL_MODULES`, `PATH_MODULE` and the functions are **not** edited. |
| `src/lib/shop-presets.ts` | A | A1 adds all six types to `BUSINESS_TYPES`, `PRESETS`, `BUSINESS_DEFAULTS`. B and C do not edit it. |
| `src/lib/industry-packs.ts` | A (owner); B, C | A1 declares all six `PackId`s and `PACK_OF_TYPE`. `PACK_TABS`: one appended block per package (A: marketplace sub-views; B: `/distribution?tab=transport`, `/time?tab=works`; C: `/recurring?tab=fees`, `/recurring?tab=leases`, `/receivables?tab=donations`, `/books?tab=funds`, `/gst-reports?tab=common-credit`). |
| `src/store/useInvoiceStore.ts` `RECORD_KEYS` | A, B, C | One new line each at the end of the array with a `// R5-X` comment. A: 3 keys. B: 7 keys. C: 2 keys. No other store edit. |
| `src/store/invoice-defaults.ts` `normalizeItem` | B | One appended spread line keeping `boq_ref`. No other edit. |
| `src/pages/Receivables.tsx` | A, C | One `TABS` line + one lazy import + one render line each (`marketplace`, `donations`), each filtered by `isPackOn`. A also adds the shared filter helper call `visibleTabs(TABS, settings)` once; C reuses it. |
| `src/lib/bank-accounts.ts` | A, then C | A: normalise keeps `clearing`; adds `pickableBankAccounts(purpose)`. C: normalise keeps `fcra` (one appended line). Callers of the pickers (cheques, e-payment, BRS import) are edited by A only. |
| `src/lib/cost-centres.ts` | B, then C | B changes `CostCentreKind` / `COST_CENTRE_KINDS` / labels once to include `'vehicle'` **and** `'fund'` (C's kind included so C does not edit the line). C adds the `fund?` normalise line only. |
| `src/types/stock.ts` | B | `Godown.kind` union gains `'site'` (the one allowed line). |
| `src/lib/godowns.ts` | B | `nonSaleableGodowns` includes `site`. No other edit. |
| `src/lib/tax-rules.ts` | B, C | Appended dated blocks at the end, never overwriting. B: `GTA_RATE_RULES`, `GTA_OPTION_WINDOW_RULES`, `GTA_RCM_RECIPIENT_KINDS`, `GST_TDS_51_RULES`, `LABOUR_CESS_RULES`. C: `COMMON_CREDIT_TRUE_UP_RULES`, `LEASE_GST_RULES` (commercial rent rate, entry 5AB from 2024-10-10). |
| `src/lib/tds-rules.ts` | A, B, C | Appended dated blocks. A: `TDS_194O_RATE_RULES`. B: `TDS_194C6_RULES`. C: `DONATION_CASH_LIMIT_RULES`, `FORM_10BD_DUE_RULES`, `FORM_10BD_COLUMNS`, `NPO_APPLICATION_RULES`, `FCRA_ADMIN_CAP_RULES`. |
| Helper accounts (by name) | A, B, C | Fixed names so packages never collide: A "Marketplace fees", "GST TCS receivable", "GST on marketplace fees — awaiting invoice"; B "GST TDS receivable", "Labour cess deducted", "Retention money receivable" (sub-view label only, no ledger); C "Donations received", "Donations — corpus fund", "Security deposits received". A5 reads "GST TDS receivable" by name. |
| `src/lib/backup.ts` `RECORD_TABLES` / `ID_TABLES` | A, B, C | One appended line per package with a `// Round 5 (R5-X)` comment. A: `sales_channels`, `channel_skus`, `marketplace_imports`, `settlements`, `eco_credits`, `marketplace_returns`. B: `consignment_notes`, `gta_options`, `vehicles`, `trips`, `ra_measurements`, `boq_coefficients`. C: `fee_plans`, `fee_runs`, `common_credit_runs`, `donations`, `form_10bd_filings`, `form_10be`, `properties`, `leases`, `security_deposits`. |
| `src/lib/audit-edits.ts` `WATCHED_TABLES` | A, B, C | One appended block each (same tables). |
| `src/lib/access.ts` `TABLE_ACTIONS` | A, B, C | Same. Masters → `master.edit` / `settings.manage`; documents and registers → `doc.create`; postings → `books.edit`. |
| `src/lib/sync-engine.ts` `DATED` / `NUMBERED` | A, B, C | A: `marketplace_imports`, `settlements`, `eco_credits`, `marketplace_returns` (D). B: `consignment_notes` (D + N `LR`), `trips` (D + N `TRP`), `ra_measurements` (D). C: `fee_runs`, `common_credit_runs`, `leases`, `security_deposits` (D), `donations` (D + N `DON`). |
| `src/components/command/NotificationBell.tsx` | A, B, C | Each adds one `ensure…Alerts` lazy gate after the R4 gates, in merge order: A `ensureMarketplaceAlerts`, B `ensureTransportAlerts` + `ensureWorksAlerts`, C `ensureFeeAlerts` + `ensureNonprofitAlerts` + `ensureLeaseAlerts`. Every gate returns early when its pack is off **before** importing its chunk. |
| `src/components/command/CommandPalette.tsx` | A | One "Industry packs" group reading `PACK_TABS` lazily. B and C add rows to `PACK_TABS`, not to the palette. |
| `src/lib/gst-tabs.ts` | C | One tab id `common-credit` in the Tools group. |
| `src/components/marketplace/TcsCreditPanel.tsx` | A (owner), B (mount) | B mounts it lazily in the Works tab with `kind="tds"`; B does not edit it. |
| `src/App.tsx`, `DashboardLayout.tsx`, `main.tsx` | none | No new routes or shell imports. |
| `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `AGENTS.md` | lead | Packages write only their own `docs/features/*.md`. The lead adds the Round 5 rows, storage keys and the pack rule after merging. |
| `tests/purchase-contract.test.ts` | A, B, C | A adds `settlement-post.ts` (it writes fee bills). B adds `trips.ts`, `trip-pnl.ts`. C adds `common-credit.ts`. One appended block each. |

Every package must pass `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` and `npm run check:size` on
its own branch, and again after rebasing on the previous package. No new runtime dependencies. No new lucide icon
names. A test in each package asserts that with no pack on, none of its tables is read on Receivables / Recurring /
Distribution / Time / Books render (spy on `getTable`).

### New storage summary

| Key / table | Package | Kind | Backed up | Synced |
|---|---|---|---|---|
| `industry_packs` on `mrchartist_inv_settings` | A | settings field | yes | yes |
| `mrchartist_inv_sales_channels` | A | rows | yes | yes |
| `mrchartist_inv_channel_skus` | A | rows | yes | yes |
| `mrchartist_inv_marketplace_imports` | A | rows (dated) | yes | yes |
| `mrchartist_inv_settlements` | A | rows (dated) | yes | yes |
| `mrchartist_inv_eco_credits` | A | rows (dated) | yes | yes |
| `mrchartist_inv_marketplace_returns` | A | rows (dated) | yes | yes |
| `mrchartist_inv_consignment_notes` | B | rows (dated, numbered `LR/FY…`) | yes | yes |
| `mrchartist_inv_gta_options` | B | rows | yes | yes |
| `mrchartist_inv_vehicles` | B | rows | yes | yes |
| `mrchartist_inv_trips` | B | rows (dated, numbered `TRP/FY…`) | yes | yes |
| `mrchartist_inv_ra_measurements` | B | rows (dated) | yes | yes |
| `mrchartist_inv_boq_coefficients` | B | rows | yes | yes |
| `mrchartist_inv_fee_plans` | C | rows | yes | yes |
| `mrchartist_inv_fee_runs` | C | rows (dated) | yes | yes |
| `mrchartist_inv_common_credit_runs` | C | rows (dated) | yes | yes |
| `mrchartist_inv_donations` | C | rows (dated, numbered `DON/FY…`) | yes | yes |
| `mrchartist_inv_form_10bd_filings` | C | rows | yes | yes |
| `mrchartist_inv_form_10be` | C | rows | yes | yes |
| `mrchartist_inv_properties` | C | rows | yes | yes |
| `mrchartist_inv_leases` | C | rows (dated) | yes | yes |
| `mrchartist_inv_security_deposits` | C | rows (dated) | yes | yes |

New numbered series: `LR`, `TRP`, `DON` (all through `series-counters.ts`, Indian FY). Freight bills, RA bills, fee
documents and rent documents are ordinary invoices / Bills of Supply in their existing series. Marketplace documents keep
the marketplace's own invoice numbers (like imported opening invoices) and never consume an app series number.

---

## 7. Open questions

Statutory questions are flagged **(verify with your CA)**. Every output stays labelled as a working paper.

1. **Income-tax Act 2025 (cross-cutting, lead) (verify with your CA).**
   - From 1 Apr 2026 the 2025 Act applies (earlier of credit / payment on or after that date), with non-salary TDS
     consolidated in Section 393 tables. The app's labels (`194C`, `194-I`, `194-O`, `194J`, Form 26Q / 16A, 80G, Form
     10BD / 10BE, Sec 11 / 12AB) are 1961-Act names (`src/lib/tds-rules.ts`). Should Round 5 show the 393 table item
     beside the old code for documents dated from 1 Apr 2026 (a date-keyed label map), and which table items map to
     194C, 194C(6), 194-I(a)/(b), 194-O?
   - What are the 2025-Act equivalents of Sec 80G, 35(1), 11, 12AB, 115BBC and of Forms 10BD / 10BE / 10, and did the
     10BD due date or columns change?
2. **Transport / GTA (verify with your CA).**
   - GTA rates after 22 Sep 2025: is it RCM 5%, forward charge 5% without ITC, or 18% with ITC (12% with ITC before)?
     Which notification (15/2025-CT(R)?) and from which date?
   - Annexure V / VI: is the window 1 Jan – 31 Mar of the preceding FY with deemed continuation, and does a new GTA opt
     at registration?
   - Is the notified recipient list for RCM (factory, society, co-operative, registered person, body corporate,
     partnership incl. AOP, casual taxable person) current, and does a composition-registered recipient still pay RCM?
   - Are the Rule 46 / consignment-note fields proposed in B1 complete (serial no., consignor, consignee, vehicle, goods,
     origin, destination, person liable, GSTINs)?
   - 194C(6): ≤ 10 goods carriages at any time in the year with PAN and declaration — confirm the conditions, the 26Q
     reporting code for "no deduction", and the 2025-Act equivalent.
3. **GST TCS / TDS credit (verify with your CA).**
   - Is the TCS credit available only once the "TDS and TCS credit received" statement is filed, and should the books
     move it to the cash ledger on acceptance (as proposed) or on filing?
   - If the operator's GSTR-8 value differs from the supplier's GSTR-1, Sec 52(8) adds the difference to the supplier's
     liability with interest — should the A5 diff produce a payable estimate?
   - Is 0.5% from 10 Jul 2024 the correct rate and notification (`ECO_TCS_RATE_RULES` already says "verify")?
4. **Marketplace invoices (verify with your CA).**
   - When the marketplace generates the invoice in the seller's name, is importing it with its own number into the
     books acceptable as the seller's invoice record (Rule 46 series), and how should e-invoicing (seller AATO above
     the threshold, B2B orders) be handled — by the marketplace's IRN or the seller's?
   - Should B2C orders be imported per order or summarised per state × rate × day for GSTR-1 (Table 7) purposes, and is
     the summary acceptable as the books record?
   - Inventory in the marketplace's warehouses in other states (FBA): is an additional place of business per state
     required, and should A2 warn when a channel's godown is in a state without a registration?
5. **Returns / RTO (verify with your CA).** For RTO (undelivered goods returned) after the invoice is issued: credit note
   (Sec 34, time limit 30 Nov) or cancellation? Is GST on marketplace commission / fees always forward charge with ITC?
6. **Works contracts (verify with your CA).**
   - Current rates after 22 Sep 2025: which government works stay at 12% (if any) and which moved to 18%? Affordable
     housing 1%?
   - Retention: GST is payable on the full invoice value including the retained part at invoice time (as proposed),
     not on release — confirm.
   - Mobilisation advance: time of supply on receipt (Sec 13) — does the R5.3 advance receipt voucher with GST cover it?
   - GST TDS u/s 51: 2% on value excluding tax, ₹2.5 lakh tested on the contract value; credit to the cash ledger on
     acceptance — confirm, and whether PSUs / local authorities as recipients are all deductors.
7. **Labour cess (verify with your CA).** Is BOCW cess (1%) on the total cost of construction deducted from bills for all
   civil works, state-wise exemptions, and is it an expense of the contractor or recoverable? Is GST payable on a value
   that includes the cess?
8. **Education / health (verify with your CA).**
   - Entry 66 (education up to higher secondary; approved courses) and entry 74 (health care by clinical establishments)
     — are the plan presets right, and is coaching / tuition 18%?
   - A mixed fee (exempt tuition + taxable items such as uniforms or transport by a third party): two documents per
     instalment (as proposed) or an invoice-cum-bill of supply (Rule 46A) when the student is unregistered?
   - Are late-payment fines on exempt fees exempt as part of the composite supply, or taxable?
9. **Rule 42 / 43 (verify with your CA).** Confirm the formulas used (D1 = E/F × C2; D2 = 5% of C2; Rule 43 Tc/60), the
   treatment of exports / zero-rated and non-taxable turnover in E and F, and the annual true-up due date and interest.
10. **NGOs (verify with your CA).**
    - 80G receipt contents after Rule 18AB; cash limit ₹2,000; donations in kind not deductible; anonymous donations
      under Sec 115BBC (the 5% / ₹1 lakh limit); corpus vs specific grant vs others for 10BD.
    - Form 10BD columns and aggregation per donor — confirm against the current portal template; due 31 May; late fee
      Sec 234G and penalty Sec 271K.
    - Sec 11: 85% application, accumulation (Form 10) and the treatment of corpus and capital expenditure in the tracker.
11. **FCRA (verify with your CA).** Administrative expenses cap (20% of FC received in the FY after the 2020 amendment —
    and how "administrative" is defined), the ban on transfers to other persons, the FC-4 due date (31 Dec), interest on
    FC as FC, and whether utilisation accounts may be at any scheduled bank.
12. **Rent (verify with your CA).**
    - Commercial rent 18% after 22 Sep 2025; residential dwelling to a registered person used for business under RCM;
      unregistered landlord of commercial property → RCM (entry 5AB, 10 Oct 2024); was a composition-tenant exclusion
      added later (date)?
    - Security deposit: not consideration until applied (proviso to Sec 2(31)); confirm GST on adjustment / forfeiture
      and that a deposit held for the lease term is not deemed consideration.
    - 194-I: ₹50,000 per month threshold from 1 Apr 2025 (already in `tds-rules.ts`); 194-IB at 2% from 1 Oct 2024 for
      individual tenants — should leases offer 194-IB?
13. **Scope.** Should the long tail — subcontractor RA bills (purchase side), channel profitability per SKU after fees
    and returns, a clinic appointment book, grant utilisation certificates, and the ITA 2025 label map — form a Round 6
    "verticals II" package, or should the ITA 2025 labels be a QA-round fix ahead of it?
