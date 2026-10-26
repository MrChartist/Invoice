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
| Distribution tabs | `page-tabs.ts` `DISTRIBUTION_TABS` (objects `{ id, pack?, alsoPacks? }`): `claims`, `packaging` (A), `mandi`, `brokers` (B), `agency` (C) | `Distribution.tsx` lazily mounts `components/trade/{ClaimsTab,PackagingTab,MandiTab,BrokersTab}.tsx` — **one-line stubs** (`export { default } from './R8Stub'`) that A / B replace with a default-exported `({ onDone }) => JSX`. Views go in `?view=` (`claims`: `schemes` / `pricedrop` / `claims`). |
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
