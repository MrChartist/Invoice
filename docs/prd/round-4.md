# PRD — Round 4: makers, store chains, exporters and trust leaders

Status: draft for build · Drafted 2026-10-26 · Baseline: branch `claude/elegant-cannon-cwapiv` at `b27b7f9`
(Phases 0–8, Round 2, Round 3 and the QA round 3 fixes merged).
Raw sources (URLs and the claim taken from each):
`/tmp/claude-0/-home-user-Invoice/c401a5ec-398d-5b90-84fd-5f6b9cfff692/scratchpad/research/round4-sources.md`.

Every item follows `AGENTS.md`:
- local-first and serverless: no network, no portal APIs, no bank or ICEGATE / DGFT fetch;
- vanilla CSS Modules with tokens;
- invoice snapshots never change;
- Indian-FY numbering;
- bare dates parsed as local days;
- statutory values date-keyed in `src/lib/tax-rules.ts`;
- GST / customs / FEMA outputs labelled as working papers ("verify with your CA").

---

## 1. Problem statement

Round 1 matched the Indian daily apps. Phases 6–8 matched Tally. Round 2 matched the established suites, and Round 3
matched the freelancer apps and Indian niche tools. Round 4 looks at four groups that no round has covered yet:

- **Manufacturing and inventory-heavy SMB tools:** Katana, MRPeasy, Deskera MRP, Zoho Inventory, Unicommerce, the
  Vyapar manufacturing module and the TallyPrime manufacturing / job-costing journals.
- **Retail chains and franchises:** Ginesys, GoFrugal and Shopify POS.
- **Indian trader / exporter practice:** export paperwork (IEC, LUT, shipping bill, packing list, e-BRC, RoDTEP) and
  import landed cost and customs duty.
- **Accessibility and trust leaders:** how the best apps handle the audit trail, data portability, undo and offline
  conflicts (Notion, Figma, the Ink & Switch local-first ideals, the MCA audit-trail rule).

The app is already deep in all four areas, so most of what these tools do is **built**. Section 2 cites the code for
each finding. These are the gaps that remain:

1. **Production is one shot.** The Manufacturing Journal (`src/lib/manufacturing.ts`) consumes and produces on one
   date. A production plan (`src/lib/mrp.ts`, `PP/FY…`) only suggests what to make.
   - Katana and Deskera run **manufacturing orders**: an order is released, materials are issued, output is reported in
     parts and the order is closed. Each order is linked to a sales order and shows planned against actual cost.
   - Tally does the same with a shop-floor (WIP) godown and Job Work Analysis.
   - We have no order object (`ManufacturingVoucher` has no order, SO or cost-centre field:
     `src/types/manufacturing.ts:121–148`). Nothing compares standard cost with actual cost, and there is no
     per-sales-order margin for made-to-order goods.
2. **Traceability stops at the batch.** Batches, expiry and FEFO are complete (`src/lib/stock-tracking.ts`), and the
   Manufacturing Journal records consumed batches and the finished batch.
   - Katana and MRPeasy turn that into **genealogy**: from the sale back to the supplier's batch, and forward from a bad
     raw-material batch to every customer who got it.
   - Nothing in `src/lib` builds that chain. A grep for `genealog`, `recall` and `trace` finds only TRACES and POS hold.
   - Unicommerce holds received goods in **QC** before they can be sold. We have only an `expiry` godown kind
     (`src/types/stock.ts:27–28`).
3. **Landed cost is per bill.** WP-8 spreads freight typed **on the same bill** over its lines (`src/lib/landed-cost.ts`).
   Zoho Inventory and the Odoo pattern apply a **later** freight, CHA or customs bill to goods received earlier.
   - An importer's Bill of Entry duty (BCD, Social Welfare Surcharge) never reaches stock cost.
   - Import bills carry only `boe_number` / `boe_date` / port (`src/types/purchases.ts:151–154`).
   - A grep for `bcd`, `customs_duty` and `assessable` finds nothing.
4. **Stores in a chain.** We have branches (`src/lib/branch.ts`), godowns, transfers (`STR/FY…`), price levels,
   loyalty points (`src/lib/loyalty.ts`) and POS returns.
   - What chains add:
     - store-specific prices (Shopify "retail markets");
     - transfer **requests** answered by the warehouse, with goods **in transit** until the store receives them (Zoho
       "Initiate Transfer", Shopify / Stocky "In transit" tab, Ginesys replenishment);
     - **gift vouchers** (GoFrugal, Shopify);
     - loyalty **tiers** and **expiry**.
   - Our transfer is instant and quantity-only (`StockTransfer`, `src/types/stock.ts:52–64`).
   - A branch has no price list (`Branch`, `src/lib/branch.ts:29–44`).
   - Loyalty has one rate and points that never expire.
   - A grep for `gift` finds only payroll perquisites. The POS tenders are Cash / UPI / Card / Cheque / Wallet
     (`src/lib/pos.ts:43`).
   - A same-GSTIN branch movement has no Rule 55 challan and no e-way JSON for "own use". `eway.ts:236` covers only
     supply / export / credit-note sub-types; job work has its own builder.
5. **Exporters do the paperwork outside the app.**
   - We have zero-rated supply types, typed LUT number / date per invoice (`src/types/invoice.ts:504–505`,
     `AdvancedTaxPanel.tsx`), shipping-bill number / date / port (`ForexFields.tsx`), FX rates
     (`currency-rates.ts`), realised exchange difference (`fx-gain.ts`) and a packing list (R2-C4, `src/lib/packing.ts`).
   - Missing:
     - **IEC** and **AD code** on the profile;
     - a **LUT register** per FY with ARN, which warns when an export is raised without a live LUT;
     - Incoterms, ports, countries, vessel and marks on the invoice;
     - an **export realisation register** (shipping bill → bank IRM / FIRC → e-BRC) watching the FEMA period, now 15
       months from shipment (RBI, Nov 2025);
     - a **RoDTEP / drawback receivable** register.
   - Roadmap 7.131 already lists "refund of IGST on goods exports (shipping-bill route)" as open.
6. **Trust details.**
   - The audit trail is strong: hash chain, edit log of every books table, archive segments, an "it cannot be turned
     off" statement (`docs/features/audit-lock.md`, `migration-audit.md`).
   - But:
     - **Undo** exists only for invoice deletes, behind a toast that **times out after 6 s**
       (`src/pages/Transactions.tsx:328–338`, `Toast.tsx:22`). Accessibility guidance says an actionable toast must not
       auto-dismiss.
     - Every other delete (bills, vouchers, parties, items, stock vouchers …) is permanent after a confirm. Notion keeps
       a 30-day Trash.
     - There is **no per-FY auditor export** of the trail for Rule 11(g) reporting. Roadmap 7.49 lists it as open.
     - **Portability** is a JSON backup plus seven accounting CSVs (`src/lib/accounting-export.ts`). A user who leaves
       cannot open their whole data set in a spreadsheet. The Ink & Switch ideal "The Long Now" asks for exactly that.
     - **Sync conflicts** offer whole-row "Keep mine / Use theirs" with raw field names as a hint
       (`src/components/sync/SyncPanel.tsx:44–56, 98–124`). Figma merges per property.

**Goal of Round 4:** ship 17 features in three parallel work packages with mostly disjoint files:

- **R4-A** production, costing and traceability (5 items);
- **R4-B** stores and chains (5 items);
- **R4-C** trade desk and trust (7 items).

### Budgets the packages must respect

| Budget | Now | Limit | Source |
|---|---|---|---|
| Initial JS (first paint, gz) | **≈ 179.6 kB** | 185 kB | `scripts/check-bundle-size.mjs:20` |
| Entry chunk (gz) | — | 90 kB | `scripts/check-bundle-size.mjs:21` |
| Total JS (gz) | **≈ 2030 kB** | 2400 kB | `scripts/check-bundle-size.mjs:38` |

Rules:
- **Everything is lazy.** That covers every new screen, library, report and dialog. The shell may gain only:
  - `React.lazy` routes and tabs wired by the lead;
  - `RECORD_KEYS` strings;
  - bell gates of the existing `ensure…Alerts` shape (`src/components/command/NotificationBell.tsx:40–197`);
  - the one Toast change in R4-C4.
- **Icons: reuse only.** Every `lucide-react` icon imported anywhere lands in the first-paint vendor chunk, so packages
  must **reuse icons the app already imports**. A new icon name fails review. Icons already in use and suggested here:
  - R4-A: `Factory`, `ClipboardCheck`, `ListTree`, `ShieldAlert`, `Scale`;
  - R4-B: `Gift`, `Trophy`, `Store`, `Truck`, `ArrowLeftRight`, `Tags`;
  - R4-C: `Globe`, `Landmark`, `FileArchive`, `Trash2`, `Undo2`, `History`, `FileDiff`, `ShieldCheck`,
    `FileSpreadsheet`.
- **Per-package first-paint delta:** A ≤ +0.2 kB, B ≤ +0.3 kB, C ≤ +0.4 kB gz. Combined ≤ +0.9 kB, so initial JS stays
  ≤ ~180.5 kB.
- **Per-package total-JS delta:** each ≤ +45 kB gz, combined ≤ +120 kB, so total JS stays ≤ ~2150 kB.
- The packages record before / after numbers from `npm run build && npm run check:size` in their feature docs. No
  budget may be raised without the lead.

### Non-goals

Anything that needs a server or the network. This drops:
- Katana's cloud Shop Floor App;
- Shopify cross-store gift cards and online loyalty apps;
- Unicommerce marketplace order sync;
- AfterShip transfer tracking;
- DGFT IRM / e-BRC fetch and upload;
- ICEGATE shipping-bill / Bill of Entry filing and RoDTEP scrip ledger sync;
- live customs exchange rates;
- loyalty SMS;
- real-time multi-device editing.

Local substitutes are named where they exist: typed or CSV-imported IRMs, CBIC-notified rates in the currency master,
folder sync, and `wa.me` / Web Share.

---

## 2. Per-competitor findings

Status:
- **B** = built (cited);
- **P** = partial;
- **M** = missing;
- **R2 / R3** = specified in an earlier round (not re-proposed);
- **X** = dropped (network / server).

Proposed items carry their Round 4 id.

| Competitor | Feature / UX pattern | Our status (evidence) | Round 4 |
|---|---|---|---|
| **Katana** | BOM with sub-assemblies | B — multi-level BOMs, cycle check (`src/lib/manufacturing.ts`, `docs/features/manufacturing.md` § BOM) | — |
| | Manufacturing order lifecycle (open → in progress → done), partial output | M — one-shot Manufacturing Journal (`MfgJournalTab.tsx`); plan only suggests (`mrp.ts`) | R4-A1 |
| | Make-to-order MO linked to a sales-order line; profit per SO | M — no SO link on `ManufacturingVoucher` (`src/types/manufacturing.ts:121`); profitability is per item / party (`profitability.ts`) | R4-A1, R4-A2 |
| | Planned vs actual cost per MO (materials, operations) | P — live cost roll-up and `cost_snapshot` per voucher; no standard vs actual (`manufacturing.ts`, `margin.ts` standard costs unused here) | R4-A2 |
| | Production operations with actual time and Shop Floor App | P — additional costs ₹ / % only (`AdditionalCost`); app = X | later (routing) |
| | Batch picked on every movement; full traceability SO ← MO ← PO | P — batches on every movement (`stock-tracking.ts`); no genealogy view | R4-A3 |
| | Expired batches blocked on new orders | B — expired batch blocks save until confirmed; pharma gate blocks (`stock-tracking.ts`, `pharma-gate.ts`) | — |
| | Outsourced production with batch on return | B — job work out / in with batches and serials (`job-work.ts`, 7M / 7S) | — |
| **MRPeasy** | Actual costing, materials "booked" to the product | B — `computeStockDetailed` costs production from consumed cost (`inventory.ts`) | — |
| | Actuals vs planned screens | M | R4-A2 |
| | Lot traceability for QA | M (as above) | R4-A3 |
| | Serials on MO paperwork (a reviewer complaint) | B — serials on vouchers (7S `serial-vouchers.ts`) | — |
| **Deskera MRP** | Work orders (make to order / to stock), progress | M | R4-A1 |
| | By-product & scrap management | B — BOM outputs by-product / co-product / scrap with fixed rate or cost share (`BomOutput`) | — |
| | Yield and finished-goods costing | P — yield not reported | R4-A2 |
| **Zoho Inventory** | Transfer order: Initiate → In transit → Mark as received | M — `StockTransfer` is instant (`src/types/stock.ts:52`) | R4-B4 |
| | Transfers between GSTINs as draft then invoice + bill | B — Sec 25(4) pair (`branch-transfer.ts`) | — |
| | Default landed-cost allocation by quantity / value | B on one bill (`landed-cost.ts`); M across bills | R4-A5 |
| | Assemblies from SO / invoice when short | P — MRP "Manufacture" link (`mrp.ts`); no SO trigger | R4-A1 |
| **Unicommerce** | GRN → QC → putaway, good vs QC-rejected | P — GRN + Rejections Out (`receipt-notes.ts`); no QC hold godown | R4-A4 |
| | Bins / putaway | B — bins (`bins.ts`, 8.86) | — |
| | Cycle counts (Enterprise) | P — Physical Stock any time (`PHY/FY…`); no ABC schedule | later |
| | Marketplace order sync | X | — |
| **Vyapar manufacturing** | BOM + additional cost per unit, "Manufacture N" | B — BOM + Manufacturing Journal | — |
| | Consumption report | B — Movement Analysis "Manufacturing" party (`stock-reports.ts`) | — |
| **TallyPrime** | Stock journal to shop-floor godown = WIP; Godown Summary | P — any godown can hold goods; no WIP concept | R4-A1 |
| | Job costing via cost centre, Job Work Analysis | P — cost centres on documents (`cost-centres.ts`), not on stock vouchers | R4-A2 |
| **Shopify POS** | Location-specific prices (retail markets) | M — price levels per **party** only (`pricing.ts`); `Branch` has no price list | R4-B3 |
| | Transfers with In-transit tab, scan to receive | M | R4-B4 |
| | Gift cards valid at every location | M | R4-B1 |
| | Tiers / VIP (apps) | M — one dated rate (`loyalty.ts` `ruleOn`) | R4-B2 |
| | Store credit | B — POS exchange credit and "keep on account" credit notes (`pos-returns.ts`) | — |
| **Ginesys** | Franchise billing with buyer-wise pricing and credit limits | B — price levels + credit limits (`credit-limit.ts`, `credit-policy.ts`) | — |
| | Inter-store transfers with audit trail; replenishment source per store | P — STR + audit; reorder per godown makes a **PO** only (`reorder.ts`) | R4-B4, R4-B5 |
| | Purchase indent → PO → GRN with approvals | P — PO → GRN → bill (WP-3), purchase approvals (`purchase-approvals.ts`); store indent M | R4-B4 |
| **GoFrugal** | Gift vouchers, coupons, loyalty, multi-store | P — offers / schemes (`offers.ts`), loyalty points; vouchers M | R4-B1, R4-B2 |
| **Exporters** (DGFT / RBI / CBIC practice) | IEC (10-digit) and AD code on documents | M — grep `IEC` finds nothing | R4-C1 |
| | LUT valid for one FY, ARN, before first export | P — typed per invoice, no register or check (`AdvancedTaxPanel.tsx:54–57`, `FooterBlocks.tsx:244`) | R4-C1 |
| | Incoterms, port of loading / discharge, destination country, vessel, marks on the commercial invoice | P — shipping-bill no / date / port only (`ForexFields.tsx`, `freight-fx.md`) | R4-C1 |
| | Packing list with weights and CBM | B — R2-C4 (`packing.ts`) | — |
| | e-BRC self-certification against bank IRMs; realisation in 15 months | M | R4-C2 |
| | RoDTEP / drawback declared in the shipping bill, e-scrip | M | R4-C2 |
| | Refund of IGST paid on exports (shipping-bill route) | M — roadmap 7.131 open | R4-C2 (register only) |
| **Importers** | Bill of Entry: AV, BCD, SWS, IGST; duty into landed cost, IGST as ITC | P — BOE no / date, customs IGST to ledger 2311 (`postings.ts:20–22`, `books.ts:417`); no BCD / SWS | R4-C3 |
| | Freight / CHA bill applied to the import receipt later | M — only same-bill memo (`landed-cost.ts`) | R4-A5 |
| **Notion** | Trash: deleted items restorable for 30 days | P — invoice delete behind a 6 s Undo (`Transactions.tsx:328`); others permanent | R4-C4 |
| | Version history | P — field diffs in the edit log (`audit-edits.ts`), no restore | R4-C4 (restore from bin only) |
| **Accessible-toast guidance** (O'Hara, ICDS, Geist) | Actionable toast must not auto-dismiss; same action in the page | M — `Toast` auto-closes after `duration` (`Toast.tsx:22–36`) | R4-C4 |
| **MCA Rule 3(1) / Rule 11(g)** | Edit log that cannot be disabled; auditor reports it operated all year and was preserved | B — trail + chain + archives; M — per-FY auditor export (roadmap 7.49 open) | R4-C5 |
| **Ink & Switch local-first** | "The Long Now": data readable without the vendor | P — JSON backup + 7 CSV datasets (`accounting-export.ts`) | R4-C6 |
| **Figma** | Per-property merge | P — whole-row choice with a raw field hint (`SyncPanel.tsx:44–124`) | R4-C7 |

---

## 3. Gap list ranked by user value / effort

Value runs 1–5 (5 = asked for daily by many users). Effort is S = 1, M = 2, L = 3. Score = value ÷ effort; ties are
broken by value. Every item below is local-only.

| Rank | Id | Gap | Seen in | Value | Effort | Score | Package |
|---|---|---|---|---|---|---|---|
| 1 | R4-C4 | Recycle bin (30 days) + accessible, persistent Undo | Notion, a11y toast guidance | 4 | S | 4.0 | C |
| 2 | R4-C1 | Exporter profile (IEC / AD code), LUT register, export document fields | DGFT / CBIC practice, Shiprocket / DHL checklists | 4 | S | 4.0 | C |
| 3 | R4-B3 | Store price lists (per branch, dated) on POS and editor | Shopify retail markets, Ginesys | 3 | S | 3.0 | B |
| 4 | R4-B2 | Loyalty tiers and points expiry | Shopify loyalty apps, GoFrugal | 3 | S | 3.0 | B |
| 5 | R4-B5 | Store replenishment: transfer from warehouse before buying | Ginesys replenishment source | 3 | S | 3.0 | B |
| 6 | R4-A4 | QC hold godown and release / reject on receipt and production | Unicommerce | 3 | S | 3.0 | A |
| 7 | R4-C3 | Bill of Entry duty calculator → stock cost and books | Importer practice, ERPNext forum | 3 | S | 3.0 | C |
| 8 | R4-C6 | Open-format data export (every table as CSV + schema + README) | Ink & Switch, Shopify CSV export | 3 | S | 3.0 | C |
| 9 | R4-C2 | Export realisation, e-BRC and incentives register | RBI 15-month rule, DGFT eBRC, RoDTEP | 5 | M | 2.5 | C |
| 10 | R4-A1 | Production orders: release, issue to WIP, partial output, close; make to order | Katana, Deskera, Tally WIP | 4 | M | 2.0 | A |
| 11 | R4-A2 | Order costing: standard vs actual, yield, SO margin | Katana, MRPeasy, Tally Job Work Analysis | 4 | M | 2.0 | A |
| 12 | R4-A3 | Batch genealogy and recall list | Katana, MRPeasy | 4 | M | 2.0 | A |
| 13 | R4-A5 | Landed-cost voucher across bills (freight / CHA / duty) by value, qty, weight | Zoho Inventory, Odoo pattern | 4 | M | 2.0 | A |
| 14 | R4-B1 | Gift vouchers: sell, redeem as tender, balance, expiry | GoFrugal, Shopify | 4 | M | 2.0 | B |
| 15 | R4-B4 | Transfer requests, in transit, receive with shortage; Rule 55 challan + own-use e-way JSON | Zoho, Shopify / Stocky, Ginesys | 4 | M | 2.0 | B |
| 16 | R4-C5 | Auditor trail pack per FY (Rule 11(g)) | MCA rule, roadmap 7.49 | 4 | M | 2.0 | C |
| 17 | R4-C7 | Field-level sync conflict resolution with business labels | Figma | 3 | M | 1.5 | C |
| 18 | — | Work centres & routing (minutes × rate, operation status) | Katana, MRPeasy | 2 | M | 1.0 | later |
| 19 | — | ABC cycle-count schedule over Physical Stock | Unicommerce | 2 | M | 1.0 | later |
| 20 | — | Franchise royalty / fee invoices from store sales | Ginesys | 2 | M | 1.0 | later |
| 21 | — | Certificate-of-origin data sheet (preferential / non-preferential) | export checklists | 2 | S | 2.0 | later (C1 follow-up) |
| 22 | — | 3-way auto-merge of disjoint field edits (needs base rows in `sync_state`) | Figma | 3 | L | 1.0 | later |

**Overlap with earlier rounds (not re-specified):**
- Packing list with weights and CBM: R2-C4.
- Back-to-back SO → PO and backorders: R2-B5. R4-A1 adds SO → **production** only.
- Display / accessibility preferences: R2-C6. R4-C4 only fixes the timed Undo.
- Statement styles, payment terms, collections: R2-A.
- Kitchen display and table reservations: Round 3 long tail. Not taken up here.

**Dropped (network or server):**
- Katana Shop Floor App;
- Shopify cross-store gift cards;
- Unicommerce marketplace sync and handheld putaway app;
- AfterShip tracking;
- DGFT IRM / e-BRC fetch and upload;
- ICEGATE filing and e-scrip ledger sync;
- live customs exchange rates;
- loyalty SMS;
- real-time co-editing.

---

## 4. Specifications (17 items)

Conventions for every item. These are the same as Round 3.

- **Logic and tests.** Pure logic goes in `src/lib/**/*.ts`, tested with `node:test` in `tests/*.test.ts` (no browser
  APIs in tested modules).
- **Strings.** Strings go in the package's own i18n area file (`defineArea(en, hi)`; typecheck requires Hindi):
  `src/i18n/areas/production-r4.ts` (A), `stores-r4.ts` (B), `trade-trust-r4.ts` (C).
- **New data.** New persisted data is a new `mrchartist_inv_<table>` read and written through `getTable/setTable`.
  Fields are snake_case and additive.
- **New fields on existing records.** These are added by **declaration merging** in the package's own types file:
  `src/types/production-r4.ts` (A), `src/types/stores-r4.ts` (B), `src/types/trade-r4.ts` (C).
  `src/types/invoice.ts`, `src/types/purchases.ts` and `src/types/manufacturing.ts` are not edited. New
  `InvoiceRecord` keys go into `RECORD_KEYS` under the line-per-package rule in §6.
- **Guards and series.**
  - Destructive calls use `requireAccess` (`src/lib/access.ts`).
  - Writes in a locked period use `assertUnlocked` (`src/lib/period-lock.ts`).
  - Numbered series use `src/lib/series-counters.ts` with Indian-FY labels.
  - Money goes through `round2` / paise (`src/lib/invoice-calc.ts`).
  - Ledger postings go through `saveVoucher` (period lock, audit, roles), as sales commission does
    (`sales-commission.ts` `ensureCommissionAccount`).
- **Purchases contract.** Any new module that reads `purchases` is added to `tests/purchase-contract.test.ts`
  (Critical Rule 9).
- **Stock readers.** Every stock reader converts alternate units with `lineFactor` / `unitFactor`
  (`src/lib/units.ts`).
- **Registries.** New tables are registered in:
  - `RECORD_TABLES` / `ID_TABLES` (`src/lib/backup.ts`);
  - `WATCHED_TABLES` (`src/lib/audit-edits.ts`);
  - `TABLE_ACTIONS` (`src/lib/access.ts`);
  - `DATED` / `NUMBERED` in `src/lib/sync-engine.ts`, for dated or numbered tables.
- **Bundle rule.**
  - No R4 module may be imported statically by `main.tsx`, `App.tsx`, `DashboardLayout.tsx`, `Dashboard.tsx`,
    `useInvoiceStore.ts` or `NotificationBell.tsx`. The bell adds only lazy `ensure…Alerts` gates.
  - Each item states its chunk. Icons are reused only (§1).

### R4-A — Production, costing & traceability

#### R4-A1 Production orders (make to stock / make to order)

*Seen in:*
- Katana: an MO is linked to an SO line, has a status, takes partial output, and plans against actual.
- Deskera: work orders made to order or made to stock.
- Tally: materials moved to a shop-floor godown are WIP.

*Today:* `MfgJournalTab.tsx` consumes and produces on one date. `MrpTab.tsx` opens a filled Manufacturing Journal
(`?tab=mfg&make=<item>&qty=<n>`). There is no order object.

**User story.** As a small furniture or garment maker, I want to:
- open a production order for 200 units against a customer's sales order;
- issue cloth to the cutting floor;
- report 120 finished today and 80 next week;
- close the order;

so I always know what is on the floor and what each order still needs.

**Acceptance criteria.**
1. **Order.** New tab `/manufacturing?tab=orders`. Fields:
   - item, BOM (default pre-selected), planned quantity, due date;
   - optional sales order (an issued `SALES_ORDER` invoice row) and line;
   - optional production plan id;
   - optional cost centre (`cost_centres`);
   - WIP godown;
   - narration.
   Number `WO/FY<yy-yy>/<seq>` (e.g. `WO/FY26-27/0001`; `PO` is already taken by purchase orders) through
   `series-counters.ts`. The status is
   Planned → Released → In progress → Completed → Closed (or Cancelled).
2. **Release.** Release explodes the BOM for the planned quantity into **required materials** (scrap % included,
   alternate units as on the BOM). It also creates a **WIP godown** the first time: an ordinary godown named
   "Shop floor (WIP)", `kind: 'wip'` (§6). Release moves no stock.
3. **Issue materials.** This saves a normal **stock transfer** (`transfersDb`, `STR/FY…`) from the store godown to the
   WIP godown, so the engine is untouched.
   - It carries additive `production_order_id`.
   - Batch items are FEFO-allocated (`allocateFefo`) and serials go by serial.
   - Issues may be partial and repeated. The order shows required, issued and balance per component.
   - Issuing more than required is allowed, with a warning.
4. **Report output.** This saves a normal **Manufacturing Journal** (`manufacturingDb.save`).
   - It carries additive `production_order_id`.
   - Components are consumed **from the WIP godown** in proportion to the reported quantity (editable), with batches
     taken from what was issued.
   - The finished batch, serials and by-products / scrap come from the BOM.
   - Partial output is allowed. The status becomes In progress after the first output and Completed when output ≥
     planned (or "Mark completed").
5. **Return / close.**
   - "Return unused" saves an STR from WIP back to the store.
   - "Close" refuses while WIP still holds material issued to this order, unless the user chooses "Write off as
     scrap". That is a Stock Journal consume-only line tagged `production_order_id`.
   - Closing freezes the order. Reopening is logged.
6. **Make to order.**
   - From an SO, "Make to order" (a button on the Orders tab: pick an SO, see its pending lines through
     `orderFulfilment` / `pendingQuantities` in `src/lib/sales-orders.ts`) creates one order per line with a BOM.
   - From MRP, "Create production orders" makes one order per make row, instead of opening the journal.
   - The SO screen is not edited (§6).
7. **Delete rules.**
   - An order with issues or output cannot be deleted, only cancelled. Cancelling first requires the WIP to be returned
     or written off.
   - Deleting an STR or a journal that names an order is allowed through the existing guards, and the order recomputes.
8. **Bell.** A lazy gate lists orders past due and not completed, and orders Completed but not Closed for more than 7
   days.

**Files.**
- New:
  - `src/lib/production/orders.ts` (store, status machine, required / issued / output maths, issue and output
    builders);
  - `src/lib/production/order-alerts.ts`;
  - `src/components/production/{OrdersTab,OrderForm,IssueDialog,OutputDialog}.tsx`, `production.module.css`;
  - `src/types/production-r4.ts`;
  - `src/i18n/areas/production-r4.ts`;
  - `docs/features/production-r4.md`.
- Edit:
  - `src/pages/Manufacturing.tsx` (tabs `orders`, `costing`, `trace`, `qc`; lazy panels only);
  - `src/lib/manufacturing.ts` (keep `production_order_id` in normalise / save; `liveRemovalIssues` unchanged);
  - `src/lib/godowns.ts` (keep `production_order_id` on STR normalise; `kind` handling, §6);
  - `src/lib/mrp.ts` (`ordersFromMrp` helper);
  - `src/components/manufacturing/MrpTab.tsx` (one button).

**Storage.**
- Table `production_orders`: `{ id, number, date, item_id, bom_id?, planned_qty, due_date?, so_id?, so_line_id?, plan_id?, cost_centre_id?, wip_godown_id, status, closed_at?, log: {at, by, action, note?}[], narration? }`.
- Additive `production_order_id?` on `stock_transfers`, `manufacturing_vouchers` and `stock_journals` (declared in
  `src/types/production-r4.ts` by merging).
- `production_orders` is DATED (by `date`) and NUMBERED in sync. `TABLE_ACTIONS`: `books.edit`. Audit entity
  `manufacturing`.

**Bundle.** Tab chunk only. Bell gate ≈ 0.1 kB.

**Tests.** `tests/production-orders.test.ts`:
- required quantities with scrap % and alternate units;
- issue → partial output ×2 → completed;
- consumption limited to issued batches;
- close refused with WIP, close after write-off;
- cancel rules;
- MRP → orders;
- SO pending lines → orders;
- numbering across FY and the deleted-latest rule.

`tests/integration/production-orders.test.ts`: the stock engine sees the issue STR and the output MFG voucher (WIP
balance goes up, then to zero), period lock refusal, clerk / viewer roles, backup round trip, and ledger vouchers
unchanged.

#### R4-A2 Order costing: standard vs actual, yield, sales-order margin

*Seen in:*
- Katana: planned cost on open MOs, actual cost on done MOs, profit per SO.
- MRPeasy: "actuals vs planned" screens.
- Tally: Job Work Analysis and order profitability.

*Today:*
- Each journal shows a live cost roll-up and stores a display `cost_snapshot`.
- Items have dated `standard_costs` (WP-8, used only by `margin.ts`).
- Nothing aggregates by order.

**User story.** As the owner, I want to see for each production order what it should have cost, what it did cost and
why they differ, and for a made-to-order sale what I earned on it.

**Acceptance criteria.**
1. **Standard cost of an order** = planned quantity × per-unit BOM roll-up, where each component's cost is its
   `standard_costs` entry in force on the order date (`rateOn`), or else its weighted-average cost on that date (marked
   "no standard"). Additional BOM costs are not modelled on the BOM, so the standard covers materials only, plus an
   optional "standard conversion cost per unit" typed on the order.
2. **Actual cost.** It is computed live from the engine (`computeStockDetailed`):
   - consumed cost of the order's MFG vouchers;
   - plus written-off WIP;
   - plus additional costs on those vouchers;
   - minus by-product / scrap values.
   Actual output quantity = Σ finished quantity.
3. **Variances** (the textbook split, labelled "management working"):
   - **material price** = (actual rate − standard rate) × actual quantity consumed;
   - **material usage** = (actual quantity − standard quantity for the actual output) × standard rate;
   - **yield** = (planned output − actual output) × standard unit cost when the order is closed;
   - **conversion** = actual additional − standard conversion × output.
   Favourable / adverse wording comes from `ledger/budgets.ts` `variance`.
4. **Sales-order margin.**
   - Revenue: the taxable value of invoices converted from the SO (doc links), in INR through `inrValue`.
   - Cost: actual cost of the units delivered from the linked orders (output cost per unit × delivered quantity).
   - Gross margin and %.
5. **Screens.** Tab `costing`:
   - list of orders with standard, actual, variance, yield %;
   - order drill-down with component rows;
   - SO margin list;
   - CSV / XLSX through `xlsx.ts` (dynamic import).
6. **Cost centre.** An order with `cost_centre_id` adds its actual material cost as a **memo** column in Books →
   Projects. Nothing posts, because the ledger does not value stock (`docs/features/ledger.md`). The project P&L stays
   ledger-based; the memo column is labelled "materials used (stock, not posted)".

**Files.**
- New: `src/lib/production/costing.ts`, `src/components/production/{CostingTab,OrderCostCard}.tsx`.
- Edit: `src/components/books/planning/ProjectsTab.tsx`, one lazy memo column (A owns this one hunk; §6).

**Storage.** Additive `standard_conversion?` on `production_orders`. No new table.

**Bundle.** Tab chunk.

**Tests.** `tests/production-costing.test.ts`:
- hand-computed order (2 components, scrap 5%, standard ₹10 / ₹4, actual purchases at ₹11 / ₹4, output 95 of 100);
- each variance to the paisa, with the variances summing to actual − standard;
- order without standards;
- SO margin with an FX invoice;
- an order whose journal is deleted recomputes.

#### R4-A3 Batch genealogy and recall list

*Seen in:*
- Katana: "full traceability back from the product on the Sales order to manufacturing … and purchasing of
  ingredients".
- MRPeasy: lot traceability for QA.
- FSSAI / drug-recall practice.

*Today:* every movement carries the batch (`collectEvents` events with `batch`). The Manufacturing Journal records
consumed batches and the finished batch. No view joins them.

**User story.** As a food or pharma maker, when a supplier warns that a raw-material batch is bad, I want every
finished batch made from it and every customer who received those batches in one list, with phone numbers, so I can
recall within the hour.

**Acceptance criteria.**
1. **Trace backward** from a sales line, a finished batch or a serial:
   - the MFG / Stock Journal or job-work receipt that produced it;
   - the consumed component batches (recursively through sub-assemblies);
   - the purchase bill / GRN / opening stock that brought each batch in, with supplier, bill number and date.
2. **Trace forward** from a purchase batch:
   - every voucher that consumed it;
   - the batches produced;
   - every outward document (invoices, challans, POS bills, transfers to other godowns / branches, job-work out)
     carrying those batches, with quantities.
   Credit notes and returns are shown as "came back".
3. **Batch splitting.** When a voucher consumed several batches of one component, the trace keeps every edge (no
   pro-rating) and marks the output batch "mixed".
4. **Recall list.** Customers with:
   - document numbers and dates;
   - quantity per batch;
   - quantity returned;
   - phone / e-mail from the party master.
   Actions:
   - CSV;
   - a printable recall notice (A4, `html-to-image` + `jspdf` through the existing PDF path);
   - "Message all" builds `wa.me` / `mailto:` links one by one (no sending).
   - "Block batch" sets the existing expiry-style block for sale: the batch goes to a non-saleable godown by an STR
     into the QC hold godown (A4).
5. **Entry points.** Tab `trace`; a "Trace" button in Inventory → Batches & expiry (`BatchesTab.tsx`); Serial lookup
   gets the same link.
6. **Performance.** One pass over `collectEvents` builds an index (batch → producing / consuming events). 10,000
   events must trace in under 200 ms in the test harness.

**Files.**
- New: `src/lib/production/genealogy.ts` (index + traversal, cycle-safe), `src/components/production/{TraceTab,RecallList}.tsx`.
- Edit: `src/components/inventory/BatchesTab.tsx`, `SerialLookup.tsx` (one link each).

**Storage.** None. Optional `recall_notices` table: `{ id, date, batch_keys, note, notified: {party, at}[] }` logs who
was told (DATED, `books.edit`).

**Bundle.** Tab chunk.

**Tests.** `tests/genealogy.test.ts`:
- two-level BOM with batch splits;
- forward trace to invoice + challan + POS bill + transfer;
- credit-note return;
- job-work processed batch;
- cycle safety;
- the 10,000-event timing guard (soft: logs, does not fail on slow CI);
- `tests/purchase-contract.test.ts` row for `genealogy.ts`.

#### R4-A4 QC hold and release

*Seen in:* Unicommerce: GRN → quality check → putaway as good or QC-rejected stock.

*Today:*
- GRN (`receipt-notes.ts`) puts goods straight into stock.
- Rejections Out returns goods to the supplier.
- A godown can be `kind: 'expiry'` (non-saleable, `nonSaleableGodowns`, `src/lib/godowns.ts:71`).

**User story.** As a trader of electronics or food, I want received goods held in "QC hold" until checked, then
released to the store or rejected back to the supplier, so nobody sells uninspected stock.

**Acceptance criteria.**
1. **Godown kind `qc`** (non-saleable like `expiry`). The setting "Hold receipts for QC" applies per stock item (`qc_on_receipt`) or company-wide. When it is on, GRN and bill
   goods lines default to the QC godown (the user can change it).
2. **Output QC.** A production order (A1) can send output to the QC godown (order setting).
3. **QC desk.** Tab `qc` lists stock in QC godowns by item / batch / source document with age. Per line:
   - **Release**: an STR to the target godown;
   - **Reject**:
     - from a GRN or bill: opens Rejections Out or a purchase return prefilled from that document (`receipt-notes.ts`,
       `purchase-returns.ts` builders);
     - from production: a Stock Journal to the scrap item or a re-work note.
   - Optional checklist result (pass / fail, note, inspector = local user) is stored on the QC record.
4. **Sale guard.** Sales from a QC godown are refused by the existing non-saleable check (the `nonSaleableGodowns`
   set gains `qc`).
5. **Bell.** Lazy: stock in QC older than N days (setting, default 3).

**Files.**
- New: `src/lib/production/qc.ts`, `src/components/production/QcTab.tsx`.
- Edit:
  - `src/lib/godowns.ts` (`nonSaleableGodowns` includes `qc`, §6);
  - `src/lib/receipt-notes.ts` (default godown hook only);
  - `src/components/inventory/ItemFormModal.tsx` (one checkbox through `ItemMastersFields.tsx`).

**Storage.**
- Table `qc_results`: `{ id, date, item_id, batch_no?, godown_id, source: {kind, id}, qty, result: 'pass'|'fail', note?, inspector?, transfer_id?, return_id? }` (DATED, `books.edit`).
- `StockItem.qc_on_receipt?`.
- Key `qc_settings`: `{ hold_all, alert_days }`.

**Bundle.** Tab chunk. Bell gate ≈ 0.1 kB (shared with A1's gate file).

**Tests.** `tests/qc-hold.test.ts`:
- GRN into QC, sale refused, release → saleable;
- reject → Rejections Out prefill quantities;
- batch kept across the move;
- ageing alert;
- `purchase-contract` row.

#### R4-A5 Landed-cost voucher across bills

*Seen in:*
- Zoho Inventory: landed cost with a default quantity / value method (Sep 2026).
- The Odoo pattern: freight / customs bills allocated to receipts by quantity, value, weight or volume.

*Today:* `landed_costs` on a bill spread only that bill's memo charges (`landed-cost.ts`, `purchase-normalize.ts:339–374`).
A separate freight or CHA bill a week later cannot reach the goods' cost.

**User story.** As an importer or trader, I want to take the clearing agent's bill and the transporter's bill and spread
them over the goods of one or more earlier purchase bills / GRNs, so my stock cost and margins are right.

**Acceptance criteria.**
1. **Voucher.** `LCV/FY<yy-yy>/<seq>`, dated. It has:
   - **charges** picked from existing purchase bills / expense lines (non-stock lines: freight, CHA, insurance), or
     typed memo amounts;
   - **targets**: purchase bills and / or GRNs (their goods lines);
   - a method: by value (default from `inventory_settings`), quantity in base units, net weight (catalogue
     `net_weight`, `packing.ts`), or equal per line.
2. **Allocation.**
   - It reuses `allocateLandedCost` with a new `weight` / `equal` basis (the function gains two branches; the existing
     signature is kept).
   - Paisa drift goes to the largest line.
   - The preview shows ₹ per line and the new unit cost.
3. **Engine.**
   - `liveInputs()` (inventory.ts) reads `landed_cost_vouchers` and adds each allocation to the target lines'
     `landedUnit`.
   - It is effective from the **target receipt date**, so FIFO layers and averages are restated. This is the same
     "engine recomputes live" rule as back-dated purchases.
   - A charge already used on another LCV, or a bill's own `landed_costs`, cannot be allocated twice (validation).
4. **Books.** Nothing extra posts. The freight / CHA bill is already an expense in Books. The LCV only moves stock
   valuation, and the report-time closing stock (`loadStockValuer`) picks it up, as WP-8 landed cost does. The screen
   says so.
5. **Delete / lock.** Period lock on the LCV date and on the earliest target date; audit entity `purchase`;
   `books.edit`.
6. **Margin.** `margin.ts` keeps using `landedUnit`, so it sees the voucher automatically.

**Files.**
- New: `src/lib/landed-voucher.ts`, `src/components/production/LandedVoucherTab.tsx` (Inventory link "Landed cost",
  route tab `/manufacturing?tab=landed`).
- Edit:
  - `src/lib/landed-cost.ts` (two bases);
  - `src/lib/inventory.ts` (`liveInputs` hook, A only; §6);
  - `src/lib/purchase-normalize.ts` (accept an optional extra-per-line map; A only).

**Storage.** Table `landed_cost_vouchers`: `{ id, number, date, method, charges: {source: {kind:'bill'|'memo', id?, line_id?}, label, amount}[], targets: {kind:'bill'|'grn', id}[], allocation_snapshot }`. DATED and NUMBERED, `books.edit`.

**Bundle.** Tab chunk. The `liveInputs` hook is a few lines inside the already-lazy inventory engine.

**Tests.** `tests/landed-voucher.test.ts`:
- by value / qty / weight / equal on two bills;
- FIFO restatement and WAC check;
- double-use refusal;
- alternate units;
- delete restores costs;
- `purchase-contract` row.

### R4-B — Stores & chains

#### R4-B1 Gift vouchers

*Seen in:* GoFrugal (gift vouchers in the upper tiers) and Shopify (gift cards valid at every location).

*Today:* no voucher concept. POS tenders are Cash / UPI / Card / Cheque / Wallet (`src/lib/pos.ts:43`).

**User story.** As a boutique chain, I want to sell ₹1,000 / ₹2,000 gift vouchers at the counter, let the holder spend
them at any of my stores in parts, and see what is outstanding and what expired.

**Acceptance criteria.**
1. **Issue / sell.**
   - Series `GV/FY<yy-yy>/<seq>`.
   - Each voucher has a **code**: a printed number plus a 4-character check from `crypto.getRandomValues`, Code128 on
     the slip via `barcode.ts`.
   - Each voucher also has a face value, a sale date, an expiry (default 12 months, setting), the buyer (optional) and
     the issuing branch.
   - Bulk issue of N vouchers is possible.
   - Promotional vouchers (free, `promo: true`) carry no sale receipt.
2. **Sale is not a supply.**
   - Selling a voucher creates **no invoice**. Per Circular 243/37/2024-GST, transactions in vouchers are neither goods
     nor services; GST arises on the underlying supply at redemption. This needs verification with your CA.
   - The sale posts a receipt through `saveVoucher`: Dr Cash / Bank (by tender) | Cr **"Gift vouchers outstanding"**, a
     user ledger created on first use under Current liabilities, like `ensureCommissionAccount`.
3. **Redeem.**
   - New POS tender **"Gift voucher"** (scan or type the code) and a payment method of the same name in `PaymentModal`.
   - It checks the balance, expiry and that the voucher is not cancelled.
   - Partial redemption leaves a balance.
   - The invoice's taxable value is unchanged: a voucher is consideration, not a discount, unlike loyalty points.
   - The payment row carries additive `gift_voucher_id`.
   - Books: a receipt row with `gift_voucher_id` posts Dr Gift vouchers outstanding | Cr Debtors. Today
     `accountForMethod` (`books.ts:442`) sends every non-cash method to the bank, so B adds one guard in the receipt
     posting (`ledger/postings.ts`) and one in the cash / bank book (`books.ts` `buildVouchers`). These rows never
     reach the cash or bank book, and bank reconciliation never offers them (§6).
   - Promotional vouchers redeem as an **amount discount** instead (like offers, `offers.ts`), because no money was
     received.
4. **Expiry / breakage.**
   - After expiry, "Recognise unredeemed balance" posts Dr Gift vouchers outstanding | Cr "Unredeemed voucher income"
     (Other income). There is no GST (breakage is not a supply per the circular; verify with your CA).
   - It runs one journal per period, with undo.
5. **Register.** Issued, sold value, redeemed, balance, expired, by branch and period, plus a per-voucher history; CSV.
   Dashboard tile "Gift vouchers" (optional, `dashboard-tiles.ts` id).
6. **Refunds and cancellation.** Cancelling an unredeemed sold voucher refunds through a payment voucher (owner,
   `doc.delete`). Any redemption blocks cancel.

**Files.**
- New: `src/lib/retail/gift-vouchers.ts`, `src/components/retail/{GiftVouchersPanel,GiftVoucherTender,GiftVoucherSlip}.tsx`,
  `src/types/stores-r4.ts`, `src/i18n/areas/stores-r4.ts`, `docs/features/stores-r4.md`.
- Edit:
  - `src/lib/pos.ts` (`TenderMethod` gains `'Gift voucher'`, B owns this hunk; §6);
  - `src/pages/Pos.tsx` (lazy tender panel);
  - `src/components/modals/PaymentModal.tsx` (method option + lazy code field);
  - `src/lib/dashboard-tiles.ts` (tile id).

**Storage.**
- Table `gift_vouchers`: `{ id, number, code, face_value, issued_on, expires_on, promo?, buyer?, branch_id?, sale_voucher_id?, status: 'active'|'redeemed'|'expired'|'cancelled', breakage_voucher_id? }`.
- Redemptions are derived from `transactions` rows with `gift_voucher_id` (POS bills included).
- Key `gift_voucher_settings`: `{ validity_months, allow_partial, prefix }`.
- DATED by `issued_on`, NUMBERED. `TABLE_ACTIONS`: `doc.create` (issue), `doc.delete` (cancel).

**Bundle.** POS loads the tender panel lazily only when vouchers exist. Settings panel lazy.

**Tests.** `tests/gift-vouchers.test.ts`:
- code check digit and random length;
- sell → ledger receipt;
- partial redeem on POS and on an invoice;
- expired refused;
- promo voucher as discount;
- breakage journal and undo;
- cancel refused after redemption;
- Z report shows the voucher tender separately (`zReport`);
- the trial balance balances.

#### R4-B2 Loyalty tiers and points expiry

*Seen in:* Shopify loyalty apps (VIP tiers, at the register) and GoFrugal loyalty management.

*Today:* `loyalty.ts` has one dated rate (`ruleOn`), and points never expire.

**User story.** As a store owner, I want Silver / Gold customers to earn more points, and old points to lapse after 12
months, so loyalty costs stay predictable.

**Acceptance criteria.**
1. **Tiers** on the programme: `{ id, name, min_spend_12m, multiplier }`, up to 5, date-keyed like the rules (append,
   never overwrite).
   - A customer's tier on a bill date = rolling 365-day taxable spend **before** that date (sales − credit notes,
     `eligibleParty`).
   - Earning = base points × the tier multiplier, rounded down.
2. **Expiry:** `expiry_months` (absent = never). Points expire FIFO: each earn lot expires on earn date + N months, and
   redemptions consume the oldest lots first. `pointsLedger` rows gain `expires_on` and an "expired" kind.
3. **POS customer card / editor** show the tier, points, "N points expire on dd/mm", and the spend to the next tier.
4. **Liability report:** outstanding points × point value, and expiring this month (for the CA's provision, labelled
   working).
5. **Backward compatible:** with no tiers and no expiry, every balance equals today's result (regression test on the
   existing fixtures).

**Files.**
- Edit: `src/lib/loyalty.ts` (tiers, lots, expiry), `src/components/loyalty/{LoyaltyPanel,LoyaltyRedeem}.tsx`.
- New: `src/lib/retail/loyalty-tiers.ts` (lot maths, pure), `src/components/retail/LoyaltyLiability.tsx`.

**Storage.** Additive `tiers?`, `expiry_months?` in the `loyalty_program` key. No new table.

**Bundle.** Inside the existing lazy loyalty chunks.

**Tests.** `tests/loyalty-tiers.test.ts`:
- tier boundaries on the rolling window;
- multiplier rounding;
- FIFO expiry with partial redemption;
- tier rule change mid-year (old bills keep old tiers);
- regression equality without tiers.

#### R4-B3 Store price lists

*Seen in:* Shopify retail markets (different prices per retail location) and Ginesys buyer-wise pricing.

*Today:*
- Price levels attach to **parties** (`clients.price_level`).
- Stock items carry dated selling prices (`price-list.ts`).
- A branch has a profile and a godown, but no price list.

**User story.** As a chain with a mall store and a high-street store, I want the mall store's POS to charge the mall
price list automatically, while party rates still win for wholesale customers.

**Acceptance criteria.**
1. `Branch.price_level_id?`: one of the existing `price_levels`. Optional per-branch **dated overrides** per item
   (`branch_prices`: `{ branch_id, item_id, from, rate }`).
2. **Precedence in `resolvePrice`** (documented and unit-tested):
   1. typed rate;
   2. customer's own level rate;
   3. branch dated override;
   4. branch level (rate or % off);
   5. item price list (`listRateOn`);
   6. catalogue rate.
   Quantity slabs below the result still apply, and MRP-less-% follows the same order. Credit / debit notes are
   untouched.
3. **Which branch.**
   - Editor: the document's branch (`BranchSelect`).
   - POS: a device-local "This counter is branch …" choice (key `mrchartist_pos_branch`, outside the prefix, never
     backed up), defaulting to the branch of the sender profile.
4. The line note says "Store price (Mall)", as "Price list" does today.
5. Bulk edit grid: item × branch with CSV import / export (`csv.ts`).

**Files.**
- Edit:
  - `src/lib/pricing.ts` (`resolvePrice` gains an optional `branch` context, B owns; §6);
  - `src/lib/branch.ts` (field + normalise);
  - `src/components/branches/BranchesPanel.tsx`;
  - `src/pages/Pos.tsx` (branch context);
  - `src/components/settings/PricingPanel.tsx` (link to the grid).
- New: `src/lib/retail/store-prices.ts`, `src/components/retail/StorePricesGrid.tsx`.

**Storage.** Table `branch_prices` (`master.edit`, not dated). Additive `Branch.price_level_id`. Device-local
`mrchartist_pos_branch`.

**Bundle.** `pricing.ts` gains a few lines. It is in the editor / POS chunks, not the shell. Confirm with
`check:size`.

**Tests.** `tests/store-prices.test.ts`: the full precedence table, dated override switch-over, slabs after the store
price, POS branch context, and CSV round trip.

#### R4-B4 Transfer requests, in transit, receive with shortage

*Seen in:*
- Zoho Inventory: Initiate Transfer → In Transit → Mark as Received.
- Shopify / Stocky: an "In transit" tab, receiving item by item and by scan.
- Ginesys: store indents and inter-store transfers with an audit trail.

*Today:* a transfer (`STR/FY…`) moves stock instantly between godowns. Same-GSTIN branch movements print nothing and
have no e-way JSON.

**User story.** As a store manager, I want to request 20 shirts from the warehouse. As the warehouse, I want to send 18,
print the challan and e-way JSON for the truck, and see them in transit. As the store, I want to receive 17, report 1
short, and have the books and stock agree.

**Acceptance criteria.**
1. **Request** `TRQ/FY<yy-yy>/<seq>`: from-godown (supplier store / warehouse), to-godown, lines (item, qty, unit),
   needed-by date, requested by (local user). Statuses: Requested → Approved (optional, `doc.approve`) → Dispatched
   (partly / fully) → Received → Closed / Rejected.
2. **Dispatch** saves an STR from the source to the **transit godown** (`kind: 'transit'`, auto-created per receiving
   godown: "In transit → Mall"). It carries additive `request_id` and `leg: 'out'`.
   - Batches FEFO, serials by serial.
   - Prints a **delivery challan for transfer** (Rule 55 "for own use / transfer", same GSTIN). This is a new print
     built on the voucher-print layout (`voucher-print.ts`) with the transporter fields of `transport.ts`.
   - Offers **e-way JSON** with supply type outward, sub-type "For own use" and document type challan, built by a new
     `buildEwayTransfer` beside `eway-job-work.ts`. Taxable value is the cost value (no tax). The layout is unverified;
     verify with your CA.
   - Transfers between different GSTINs keep the Sec 25(4) tax invoice + bill path (`branch-transfer.ts`), and the
     request links to that pair instead.
3. **Receive** saves an STR from transit to the destination (`leg: 'in'`).
   - Per line: received, short, damaged.
   - **Short / damaged** stay in transit until resolved: "Write off" (Stock Journal consume line,
     `request_id`), "Claim from transporter" (note), or "Found" (receive later).
   - Scan-to-receive with the existing scan bar (`scan.ts`).
4. **Views.**
   - Requests list per store.
   - "In transit" tab with age.
   - Branch-wise value in transit (cost × qty).
   - Bell: in transit for more than N days, and requests past their needed-by date.
5. **Stock truth.** Goods in transit belong to the company and count in closing stock (valued in the transit godown).
   In a branch view they belong to the receiving branch (`branch-stock.ts` reads godown → branch; the transit godown
   carries `parent_id` = receiving godown).

**Files.**
- New: `src/lib/retail/transfer-requests.ts`, `src/lib/eway-transfer.ts`, `src/lib/retail/transfer-challan.ts`,
  `src/components/retail/{RequestsTab,DispatchDialog,ReceiveDialog,InTransitTab}.tsx`.
- Edit:
  - `src/components/inventory/TransfersTab.tsx` (tabs "Requests" / "In transit", lazy);
  - `src/lib/godowns.ts` (STR normalise keeps `request_id` / `leg`; godown kind `transit` is added by A's hunk, §6).

**Storage.**
- Table `transfer_requests`: `{ id, number, date, from_godown, to_godown, lines: {id, item_id, qty, unit?, unit_factor?}[], needed_by?, status, requested_by?, approved_by?, log[], dispatch_ids: string[], receipt_ids: string[], writeoff_ids?: string[] }`.
- DATED and NUMBERED, `TABLE_ACTIONS`: `doc.create` (request), `books.edit` (dispatch / receive).
- Additive `request_id`, `leg` on `stock_transfers`.

**Bundle.** Tab chunks. Bell gate ≈ 0.1 kB.

**Tests.** `tests/transfer-requests.test.ts`:
- request → dispatch 18 → receive 17 + 1 short → write-off;
- the transit godown balance goes to zero;
- batches and serials preserved;
- e-way JSON shape (sub-type, doc type, values);
- the Sec 25(4) path untouched;
- branch-stock attribution;
- period lock.

#### R4-B5 Store replenishment from the warehouse

*Seen in:* Ginesys (replenishment source per store) and Zoho (transfer orders driven by reorder).

*Today:* reorder per godown (`reorder.ts`, `reorder_by_godown`) and MRP propose **purchase orders** only.

**User story.** As the owner, I want the store's low stock to be filled from the warehouse first, and only the rest
bought, in one screen.

**Acceptance criteria.**
1. `Godown.replenish_from?` (a godown id, e.g. the warehouse). Shown in the godown form.
2. **Replenishment run** per store godown:
   - shortfall from `reorderStatus` per godown;
   - minus pending transfer requests;
   - minus goods in transit to it (B4);
   - **transfer suggestion** = min(shortfall, source free stock above the source's own reorder level);
   - the remainder is a **purchase suggestion** (MOQ, last supplier: the existing `reorder.ts` logic).
3. Actions: "Create transfer requests" (one request per source → store) and "Create purchase order" (the existing
   path).
4. Report: fill rate per store (received ÷ requested, last 90 days).

**Files.**
- Edit: `src/lib/reorder.ts` (an optional `replenishFrom` pass, B owns; A does not edit it).
- New: `src/components/retail/ReplenishTab.tsx` (tab in `/manufacturing?tab=reorder` sub-view, lazy).
- `GodownsModal.tsx` gains one select.

**Storage.** Additive `Godown.replenish_from`.

**Bundle.** Tab chunk.

**Tests.** `tests/replenish.test.ts`:
- warehouse free stock respects its own level;
- in-transit and pending requests netted;
- remainder to PO with MOQ;
- several stores competing for one source (allocated in godown sort order, documented).

### R4-C — Trade desk & trust

#### R4-C1 Exporter profile, LUT register and export document fields

*Seen in:*
- DGFT / customs practice: a 10-digit IEC and a 14-digit AD code registered on ICEGATE.
- Export checklists: Incoterms, HS, country of origin and payment terms on the commercial invoice.
- The LUT (RFD-11) is valid for one FY, filed before the first export, with an ARN.

*Today:*
- LUT number / date are typed per invoice (`AdvancedTaxPanel.tsx`) and printed in the footer (`FooterBlocks.tsx:244–246`).
- Shipping-bill number / date / port are on the document (`ForexFields.tsx`).
- No IEC, no LUT register, and no Incoterms or ports.

**User story.** As an exporter, I want my IEC and AD code on every export invoice, the right LUT filled in
automatically for the year, and a warning before I raise a zero-rated invoice without a live LUT.

**Acceptance criteria.**
1. **Profile.** `SenderProfile.iec?` (10 characters, validated alphanumeric) and `ad_code?` (14 digits), with an
   optional `ad_bank?` label. They print on export documents (EXPORT_* supply or place of supply 96 / 97) under the
   GSTIN.
2. **LUT register.** Rows `{ fy: 'FY26-27', gstin, arn, filed_on, valid_from, valid_to }`, entered in Settings → Export.
   - A new export / SEZ "without payment" invoice dated in that FY auto-fills `lut_number` = ARN and `lut_date` =
     filed date, unless the user typed one.
   - The footer is unchanged: it reads the same fields.
   - Preflight (`gst-preflight.ts` consumer, read-only) raises **LUT_MISSING** (error) for a zero-rated export with no
     LUT, and **LUT_OUTSIDE_FY** when the typed LUT's FY differs from the invoice's FY.
   - Bell (lazy): "No LUT for FY26-27 yet" from 15 March and on the first export of a new FY.
   - Wording: "under Rule 96A — verify with your CA".
3. **Export fields** (additive on `InvoiceRecord`, all optional), in an "Export details" fieldset that appears with
   the shipping-bill fields:
   - `incoterm` (EXW / FCA / FAS / FOB / CFR / CIF / CPT / CIP / DAP / DPU / DDP, list in the lib);
   - `port_of_loading`, `port_of_discharge`;
   - `country_of_origin` (default India), `country_of_destination` (ISO code + name; the e-Invoice `CntCode` is
     pre-filled from it instead of being typed in the e-Invoice modal);
   - `pre_carriage`, `vessel_flight`, `marks_numbers`, `export_payment_terms` (free text, e.g. "DA 60 days").
4. **Printing.** A lazy `<LazyExportBlock>` in `TemplateEngine.tsx` prints these fields in a compact table under the
   parties, only when any field is set. Labels follow Design Studio label overrides. It uses the `accent` variable only.
5. **Reuse.** The packing list (R2-C4) copies `marks_numbers`, ports and destination when it is made from such an
   invoice (read only, no packing-list schema change: the fields are shown from the source invoice).

**Files.**
- New:
  - `src/lib/trade/exporter.ts` (IEC / AD validation, Incoterm and country lists);
  - `src/lib/trade/lut-register.ts`, `src/lib/trade/lut-alerts.ts`;
  - `src/components/trade/{ExportSettingsPanel,ExportDetailsFields}.tsx`;
  - `src/components/templates/parts/ExportBlock.tsx`;
  - `src/types/trade-r4.ts`, `src/i18n/areas/trade-trust-r4.ts`, `docs/features/trade-trust-r4.md`.
- Edit:
  - `src/components/creator/ForexFields.tsx` (mount the fieldset lazily);
  - `src/components/creator/AdvancedTaxPanel.tsx` (LUT auto-fill hint);
  - `src/components/settings/ProfileEditor.tsx` (IEC / AD code);
  - `src/components/einvoice/EInvoiceModal.tsx` (prefill `CntCode` only);
  - `src/lib/gst-preflight.ts` (two codes, C owns this hunk).

**Storage.**
- Table `lut_register` (`settings.manage`, not dated).
- Additive `SenderProfile.iec`, `ad_code`, `ad_bank`.
- Additive `InvoiceRecord.incoterm`, `port_of_loading`, `port_of_discharge`, `country_of_origin`,
  `country_of_destination`, `pre_carriage`, `vessel_flight`, `marks_numbers`, `export_payment_terms`.

**Bundle.** The editor fieldset is lazy (export documents only). The template block is lazy. The bell gate is
≈ 0.1 kB.

**Tests.** `tests/exporter.test.ts`:
- IEC / AD validation;
- LUT pick by FY and GSTIN;
- auto-fill does not overwrite typed values;
- preflight codes;
- `CntCode` prefill;
- template block hidden without data.

The `normalizeRecord` persistence test is extended for the new keys.

#### R4-C2 Export realisation, e-BRC and incentives register

*Seen in:*
- DGFT upgraded eBRC (Trade Notice 33/2023-24): banks push IRMs, and exporters self-certify by matching IRMs to
  shipping bills / invoices.
- RBI 2025 amendment: realisation within **15 months** from the date of export.
- RoDTEP declared in the shipping bill, credited as an e-scrip, extended to 31 Dec 2026.
- Roadmap 7.131: "refund of IGST on goods exports (shipping-bill route)".

*Today:* receipts against foreign-currency invoices post realised FX gain / loss (`fx-gain.ts`). Nothing tracks
shipping bill → remittance → e-BRC or the FEMA clock.

**User story.** As an exporter, I want one register showing each shipping bill, what has been realised against it from
the bank's inward remittances, its e-BRC status, the days left in the realisation period, and the RoDTEP / drawback /
IGST refund I am still owed.

**Acceptance criteria.**
1. **Rows** come automatically from issued export invoices (EXPORT_* supply or place of supply 96) with
   `shipping_bill_no` / `shipping_bill_date` (or the invoice date when no shipping bill is typed, flagged). Per row:
   - invoice FCY value;
   - realised FCY: receipts on the invoice (`transactions`, in FCY via the receipt's realised rate) plus typed IRMs;
   - outstanding FCY;
   - due date = shipment date + period from `tax-rules.ts` key `exportRealisationMonths`: 9 months before
     the amendment date, 15 after;
   - days left;
   - status Open / Part / Realised / Overdue / Written off (with a reason).
2. **IRM / FIRC entry.**
   - Typed or CSV-imported: IRM no., date, bank, FCY amount, purpose code.
   - The CSV is downloaded by the user from the DGFT IRM repository or their bank. The column mapping goes through the
     import-mapping helper, with no network.
   - Matching suggests invoices by FCY amount, party and date. One IRM can split over invoices, and one invoice can
     take many IRMs.
   - **e-BRC** fields per match: e-BRC no., date, status (self-certified / pending).
3. **Alerts** (lazy bell): realisation due within 60 days, overdue, and shipping bill missing. The overdue note says
   that non-realisation can withdraw the export benefit / require GST payment with interest under Rule 96A, and to
   verify with your CA.
4. **Incentives.** Per shipping bill, typed rows:
   - **RoDTEP** claimed (rate %, amount), scrip no. / date, amount credited, utilised (against which Bill of Entry),
     transferred (sale value);
   - **Duty drawback** (AIR rate, amount, credited date);
   - **IGST refund** (shipping-bill route: amount, status, credited date).
   Receivable = claimed − credited. "Post" writes journals through `saveVoucher`:
   - Dr "Export incentives receivable" | Cr "Export incentives income" on claim;
   - Dr Bank | Cr Receivable on credit;
   - scrip utilisation against duty is entered from R4-C3 (Dr Customs duty | Cr Receivable).
   The ledgers are user ledgers created on first use. The tax treatment of scrip sale and incentive income needs
   verification with your CA.
5. **Outputs.**
   - Register CSV / XLSX.
   - A "for the bank" statement per party (open shipping bills with invoice, SB, FCY, realised, outstanding).
   - Year-end: the unrealised list as at 31 Mar for the notes (it feeds nothing automatically).

**Files.**
- New:
  - `src/lib/trade/export-register.ts` (derive rows, matching, statuses);
  - `src/lib/trade/export-incentives.ts`, `src/lib/trade/export-alerts.ts`;
  - `src/components/trade/{ExportDesk,IrmImport,IncentivesTab}.tsx`.
  The route is a lazy tab in `/gst-reports` Tools (`gst-tabs.ts` id `export-desk`).
- Edit: `src/lib/tax-rules.ts` (append the dated `exportRealisationMonths`, C only), `src/lib/gst-tabs.ts` (one id).

**Storage.**
- Tables:
  - `export_irms`: `{ id, irm_no, date, bank?, currency, fcy, purpose?, allocations: {invoice_id, fcy}[], ebrc_no?, ebrc_date?, ebrc_status? }`;
  - `export_incentives`: `{ id, invoice_id, kind: 'rodtep'|'drawback'|'igst_refund', claimed, rate?, scrip_no?, scrip_date?, credited?, credited_on?, utilised?: {boe_id, amount}[], transferred?: {date, value}, voucher_ids: string[] }`;
  - `export_writeoffs`: `{ invoice_id, date, reason, fcy }`.
- All three are DATED, `books.edit`.

**Bundle.** Tab chunk. Bell gate ≈ 0.1 kB (only when an export invoice exists: the gate checks a cheap flag in
`settings`).

**Tests.** `tests/export-register.test.ts`:
- 9 vs 15 month due by shipment date;
- part realisation by receipt and by IRM;
- split IRM;
- overdue status;
- CSV IRM import with column mapping;
- incentives receivable maths and journals balance;
- invoice without a shipping bill flagged.

#### R4-C3 Bill of Entry duty calculator and import costing

*Seen in:* importer practice: assessable value from CIF; BCD on AV; SWS at 10% of BCD; IGST on AV + BCD + SWS. Sources
conflict on the old 1% landing charge and on the IGST base, so the rule set is date-keyed and flagged "verify with your
CA".

*Today:*
- Import bills carry `import_type`, `boe_number`, `boe_date`.
- Customs IGST posts to ledger 2311 "IGST payable on imports (customs)" (`postings.ts:20–22`).
- BCD / SWS are not modelled.

**User story.** As an importer, I want to type the CIF value, exchange rate and duty rates from my Bill of Entry, have
the BCD / SWS / IGST computed, the duty loaded into the goods' cost, the IGST taken as ITC, and the duty payment posted.

**Acceptance criteria.**
1. **BOE sheet** on an import-of-goods bill (`BillModal.tsx` "Bill of Entry duty…" button). The sheet has:
   - header: BOE no. / date / port (existing fields), customs exchange rate (from `currency_rates`, CBIC-notified rate
     typed by the user), FOB / freight / insurance in FCY (or CIF directly);
   - per line: CTH / HSN, assessable value (allocated by value unless typed), BCD %, SWS % (default 10% of BCD,
     dated in `tax-rules.ts`), IGST %, compensation cess %, optional anti-dumping / safeguard amount.
2. **Calculation** (`boe-duty.ts`, pure):
   - AV = CIF × rate (rule `landingCharge` dated: 0 now; the historical 1% kept for old dates);
   - BCD = AV × BCD %;
   - SWS = BCD × SWS %;
   - IGST = (AV + BCD + SWS + other duties) × IGST % (base set by the dated rule);
   - cess on the same base;
   - each rounded to the rupee as customs does (rule flag).
3. **Apply.**
   - IGST and cess go into the bill's existing tax fields. ITC eligibility is unchanged, and they flow to 3B 4A(1) as
     today.
   - BCD + SWS + other duties are written as `landed_costs` rows ("BCD", "SWS", …) on the same bill, so they load stock
     cost through the existing engine path.
   - The sheet is stored on the bill (`boe_duty` snapshot).
4. **Posting.** "Post duty" writes a journal through `saveVoucher`: Dr "Customs duty on imports" (direct expense, user
   ledger) | Cr "Customs duty payable" (user ledger, Duties & taxes). The customs payment (Payment voucher) then clears
   both "Customs duty payable" and 2311.
   - **RoDTEP scrip** utilisation (R4-C2) can pay part: Dr Customs duty payable | Cr Export incentives receivable.
   - The screen says: "duty is in stock cost for valuation and an expense in the books; closing stock carries it —
     verify with your CA".
5. **Report.** Import register by BOE: AV, BCD, SWS, IGST, cess, total duty, ITC taken. CSV.

**Files.**
- New: `src/lib/trade/boe-duty.ts`, `src/components/trade/BoeDutySheet.tsx`.
- Edit: `src/components/purchases/BillModal.tsx` (button + lazy sheet; C owns this hunk), `src/lib/tax-rules.ts`
  (dated `customsSwsPct`, `customsLandingChargePct`, `customsIgstBase`; C only).

**Storage.** Additive `PurchaseRecord.boe_duty?`: `{ rate, fob?, freight?, insurance?, cif, lines: {line_id, av, bcd_pct, sws_pct, igst_pct, cess_pct?, other?}[], totals, voucher_id? }`, declared in `src/types/trade-r4.ts`. No new table.

**Bundle.** Lazy sheet inside the bill modal's chunk.

**Tests.** `tests/boe-duty.test.ts`:
- the ₹1,00,000 CIF example at 10 / 10 / 18 (₹19,980 IGST under the current rule);
- the old 1% landing rule by date;
- multi-line AV allocation;
- rupee rounding;
- landed-cost rows written and stock cost raised;
- the journal balances;
- `purchase-contract` row.

#### R4-C4 Recycle bin and accessible Undo

*Seen in:*
- Notion: 30-day Trash, restore to the original place.
- Accessibility guidance: an actionable toast must not auto-dismiss, and the same action should exist in the page.

*Today:*
- Invoice deletes wait 6 s behind an Undo toast (`Transactions.tsx:328–338`).
- `Toast` auto-closes after `duration` (`Toast.tsx:22–36`).
- Every other delete is permanent after a confirm.
- The edit log records deletes with field diffs, not whole rows.

**User story.** As a clerk who deleted the wrong bill or party, I want to find it in "Recently deleted" and restore it
in one tap. As a keyboard or screen-reader user, I want an Undo that waits for me.

**Acceptance criteria.**
1. **Capture.**
   - The audit edit observer (`audit-edits.ts`) already sees every delete on `WATCHED_TABLES` with the row before. It
     also writes the **whole deleted row** to the bin.
   - Invoices are captured in `localDb.invoices.remove` (one call, §6).
   - Attachments are kept while a bin entry references them.
2. **Bin.**
   - Settings → Data → **Recently deleted**: table, label, number, deleted by / at, and search.
   - Retention is 30 days (setting 7–90). Older entries are purged on start-up, lazily after first paint.
   - The size cap is 5 MB; past it the oldest go first.
   - Owner and clerk see their own deletes; the owner sees all.
3. **Restore.**
   - Restore puts the row back through the table's own save path where one exists (`localDb.invoices.save` with
     `skipNumbering`, `purchasesDb`, `vouchers` `saveVoucher` …), so guards run: period lock, roles, numbering.
     Otherwise it uses `setTable` with `requireTableWrite`.
   - It is refused when:
     - a live row now holds the same id or number ("INV/FY26-27/0042 has been reused");
     - the parent is gone (a payment whose invoice was deleted: restore the invoice first, offered as one action);
     - the period is locked (PIN override as usual).
   - The audit log records `restore` with the bin id.
4. **Undo toast.**
   - `Toast` with an `action` no longer auto-dismisses. It stays until dismissed, or until the next toast replaces it
     (then the action stays available in the bin).
   - Focus is not stolen. `Alt+Z` triggers the latest Undo while it is shown. `role="status"` stays polite.
   - Transactions keeps its delayed delete, but the timer starts only when the toast is dismissed or the page is left.
     Other lists (bills, vouchers, parties, items) gain "Deleted · Undo", which restores from the bin.
5. **Permanence.** "Delete permanently" (owner) and "Empty bin" ask for the PIN when any entry belongs to a locked
   period. They write an audit row.

**Files.**
- New: `src/lib/trust/recycle-bin.ts` (capture, purge, restore planners per table, pure where possible),
  `src/components/trust/{RecycleBinPanel,UndoDeleted}.tsx`.
- Edit:
  - `src/lib/audit-edits.ts` (capture hook in the observer, C owns this hunk);
  - `src/lib/localDb.ts` (one capture call in `invoices.remove`);
  - `src/components/ui/Toast.tsx` (no auto-dismiss with an action, `Alt+Z`);
  - `src/pages/Transactions.tsx` (timer rule);
  - `src/components/settings/DataPanel.tsx` (lazy panel link).

**Storage.** Table `recycle_bin`: `{ id, table, row_id, label, number?, deleted_at, deleted_by?, row: unknown, period_day? }`.
- Backed up.
- **Not synced**: a delete already syncs as a tombstone, and a restore syncs as a new version. It is added to
  `isSyncedKey`'s exclusions next to `audit_log`.
- Payroll rows are visible only with `payroll.view` (as `visibleAudit`).
- `TABLE_ACTIONS`: restore needs the table's own right.

**Bundle.** The Toast change is first paint (≈ +0.1 kB). The bin is lazy. Capture is a few lines inside
`audit-edits.ts`, which is already loaded with the audit module.

**Tests.** `tests/recycle-bin.test.ts`:
- capture on delete of a bill, voucher, client, stock item;
- invoice capture;
- restore through guards (lock refusal, reused number refusal, parent missing → combined restore);
- purge by age and size;
- payroll privacy;
- not synced, in backup.

`tests/toast.test.tsx` (render test with the existing harness): an action keeps the toast open.

#### R4-C5 Auditor trail pack per FY (Rule 11(g))

*Seen in:* the MCA proviso to Rule 3(1) (edit log, cannot be disabled); Rule 11(g) auditor reporting (the feature
existed, operated all year for all transactions, was not tampered with, and was preserved); retention of 8 years
(Sec 128(5)). Roadmap 7.49 lists "per-FY auditor export with chain head" as open.

*Today:*
- Settings → Activity: filter, CSV, Verify integrity, chain head copy / export, edit log per record, archive segments
  (`ActivityPanel.tsx`, `audit-chain.ts`, `audit.ts`).
- Nothing packages it per FY for the auditor.

**User story.** As a company owner at year-end, I want one file for my auditor that shows the edit log for the year,
proves the chain is intact, and lists deletions, back-dated entries and lock overrides.

**Acceptance criteria.**
1. **Settings → Activity → "Auditor pack…"** asks for the FY. It builds a ZIP (`zip.ts`, dynamic import) with:
   - `audit-log-FY.csv`: every row whose `at` falls in the FY, from `audit.fullRows()` (archives included), through
     `auditToCsv` with user, entity, action, document, field changes. Privacy redaction is unchanged.
   - `deletions-FY.csv`: delete rows with the before values.
   - `backdated-FY.csv`: documents and vouchers whose date is more than N days (default 7) before their create time.
   - `overrides-FY.csv`: period-lock `override` rows and approvals.
   - `integrity.txt`: the `verifyAuditChain` result over the full chain (ok / broken + where), the chain head at the
     FY end, the current head, archive segment list, restore markers in the FY, and a statement that the trail cannot
     be disabled in this app.
   - `users.csv`: local users with roles (no PIN data).
   - `README.txt` explaining each file.
2. **Head attestation.** The pack's `integrity.txt` carries its own SHA-256 (`sha256.ts`), shown on screen to note
   down, as the existing chain-head export does.
3. **Year-end checklist.** The WP-7 year-end wizard (`year-end.ts`) gains a step "Auditor pack generated" (mark only).
4. **Retention notice.** The bell warns once a year when the oldest audit row is older than 8 FYs and the user tries
   to erase. "Erase" in Settings mentions the retention duty. Verify with your CA.

**Files.**
- New: `src/lib/trust/auditor-pack.ts` (pure builders; ZIP assembly in the component), `src/components/trust/AuditorPackDialog.tsx`.
- Edit: `src/components/audit/ActivityPanel.tsx` (one button), `src/lib/year-end.ts` (one step id; C only).

**Storage.** None (the year-end mark uses the existing `year_end` table).

**Bundle.** Dialog chunk.

**Tests.** `tests/auditor-pack.test.ts`:
- FY slicing across archive segments;
- back-dated rule;
- overrides;
- integrity text for an intact chain and for a tampered row;
- payroll rows hidden without the right;
- CSV formula guard.

#### R4-C6 Open-format data export

*Seen in:* Ink & Switch "The Long Now" (data readable without the vendor); Shopify CSV exports.

*Today:* a full JSON backup (owner, `buildBackup`) and seven accounting CSV datasets (`accounting-export.ts`).

**User story.** As a user who may switch tools, or whose CA uses Excel, I want my entire company as plain spreadsheets
with a description of every column.

**Acceptance criteria.**
1. **Settings → Data → "Export everything (CSV / Excel)"** (owner, `data.backup`). It builds a ZIP with:
   - one CSV per table in `RECORD_TABLES` plus the object keys. Rows are flattened one level; nested arrays (invoice
     lines, bill lines, voucher lines) go to child CSVs (`invoices.csv` + `invoice_lines.csv` keyed by `invoice_id`),
     and deeper values become a JSON column;
   - optionally one `.xlsx` workbook with a sheet per table (`xlsx.ts`, header row bold);
   - `schema.json`: table → columns with type (string / number / date / bool / json) and a one-line meaning, generated
     from a hand-kept map with a fallback of "unknown";
   - `README.md`: what each file is, the money and date conventions (rupees with 2 decimals, local `YYYY-MM-DD`),
     and how to re-import (our own JSON backup is the only lossless import).
2. **Excluded:**
   - device-local keys;
   - sync meta;
   - vault records;
   - the recycle bin (optional checkbox);
   - attachments (optional: included as files under `attachments/` with an index CSV);
   - payroll tables without `payroll.view` (owner has it).
3. **Assets** are resolved through `getTable`, so logo / signature references become a separate `assets/` folder, not
   data URIs in cells.
4. **Size and progress.** It streams table by table with a progress line. The test data set of 2,000 invoices must
   finish in under 5 s on the CI box (soft).
5. **Safety.** CSV formula guard (`csv.ts` `toCsv`). The file name carries the company name and date.

**Files.**
- New: `src/lib/trust/open-export.ts` (flatten, schema map, file list; pure), `src/lib/trust/open-export-schema.ts`,
  `src/components/trust/OpenExportDialog.tsx`.
- Edit: `src/components/settings/DataPanel.tsx` (one button, shared with C4's link).

**Storage.** None.

**Bundle.** Dialog chunk. The schema map is in it.

**Tests.** `tests/open-export.test.ts`:
- flatten invoices into parent + lines CSVs with stable column order;
- every `RECORD_TABLES` table appears (guard test, so a new table without a schema entry is reported, not silently
  dropped);
- device-local / sync / vault keys absent;
- asset references resolved to files;
- formula guard;
- payroll exclusion.

#### R4-C7 Field-level sync conflict resolution

*Seen in:* Figma: per-property last writer wins, so edits to different properties never collide.

*Today:*
- A concurrent edit becomes a conflict.
- The user picks the whole row: "Keep mine" / "Use theirs".
- The panel shows top-level differing fields with raw keys (`SyncPanel.tsx:44–56, 98–124`).

**User story.** As an owner syncing a shop PC and a laptop, when a client was edited on both — phone on one, GSTIN on
the other — I want to keep both changes, with fields labelled in plain words.

**Acceptance criteria.**
1. **Labelled diff.** Each conflicting row shows field labels from a per-table map ("GSTIN", "Phone", "Credit limit")
   with formatted values: money via `formatCurrency`, dates via `formatDate`. Unknown fields fall back to the key.
   Privacy-hidden fields (bank, contact) show "(changed)" unless the user has `settings.manage`.
2. **Per-field pick.**
   - For **masters** (clients, vendors, catalogue, stock items, godowns, accounts, cost centres), every top-level field
     has Mine / Theirs. The result is a merged row.
   - For **documents and vouchers**, fields are grouped so totals stay consistent: "Lines, taxes & totals" is one
     group (whole choice), and "Notes / terms", "Dates & due", "Party & addresses", "Status" are separate groups.
   - Numbers (invoice number, voucher number) can never be merged from both sides. They follow the group "Number &
     date".
3. **Resolve.**
   - New resolution kind `merge` with `{ field picks }` in `resolveConflict`. It writes the merged row as a new version
     whose vector covers both sides, the same as today's resolution.
   - It re-scans first ("listing is stale" rule unchanged).
   - It needs the same rights as today, and the PIN override for a locked period.
4. **Validation** before write: documents are re-normalised (`normalizeRecord`) and recalculated, and a mismatch
   between the stored total and the recomputed total refuses with "choose lines and totals from one side".
5. **Bulk.** "Keep mine for all", "Use theirs for all" and "Merge non-overlapping masters" (applies Mine for fields
   only mine changed vs the remote, and Theirs for the rest — available only for masters, and only when the remote
   version is a direct successor of a version this device knew, which the vectors tell).

**Files.**
- New: `src/lib/trust/field-merge.ts` (field groups, labels, merge, validation; pure),
  `src/components/trust/ConflictMerge.tsx`.
- Edit: `src/lib/sync-engine.ts` (`Resolution` union + `merge` branch in `resolveConflict`, C only; §6),
  `src/components/sync/SyncPanel.tsx` (mount `ConflictMerge` lazily per conflict).

**Storage.** None (conflicts stay in `sync_conflicts`).

**Bundle.** Lazy inside the already-lazy Sync panel.

**Tests.** `tests/field-merge.test.ts`:
- client merge of disjoint fields;
- invoice groups keep totals consistent;
- number never mixed;
- stale listing refused;
- locked period needs override;
- converged vectors after both devices sync (extend `tests/sync-engine.test.ts` with one merge round trip).

---

## 5. Work packages

There are three packages, each buildable by one agent in its own worktree. Each file is owned by one package, and the
few shared touchpoints are append-only (§6). **Precondition:** the QA round 3 fixes (QA-1, QA-2) are merged, so
`Pos.tsx`, `Transactions.tsx`, `Toast.tsx` and `DataPanel.tsx` are stable.

### R4-A — Production, costing & traceability (5 items)

Items:
- **A1** production orders;
- **A2** order costing & variance;
- **A3** batch genealogy & recall;
- **A4** QC hold & release;
- **A5** landed-cost voucher.

Owned files (new):
- `src/lib/production/{orders,order-alerts,costing,genealogy,qc}.ts`
- `src/lib/landed-voucher.ts`
- `src/components/production/*`
- `src/types/production-r4.ts`
- `src/i18n/areas/production-r4.ts`
- `docs/features/production-r4.md`
- tests `production-*.test.ts`, `genealogy.test.ts`, `qc-hold.test.ts`, `landed-voucher.test.ts`

Owned files (edit):
- `src/pages/Manufacturing.tsx`
- `src/lib/manufacturing.ts`
- `src/lib/mrp.ts`, `src/components/manufacturing/MrpTab.tsx`
- `src/lib/receipt-notes.ts` (default-godown hook)
- `src/lib/landed-cost.ts`
- `src/lib/inventory.ts` (`liveInputs` hook)
- `src/lib/purchase-normalize.ts` (extra-per-line map)
- `src/components/inventory/{BatchesTab,SerialLookup,ItemFormModal,ItemMastersFields}.tsx`
- `src/components/books/planning/ProjectsTab.tsx` (memo column)

Shared (append-only, §6):
- `src/types/stock.ts` (`Godown.kind` union)
- `src/lib/godowns.ts` (A first, then B)

Icons (reuse): `Factory`, `ClipboardCheck`, `ListTree`, `ShieldAlert`, `Scale`.

First-paint delta target: ≤ +0.2 kB gz (one bell gate + `RECORD_KEYS`: none, since A adds no invoice keys).

### R4-B — Stores & chains (5 items)

Items:
- **B1** gift vouchers;
- **B2** loyalty tiers & expiry;
- **B3** store price lists;
- **B4** transfer requests & in transit;
- **B5** replenishment.

Owned files (new):
- `src/lib/retail/{gift-vouchers,loyalty-tiers,store-prices,transfer-requests,transfer-challan}.ts`
- `src/lib/eway-transfer.ts`
- `src/components/retail/*`
- `src/types/stores-r4.ts`
- `src/i18n/areas/stores-r4.ts`
- `docs/features/stores-r4.md`
- tests `gift-vouchers`, `loyalty-tiers`, `store-prices`, `transfer-requests`, `replenish`

Owned files (edit):
- `src/lib/pos.ts` (`TenderMethod` + Z-report tender row)
- `src/pages/Pos.tsx`
- `src/components/modals/PaymentModal.tsx`
- `src/lib/loyalty.ts`, `src/components/loyalty/*`
- `src/lib/pricing.ts`
- `src/lib/branch.ts`, `src/components/branches/BranchesPanel.tsx`
- `src/components/settings/PricingPanel.tsx`
- `src/components/inventory/{TransfersTab,GodownsModal}.tsx`
- `src/lib/reorder.ts`
- `src/lib/dashboard-tiles.ts`

Shared (§6):
- `src/lib/books.ts` and `src/lib/ledger/postings.ts` (one gift-voucher receipt guard each)
- `src/lib/godowns.ts` (STR normalise keys, after A)
- `src/types/stock.ts`

Icons (reuse): `Gift`, `Trophy`, `Store`, `Truck`, `ArrowLeftRight`, `Tags`.

First-paint delta target: ≤ +0.3 kB gz (`RECORD_KEYS` none; payment-method label; bell gate).

### R4-C — Trade desk & trust (7 items)

Items:
- **C1** exporter profile, LUT register & export fields;
- **C2** realisation, e-BRC & incentives register;
- **C3** Bill of Entry duty;
- **C4** recycle bin & accessible Undo;
- **C5** auditor pack;
- **C6** open-format export;
- **C7** field-level conflicts.

Owned files (new):
- `src/lib/trade/{exporter,lut-register,lut-alerts,export-register,export-incentives,export-alerts,boe-duty}.ts`
- `src/lib/trust/{recycle-bin,auditor-pack,open-export,open-export-schema,field-merge}.ts`
- `src/components/trade/*`, `src/components/trust/*`
- `src/components/templates/parts/ExportBlock.tsx`
- `src/types/trade-r4.ts`
- `src/i18n/areas/trade-trust-r4.ts`
- `docs/features/trade-trust-r4.md`
- tests listed above

Owned files (edit):
- `src/components/creator/{ForexFields,AdvancedTaxPanel}.tsx`
- `src/components/settings/{ProfileEditor,DataPanel}.tsx`
- `src/components/einvoice/EInvoiceModal.tsx` (`CntCode` prefill)
- `src/lib/gst-preflight.ts`
- `src/lib/gst-tabs.ts`
- `src/components/purchases/BillModal.tsx`
- `src/lib/tax-rules.ts` (appended dated keys)
- `src/lib/audit-edits.ts` (capture hook)
- `src/lib/localDb.ts` (one capture call)
- `src/components/ui/Toast.tsx`
- `src/pages/Transactions.tsx`
- `src/components/audit/ActivityPanel.tsx`
- `src/lib/year-end.ts`
- `src/lib/sync-engine.ts` (`Resolution`)
- `src/components/sync/SyncPanel.tsx`

Shared (§6):
- `src/components/templates/TemplateEngine.tsx` (one lazy block)
- `RECORD_KEYS`

Icons (reuse): `Globe`, `Landmark`, `FileArchive`, `Trash2`, `Undo2`, `History`, `FileDiff`, `ShieldCheck`,
`FileSpreadsheet`.

First-paint delta target: ≤ +0.4 kB gz (Toast change, `RECORD_KEYS` strings, two bell gates).

**Combined:** ≤ +0.9 kB gz first paint (≤ ~180.5 of 185 kB) and ≤ +120 kB gz total JS (≤ ~2150 of 2400 kB). Each
package runs `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` and `npm run check:size` and records the
numbers in its feature doc.

---

## 6. Shared-file protocol

Merge order: **R4-A → R4-B → R4-C**. Each later package rebases and resolves the append-only conflicts mechanically
(keep both sides).

| File | Who | Rule |
|---|---|---|
| `src/types/invoice.ts`, `purchases.ts`, `manufacturing.ts` | none | Not edited. Fields come by declaration merging: `production-r4.ts` (A: `production_order_id` on `StockTransfer` / `ManufacturingVoucher` / `StockJournal`, `StockItem.qc_on_receipt`); `stores-r4.ts` (B: `Payment.gift_voucher_id`, `Branch.price_level_id`, `Godown.replenish_from`, `StockTransfer.request_id` / `leg`); `trade-r4.ts` (C: the `InvoiceRecord` export fields, `SenderProfile.iec` / `ad_code` / `ad_bank`, `PurchaseRecord.boe_duty`). |
| `src/types/stock.ts` `Godown.kind` | A, then B reads | A changes the union once to `'van' \| 'expiry' \| 'wip' \| 'qc' \| 'transit'` (B's `transit` included, so B does not edit the line). |
| `src/lib/godowns.ts` | A, B | A: `nonSaleableGodowns` includes `qc`, `wip` and `transit` (stock there cannot be sold); STR normalise keeps `production_order_id`. B: STR normalise keeps `request_id` / `leg` (one appended line after A's). No other edits. |
| `src/store/useInvoiceStore.ts` `RECORD_KEYS` | C | Only C adds invoice keys: one new line at the end of the array with a `// R4-C` comment. A and B add none. No other store edit. |
| `src/components/templates/TemplateEngine.tsx` | C | One `<LazyExportBlock invoice={invoice} />` directly after the parties block, in its own `Suspense fallback={null}`, rendering nothing without export fields. |
| `src/lib/books.ts`, `src/lib/ledger/postings.ts` | B | One guarded hunk each for receipt rows with `gift_voucher_id`: `buildVouchers` leaves them out of the cash / bank book; the receipt posting debits the gift-voucher liability ledger (looked up by name, created by `ensureGiftVoucherAccount`) instead of cash / bank. No other edit. |
| `src/lib/pos.ts` | B | B owns this round (tender union, Z-report row). A and C do not edit it. |
| `src/lib/inventory.ts`, `purchase-normalize.ts`, `landed-cost.ts` | A | A only. C's BOE duty writes `landed_costs` rows on the bill and needs no engine change. |
| `src/lib/reorder.ts` | B | B only. |
| `src/lib/tax-rules.ts` | C | Appends dated keys (`exportRealisationMonths`, `customsSwsPct`, `customsLandingChargePct`, `customsIgstBase`) at the end; never overwrites older values. |
| `src/lib/audit-edits.ts` | A, B, C (registry); C (logic) | `WATCHED_TABLES`: one appended block per package. C alone adds the bin capture call inside the observer. |
| `src/lib/backup.ts` `RECORD_TABLES` / `ID_TABLES` | A, B, C | One appended line per package with a `// Round 4 (R4-X)` comment. A: `production_orders`, `qc_results`, `recall_notices`, `landed_cost_vouchers`. B: `gift_vouchers`, `branch_prices`, `transfer_requests`. C: `lut_register`, `export_irms`, `export_incentives`, `export_writeoffs`, `recycle_bin`. |
| `src/lib/access.ts` `TABLE_ACTIONS` | A, B, C | Same. Masters (`branch_prices`, `lut_register`) → `master.edit` / `settings.manage`; vouchers and registers → `books.edit`; `gift_vouchers` → `doc.create`; `transfer_requests` → `doc.create`; `recycle_bin` → restore checks the target table. |
| `src/lib/sync-engine.ts` `DATED` / `NUMBERED` | A, B; C (logic) | A: `production_orders` (D + N), `qc_results` (D), `landed_cost_vouchers` (D + N). B: `gift_vouchers` (D + N), `transfer_requests` (D + N). C: `export_irms`, `export_incentives` (D). C alone edits `Resolution` / `resolveConflict` and adds `recycle_bin` to the not-synced keys. |
| `src/components/command/NotificationBell.tsx` | A, B, C | Each adds its `ensure…Alerts` after `ensurePackAlerts` and one call in the poll effect, in merge order: A `ensureProductionAlerts` (orders + QC), B `ensureTransferAlerts`, C `ensureTradeAlerts` (LUT + realisation). |
| `src/components/command/CommandPalette.tsx` | A, B, C | One appended command group each ("Production / Trace / QC / Landed cost", "Gift vouchers / Transfers / Store prices", "Export desk / Recently deleted / Auditor pack / Export everything"). |
| `src/lib/gst-tabs.ts` | C | One tab id `export-desk` in the Tools group. |
| `src/pages/Manufacturing.tsx` | A (owner), B | B adds one lazy "Replenish" sub-view line in the reorder tab after A merges. |
| `src/lib/dashboard-tiles.ts` | B | One tile id `giftVouchers`. |
| `src/App.tsx`, `DashboardLayout.tsx` | lead | No new routes: all screens are tabs of existing lazy routes (`/manufacturing`, `/gst-reports`, Settings). |
| `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `AGENTS.md` | lead | Packages write only their own `docs/features/*.md`. The lead adds the Round 4 rows, the table rows and storage keys after merging. |
| `tests/purchase-contract.test.ts` | A, C | A adds `genealogy.ts`, `qc.ts`, `landed-voucher.ts`. C adds `boe-duty.ts` and `open-export.ts` (it reads purchases). One appended block each. |

Every package must pass `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` and `npm run check:size` on
its own branch, and again after rebasing on the previous package. No new runtime dependencies. No new lucide icon
names.

### New storage summary

| Key / table | Package | Kind | Backed up | Synced |
|---|---|---|---|---|
| `mrchartist_inv_production_orders` | A | rows (dated, numbered `WO/FY…`) | yes | yes |
| `mrchartist_inv_qc_results` | A | rows (dated) | yes | yes |
| `mrchartist_inv_qc_settings` | A | object | yes | yes |
| `mrchartist_inv_recall_notices` | A | rows (dated) | yes | yes |
| `mrchartist_inv_landed_cost_vouchers` | A | rows (dated, numbered `LCV/FY…`) | yes | yes |
| `mrchartist_inv_gift_vouchers` | B | rows (dated, numbered `GV/FY…`) | yes | yes |
| `mrchartist_inv_gift_voucher_settings` | B | object | yes | yes |
| `mrchartist_inv_branch_prices` | B | rows | yes | yes |
| `mrchartist_inv_transfer_requests` | B | rows (dated, numbered `TRQ/FY…`) | yes | yes |
| `mrchartist_pos_branch` | B | device-local (outside prefix) | no | no |
| `mrchartist_inv_lut_register` | C | rows | yes | yes |
| `mrchartist_inv_export_irms` | C | rows (dated) | yes | yes |
| `mrchartist_inv_export_incentives` | C | rows (dated) | yes | yes |
| `mrchartist_inv_export_writeoffs` | C | rows | yes | yes |
| `mrchartist_inv_recycle_bin` | C | rows (30-day, 5 MB cap) | yes | **no** |

New numbered series: `WO`, `LCV`, `GV`, `TRQ` (all through `series-counters.ts`, Indian FY). There is no new tax-document
series: gift vouchers are not invoices, and transfer challans reuse the request number.

---

## 7. Open questions

Statutory questions are flagged **(verify with your CA)**. Outputs stay labelled as working papers.

1. **Gift vouchers (R4-B1) (verify with your CA).**
   - Circular 243/37/2024-GST treats voucher transactions as neither goods nor services, with GST on the underlying
     supply at redemption, and breakage not a supply. Is posting the sale to a liability with no invoice right for both
     PPI and non-PPI vouchers?
   - Is Sec 12(4) really omitted from 1 Oct 2025, as a secondary source says?
   - Should a promotional (free) voucher be a discount at redemption (Sec 15(3)(a)) as proposed?
   - Is breakage income outside GST and taxable under income tax in the year of expiry?
2. **Transfers (R4-B4) (verify with your CA).**
   - Confirm the Rule 55 challan contents for same-GSTIN transfers.
   - Confirm the e-way sub-type "For own use" with doc type challan, and value at cost.
   - Is an e-way bill needed below ₹50,000 per consignment for intra-state branch movements in each state?
   - Should "short in transit" losses trigger an ITC reversal reminder (Sec 17(5)(h)), as expiry destruction does?
3. **Export realisation (R4-C2) (verify with your CA).**
   - Confirm 15 months from the date of export, the exact notification number (sources cite FEMA 23(R)(7)/2025-RB and
     10(R)(7)/2025-RB), and whether it applies to shipments made before the amendment.
   - Does the proposed FEMA (Export & Import) Regulations 2026 (18 months for INR-settled exports, from 1 Oct 2026)
     need a second dated rule?
   - What exactly does Rule 96A require on non-realisation for LUT exports (pay IGST with interest within 15 days of
     the period ending)?
   - Should the register treat SOFTEX / service exports the same way, with the invoice date as the start?
4. **Export incentives (R4-C2) (verify with your CA).**
   - Accrual of RoDTEP / drawback income on shipment vs on credit (ICDS VII / AS 9).
   - GST on the sale of RoDTEP scrips (believed exempt).
   - The accounting of scrips used against BCD.
5. **Customs duty (R4-C3) (verify with your CA).**
   - Confirm the current assessable-value rule (no 1% landing charge) and from which date.
   - Confirm the IGST base (AV + BCD + SWS + other duties, excluding cess).
   - Confirm SWS exemptions per tariff line.
   - Is expensing BCD in the books while carrying it in stock valuation the right presentation, or should duty post to
     a "Purchases — customs duty" account under Purchases so gross profit reflects it?
6. **Loyalty liability (R4-B2) (verify with your CA).** Is the outstanding-points liability report enough for Ind AS 115 /
   AS 9 entities, or should a provision journal be offered?
7. **Order costing (R4-A2).**
   - Is the materials-only standard (plus a typed conversion rate) enough, or should BOM additional costs be stored as
     standard too?
   - Should variances post to the ledger once stock valuation by journal is in place (`docs/GAP_ANALYSIS.md` P0-3)?
8. **Genealogy (R4-A3).**
   - Is "mixed batch, every edge kept" acceptable for food / drug recalls, or is quantity-weighted attribution required
     by FSSAI / CDSCO practice?
   - Should recall notices carry a regulator reference field?
9. **Recycle bin (R4-C4).**
   - Does keeping deleted rows for 30 days conflict with a user's wish to purge personal data (DPDP Act 2023)?
     Proposed: "Delete permanently" stays available to the owner.
   - Should the bin also capture rows replaced by a restore or a sync "Use theirs"?
10. **Auditor pack (R4-C5) (verify with your CA).**
    - Is a CSV + integrity text acceptable evidence for Rule 11(g), or do auditors expect a signed PDF summary?
    - Should the pack include the backup daily-copy log for Rule 3(5)? The app's backups are user-located, not
      "servers in India".
11. **Field-level merge (R4-C7).** Is "Merge non-overlapping masters" safe without a stored base version, or should it
    wait for the 3-way merge (long tail) that keeps base rows in `sync_state`?
12. **Scope.** Should the long tail — work centres / routing, ABC cycle counts, franchise royalty billing, a
    certificate-of-origin data sheet, 3-way auto-merge — form a Round 5 "shop floor & franchise" package?
