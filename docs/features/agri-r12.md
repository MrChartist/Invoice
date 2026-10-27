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

## AG-B — Dairy and milk collection

(AG-B)

## AG-C — Mills

(AG-C)

## AG-D — Cold storage, input dealers, FPO / co-operative

Three desks on `/inventory`, one lazy chunk each (views inside the desk chunk; the loans view is a shared sub-chunk):
`cold` (pack `coldstore`: `lots`, `gatepasses`, `rent`, `loans`, `chambers`), `inputs` (pack `agri_inputs`: `licences`,
`subsidy`, `credit`) and `members` (pack `fpo`: `register`, `shares`, `patronage`, `papers`, plus `loans` when the
cold-storage pack is off). Strings: `src/i18n/areas/agri-r12d.ts` (English + Hindi). Working papers — verify with your
CA (AG8, AG16–AG25, AG30, AG32, AG60–AG69).

### D1 Lots, receipts and gate passes (`ag-cold-lots.ts`, `ag-gatepass.ts`)

- Table `cold_lots` (`doc.create`, dated `date_in`, numbered `CSR/FY…`; gate passes `GPO/FY…` live on the lot's `outs`).
  **Custody only**: no stock module reads the table (`tests/ag-cold-lots.test.ts` greps the stock modules).
- Balance = bags in − gate passes − bags transferred. A transfer to another depositor (consent note required) makes a
  child lot with a new `CSR` number and the parent's `date_in` (`from_lot_id`), so the rent runs on (AG60).
- Gate pass: refuses more than the balance and a date before the date in; an open loan naming the lot blocks it
  unless the bags left still cover the loan at `agri_settings.cold.release_ltv_pct` of the loan's bag rate, or the owner
  overrides with a reason (`loan_check: 'override'`, audit row). Unpaid rent bills warn. With a plan billing at
  release the draft rent bill for the released bags is raised in the same step (all or nothing).
- Papers (A5, `smallPaper`): storage receipt ("Non-negotiable receipt — not a WDRA e-NWR", AG23, terms from settings),
  gate pass with the balance bags. Chambers (`agri_settings.chambers`) with utilisation; depositor statement (lots,
  bags, rent billed / due, loans due).

### D2 Rent (`ag-cold-rent.ts`)

- Table `cold_rent_plans` (`master.edit`): basis `bag_season | bag_month | qtl_season | qtl_month | flat`, season
  (`MM-DD`), minimum months, part month (full / by days ÷ 30), one or more handling charges (`in` / `out`, optional own
  rate), late rent per bag-month after a date, class `storage_agri` (nil, bill of supply) / `storage_other` (18%), a
  "whole chamber" flag (taxable by default, Gujarat AAR note), a notified rate with its order ref (no presets).
- Rule rows: `agri-rules.ts` `STORAGE_CLASS_RULES` (SAC 996721 / 997212), `STORAGE_WORD_RULES` for the class
  suggestion (AG1, AG8).
- A rent bill is a DRAFT invoice written through `agSnapshot('rent', …)`: AG-A's printed fields (lot no., depositor,
  commodity, bags in / out / balance, chamber, date in, season, rate basis, exempt, the `working` rows of the following
  page, the line's lot / bags / rate per bag) plus D's (`lot_id`, bags billed, basis, rate, period, months, gate pass,
  class, plan, notified rate, `in_charges`) — printed from the snapshot only. Occasions: gate pass (default), in advance,
  a period (monthly plans), season end. No double billing: season bags already on live rent bills, `in` charges once
  per lot, a gate pass once, monthly periods never overlap (`billedOn` reads live invoices, so a deleted draft frees
  its bags).
- Rent due by depositor and season (closed lots with rent unpaid flagged); unbilled rent memo (AG30, no accrual).

### D3 Loans against stored produce (`ag-loans.ts`)

- Table `agri_loans` (`books.edit`, dated, numbered `LAS/FY…`). Simple interest by days (365) from disbursement /
  last repayment; `monthly_compound` optional (AG62). Repayments interest first, in date order; closes at zero.
- Posting (real money, ordinary vouchers): disbursement PAYMENT Dr "Loans to depositors" | Cr bank / cash; repayment
  RECEIPT Dr bank / cash | Cr "Loans to depositors" + Cr "Interest on loans to depositors". Undo / delete go through
  `deleteVoucher` and `setTable` (recycle bin). LTV warning (memo); interest statement; overdue loans in the bell.

### D4 Input dealer desk (`ag-licences.ts`, `ag-subsidy.ts`, `ag-season-credit.ts`, `ag-expiry.ts`)

- Licences and principal certificates in `agri_settings.licences` / `.principals`; notices with R9's `licenceNotices`
  (60-day window, ≤ 45 days "due soon", expired) on the desk and in the bell. An item class needing a licence with none
  valid → warning on the POS strip (never a block). Bills of licensed classes from a supplier without a principal
  certificate are listed (purchases read through `readPurchase` / `readPurchaseLines`, in the purchase contract test).
- Expiry by class: `ag-expiry.ts` runs inside the stock checks after the pharma gate and turns an expired batch of
  seeds / pesticides into an error (fertilisers keep the confirmation). It mirrors the `block` rows of
  `DEALER_CLASS_RULES` (pinned by `tests/ag-inputs.test.ts`) so the stock checks do not pull the rules chunk.
- Subsidised fertiliser: stock items flagged `ag_subsidised` (desk). The POS strip (`PosInputsStrip`, lazy, pack
  `agri_inputs`) asks the PoS transaction no. and the farmer ID (Aadhaar last 4 or KCC — 12 digits refused) when the
  cart has a flagged item; missing ones stop the save. Monthly cap warning (`FERT_SUBSIDY_DEFAULTS` 50, or
  `agri_settings.subsidy.cap`). PoS vs book: book stock at month end from the engine ledger against the PoS stock typed
  per month (`agri_settings.pos_stock`), and the month's flagged sales without a PoS no.
- Credit till harvest: seasons (`agri_settings.seasons`, `YYYY-MM-DD` or `MM-DD`, defaults Kharif 11-15 / Rabi 04-30 /
  Zaid 07-15) from the POS strip or the desk ("Set season" on an open bill): `ag.inputs.season` / `season_due` and the
  due date. `tr-interest.ts` starts a season bill's interest at `season_due` whatever the company basis (one branch).
- `ag.inputs` snapshot: licence lines valid on the day (`{ kind, no }`), PoS txn, farmer ID (`farmer_id`; 4 digits also
  in `farmer_id_last4` for the paper), bags under subsidy, season / season due.

### D5 Members (`ag-members.ts`, `ag-patronage.ts`, `ag-coop-papers.ts`)

- Members = vendors / clients with `ag.member` (one per `ag.code`). Table `member_shares` (`books.edit`, dated):
  allot (`SHC/FY…` certificate; from application money JOURNAL or bank / cash RECEIPT), transfer (pair of rows, new
  certificate, totals unchanged), surrender (optional refund PAYMENT), forfeit (JOURNAL to "Forfeited shares").
  Application money per member from closed `farmer_cycles` `share` deductions less allotments that used it. Register
  as at a date (folio, shares, paid up, membership date, cessation, certificates; CSV); certificate print with
  distinctive numbers.
- Patronage per FY: supplies (cycle lines by `farmer_id` + the member's own vouchers at taxable value) and purchases
  by the member; members vs non-members of all farmer vendors. Distribution paper (reserve %, dividend % with cap,
  patronage pool by business, retained) → an OPTIONAL (draft) appropriation journal.
- Papers: co-operative profit by head with the members' share — `80P(2)` before 1 Apr 2026, `Sec 149` (Income-tax
  Act 2025, as reported) from then (`COOP_DEDUCTION_RULES`); producer company 80PA keyed by assessment year
  (`PRODUCER_COMPANY_RULES`): 100% under ₹100 crore turnover for AY 2019-20 … 2024-25, nothing after ("no deduction
  found — verify AG17"). Statutory calendar (`MEMBERS_CALENDAR_RULES` defaults, typed overrides
  `agri_settings.calendar`) on the desk and as a lazy card in GST → Compliance with the `fpo` pack.

### Storage, registries, rules

| Key | Kind | Backed up | Synced | Audited / rights |
|---|---|---|---|---|
| `cold_lots` | table, dated `date_in`, numbered `CSR` (`GPO` inside) | yes | yes | `ag-registry` `doc.create` |
| `cold_rent_plans` | table | yes | yes | `master.edit` |
| `agri_loans` | table, dated, numbered `LAS` | yes | yes | `books.edit` |
| `member_shares` | table, dated (`SHC` on certificates) | yes | yes | `books.edit` |
| `agri_settings` D fields (object-valued, kept by `cleanAgriSettings`) | `chambers`, `cold` (`receipt_terms`, `release_ltv_pct`), `licences`, `principals`, `seasons`, `subsidy` (`cap`), `pos_stock`, `coop`, `calendar` | yes | singleton | `settings.manage` |
| record `ag.rent`, `ag.inputs`; item `ag_subsidised` | additive | yes | yes | — |

Every D writer imports `./ag-registry`. Rows: `backup.ts` (record + id tables), `sync-engine.ts` (`DATED`,
`NUMBERED`), `trust/open-export-schema.ts`, `demo-data.ts` `DEMO_EXTRA_TABLES`. Row shapes: `src/types/agri-r12d.ts`.
No new no-cash marker: loans, rent and interest move real money. Rule rows (`// AG-D` in `agri-rules.ts`):
`STORAGE_CLASS_RULES`, `STORAGE_WORD_RULES`, `FERT_SUBSIDY_DEFAULTS`, `DEALER_CLASS_RULES`,
`COOP_DEDUCTION_RULES`, `PRODUCER_COMPANY_RULES`, `MEMBERS_CALENDAR_RULES`, each with `source` and `verified`.

Edits to shared files (one line or one block each): `stock-tracking.ts` (expiry gate), `trade/tr-interest.ts` (season
due date), `pages/Pos.tsx` (lazy strip, state, save check), `command/NotificationBell.tsx` (bell gate for the three
packs), `gst-reports/ComplianceView.tsx` (lazy members calendar).

Demo (`demo/profile-agri.ts`, pack `coldstore`): a season rent plan and three lots of the demo clients, one partly
released (loans, shares and licences are left to the desks: they post vouchers or live in settings).

Tests: `ag-d-registry` (names, registry, backup / sync / export rows, pack gate), `ag-cold-lots`, `ag-cold-rent`, `ag-loans`, `ag-inputs`, `ag-members`; purchase contract (R12-D readers);
e2e step "R12-D cold store desk".

### Deviations from the PRD (AG-D)

- **One chunk per desk**: each desk imports its views statically (the loans view is a shared lazy sub-chunk), not one
  lazy sub-chunk per view — measured ≈ 8 kB gz smaller (fewer preload maps and better compression).
- **Expiry gate** mirrors the `block` rows of `DEALER_CLASS_RULES` in a tiny `ag-expiry.ts` (pinned by a test) so the
  stock checks do not pull `agri-rules.ts` into their chunk graph (that added two preload entries to first paint).
- **Settings scalars** are nested (`cold.release_ltv_pct`, `cold.receipt_terms`, `subsidy.cap`): AG-A's cleaner keeps
  object-valued keys only.
- **Compliance calendar**: the members' reminders are a lazy card on GST → Compliance (fpo pack) and a table on
  Members → Papers; they are not merged into the GST return calendar rows.
- **Loans view under Members** shows only when the cold-storage pack is off and has no `PACK_TABS` row / own help topic
  (it falls back to the Members topic).
- **Demo**: lots and a rent plan only (see above).
- **Loan / share entries** post ordinary vouchers through `postPair` / `saveVoucher` (no new marker; real money).

### Bundle (AG-D)

BUNDLE_PLACEHOLDER
