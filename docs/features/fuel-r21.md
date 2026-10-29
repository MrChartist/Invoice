# Round 21 — petrol pumps, CNG stations and LPG distributors

PRD: `docs/prd/round-21.md`. CA items: `docs/CA_REVIEW.md` §21 (FU1–FU30). Working papers — verify with your CA.

## R21-A — Fuel core (profile, plumbing, tanks and nozzles, dated prices, POS fuel line, paper, e-Way guard)

### What it does

- **Profile (A1).** A wizard card "Petrol pump, CNG station or LPG distributor" (not a business type) and a Settings →
  Features "Fuel profile" row (every `kirana` company and any company that has one; "Custom" clears it, nothing is
  deleted). `applyFuelKind(kind, { currentPacks })` (`shop-presets.ts`) writes business type `kirana`, **explicit**
  `modules` = the kirana preset ∪ `accounts`, `banking`, `gst`, `tds`, `payroll`, `fuel_kind` and an **explicit**
  `industry_packs` list = the company's ∪ `fuel` (`pump`, `cng`, `pump_cng`), `lpg` (`lpg`) or both (`pump_lpg`). It
  never writes `retail_kind` (no retail desk). Landing `/inventory?tab=fuel&view=shift` (`lpg` → `&view=lpg`; until B /
  D add those views the desk opens the first view it has). `PACK_OF_TYPE`, `PACK_OF_TYPE_INLINE` and `PACK_ROUTES` are
  unchanged. The R5-C `common-credit` GST tab (and its Ctrl+K row) lists `fuel` (D2's Rule 42 run).
- **Desk.** One `INVENTORY_PACK_TABS` row `fuel` (pack `fuel`, `alsoPacks` `lpg`; Inventory now filters its pack desks
  with `visiblePackTabs`, which reads `alsoPacks`), mounted lazily from `Inventory.tsx`. `components/fuel/FuelDesk.tsx`
  mounts views **by file name** (`import.meta.glob('./*View.tsx')`): A ships `TanksView` and `PricesView`; B adds
  `ShiftView` / `DsrView`, C `DipsView` / `StockView`, D `CreditView` / `OmcView` / `LpgView` — files only. The desk
  already holds every view's label (`fuel-r21a.ts` `v.*`), icon (PRD §1.5, all reused) and pack (`lpg` for the LPG view,
  `fuel` for the rest); a view whose file is missing or whose pack is off is not listed (its URL still opens it). The
  "About this tab" strip reads the help topic of the view.
- **Plumbing.** Names in `fuel/fu-shared.ts` (tables `fuel_nozzles`, `fuel_prices` (A), `fuel_shifts` (B),
  `fuel_tank_logs` (C), `fuel_slips` (D); object `fuel_settings`; packs; dated map). `fuel/fu-registry.ts` registers the
  rights and audit labels of **every** Round 21 table at runtime (B–D never edit it); `sync-engine.ts` and
  `trust/recycle-bin.ts` import it; all five tables are backed up, in the open export, and the four dated ones are
  synced by `date`. `fuel_settings` (`fu-settings.ts`, owner only, audited on save; `fuDefaultsFor(kind)` fills two
  shifts from 06:00 / 14:00 — one from 09:00 for an LPG agency — prices at 06:00, a 5 L test and monthly credit bills).
  Types: `src/types/fuel-r21.ts` (one block per package; A declared every sub-field). Rules: `src/lib/fuel-rules.ts`
  (lazy, date-keyed, `verified`): GST status of MS / HSD / branded / CNG (non-GST, FU1), the lubricant hint (FU2),
  Rule 138(14) (FU3), the MDG density tolerance, daily records, nozzle test, variation band and records retention
  (FU15–FU19, `verified: true` — read in the HPCL MDG 2012 Ver. 7 text) and W&M re-verification (FU24).
- **Tanks and nozzles (A2).** A tank is an ordinary saleable **godown** with `Godown.fu` = product, capacity, calibration
  chart `[mm, litres][]`, calibration due (no new `Godown.kind`). "Add tank" creates the godown and marks the product's
  stock item (`StockItem.fu = { product, unit }`); with no product picked it uses (or creates) the stock item named after
  the kind ("Petrol (MS)", litres; CNG in kg). The chart is typed or pasted as "mm, litres" rows (`parseChart` skips a
  heading); `chartIssue` refuses a chart that does not rise in both columns; `dipToLitres(chart, mm)` interpolates
  linearly (three decimals) and refuses a dip outside the chart. CNG cascades have no chart. `fuel_nozzles`
  (`master.edit`, audited, recycle bin): DU no., nozzle no. ("2-B"), tank, product = the tank's product (checked),
  opening totaliser, W&M stamping due, active; labels unique among active nozzles.
- **Prices and the POS fuel line (A3).** `fuel_prices` (`master.edit`, dated by `date`, audited): product, date, time
  (`HH:MM`), RSP, optional excise / VAT / dealer price / margin per litre typed from the OMC build-up (D2 reads them). The
  price of a sale is `priceAt(rows, item, day, time)` — the latest row at or before that moment (05:59 takes
  yesterday's, 06:00 today's, a mid-day revision from its time). A second row for the same moment replaces the first;
  "Copy yesterday" copies each product's price in force at the end of yesterday. The prices view shows the board now and
  the history. POS: with the `fuel` pack on, `components/fuel/NozzleChip.tsx` (lazy) shows, under a bill line whose item
  is a pump product, the nozzle chip (that product's nozzles; one is picked for you) and a ₹ box: ₹500 at ₹94.72 →
  5.279 L with the line rate worked back so the amount stays ₹500.00 (FU8, `litresFor`); without ₹ the typed litres sell
  at the price in force. MS / HSD / CNG lines take `tax_rate: 0` and the R10 line key `sv.exempt: 'NON_GST'` (GSTR-1
  Table 8 non-GST, GSTR-3B 3.1(e)); lubricants keep their slab. The document patch (`fuDocPatch`): a fuel-only bill is a
  **Bill of Supply** (`exempt_kind: 'NON_GST'`); a mixed bill to a buyer without a GSTIN takes the Rule 46A title
  (`sv.rule46a`, "Invoice-cum-Bill of Supply"); a mixed bill to a GSTIN buyer is refused at the counter with "bill the
  fuel and the other items separately" (`fuSplit` returns the two documents for B / D batch writers). No price in force
  refuses the save with the reason. The POS change is one lazy strip, one state, one guard and the record patch.
- **e-Way (A3).** `eway.ts` leaves non-GST lines (`sv.exempt: 'NON_GST'`, or every line of a non-GST Bill of Supply) out
  of the item list and the value — a diesel + lubricant bill's e-Way value is the lubricant only — and a document of
  non-GST goods only gets the warning "e-Way bill not needed — Rule 138(14) … (verify with your CA)". Documents without
  non-GST lines are unchanged. (The hook is generic — every non-GST supply is in the Rule 138(14) annexure — so `eway.ts`
  imports no Round 21 code.)
- **Paper (A4).** `parts/FuelLines.tsx` (lazy, every layout incl. receipts) prints one row per fuel line from the `fu`
  snapshot only: "Petrol (MS) — Nozzle 2-B · 41.230 L @ ₹94.72 (price of 29-10-2026 06:00)", plus vehicle / slip no.
  when D fills them. A later price or nozzle change never reprints an old bill. Documents without `fu` print as before.
- **Help, Ctrl+K.** Topics `inventory:fuel`, `…:tanks`, `…:prices` (B–D add theirs); Ctrl+K title `inventory.fuel`;
  palette labels `r21.*` (PACK_TABS rows for the desk, tanks and prices).

### Cuts (PRD §3)

- **Cut 1 — demo rows** (two tanks, four nozzles, three days of prices in the Demo company): not built; the A cap.
- **Cut 2 — chart import from a CSV / XLSX file**: not built; the chart box takes pasted "mm, litres" rows instead.
- **Split on save for a GSTIN buyer** (A3): the POS refuses a mixed bill to a GSTIN buyer with the reason instead of
  saving two documents (payments, numbering and the PENDING 48 / 50 POS work); `fuSplit` is the pure split for the
  batch writers of B / D.
- The bridges `fu-issue-io.ts` / `fu-tax-io.ts` are not created by A: nothing in A reaches shared lazy code from an
  engine (the e-Way hook is generic, see above). B creates `fu-issue-io.ts`, D `fu-tax-io.ts` / `fu-recv-io.ts`, C
  `fu-stock-io.ts` (≤ 4 in all; `tests/fu-rules.test.ts`).

### API for B / C / D

- `fu-shared.ts` `FU_TABLES` / `FU_OBJECTS` / `FU_DATED`; every table is registered — writers `import './fu-registry'`.
- `fu-settings.ts` `readFuelSettings`, `fuDefaultsFor(kind)`, `saveFuelSettings(patch)` (owner; add your keys to the
  `FuelSettings` interface in your block of `src/types/fuel-r21.ts`).
- `fu-tank.ts` `dipToLitres(chart, mm)`, `chartIssue`, `parseChart`, `readNozzles`, `saveNozzle`, `removeNozzle`,
  `nozzleIssue`; tanks are `godownsDb.stored().filter((g) => g.fu)` (read them in a bridge / view: `godowns.ts` is not
  first paint).
- `fu-line.ts` (pure, `f-fuel`): `priceAt(rows, itemId, day, time)`, `nozzleLabel`, `isNonGst(product, day)`,
  `litresFor(amount, rsp)`, `fuelLine(line, { product, unit, price, nozzle, amount, day })` → `{ line, fu }`,
  `fuDocPatch(record, lines)` → `{ patch, split }`, `fuSplit(record)`.
- `fu-price.ts` `readPrices`, `savePrice`, `copyYesterday`.
- Snapshot: `InvoiceRecord.fu` (`FuSnapshot`: `lines[lineId]` = `FuLine` {nozzle_id, nozzle, litres, price_id, rsp, at,
  unit, vehicle, slip_no}, `shift_id` (B), `slip_ids` (D), `lpg_use` (D)). One record key; fuel lines reuse `sv.exempt`.
- Desk: add `src/components/fuel/<Name>View.tsx` with `export default function ({ onDone })`; the id is the file name
  (`ShiftView` → `shift`). Labels / icons / packs are already in the desk and `fuel-r21a.ts`.
- Strings: shared pump words (`shift`, `test`, `density`, `meter`, `slip`, `variation`, `attendant`, `litres`, `dip`) live
  in `fuel-r21a.ts`; add your own area `fuel-r21b.ts` … `fuel-r21d.ts` (literal Hindi).
- Help: add `inventory:fuel:<view>` topics in `topics-packs.ts` and `PACK_TABS` rows / palette labels if you want Ctrl+K
  rows for your views; append your words to `inventory.fuel` in `discover-r6-tabs.ts`.

### Sizes (gz)

| | `4695f54` (measured) | R21-A on `4695f54` (measured) | R21-A merged with `685ce27` (measured) |
|---|---|---|---|
| Initial JS | 177.9 kB | 177.9 kB | 177.9 kB |
| Entry chunk | 89.5 kB | 89.6 kB | 89.6 kB |
| Core precache | 3,254.5 kB | 3,262.2 kB (**+7.7**, cap 8) | 3,266.8 kB (#115 recorded 3,256.5) |
| Hindi pack | 373.2 kB | 374.6 kB | 375.6 kB |
| Hindi in core | 21.8 kB | 21.8 kB | 21.8 kB |
| `f-fuel` / `FuelDesk` (incl. tanks + prices views) / `NozzleChip` / `FuelLines` | — | 1.9 / 3.7 / 1.2 / 0.5 kB | same |

First build (each view, writer and form helper its own chunk) measured +10.9 kB; A's two views and the tank / price writers
now ship in the desk chunk and the POS strip reads its two tables directly (−3.2 kB). The +10.3 kB against #115's recorded
3,256.5 kB includes #115's own growth as measured in this checkout (its row was recorded before its final merge).

`room` at A's first commit (PRD §1.4): 3,300 − 3,254.5 − 20 (R20-B / C / D caps, not merged) − 5 = **20.5 kB** (R21-P not
merged on this base). Round 21's cap = min(29, 20.5) = 20.5 kB: ≥ 20, so package D stays in Round 21; A's own cap is 8 kB.

## R21-B — Shifts, attendants and the day close

### What it does

- **Shift (B1).** `fuel_shifts` (`doc.create`, dated by `date`, audited; one row per day × shift number), view `shift`.
  "Open shift" takes the shift number, start time and the attendants (comma separated; with more than one, a picker per
  nozzle says who holds it); a reading per held nozzle is created with the **opening carried** from the latest earlier
  closed shift (else the nozzle's totaliser start) and the daily test litres (`fuel_settings.test_litres`, 5). An opening
  that differs from the carried one needs a reason and is audited. Litres sold = closing − opening − test (the test goes
  back to the tank, never sold); a totaliser past its maximum wraps (`FuReading.max`, default 10⁷; a wrap is accepted
  only within a tenth of the dial, otherwise "closing below opening" is refused); a negative sale is refused. Value = the
  price in force at the shift's opening; with a price change inside the shift and a typed reading at the change
  (`FuReading.splits`, one per change) the litres split at it (FU9). Moments are local "YYYY-MM-DD HH:MM"; a closing time
  earlier than the start closes on the next day. Pure maths in `fu-shift.ts`, the store in `fu-dayclose.ts`.
- **Settlement (B2, `fu-settle.ts`, pure).** Per attendant: expected = value of their nozzles' litres − the amount of
  POS bills made from those nozzles during the shift (bills with `fu.lines[...].nozzle_id`, created between open and
  close; cancelled bills, day-close bills and slip bills left out); collections typed by mode (cash, UPI, card, fleet card,
  OMC loyalty, credit slips); short (−) / excess (+) = collected − expected. A shortage on a posted shift is settled by
  "Recover in cash" (a cash receipt on the shift's bill) or "Write off" (the existing `write_off` row, note "Shortage at
  pump — <name>", owner only like every write-off; `movedNoCash` skips it). Salary recovery is not built (FU10).
- **Day close (B3, `fu-issue-io.ts`).** Every closed shift of the day → ONE non-GST Bill of Supply of its **counter
  litres** (meter litres less POS bills and D's credit slips of the shift), lines per tank × product with
  `godown_id` = the tank (stock leaves the right tank), `sv.exempt: 'NON_GST'`, `exempt_kind: 'NON_GST'`, client
  `fuel_settings.counter_client_id` or "Counter sales — fuel", `fu.shift_id`, no round-off (the meter value is exact) —
  all of the day's bills in **one `localDb.invoices.saveMany`**. Receipts by mode: cash → cash; UPI → the bank picked
  on the bar (real banks only, `pickableBankAccounts('payout')`); card → "Card settlements clearing"; fleet card / OMC
  loyalty → "Fleet-card receivable (OMC)" (clearing accounts created on first use, `clearing: true`, so cheque / e-payment
  / BRS pickers never offer them). Credit-slip collections are not receipts (D bills the slips). Receipts never exceed the
  bill. Undo = the bill's receipts removed, the bill cancelled (its number stays used), status back to `closed`.
- **DSR (B4, `fu-dsr.ts` pure + `DsrView`).** Per shift × nozzle opening / closing / test / sold / rate(s) / value; per
  product litres, average rate, value; collections by mode; credit-slip sales; short / excess per attendant. Print window
  A4 landscape (script-free, `escHtml`; a blocked pop-up saves the HTML).
- **Help, Ctrl+K.** Topics `inventory:fuel:shift` and `inventory:fuel:dsr` live in `topics-purchase.ts` (Inventory's
  area: a pack-area topic needs a `PACK_TABS` row, which is A's file); the `inventory.fuel` Ctrl+K title lists the new
  words. Strings in `fuel-r21b.ts` (literal Hindi). e2e: the R21-B step (1000 → 1250, test 5 → 245 L × ₹94.72, cash
  ₹23,206.40, close, day close → one Bill of Supply with a cash receipt, DSR prints).

### Cuts and deviations

- **Cut 1 — DSR CSV** (PRD §11): not built; print only.
- **Cut 2 — "Excess at pump" journal**: not built. An excess is kept out of the receipts (taken off the attendant's
  collections, cash first) and shown on the shift as a note: "post it in Books to Excess at pump (other income)" (FU29).
- No `fuel-rules.ts` B block: the meter maximum is a device convention, not a rule.
- Help topics in `topics-purchase.ts`, not `topics-packs.ts` (see above); no `PACK_TABS` / palette rows for the two
  views (`industry-packs.ts` is A's file); the Ctrl+K row is A's `inventory.fuel` with B's words appended.
- The bridge and the shift view read `fuel_nozzles` / `fuel_prices` / `fuel_settings` directly (`fuData`, `fuCfg`), so
  A's writers stay in the desk chunk.
- Rollback lists leave out `series_counters` (`tests/fu-registry.test.ts`: Round 21 names no series); a failed day close
  can therefore leave a number reserved, as a deleted document does.

### Sizes (gz)

| | `67ccabd` (master, measured) | R21-B on `67ccabd` (measured) |
|---|---|---|
| Initial JS | 177.8 kB | 177.8 kB |
| Entry chunk | 89.5 kB | 89.5 kB |
| Core precache | 3,277.2 kB | 3,288.7 kB (**+11.5**, cap 7) |
| Hindi pack | 376.6 kB | 377.7 kB (`lang-hi-fuel` +1.0) |
| Hindi in core | 21.9 kB | 21.9 kB |
| New / grown chunks | — | `f-fuel` +2.8, `fu-issue-io` 2.7 (bridge + shift store), `ShiftView` 2.5, `DsrView` 1.3, `fu-ui` 0.4 (now shared), `topics-purchase` +0.3, `FuelDesk` +0.2 |

The chunks sum to +10.2 kB; `check-bundle-size` reports +11.5 kB for the core (the precache list / manifest and per-file
overhead of four more files). **Over the B cap of 7 kB after both stop-rule cuts.** Measured on the way: first build
+10.9 kB on `2737c99`; reading A's tables directly (A's writers back in the desk chunk) and cuts 1 /
2 took ≈ 1 kB off; the final +11.5 is measured against `67ccabd` (the chunk sum, +10.2 kB, is the package itself).
The core total stays under the 3,300 kB budget; no cut beyond the PRD's stop rule was made — the lead decides.
