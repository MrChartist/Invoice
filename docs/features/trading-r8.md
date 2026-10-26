# Round 8 — trading businesses: TR-C (agents, tax rules, setup) and the shared API

Package TR-C of `docs/prd/round-8.md`. TR-C merges first, so it also owns the **shared registrations** that TR-A
(distributor pricing / claims / collections) and TR-B (commodity / mandi trade) build on. Everything here is a working
paper — verify with your CA (CA ids TR6–TR22 in `docs/CA_REVIEW.md`).

## 1. Shared API for TR-A and TR-B

| What | Where | Notes |
|---|---|---|
| Table / object / series names | `src/lib/trade/tr-shared.ts` (`TR_TABLES`, `TR_OBJECTS`, `TR_SERIES`) | Data only. Series `TCL`, `PDR` (A), `ARR`, `PAT`, `IND` (C). Use `nextSeriesNumberFor(TR_SERIES.x, date, existing)` + `recordSeries`. |
| Backup, sync, open-export schema | `backup.ts` (`// Round 8 (R8-A/B/C)` rows in `RECORD_TABLES` and `ID_TABLES`), `sync-engine.ts` (`DATED`, `NUMBERED`), `trust/open-export-schema.ts` | All Round 8 tables and objects of the §6 storage table are already listed. Nothing to add. |
| Rights + audit labels | `src/lib/trade/tr-registry.ts` (`TR_TABLE_ACTIONS`, `TR_WATCHED`) | **Deviation (first paint):** `TABLE_ACTIONS` (access.ts) and `WATCHED_TABLES` (audit-edits.ts) ship with first paint (+268 B gz for the R8 rows), so the rows are added at runtime by this lazy module. **Every module that writes a Round 8 table must `import './tr-registry'`** (tr-arrivals / tr-patti / tr-indents / tr-stock-statement do). The sync engine and the recycle bin import it too, so merges and restores always see the rows. `tests/tr-registry.test.ts` pins this. |
| Record / line fields | `src/types/trade-r8.ts` (one `declare module` block per package) | A: `disc_chain`, `disc_per_unit`, `cash_discount`, `price_drop_id`, `interest_run_id`, `Client.cash_discount`. B: `wt` (`LineWeight`), `charge_head_id`, `broker_id` (record, `PurchaseRecord`, `Client`, `Vendor`), `PurchaseLine.wt`. C: `agency`, `arrival_id`, `Vendor.principal_kind`, `Client.tcs_declaration`, `Client.deducts_194q`; settings `trade_kind`, `trade_discounts`, `returnable_packaging`. Edit only your own block. |
| Editor persistence | `src/store/invoice-defaults.ts` `R8_RECORD_KEYS`, `R8_LINE_KEYS` (kept by `normalizeRecord` / `normalizeItem` when present), `RECORD_KEYS` spreads `R8_RECORD_KEYS` | Done for all three packages (the PRD gave this to B; TR-C needed `agency` / `arrival_id` working first). |
| Pack ids / tabs | `industry-packs.ts`: `PackId` + `distributor`, `commodity`, `agency`; `PACK_TABS` `// R8` block; `visiblePackTabs` (reads `alsoPacks`); `shop-mode.ts` `PACK_ROUTES['/distribution']` | `PACK_OF_TYPE` unchanged: `wholesale` implies no pack. |
| Distribution tabs | `page-tabs.ts` `DISTRIBUTION_TABS` (objects `{ id, pack?, alsoPacks? }`): `claims`, `packaging` (A), `mandi`, `brokers` (B), `agency` (C) | `Distribution.tsx` lazily mounts `components/trade/{ClaimsTab,PackagingTab,MandiTab,BrokersTab}.tsx` — TR-A's two are built (see TR-A below); B's are **one-line stubs** (`export { default } from './R8Stub'`) that B replaces with a default-exported `({ onDone }) => JSX`. Views go in `?view=` (`claims`: `schemes` / `pricedrop` / `claims`). |
| Help, glossary, Ctrl+K | `topics-packs.ts` (all R8 pack tabs and views), `topics-sales.ts` (`receivables:interest`), `topics-books.ts`, `topics-purchase.ts`; `glossary.ts` (20 R8 terms); `discover-r6-tabs.ts` titles (`distribution.*`, `reports.stockstatement`, `inventory.hsn`, `receivables.interest`); `palette/synonyms.ts`; palette labels `r8.*` in `palette-destinations.ts` | A adds only its `RECEIVABLES_TABS` row `{ id: 'interest' }` — topic and title already exist. The help tests now accept `TR` CA ids. |
| Checklist | `checklist-steps.ts`: `PACK_FIRST_TABLE` distributor → `party_rates`, commodity → `trade_charge_heads`, agency → `arrivals`; steps `schemeScope` (counts `schemes` rows with `scope`), `weightItem` (stock items with `sold_by_weight_bags`), `principal`, `tradeProfile` | A / B only need to write those fields. |
| Sample data | `src/lib/demo/profile-trading.ts` `tradingExtras(ctx)` (Demo company only; loaded through `loadDemoData`, which refuses outside the marked Demo company) | A / B append their rows in the same function; extra tables must be added to `DEMO_EXTRA_TABLES`. |
| E2E | `tests/e2e/smoke.mjs` step "R8-C trade profile + agency" | A, then B, append theirs after it. |

## 2. TR-C items

**C1 Commission-agent desk** (agency pack; Distribution → Agency, views `arrivals`, `pattis`, `indents`).
- `tr-arrivals.ts`: arrivals (`ARR/FY…`, advance → payment voucher class "Arrival advance"), lots in a godown of kind
  **`consignment`** (created on first use). Decision for the append-only `Godown.kind` union: `consignment` is
  **non-saleable** in `nonSaleableGodowns`; `consignmentGodowns()` lets `saleLimitGate` pass an **agency line** (one with
  `arrival_id`) from it. **The principal's goods never enter our stock valuation**: `collectEvents` skips agency lines and
  the lot balance is derived from the arrival less its agency lines (`lotBalances`, `lotShortage`). Own stock, Books and
  the bank statement therefore stay clean (deviation from "brings goods into stock": quantity is tracked per lot, not by
  the costing engine, so weighted-average costs are never diluted by zero-cost consignment receipts).
- Editor: `LotPicker` (lazy, agency pack only) on sale lines sets `arrival_id`, the consignment godown and `agency: true`.
- `tr-patti.ts`: bikri patti (`PAT/FY…`): gross = agency lines of the chosen lots not on a live patti; deductions %,
  per bag (bags pro rata to the quantity sold), per unit, fixed; advance recovered; net payable. Post = one journal
  (class "Bikri patti"): Dr "Agency sales transferred to principals" (Sales group) gross / Cr Sundry creditors (principal)
  gross − deductions / Cr "Commission (aadat) income" / Cr other ledgers (Other income by default). Taxable aadat (goods
  other than agricultural produce, TR9) is left out of the journal and billed on a tax invoice. Cancel deletes the
  journal (recycle bin) and keeps the number. `unsettledLots` feeds the Agency notice (year-end, TR22).
- `tr-indents.ts`: indent register (`IND/FY…`), statuses placed → dispatched → paid → billed (derived from the live
  commission invoice), "Bill commission" = one draft services invoice per principal (SAC 996111, 18%, 194H preset;
  foreign principal: intermediary warning).

**C2 Trader statutory rules** — `src/lib/trading-rules.ts` (date-keyed, append-only, every row sourced; never imported by
`tax-rules.ts` or the shell, checked by an import-graph test): 206C(1) specified goods (2017 base, 14 May 2020 – 31 Mar
2021 cut, 2% from 1 Apr 2026, timber / forest produce unverified), 206C(1F) motor vehicle / luxury goods (from 22 Apr
2025), 206CC, 194Q buyer turnover, RCM notified goods (raw cotton from 15 Nov 2017, mint oils unverified), composition
tracker thresholds (limit rows mirror `COMPOSITION_LIMIT_RULES`, pinned equal by a test — importing that unused export
would have grown first paint). Helpers in `trade/tr-statutory.ts`. Wiring: editor TCS presets (`AdvancedTaxPanel` merge
line; a trading preset also sets the label so 27EQ maps it via the new `TCS_27EQ_CODES` rows; luxury-goods code left
blank, TR15), `PartyTaxHints` (Form 27C / 127 tick on the party suppresses 206C(1) presets; 206C(1F) value warning;
"customer deducts 194Q" hint), `ita2025.ts` rows `206C1` / `206C1F`, 194Q gate in `tds-payables.ts` (`tds_settings.turnover_by_fy`,
entered on TDS → Overview; at or under ₹10 crore the bill's 194Q is refused, unknown = allowed with a warning),
`RcmGoodsNotice` in the bill modal, `CompositionTracker` on GST → Compliance (composition profiles only).

**C3 Help, glossary, sample data** — see §1. Agent sample: one wheat lot of 80 bags, two agency sales, a draft patti and
two indents (`DEMO*` series).

**C4** Reports → Bank stock statement (`tr-stock-statement.ts` pure, `tr-stock-live.ts` readers, terms per bank account
in `bank_statement_settings`, print / XLSX) and Inventory → HSN stock (`tr-hsn-stock.ts`, CSV). Stock total = the books'
valuer (`loadStockValuer`, paise → ₹), creditors for goods bill-wise (purchases contract test extended), debtors aged
by bill date as on the statement date.

**C5 Trade profile** — `shop-presets.ts` `TRADE_PROFILES` / `applyTradeKind` (business type stays `wholesale`;
explicit `industry_packs`; due days / landing per kind); `TradeKindPicker` in the setup wizard (under Wholesale) and in
Settings → Features ("Custom" clears the profile, packs kept). Existing wholesale companies: unchanged, plus the
checklist step "Pick your trade".

## 3. Sizes (gz, `npm run build && npm run check:size`, vs `5cc25cb`)

| | Before | After | Δ |
|---|---|---|---|
| Initial JS | 188,740 B (184.3 kB) | 188,838 B (184.4 kB) | **+98 B** (`PACK_ROUTES` ids, `TABLE_ACTIONS` export) |
| Total JS | 2,596,928 B (2536.1 kB) | 2,640,600 B (2578.7 kB) | **+42.6 kB** |

The total is over TR-C's 11 kB share. Of it, ≈6.5 kB is shared Round 8 work done here for all packages (help topics and
glossary for A / B tabs, registries, stubs, Ctrl+K titles); the rest is the five TR-C items with Hindi (agency tab 6.0
kB, TR-C strings 5.4 kB, engines ≈9 kB, stock statement / HSN ≈4.7 kB). Lazy preload lists of the new mounts cost
≈2 kB more in host chunks (Reports, Inventory, editor, Tds). Total stays under the 2700 kB budget with ≈121 kB left for
Round 7, TR-A and TR-B (their shares: 31 + 13 + 11 kB).

## 4. Round 8 changes that touch existing CA items

- G6 / TR18: interest topic text only (TR-A builds the screen).
- T15: unchanged (194H on brokers is TR-B).
- 194Q (TR13): bills of a buyer with entered turnover ≤ ₹10 crore no longer save a 194Q deduction.

---

# TR-A — distributor pricing, claims and collections

Package TR-A of `docs/prd/round-8.md` (merged after TR-C). Strings: `src/i18n/areas/trade-r8a.ts` (English + Hindi).
Every TR-A module that writes a Round 8 table imports `./tr-registry` (listed in `tests/tr-registry.test.ts`).
Working papers — verify with your CA. TR-A's `ClaimsTab` / `PackagingTab` replace the §1 stubs (B's stay stubs).

## A. Items

**A1 Discounts, party rates, cash discount, minimum margin.**
- `tr-discounts.ts` (pure): `parseChain("18+4")` (≤ 3 steps, 0–100); `chainPercent` = 100 × (1 − Π(1 − dᵢ/100));
  `effectivePercent(chain, perUnit, rate)` = chain % + perUnit / rate × 100 (capped at 100, 6 decimals);
  `reconcileDiscount` (a % typed in the line cell clears `disc_chain` / `disc_per_unit`; a rate change re-derives the
  %). The line keeps the effective `discount_percent`; `invoice-calc.ts` is untouched (§8 Q2). Print:
  `paper-helpers.ts` `discountText` ("Disc 18 + 4 % + ₹5/unit") joins the tracking sub-line.
- Editor: `LineDiscountCell` — lazy sub-row in `ItemsTable.tsx`, with Settings → Items → *Trade discounts* or the
  distributor / commodity pack. **Deviation:** "18+4" is typed in this sub-row (`data-disc-chain`), not in the
  numeric % cell (§6: one mount line in `ItemsTable.tsx`, no other edit).
- `tr-party-rates.ts`: table `party_rates` (client or vendor × item, dated; rate and / or chain / ₹ per unit),
  `partyRateFor`, `parseBulkRates`, `lastPurchaseRate` (purchases contract: `readPurchase` / `readPurchaseLines`).
  `pricing.ts` `resolvePrice(…, partyRate)` puts the party rate first (basis "Party rate"). The editor glue
  (`pricing-actions.ts`) loads party rates and scoped schemes as one lazy chunk (`tr-pricing.ts`) so the editor's static
  graph — and the first-paint preload map — gain no file. Credit / debit notes are never re-priced (existing guard).
- `PartyRatesEditor` (Settings → Items → *Trade terms & party rates*; Distribution → Masters with the distributor /
  commodity pack): the `trade_discounts` / `returnable_packaging` switches, the company minimum margin
  (`settings.trade_min_margin`), per-group minimums (`stock_groups.min_margin_percent`, kept by `stockGroupsDb.save`,
  set by `setMinMargin`), party rates one by one or pasted ("item, rate, 18+4"), the customer's default cash-discount
  term (`Client.cash_discount`, typed "2/7"). **Deviation:** no separate Clients → party → *Special rates* panel.
- Bill modal: `BillRateHints` (lazy, trade setting / pack) — the supplier's party rate and the last purchase rate as
  tap-to-use hints; a typed rate is never changed.
- Cash discount: record `cash_discount` (editor summary strip, defaulted from the party when the party changes),
  printed under the totals by `cashDiscountText` ("2% cash discount if paid by 03-11-2026: ₹1,234.00"; one line in
  `TemplateEngine.tsx`). `settlement.ts` `settlementOptions` proposes the settlement discount (financial credit note)
  for a receipt within the days: paid × p / (100 − p) (the percent of what the receipt settles), capped at the rest.
- Minimum margin: `tr-margin.ts` (`minMarginIndex` — nearest group up the tree, else the company default;
  `marginShortfalls`). The discount sub-row flags a line below its floor. `credit-policy.ts` gained
  `registerMarginCheck`: under credit policy **Block** a clerk's document with a line below the floor is held for the
  owner (approval `reason: 'margin'`); the owner's save is audited ("Minimum margin overridden …"). `approval-gate.ts`
  (first paint) is **not** edited — the check rides the existing lazy credit gate (registered when the discount
  sub-row loads, i.e. with trade discounts on).

**A2 Scheme scope v2 and scheme claims.**
- `schemes` rows gain `scope` (`group_ids` incl. sub-groups, `item_ids`, `brand` = stock category name or a word of the
  item name, `client_ids`, `level_ids`), `free_slabs` (best slab reached), `principal_vendor_id`, `claim_basis`,
  `claim_rate` (merged into `Scheme` by `trade-r8.ts`; `schemesDb.save` keeps them). `tr-schemes.ts`
  `applyScopedSchemes` counts the paid quantity across qualifying lines and adds one ₹0 free line (the scheme's free
  item, or the cheapest qualifying item) — passed to `syncSchemeLines` as an optional callback (one guarded branch);
  unscoped schemes behave exactly as before.
- `tr-claims.ts`: `schemeClaimRows` (free lines at cost / at the selling rate / fixed ₹ per free unit; `discount_given`
  = line discount on qualifying lines; lines already on a live claim are skipped), `saveClaim` (TCL/FY…), sent /
  rejected, `deleteClaim` (draft or rejected; recycle bin; the number stays reserved), `settleClaim`: **financial**
  (default, TR4) = journal Dr Sundry creditors (principal) / Cr "Scheme claims received" (Other income, created on
  first use); **GST** = supplier credit note via `purchaseReturnsDb.create` (`SUPPLIER_CN`, reason 02, ITC reversal).
  Below the claim = *short-settled*; `unsettleClaim` removes the journal / note. CSV and a printable table.
- UI: Distribution → Claims (`ClaimsTab`, `?view=` `schemes` / `pricedrop` / `claims`). **Deviation:** scope and claim
  terms are entered on Claims → Schemes (new group / brand / party scheme form; principal + basis per existing scheme),
  not in the Settings → Items scheme dialog (which now only keeps the fields).

**A3 Price drop.** `tr-price-drop.ts`: `dropRows` (issued live sales in the window less goods returned on live credit
notes, per bill × item; pairs already on a live run are excluded, so a rerun is refused); `issuePriceDrop` (PDR/FY…,
all or nothing): **financial** notes per customer (new `financial_reason: 'price_drop'`, label "Price drop", Discount
allowed; FCN series; `price_drop_id`; bills linked by the new `doc_links` relation `price_drop` — provenance only, the
note is an on-account credit) or **GST** "rate difference" notes per bill, only when *agreed before supply* and refused
after the Sec 34(2) date (`nextFyCutoff`); `undoPriceDrop` cancels the notes (numbers kept); `stockBefore` /
`liveStockBefore` (own stock at the end of the day before the effective date); `claimPriceDrop` (one `trade_claims` row,
kind `price_drop` = notes + own stock × drop). Financial notes carry no tax, so every GST / e-Invoice / e-Way reader
skips them via `isNonGstFinancialNote`. **Deviation:** own stock is the item total, not godown-wise.

**A4 Interest.** Receivables → **Interest** (`RECEIVABLES_TABS` row `interest`, `InterestTab`, not pack-gated).
`tr-interest.ts` `partyInterest` runs `interest.ts` `computeInterest` per bill (invoices and Dr opening bills; payments
and credit notes from their dates); rate = the party's `late_fee` % p.a. → `interest_settings.rate` → none; basis due
date or bill date + the party's credit days; grace; under `min_amount` the party is listed unticked; a bill charged in
an earlier `interest_runs` row is charged only after that date (`overlaps` lists them). `raiseInterest`: one DRAFT
invoice per ticked party, one line per bill at that bill's principal GST rate / HSN (G6, TR18; opening bills take the
party's latest invoice rate), `interest_run_id`, plus the run row. Statement: view, CSV, print, WhatsApp (`wa.me`,
user-tapped). **Deviation:** the payables side is a link to the existing MSME interest card (Expenses).

**A5 Packaging.** `tr-packaging.ts`: `packaging_types`, `packaging_moves`; `packBalances` (per party × type as on a date,
FIFO ageing); `recordPackMove` (deposit + → receipt Dr cash / Cr "Packaging deposits" (Other current liabilities),
− → payment; no GST — TR8); `removePackMove` (recycle bin + its voucher; a charge's closing move cannot be deleted);
`chargeUnreturned` (draft invoice "<type> not returned" at the charge rate with the type's HSN / GST, plus an `in` move
closing them). UI: Distribution → Packaging (`PackagingTab`) and the editor summary strip (`PackagingStrip`, crates out
/ in with the document + the cash-discount term). **Deviation:** no packaging strip in the bill modal (supplier crates
are entered on the Packaging tab).

**Sample data.** `tradingExtras` adds for the distributor pack (Demo company only): an 18 + 4 % party rate, a brand
scheme paid by a principal, a crate type and three crate movements (`DEMO_EXTRA_TABLES` + `party_rates`, `schemes`,
`packaging_types`, `packaging_moves`).

## B. Tests
`tests/tr-discounts.test.ts` (chain maths / rounding, per unit, typed % clears, totals equal a typed %, party-rate
order, bulk paste, last purchase rate, cash-discount date / amount / receipt proposal, margin hold for a clerk and the
owner's audited override), `tr-schemes.test.ts`, `tr-price-drop.test.ts`, `tr-interest.test.ts`, `tr-packaging.test.ts`;
`purchase-contract.test.ts` (last purchase rate), `tr-registry.test.ts` (importers), `tr-demo.test.ts` (distributor
rows); E2E step "R8-A discounts + claims".

## C. Sizes (gz, `npm run build`, vs `0b02e52`)

| | Before | After | Δ |
|---|---|---|---|
| Initial JS | 188,964 B | 188,984 B | **+20 B** |
| Total JS | 2,665,367 B | 2,698,318 B (2635.1 kB / 2800) | **+32.2 kB** |

**Deviation (total):** over TR-A's 13 kB share. Largest pieces: Claims tab with the claim / price-drop engines 7.9 kB,
TR-A strings with Hindi ≈4 kB, Interest tab with its engine 4.0 kB, packaging engine + tab + strip 5.9 kB, party-rate
editor + engine 3.1 kB, discount sub-row 1.6 kB, schemes 1.1 kB; the rest is lazy-mount glue in host chunks.

## D. Round 8 changes that touch existing CA items
- G8 / TR1: the cash-discount term is printed; the settlement discount stays a financial note (no GST) unless the
  company's GST variant is on.
- TR3: price-drop notes default to financial; GST notes only "agreed before supply" and within Sec 34(2).
- TR4: scheme-claim settlement defaults to a financial journal; a GST supplier credit note is optional.
- G6 / TR18: bulk interest drafts take each bill's principal GST rate (opening bills: the party's latest invoice rate).
- TR8: crate deposits carry no GST (liability); unreturned crates are billed as a taxable sale.
