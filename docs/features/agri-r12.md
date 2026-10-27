# Round 12 — agriculture and food processing (feature notes and the API for AG-B / AG-C / AG-D)

PRD: `docs/prd/round-12.md`. CA items: `docs/CA_REVIEW.md` §12 (AG1–AG32 from the PRD; AG33–AG39 added by AG-A;
AG-B uses AG40+, AG-C AG50+, AG-D AG60+). Every GST / TDS / mandi / licence figure here is a working paper — verify
with your CA. One section per package; each package edits only its own section and records its own bundle numbers.

## AG-A — Agri profile and shared farm pieces

### What shipped

| Item | Where |
|---|---|
| A1 profile | Settings `agri_kind` (`fpo`, `coop`, `dairy`, `mill`, `cold`, `inputs`, `farm`, `other`), `mill_kind` (`rice` / `flour` / `dal` / `oil`) — additive, `types/agri-r12.ts`. **No new business type**: `shop-presets.ts` `AGRI_KINDS` / `AGRI_PROFILES` / `applyAgriKind(kind, { registered, mill_kind, currentPacks })` writes `manufacturer` (or `kirana` + `retail_kind: 'general'` for input dealers, so R9's "Pick your shop" step never fires), explicit modules (`registered` adds `gst`; every kind keeps `inventory`, so `PACK_ROUTES` is unchanged) and explicit packs (`agri` + the kind's own; `other` keeps the type / modules and adds `agri` to the packs the company has). Six packs `agri`, `dairy`, `mill`, `coldstore`, `agri_inputs`, `fpo` (`industry-packs.ts`; `PACK_OF_TYPE` unchanged). Switches and default cycles in the company object `agri_settings` (`agri/ag-settings.ts`: owner only, audited on save, backed up, synced as a singleton; object-valued keys B–D add are kept as stored) via `agri/ag-profile.ts` (`agriSwitchesFor`, `applyAgriSwitches` — fills only unset switches). Wizard: one more card "Farm, dairy & food processing" (not a type) → `AgriKindPicker` (+ mill sub-choice; the wizard's GST step answers "registered?"); Settings → Features "Agriculture profile" for every company (+ "Custom"); Features row `adv.agriProfile`, `PACK_HREF` rows. Checklist steps (`checklist-steps.ts`, append-only, only with `agri_kind`): `farmers` (every kind), dairy `rateChart` / `firstShift`, mill `millBom` / `cmrAgreement` (rice), cold `chambers` / `rentPlan`, inputs `agriLicence`, fpo / coop `shareCapital`, farm `farmBatch`. |
| Desks | `INVENTORY_PACK_TABS` (`page-tabs.ts`): `farm` (pack `agri`), `dairy`, `mill`, `cold` (`coldstore`), `inputs` (`agri_inputs`), `members` (`fpo`); `Inventory.tsx` mounts one lazy desk each (`components/agri/{Farm,Dairy,Mill,Cold,Inputs,Members}Desk.tsx`). Dairy / Mill / Cold / Inputs / Members are **stubs** (`R12Stub.tsx`) that AG-B / C / D replace in place — `Inventory.tsx` is not edited again. Every desk and view of the PRD (33 `PACK_TABS` rows) has a help topic (`topics-packs.ts`), a palette label (`r12.*` in `palette-destinations.ts`) and a Ctrl+K title (`inventory.*` in `discover-r6-tabs.ts`); synonyms for farmers / vouchers / cycles / batches. |
| A1 batches | `agri/ag-batches.ts` (table `farm_batches`, dated `start`): flock / pond / herd / crop with events; the first save creates (or reuses by name) a `project` cost centre; memo `batchMemo` (mortality %, feed kg, gained kg, FCR = feed ÷ weight gained, cost per kg). Farm → Batches; the "Agricultural income (exempt)" ledger button (`agriIncomeLedger`, Other income, AG15 / AG39). |
| A2 farmers | `agri/ag-farmers.ts`: farmers are vendors with `ag` (`AgParty`: code `F-0001`…, village, centre, member no., bank, UPI, Aadhaar **last 4 only**, KCC, language); `principal_kind: 'agriculturist'` set on every farmer (RCM prompt, patti, 6DD(e)); bank fields mirrored to the vendor's e-payment fields. `duplicateWarnings` (code, phone, bank account — soft), `searchFarmers`, `farmerBalances` (own vouchers through `readPurchase`, closed cycles' net, receivable from the client with the same `ag.code`), CSV export / import (`farmersFromRows`: loose header matching, missing code → next), centres in `agri_settings.centres`. Farm → Farmers; farmer cards (QR of the code, 8 per A4, `FarmerCard.tsx`). |
| A3 vouchers | `agri/ag-vouchers.ts`: `FPV/FY…` purchase vouchers (an ordinary `purchases` row; `ag.voucher` = centre, vehicle, quality readings, cut kg, accepted kg, charges, declaration). Line = R8 weighing `wt`; quantity = **accepted** weight in the billing unit; a price cut lowers the rate; charges reuse the R8 heads (`tr-charges.ts`, no preset rate) — *recovered from the farmer* is a less-line, *paid by us* a memo. `agri/ag-quality.ts` (table `quality_cut_tables`): per commodity, per-point cut on weight or price, cap, reject line (save refuses a reject unless "Accept anyway"). `agri/ag-tax.ts`: class suggestions (`agri-rules.ts` `AGRI_CLASS_RULES`, 42 classes, dated rows, 22 Sep 2025 rows `verified: false`), `classRateNotice`, `voucherDeclaration` (agriculturist line, or the R8 RCM line for notified goods via `tr-statutory.ts`), `prompt194q` (our turnover test + the farmer's FY purchases). Exceptions report: `AG_CLASS_RATE` (`gst-guards.ts`, one lazy hook `agri/ag-hooks.ts` loaded for agri companies). Bill form: `VoucherAgriPanel` (lazy, agri pack + farmer vendor): "Use our FPV number" and the declaration. Farm → Vouchers (make, print, pay with the cash note, delete). |
| A4 cycles | `agri/ag-cycles.ts` (pure: `cyclePeriod`, `lineNet`, `settleLines`, `cycleTotals`, `carriedIn`, `inputDeductions`, `bonusRun`) and `agri/ag-cycle-post.ts` (table `farmer_cycles`, `CYB/FY…`): draft → **close** = ONE purchase per cycle (pooled vendor "Milk producers — / Farmers — <centre>", lines per unit, `ag.cycle_id`), feed / input set-off receipts with `exchange_purchase_id` (no new marker), one deductions journal (Dr pooled vendor; Cr Sundry creditors party = the farmer for set-offs, "Farmer advances", "Share application money — members", named ledgers), journal total rolled into the bill's `amount_paid`; **pay** = one purchase payment per mode; **reopen** (closed, unpaid) removes its receipts / journal / bill through their guards (recycle bin); drafts deletable; CYB numbers never reused. `bank-upload.ts` `cycleUploadRows` (adapter, formats unchanged). Rule 6DD(e): `agri/ag-cash.ts` (pure) called by `rt-cash-guard.ts` `cashPaymentIssue(paid, date, payee?)`. Slips: `agri/ag-print.ts` `slipHtml` (A6 / 80 mm, shift table when B fills `shifts`) and `agri/ag-slips.ts` (`wa.me`, Hindi / English by the farmer's language, one tap each). Farm → Cycles. |
| A5 paper | Record key **`ag`** (`R12_RECORD_KEYS = ['ag']`, spread into `R9_RECORD_KEYS`, so `normalizeRecord` and the store's `RECORD_KEYS` keep it). `agri/ag-snapshot.ts` `agSnapshot(kind, parts)` (drops empty parts). `TemplateEngine.tsx`: `AgriBlock` (lazy; after the parties, before the GST grid; never on receipt paper unless `ag.kind === 'inputs'`; rows in `parts/agri-rows.ts`: storage / dealer / milk / custom milling / header) and `AgriStatementPage` (lazy following page: rent working, CMR statement, milk lines). `paper-helpers.ts`: `agriLineText` inside `trackingText(item, invoice.ag)` (both item tables) and `agriDeclaration` (snapshot text; loose produce on a bill of supply; exempt storage rent; interest). Small papers: FPV voucher (`voucherHtml`), farmer slip, farmer cards. |
| Demo | `demo/profile-agri.ts` (dispatched from `demo/profiles.ts` for any Demo company with the `agri` pack): A's broiler flock; B / C / D add their blocks there. `farm_batches` in `DEMO_EXTRA_TABLES`. |

### API for AG-B / AG-C / AG-D

- **Types** (`src/types/agri-r12.ts`): fill your `// AG-B` … block. AG-A declared the `ag` snapshot sub-objects for
  everyone — `milk` (`AgMilkSnap`), `cmr` (`AgCmrSnap`), `rent` (`AgRentSnap`, incl. `working` for the D2 page), `inputs`
  (`AgInputsSnap`) and per-line `ag.lines[lineId]` (`AgLineSnap`: fat / snf / litres, lot / bags / rate_bag / season,
  batch / exp / mrp_bag, text) — plus `PurchaseRecord.ag` (`voucher`, `cycle_id`, `stock_by_shift`), `Vendor.ag` /
  `Client.ag`, item `ag_class` / `ag_pack_kg` / `ag_labelled` / `ag_subsidised`, `ProductionOrder.ag.mill` (`AgMillOrder`,
  C fills it), `FarmerCycleLine.shifts` (B fills it for the slip). Do not add record keys.
- **Names** (`agri/ag-shared.ts`): add your tables to `AG_TABLES` / `AG_DATED`; move your series from
  `AG_RESERVED_SERIES` (`WBS`, `MDS`, `CMR`, `CSR`, `GPO`, `LAS`, `SHC`) into `AG_SERIES` (write the prefix once —
  `tests/ag-registry.test.ts` counts `'XXX'` literals).
- **Registry** (`agri/ag-registry.ts`): add rows in your block; every writer `import './ag-registry'`. `sync-engine.ts`
  and `trust/recycle-bin.ts` already import it. Add backup / sync (`DATED`, `NUMBERED`) / open-export rows in `// R12-B` …
  blocks.
- **Rules** (`agri-rules.ts`): your section's rows are committed with the PRD values (`MILK_DEFAULTS`,
  `OUTTURN_STANDARDS`, `MILLING_PDS_RULES`, `STORAGE_CLASS_RULES`, `FERT_SUBSIDY_DEFAULTS`, `COOP_DEDUCTION_RULES`,
  `PRODUCER_COMPANY_RULES`); append dated rows, never edit. Import only from `lib/agri/*` (`tests/ag-rules.test.ts`).
- **Desks**: replace your stub file (`DairyDesk.tsx`, `MillDesk.tsx`, `ColdDesk.tsx`, `InputsDesk.tsx`,
  `MembersDesk.tsx`) — same default export and props `{ view?: string; onDone(msg, error?) }`. Help topics, palette
  labels and Ctrl+K titles for your views exist; correct their wording in place.
- **Settings**: `readAgriSettings` / `saveAgriSettings` (`agri/ag-settings.ts`); store your sub-objects (milk, chambers,
  licences, principals, seasons) as object-valued keys — `cleanAgriSettings` keeps them as stored.
- **Snapshot / paper**: write documents through `agSnapshot(kind, { milk | cmr | rent | inputs, lines, declaration })`.
  `AgriBlock` / `AgriStatementPage` / `agriLineText` already print every field above; refine your arm in
  `parts/agri-rows.ts` if you need other labels.
- **Cycles (B)**: build milk cycle lines (`FarmerCycleLine` with `kg_fat` / `kg_snf` / `shifts`) and call
  `saveCycleDraft({ source: 'milk', … })`, then `closeCycle` / `payCycle`; deductions from `inputDeductions`. Set
  `ag.stock_by_shift` on the cycle purchase yourself (B owns the stock-reader guard).
- **Class-rate hook (C)**: plug the packing rule into `agri/ag-hooks.ts` `agExceptions` (same check, no second edit of
  `gst-guards.ts`).
- **Cash**: never add a no-cash marker — set-offs reuse `exchange_purchase_id`.

### Deviations from the PRD (AG-A)

- **Set-off journal** credits *Sundry creditors (party = the farmer)*, not a separate "Sundry creditors — exchange"
  ledger: the existing receipt posting (`ledger/postings.ts`, R9) debits Sundry creditors with the party for an
  `exchange_purchase_id` row, so this is the counter-entry that clears both sides (CA item AG33).
- **`cn-muster.ts` not edited**: its cash check is on wages to site labour, never a cultivator; Rule 6DD(e) is wired into
  the generic `rt-cash-guard.ts` `cashPaymentIssue` (optional payee) and shown on Farm → Vouchers → Pay. The existing
  Expenses payment dialog has no 40A(3) warning at all, so nothing there needed suppressing.
- **Farmer import**: the Farmers view imports CSV through `csv.ts` `parseTable` with its own column mapping
  (`farmersFromRows`) instead of a new entity in the generic import wizard (whose schemas / appliers would need a new
  kind); XLSX: save as CSV.
- **Vendor / client form "Farmer" section** not added: farmers are created and edited on Farm → Farmers (the vendor form
  keeps working for their ordinary fields).
- **Bonus / price-difference run** is a CSV working (`bonusRun`); the draft journal is entered by the user (AG38).
- **Charges paid by us** are a memo on the voucher (booked separately), recovered ones a less-line (AG34, AG35).
- **AgriBlock on the GST layout** sits just before the GST grid (the GST grid owns its party panel); on the other layouts
  after the party panel.

### Bundle (AG-A)

Measured with `vite build` + gzip -9 (the budget script's method), before = `claude/elegant-cannon-cwapiv` at `0b65bcc`,
after = this branch merged with it.

| Budget | Before | After | Delta | Share |
|---|---|---|---|---|
| Initial JS (first paint) | 189,147 B (184.71 kB) | 189,162 B (184.73 kB) | **+15 B** | ≤ +0.05 kB ✓ |
| Total JS | 3,078,416 B (3006.3 kB) | 3,126,902 B (3053.6 kB) | **+48,486 B (+47.3 kB)** | ≤ 11 kB ✗ |

**Overrun: +36 kB over AG-A's 11 kB share** (total stays under the 3200 kB limit: 3053.6 kB). Breakdown (gz, by chunk):
views 15.4 kB (Cycles 2.9, Vouchers 2.7, Farmers 2.4, Batches 2.1, FarmDesk 1.8 — mostly its preload map —, Quality 1.2,
FarmerCard 0.8, VoucherAgriPanel 0.4, agri-util 0.7, five desk stubs + R12Stub 1.4); engines 15.2 kB (ag-cycle-post +
ag-cycles 3.7, ag-tax + agri-rules 2.3, ag-farmers 2.2, ag-print 1.7, ag-vouchers 1.6, ag-settings 1.1, ag-quality 1.0,
ag-profile 0.5, registry / hooks / shared / demo 1.1); desk strings `agri-r12a` 3.6 kB (English + Hindi); help topics
for all 33 R12 desk / view rows 2.5 kB, glossary 0.7 kB, palette labels 1.0 kB, Ctrl+K titles / synonyms 0.6 kB, reach
strings (packs, checklist) 1.2 kB, picker strings + wizard / features wiring 2.2 kB; paper parts 1.7 kB (AgriBlock,
AgriStatementPage, css); chunk splits caused by new importers 1.2 kB (`tr-charges`, `bank-upload` now shared chunks);
the rest (checklist, shop-presets, industry-packs, gst-guards, Inventory, TemplateEngine wiring) ≈ 3 kB. The PRD's 11 kB
assumed AG-A would mostly configure existing screens; A2–A4 needed four new working views (farmers, vouchers, cycles,
quality) plus the cycle posting engine. Trimming options for the lead: merge the five Farm views into one chunk
(≈ −1.5 kB of preload maps), drop the farmer cards / CSV import (≈ −1.5 kB), or the fallback raise in the PRD §1.

## AG-B — Dairy and milk collection (pack `dairy`)

Inventory → **Dairy** (`/inventory?tab=dairy&view=`): `charts`, `collection`, `bills`, `dispatch`, `products`, `cards`.
One lazy chunk (`DairyDesk.tsx` with its views, engines and the `agri-r12b` strings); nothing is read until the tab opens.

| Item | What it does | Code |
|---|---|---|
| B1 rate charts | Table `milk_rate_charts` (`master.edit`, dated `effective_from`). Bases `matrix` (nearest lower step, or nearest), `fat_kg`, `ts_kg`, `two_axis`, `flat`; minimum fat / SNF with reject / flat / deduct; add-ons by shift, milk kind and quantity; `buyer_id` marks a union's chart (B4). Append-only: a new chart closes the open one of the same milk / centres / buyer the day before; a chart used by an entry cannot be edited or deleted. Matrix in / out as CSV and XLSX, heat preview, "test a sample". kg = L × (1 + CLR / 1000), CLR default 28 cow / 30 buffalo (`MILK_DEFAULTS`). | `agri/ag-rate-chart.ts`, `RateChartsView.tsx` |
| B2 shift sheet | Table `milk_shifts`: **one row per centre per date per shift** with an `entries` array (300 farmers × 365 days = 730 rows; a day reads ≤ 2). Each entry stores chart id, rate and amount (never repriced). Rejected cans: quantity, zero amount, reason. A second can of a farmer in the shift needs "Add again". Close posts the accepted litres per milk kind into the centre godown as ONE stock journal (`SJ/FY…`, production lines at the shift's ₹ / L, tagged `milk_ref`, `books.edit`); reopen removes it (refused while a closed / paid cycle billed the shift). Analyser: plain ASCII over Web Serial (`ag-analyser.ts`, presets generic CSV / key=value, field order, separator, fixed-point divisor, baud), device-local `mrchartist_milk_analyser` (set in `AnalyserSetup.tsx` on the Collection view); can weight from the existing scale reader. Slip 58 / 80 mm (HTML print), optional `wa.me` message per can (setting, off by default). | `agri/ag-shifts.ts`, `ag-analyser.ts`, `CollectionView.tsx`, `CollectionEntry.tsx`, `AnalyserSetup.tsx` |
| B3 milk bills | `buildMilkCycle(centre, from, to)` → one line per farmer (litres, kg fat, kg SNF, amount, shift-wise snapshot, carried-in, feed / input deductions, bank / cash mode) on AG-A4's `farmer_cycles`; an unclosed shift blocks. `closeMilkCycle` closes through A4 (one exempt pooled purchase) and marks it `ag.stock_by_shift`. Farmer bills (A5 pages) print from the cycle row only; summary by farmer / village / route with "no supply". Paying, the bank file and slips are A4's (Farm → Cycles). | `agri/ag-milk-cycle.ts`, `MilkBillsView.tsx` |
| B4 dispatch | Table `milk_dispatches` (`MDS/FY…`): saving takes the milk out of the centre godown (consume-only stock journal, remade when the sent figures change); the union's acknowledgement; "Bill" raises a nil-rated **bill of supply** at the buyer's chart on the received figures (setting `invoice_from`), with the `ag` snapshot (`kind: 'milk_sale'`, tanker, shift, kg fat, kg SNF, chart name; per-line fat / SNF / litres). Reconciliation by day / month: collected vs sent vs received, milk-card litres as local outflow, centre gap, transit shortage and its % of kg fat, flag beyond the tolerance (0.5% default). | `agri/ag-dispatch.ts`, `ag-milk-reco.ts`, `DispatchView.tsx` |
| B5 products, cards | Starter BOMs (paneer + whey, khoa, curd, ghee + residue, buttermilk; typical yields "practice — adjust") with the A3 classes (paneer nil / ghee 5% from 22 Sep 2025); fat memo. Table `milk_cards` (one per customer per month, default litres, day overrides, 0 = skipped); "Bill month" → one bill of supply per card ("29 days · 29.5 L"), re-billing refused; "Copy last month". | `agri/ag-dairy-products.ts`, `ag-milk-cards.ts`, `ProductsView.tsx`, `MilkCardsView.tsx` |

**No double counting (AG28).** Milk enters stock per closed shift; the pooled cycle purchase is the ledger posting and
the stock reader skips it through ONE guarded line in `collectEvents` (`inventory.ts`): `if (p.ag?.stock_by_shift)
continue`. `tests/purchase-contract.test.ts` and `tests/ag-shifts.test.ts` prove the stock stays at the shifts' litres
after the cycle purchase is written.

**Rights, audit, bin, backup.** `ag-registry.ts` block AG-B: charts `master.edit`; shifts, dispatches, cards
`doc.create` (closing a shift / saving a dispatch also writes a stock journal: `books.edit`). All four tables audited,
backed up, synced (`DATED`: charts by `effective_from`, shifts and dispatches by `date`; `NUMBERED`: dispatches) and in
the open-export schema. Restore rules (`trust/recycle-bin.ts`): a dispatch only with its stock journal (journals are not
binned, so: enter it again); a milk card not next to a re-made card of the same customer and month. No new no-cash
marker (feed set-off is A4's `exchange_purchase_id`).

**CA items.** AG40–AG45 (`docs/CA_REVIEW.md` §12.5).

**Tests.** `ag-rate-chart`, `ag-analyser`, `ag-shifts`, `ag-milk-cycle`, `ag-dispatch`, `ag-milk-cards`,
`ag-dairy-products` (+ a `purchase-contract` case). E2E step "R12-B dairy desk".

**Centres.** The desk uses the milk centres of `agri_settings.centres` (kind `milk`, each with its godown); with none set
up it works on one built-in "Main centre" (id `main`, the Main godown), so a single-centre society needs no setup. Settings
sub-object `agri_settings.milk` (`AgMilkSettings`): stock item per milk kind (created on first close: "Cow milk" …, LTR,
HSN 0401, class `milk_fresh`), CLR, tolerance, bill basis, WhatsApp-per-can switch.

**Sample data.** `profile-agri.ts` AG-B block (pack `dairy`): 12 farmers (vendors, codes F-0001…), a cow matrix chart,
20 days × 2 closed shifts at the Main centre (sample rows: no stock journal), one acknowledged dispatch, one milk card.
`DEMO_EXTRA_TABLES` gains `vendors` and the four dairy tables.

### Deviations from the PRD (AG-B)

- **One chunk, not a sub-chunk per view**: the desk, its six views, engines and strings load as ONE lazy chunk (gzip
  shares their vocabulary: ≈ 6 kB less than a chunk per view), the R9 `JewelleryDesk` pattern.
- **Device settings row not added**: a lazy analyser row in the POS device settings (`RetailSettings.tsx`) split the
  dairy strings into a second chunk (+6.6 kB); the analyser profile is set on Dairy → Collection instead (same
  device-local key).
- **Slips print as HTML** (58 / 80 mm page) through the print dialog, not through the ESC/POS byte path.
- **Shift stock journal written directly** (`milkJournal` in `ag-shifts.ts`: role `books.edit`, period lock, `SJ`
  series, audit): `stockJournalsDb.save` requires a source line and a shift receipt has none. Closing a shift therefore
  needs `books.edit` (a clerk can enter cans; the owner / accountant closes).
- **Stock journals are not in the recycle bin** (not a watched table), so a deleted dispatch cannot be restored — enter
  it again (restore rule refuses with that message).
- **Rate-chart import / export**: CSV both ways; XLSX import (via `xlsxToCsv`); no XLSX export (trimmed for the budget).
- **Union deductions on its payment** are the existing short-payment handling on the receipt (no new screen).

### Bundle (AG-B)

`vite build` + gzip -9, before = `claude/elegant-cannon-cwapiv` at `43b397e` (AG-A + AG-C merged), after = this branch.

| Budget | Before | After | Delta |
|---|---|---|---|
| Initial JS (first paint) | 189,186 B | 189,182 B | **−4 B** (≤ +0.03 kB ✓) |
| Total JS | 3,156,623 B (3082.6 kB) | 3,179,237 B (3104.7 kB) | **+22,614 B (+22.1 kB)** |

**Overrun: +14.1 kB over the 8 kB share** (inside the lead's ≤ 25 kB cap; total 3104.7 / 3200 kB). The DairyDesk chunk
is 21.6 kB; the rest is shared-file growth (help topics +0.3, demo block +0.8, `ag-snapshot` now a shared chunk +0.3,
open-export / recycle-bin / registry / sync rows +0.5). Per-module gzip measured alone (sum 31.9 kB; ≈ 0.68 of that
once bundled in one chunk): strings `agri-r12b` (English + Hindi) 3.7; engines 14.9 (`ag-shifts` 2.6, `ag-milk-cycle`
2.4, `ag-dispatch` 2.3, `ag-rate-chart` 2.1, `ag-milk-cards` 1.4, `ag-analyser` 1.2, `ag-milk-reco` 0.9,
`ag-dairy-products` 0.9); views 13.3 (RateCharts 2.3, Dispatch 2.3, Collection 2.1, MilkCards 1.5, MilkBills 1.5,
CollectionEntry 1.3, Products 1.0, desk / kit / ui / analyser setup 2.5). The 8 kB share assumed B mostly configures
existing engines; the rate-chart engine, the shift sheet with devices, dispatch billing and reconciliation and the card
grid are new. Further trims for the lead: drop the products view (≈ −1.3 kB), the add-ons / heat preview (≈ −0.4 kB) or
shorten Hindi strings.

## AG-C — Mills: rice, flour, dal, oil (pack `mill`)

### What shipped

| Item | Where |
|---|---|
| C1 intake | Table `weighbridge_slips` (`WBS/FY…`, `doc.create`, dated `date`, numbered): `agri/ag-weighbridge.ts` (`openSlip` = first weighing, `recordTare` = second weighing → `net = gross − tare`, `setReadings`, `cancelSlip` (number kept, prints "CANCELLED"), `deleteSlip` (unused only; recycle bin, number reserved), `markUsed` / `releaseSlip`, `receiveForJob` → a JWP receipt). Pure: `slipNet`, `cleanReadings`, `openSlips` (> 24 h flagged), `dailyIntake` (by commodity / party kind / use, net-weighted moisture), `voucherPrefill` (net as QTL, bags, the R8 `wt` weighing with the vehicle net as gross, readings → quality cuts), `slipHtml` (A5 small paper: both weighings with times, net, readings, "Subject to quality cut"). View `components/agri/IntakeView.tsx`: first weighing, open slips with tare (Web Serial scale via `scale-serial.ts` on demand, or typed), the day's slips (Print, Make voucher, Receive for CMR, Receive for job milling, Cancel), daily intake. |
| C2 milling batches | Starters `agri/ag-mill-bom.ts` (`MILL_STARTERS` rice / flour / dal / oil per 100 of input, `starterBom`, `installMillStarter` — items reused by name or created in QTL with their `ag_class`, BOM saved through `bomsDb`, default for the main item; "practice — adjust"). A batch is an ordinary production order with `ag.mill` (`MillOrderMeta`: moisture in / out, `standard_outturn_pct`, `std_source`), saved by `agri/ag-yield.ts` `setMillMeta` (`books.edit`). Yield read from the order's manufacturing journals only: `voucherFigures` (components via `lineFactor`, kg via `kgPer`), `batchYield`, `yieldOf` (outturn = main + co-products, by-product %, loss, moisture loss `in × (m_in − m_out) ÷ (100 − m_out)`, unexplained, cost per unit from the engine's `cost_snapshot`, flag beyond `OUTTURN_STANDARDS.tolerance_pts`). Panel `components/agri/YieldPanel.tsx` mounted lazily by `production/OrdersTab.tsx` with the `mill` pack; view `MillBatchesView.tsx` (starter, batch list with outturn / standard / flag). |
| C3 CMR and job milling | Table `cmr_agreements` (`doc.create`): `agri/ag-cmr.ts`. Paddy lots are JWP receipts (`principalDb`, register only — never stock); a delivery (`CMR/FY…`, lot / ACK no., fortified) is a JWP return of the paddy milled (rice ÷ outturn, `processed`). `cmrAccount` (paddy, due, delivered, balance, % complete, days left / overdue, by-product recovery due, charges earned). `pdsTest` (Circular 153: goods ≤ 25% of the value → exempt, else 5%; boundary in), `millingChargesInvoice` (draft bill of supply when exempt, tax invoice at 5% otherwise, lines classed `milling_pds`, `ag.cmr` snapshot), `jobMillingRate` / `jobMillingInvoice` (`jobChargesLine`, class `job_milling`, 5% for a registered principal, typed rate otherwise — AG10). `job-work.ts` is used read-only (no edit). View `CmrView.tsx`. |
| C4 packing rule | `agri/ag-packing.ts` (pure): `packClass` (labelled and ≤ 25 kg / 25 L → packed class, exactly 25 in; else loose; `counterLoose` for a retail sale from a larger bag), `endUseClass` / `needsEndUse` (bran, oil cake as feed or not), `suggestLine` (class → rate / HSN by date from `AGRI_CLASS_RULES`, with the N 6/2022 note), `ewayHint` (exempt-only goods → "may not be needed — verify AG12"; taxable goods over ₹50,000 → prompt; the value test on the taxable lines). Item fields `ag_pack_kg`, `ag_labelled` (and `ag_class`) on stock items through the lazy `components/agri/PackSizeRow.tsx` in the stock item form (mill / agri pack, or already set). The class-rate notice in `gst-guards.ts` is AG-A's hook; it calls `suggestLine` (no second edit). |
| C5 reports | `agri/ag-mill-reports.ts`: `millMonths` (intake own — purchases of the batches' input items through `readPurchase` / `readPurchaseLines`, CMR lots, job receipts; milled; outputs by kind; outturn vs input-weighted standard; moisture loss; flagged batches; by-product realisation from issued sales), `realisation`, `millGroup` / `millStockGroups` (preset `STOCK_STATEMENT_PRESETS.mill` added to `trade/tr-stock-statement.ts` — one constant, the working unchanged), `principalMemo` (JWP pending, quintals and typed value), `loadMillStockStatement` (TR-C4 input regrouped; principals' material as a memo). View `YieldView.tsx` (monthly table, realisation, stock statement; CSV / XLSX). Oil mills read outturn as oil yield and by-product % as cake. |

### Storage (R12-C)

| Key / field | Kind | Backed up | Synced | Audited | Right |
|---|---|---|---|---|---|
| `weighbridge_slips` (`WBS`) | table, dated `date`, numbered | yes | yes (`DATED`, `NUMBERED`) | yes | `doc.create` |
| `cmr_agreements` (`CMR` on deliveries, inside the row) | table | yes | yes | yes | `doc.create` |
| `ProductionOrder.ag.mill`; item `ag_pack_kg`, `ag_labelled`; invoice `ag.cmr` | additive | yes | yes | yes | — |

Deletes go through the data layer: an unused slip and an agreement without lots / deliveries go to the recycle bin
(restore needs no module hook: nothing else names them); a lot / delivery is removed with its JWP row through
`principalDb.remove` (its own guards); WBS / CMR numbers stay reserved. Writers import `./ag-registry`.

### Rules (`agri-rules.ts`, section AG-C)

`OUTTURN_STANDARDS` (CMR 67 raw / 68 parboiled — agency norm, CAG 2015, `verified: false`), `OWN_OUTTURN_STARTERS`
(own-mill starters rice 67, flour 82, dal 76, oil 33; flag tolerance 1 point — practice), `MILLING_PDS_RULES` (goods ≤
25% → exempt entry 3A, else 5%, from 2021-06-17, Circular 153 — `verified: true`), `JOB_MILLING_RULES` (5% registered,
unregistered `null` → typed, AG10). SACs come from AG-A's class rows (`agClassAt('milling_pds' | 'job_milling')`);
the 25 kg line from `PACKED_25KG_RULES`.

### Wiring to AG-A

- **Make voucher** (Intake): `voucherFromSlip(slip, { vendor, rate, tare_per_bag, params })` calls AG-A3's
  `saveVoucher` (FPV/FY…, quality cuts from the commodity's table via `qualityTableFor`) with the slip's net weight as the
  R8 weighing, bags, readings, vehicle and `wbs_id`, and marks the slip used — one tap from the slip, no edit of AG-A's
  view. Offered for slips whose party is a farmer vendor.
- **Desk**: `components/agri/MillDesk.tsx` replaces AG-A's stub in place (same props); `Inventory.tsx` not edited.
- **Snapshot**: milling-charges / job-milling drafts write `agSnapshot('cmr', { cmr: AgCmrSnap })` /
  `agSnapshot('job_milling', …)`; AG-A's `AgriBlock` prints the "Custom milling" box.
- **Names / registry / rules / types**: AG-C rows in `ag-shared.ts` (`AG_TABLES.weighbridge` / `.cmr`, `AG_SERIES.wbs` /
  `.cmr` moved out of `AG_RESERVED_SERIES`, `AG_DATED.weighbridge_slips`), `ag-registry.ts` (AG-C block),
  `agri-rules.ts` (AG-C section: `OUTTURN_STANDARDS` kept, `OWN_OUTTURN_STARTERS`, `MILLING_PDS_RULES` kept,
  `JOB_MILLING_RULES`), `types/agri-r12.ts` (AG-C block; `ProductionOrder.ag.mill` is `MillOrderMeta` per the PRD —
  `{ input_moisture?, output_moisture?, standard_outturn_pct, std_source }` — replacing AG-A's placeholder
  `AgMillOrder`, which nothing used).
- **Class-rate hook**: the 25 kg rule plugs into `agri/ag-hooks.ts` `agExceptions` (no second edit of `gst-guards.ts`): a
  line's class is moved to its packed / loose pair from the stock item's pack size and label before the rate check.
- **Help**: the five `inventory:mill*` topics in `topics-packs.ts` reworded to what shipped (CA ids AG50–AG53 added).
- **Demo**: `demo/profile-agri.ts` AG-C block — a done weighbridge slip, the rice starter items / BOM, one milling batch
  (production order + manufacturing journal, outturn 68% vs 67%), a CMR agreement with a paddy lot and one delivery
  (JWP receipt and return). `DEMO_EXTRA_TABLES` gained `weighbridge_slips`, `cmr_agreements`, `job_work_principal`,
  `boms`, `production_orders`, `manufacturing_vouchers`.
- **e2e**: step "R12-C mill desk" in `tests/e2e/smoke.mjs` (slip → net; yield panel 68% vs 67%; CMR due 33.5 qtl, a
  CMR/FY… delivery, JWP in / out; the 25% test exempt / 5%).

### Deviations from the PRD (AG-C)

- **e-Way note (C4-4)**: `ewayHint` (exempt-only bill → "may not be needed — verify AG12"; taxable lines over ₹50,000 →
  prompt) is an engine with tests; it is not yet shown in the editor's e-way prompt (that UI is outside AG-C's files).
- **End-use choice (C4-3)**: `endUseClass` picks feed / other for bran and cake; the editor line has no extra control —
  the class is chosen on the stock item (`PackSizeRow`) and the typed rate wins as usual.
- **Counter sale from a > 25 kg bag (C4-2)**: `packClass(…, { counterLoose: true })` exists; the POS does not pass it yet.
- **Job milling receipt**: "Receive for job milling" records the JWP receipt directly from the slip (net weight in QTL);
  the job-milling bill is made on Custom milling → Job milling (`jobChargesLine`, class `job_milling`).
- **Views are one chunk** with the desk (not lazy sub-chunks): each lazy split costs a preload map in the parent chunk.
- `ag-cmr` and the JWP writer need `books.edit` for paddy lots / deliveries (the job-work register's own right).

### CA items

AG50 (CMR paddy as the agency's material; shortfall), AG51 ★ (the 25% test per bill), AG52 (milling and moisture loss),
AG53 (bank stock statement for a mill) — `docs/CA_REVIEW.md` §12.5.

### Bundle (AG-C)

Measured with `vite build` + gzip -9 (the budget script's method), before = `claude/elegant-cannon-cwapiv` at `228ca3c`
(AG-A merged), after = this branch merged with it.

| Budget | Before | After | Delta | Share |
|---|---|---|---|---|
| Initial JS (first paint) | 189,162 B | 189,186 B | **+24 B** | ≤ +0.03 kB ✓ |
| Total JS | 3,126,902 B (3053.6 kB) | 3,156,623 B (3082.6 kB) | **+29,721 B (+29.0 kB)** | ≤ 7 kB ✗ |

Breakdown of the total (gz): the mill desk chunk (four views + weighbridge, CMR, mill-report and starter engines)
+15.0 kB; the shared mill chunk (Hindi / English strings, form helpers) +5.0 kB; `agri-rules` split out of AG-A's
`ag-tax` chunk +0.6 kB net; `ag-yield` +1.4 kB; yield panel +1.1 kB; pack-size row + packing rule +1.4 kB; preload maps
of the two lazy mounts in `OrdersTab` / `ItemFormModal` +1.35 kB; `tr-stock-statement` split from its tab +0.3 kB net;
help wording +0.6 kB; demo block +1.1 kB; the rest ≤ 0.3 kB each. First paint: the `index` chunk +24 B (preload map of
the real desk). Measures already taken: one chunk for the desk and its views (a chunk per view cost ~0.15 kB each),
common words and the stock-statement rows reused from the R8 trade area, no namespace (dynamic) import of first-paint
modules (that cost +160 B of first paint through renamed exports). Trimming options for the lead: drop the demo
block (−1.1 kB), drop job milling / the stock-statement preset from the desk (≈ −2 kB), or move the pack-size row into
the item form without a lazy split once the item form has another lazy part (−0.6 kB).

## AG-D — Cold storage, input dealers, FPO / co-operative

(AG-D)
