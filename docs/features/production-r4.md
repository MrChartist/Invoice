# Production, costing & traceability (Round 4, package R4-A)

Spec: `docs/prd/round-4.md` §4 R4-A1–A5. Everything is a tab of the existing lazy `/manufacturing` route
(`?tab=orders|costing|trace|qc|landed`); there are no new routes. Nothing here posts to Books or the double-entry
ledger: stock is valued by the stock engine and picked up at report time by `loadStockValuer()`.

## What was built

| Item | Screen | Library | Storage |
|---|---|---|---|
| A1 Production orders `WO/FY…` | `?tab=orders` (`OrdersTab`, `OrderForm`, `IssueDialog`, `OutputDialog`) | `src/lib/production/orders.ts`, bell `order-alerts.ts` | `production_orders`; additive `production_order_id` on `stock_transfers`, `manufacturing_vouchers`, `stock_journals` |
| A2 Order costing & SO margin | `?tab=costing` (`CostingTab`, `OrderCostCard`); Books → Projects memo row (`ProjectMaterialsRow`, lazy) | `src/lib/production/costing.ts` | `standard_conversion` on the order |
| A3 Batch genealogy & recall | `?tab=trace` (`TraceTab`, `RecallList`); "Trace" links in Inventory → Batches and Serial lookup | `src/lib/production/genealogy.ts` | `recall_notices` |
| A4 QC hold & release | `?tab=qc` (`QcTab`); item-form checkbox "Hold receipts for QC" | `src/lib/production/qc.ts`; GRN default-godown hook `applyQcHold` in `receipt-notes.ts` (re-exported by qc.ts) | `qc_results`, key `qc_settings`, `StockItem.qc_on_receipt` |
| A5 Landed-cost voucher `LCV/FY…` | `?tab=landed` (`LandedVoucherTab`) | `src/lib/landed-voucher.ts`; `landed-cost.ts` (bases `weight` / `equal`, `allocateLandedAmounts`); `purchase-normalize.ts` (extra-per-line map); `inventory.ts` `liveInputs` hook | `landed_cost_vouchers` |

### A1 — production orders

- Status: Planned → Released → In progress → Completed → Closed (or Cancelled). Planned / Released / Closed /
  Cancelled are stored milestones; In progress and Completed are derived from the output reported (`orderStatus`), so
  deleting an output journal recomputes the order. "Mark completed" stores Completed early.
- Release explodes the default (or chosen) BOM for the planned quantity into `materials` (base units, scrap %
  included, `per_unit` kept as the costing standard) and creates the "Shop floor (WIP)" godown (`kind: 'wip'`) once.
- Issue materials = a normal `STR/FY…` from a store to the WIP godown, tagged `production_order_id`; batch items are
  split first-expiry-first (`fefoAllocate`), serial items take the first serials in stock. Over-issue is allowed with a
  warning. The transfer check (`transferIssues`) refuses a shortfall.
- Report output = a normal `MFG/FY…` tagged `production_order_id`, consuming from the WIP godown in proportion to the
  quantity (editable), from the batches issued to the order (`buildOutputVoucher`). Output may be partial.
- Return unused = an STR from WIP back to the store. Close is refused while WIP holds material issued to the order,
  unless "Write off as scrap" — a consume-only `SJ/FY…` (`saveConsumeOnlyJournal`, manufacturing.ts) tagged
  `production_order_id`. Closing freezes the order; reopening is logged.
- Make to order: Orders tab → "Make to order" → pick an issued sales order → one draft order per pending line whose item
  has a BOM, net of live orders for the line (`ordersFromSo`). From MRP: "Create production orders" (`ordersFromMrp`).
- Delete only an order with no issue / output / write-off; otherwise cancel (needs WIP empty and no output).
- Every write: `requireAccess('books.edit')`, period lock (`assertUnlocked`) on the order date and on each voucher's
  own date, `WO` series counter (deleted latest numbers never reused), `withTablesRollback`, audit entity
  `manufacturing`.

### A2 — order costing (management working)

- Standard per unit = Σ material `per_unit` × standard cost on the order date (`standard_costs` / `rateOn`), else the
  weighted-average cost that day ("no standard"), plus the typed standard conversion cost.
- Actual = component cost consumed by the order's journals (engine ledgers) + written-off WIP + additional costs −
  by-product / scrap values.
- Variances against the standard cost of the actual output: price, usage, yield (closed orders) and conversion. On a
  closed order the yield is carved out of usage and conversion so that price + usage + yield + conversion − by-product
  credit = actual − standard of the output, to the paisa (see "Deviations").
- SO margin: revenue = taxable value (₹ via `inrValue`) of invoice lines raised for the made SO lines; cost =
  delivered quantity × actual unit cost of the orders made for the line.
- Cost-centre memo: Books → Projects shows "Materials used (stock, not posted)" per cost centre for the period
  (lazy row; only when an order carries a cost centre).

### A3 — genealogy & recall

One pass over `collectEvents` builds the index; backward trace from a batch, a serial or a sales document number,
forward trace from any batch to invoices / challans / POS bills / transfers / job work out, with credit notes and
rejections in as "came back". Mixed batches keep every edge. Recall list: CSV, printable A4 notice (`exportNodeToPdf`,
html-to-image + jspdf), WhatsApp / e-mail links opened one by one, "Block batch" (STRs moving every saleable unit
into the QC hold godown), and a `recall_notices` log of who was told. 10,000 events index + trace in well under
200 ms in the test harness (soft guard).

### A4 — QC hold

Godown kind `qc` is non-saleable (`nonSaleableGodowns` now covers `expiry`, `wip`, `qc`, `transit`). A GRN line with
no godown whose item is `qc_on_receipt` (or "Hold every receipt for QC") goes to the QC hold godown (created on first
use). The QC desk lists FIFO lots per item / batch / source document with age. Release = STR to a target godown +
`qc_results` pass. Reject = Rejections Out pre-filled from the GRN (`rejectionFromQc`), a debit-note link for a bill,
or a consume-only scrap journal for production output. Bell: lots older than `alert_days` (default 3).

### A5 — landed-cost voucher

Charges are non-stock bill / expense lines (`chargeCandidates`) or memo amounts; targets are goods lines of bills
and / or GRNs. Methods: value, quantity (base units), net weight (stock-item / catalogue `net_weight`), equal per
line; paisa drift to the largest line. The engine reads the vouchers in `liveInputs()` and hands it COPIES of the
target bills (per-line extra under `__landed_extra`) and GRNs (rate raised; a billed GRN line passes the extra to the
bill line that bills it), so FIFO layers and the weighted average are restated from the receipt date. A bill line
can be spread once; a memo equal to a target bill's own `landed_costs` is refused. Period lock on the voucher date and
the earliest target date. Audit entity `purchase`.

## Verify with your CA

Consolidated in `docs/CA_REVIEW.md` (ids G38, AC9, AC10, I36); answers are logged there with the date and the PR.

- **Order costing** is a management working from the stock engine (weighted average / FIFO). Standards cover
  materials plus a typed conversion rate; BOM additional costs are not stored as standard. Variances are not posted
  to the ledger (stock is not valued there). Confirm the method and any use in the books (PRD open question 7).
- **Yield split**: on closed orders the yield variance is carved out of usage / conversion. Confirm this presentation
  suits your reporting.
- **Genealogy / recall**: every edge is kept for mixed batches (no quantity-weighted attribution). Confirm with your
  QA head whether this meets FSSAI / CDSCO practice and what a recall notice must carry (open question 8).
- **Landed cost**: the freight / CHA bill stays an expense in Books; the voucher only restates stock valuation that the
  report-time closing stock picks up. Confirm the presentation (e.g. whether freight inward should sit in Purchases
  for gross profit) and that a charge is not also claimed elsewhere.
- **QC rejections / scrap**: write-offs and QC scrap reduce stock only; any ITC reversal on destroyed goods
  (Sec 17(5)(h)) is not raised automatically — check with your CA.

## Deviations from the PRD

1. **Variance identity**: the PRD lists usage against the actual output and yield = (planned − actual) × standard unit
   cost, and asks that the variances sum to actual − standard. Taken literally these cannot sum (the yield double
   counts the lost units already inside usage). The yield is therefore carved out of usage and conversion on closed
   orders, and "standard" in the identity is the standard cost of the actual output; the planned standard is shown
   alongside. Open orders show the PRD formulas unchanged (yield 0).
2. **Cost-centre memo** is a memo **row** under the Project P&L (its columns are the cost centres), not a column.
3. **QC default godown** is applied to GRNs only (`receipt-notes.ts` hook). Purchase-bill lines are entered in the
   purchases module, which R4-A does not own: the lead can call `applyQcHold(lines)` (receipt-notes.ts) in the bill save path.
   **Closed in R6-C1**: `purchasesDb.save` applies it to new stock lines without a `grn_line_id` (`withBillQcHold`).
4. **Reject from a bill** opens the debit-note screen (`/expenses?tab=returns&new=dn`) and logs the QC failure; it is not
   pre-filled (the returns screen takes no bill pre-fill parameter). **Closed in R6-C1**: the link carries
   `bill=<id>&lines=<lineId>:<qty>,…` and the Returns tab pre-fills the debit note.
5. **Margin chip / insights** (`margin.ts` callers in the editor) read raw bills, so they do not yet include
   landed-cost vouchers; the stock engine, stock reports and `loadStockValuer()` do. The lead can feed them
   `liveInputs().purchases`. **Closed in R6-C1**: `liveCostPurchases` / `liveUnitCosts` in `margin.ts`.
6. **Inventory → "Landed cost" link** is not added (Inventory.tsx is not R4-A's); the palette and the Manufacturing tab
   reach it (R6-B adds the header link to `/manufacturing?tab=landed`). The sale guard message for QC / WIP godowns reuses the existing "non-saleable (expired / breakage)" text
   (pharma-gate.ts is not R4-A's).
7. Small extra files: `src/i18n/areas/production-r4-links.ts` (strings for the Inventory entry points, so those screens
   do not download the whole catalogue), `src/components/production/palette-destinations.ts` and `tabs.ts`.
8. Make to order / MRP: a due date already in the past (an overdue sales order) is dropped from the new order rather
   than refused.

## Bundle

Measured with `npm run build` + gzip level 9 (the `check:size` method), base = `claude/elegant-cannon-cwapiv` after
QA-2 / R3-B / R3-C merged:

| | Before (base) | After (R4-A merged) | Delta |
|---|---|---|---|
| Initial JS (gz) | 185,148 B (180.8 kB) | 185,261 B (180.9 kB) | **+113 B** (target ≤ +0.2 kB) |
| Total JS (gz) | 2,180,491 B (2129.4 kB) | 2,225,050 B (2172.9 kB) | **+43.5 kB** (target ≤ +45 kB) |

First paint carries only the registry strings (`TABLE_ACTIONS`, `WATCHED_TABLES`) and the bell gate; the five tabs
are one lazy chunk (`components/production/tabs.ts`), the bell provider imports the engines lazily, the GRN QC hook
lives in `receipt-notes.ts` itself, and the tab labels / MRP button strings are inline so those screens do not pull
the production catalogue.

No new lucide icon names (reused `Factory`, `ClipboardCheck`, `ListTree`, `ShieldAlert`, `Scale`, `Plus`, `Pencil`,
`Trash2`, `Save`, `Download`, `Printer`).

## Rows for the lead (do not edit these files from the package)

**ROADMAP.md** — Round 4: R4-A1 production orders (WO, WIP godown, issue / output / close, make to order, MRP →
orders) ✅; R4-A2 order costing, variances, SO margin, cost-centre memo ✅; R4-A3 batch genealogy, recall list, notice,
block batch ✅; R4-A4 QC hold & release ✅; R4-A5 landed-cost voucher ✅.

**ARCHITECTURE.md** — table rows:

| table | owner module | shape |
|---|---|---|
| `production_orders` | production (R4-A1, `src/lib/production/orders.ts`) | `ProductionOrder` `WO/FY<yy-yy>/<seq>` (`src/types/production-r4.ts`): item, BOM, planned qty, due, SO + line, plan, cost centre, WIP / store / output godown, `output_to_qc`, status milestones, exploded `materials`, `log`, `standard_conversion`; issued / output / held derived from STR / MFG / SJ rows tagged `production_order_id` |
| `qc_results` | QC hold (R4-A4, `src/lib/production/qc.ts`) | `QcResult` pass / fail per lot: item, batch, QC godown, source doc, qty, inspector, release STR / rejection id |
| `recall_notices` | genealogy (R4-A3, `src/lib/production/genealogy.ts`) | `RecallNotice {id, date, batch_keys, note, notified: {party, at}[]}` |
| `landed_cost_vouchers` | landed cost (R4-A5, `src/lib/landed-voucher.ts`) | `LandedCostVoucher` `LCV/FY<yy-yy>/<seq>`: method, charges (bill line / memo), targets (bill / GRN), `allocation_snapshot`; applied live by `liveInputs()` |
| `qc_settings` (object) | QC hold (R4-A4) | `{hold_all, alert_days}` |

Also: `Godown.kind` now `'van' | 'expiry' | 'wip' | 'qc' | 'transit'`; `nonSaleableGodowns` covers expiry / wip / qc /
transit; additive `production_order_id` on `stock_transfers` / `manufacturing_vouchers` / `stock_journals`;
`StockItem.qc_on_receipt`; `PurchaseLineCore.lineId` and the engine-only `__landed_extra` key on bill copies.

**AGENTS.md** — storage keys: `mrchartist_inv_production_orders`, `mrchartist_inv_qc_results`,
`mrchartist_inv_qc_settings`, `mrchartist_inv_recall_notices`, `mrchartist_inv_landed_cost_vouchers` (all backed up and
synced; `production_orders` / `landed_cost_vouchers` DATED + NUMBERED, the others DATED). Known-debt line: "Landed-cost
vouchers reach the stock engine through `liveInputs()` (engine copies of bills / GRNs); readers that take raw bills
(margin chip) do not see them yet."
