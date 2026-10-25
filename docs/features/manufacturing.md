# Manufacturing & stock vouchers (Phase 7, Tally parity)

Tally-style Bill of Materials, Manufacturing Journal, Stock Journal, Physical Stock, reorder levels and the inventory
reports Tally users expect. Stock only: nothing here posts to Books or the double-entry ledger.

- **Route**: `/manufacturing` (lazy page `src/pages/Manufacturing.tsx`, tabs `?tab=boms|mfg|journal|physical|jobwork|rejections|plan|reorder|reports`).
  Reached from Inventory (header link "Manufacturing") and from the reorder bell notice.
- **Screens**: `src/components/manufacturing/*` (new files only; Inventory got one link).
- **Logic**: `src/lib/manufacturing.ts` (BOM, vouchers, storage), `src/lib/reorder.ts`, `src/lib/stock-reports.ts`;
  engine changes in `src/lib/inventory.ts` (`StockVoucherInput`, `stockVoucherInputs`, `computeStockDetailed`).
- **Types**: `src/types/manufacturing.ts`. **Strings**: `src/i18n/areas/manufacturing.ts` (English + Hindi, `mfgT`).
- **Tests**: `tests/manufacturing.test.ts` (pure), `tests/integration/manufacturing.test.ts` (storage, lock, roles,
  backup, ledger), `tests/purchase-contract.test.ts` (reorder reads bills), e2e step "manufacturing: BOM, then
  manufacture 2 units".

## Tables (all in backup `RECORD_TABLES` / `ID_TABLES`, role guard `TABLE_ACTIONS`, folder-sync dated + numbered)

| table | role | number |
|---|---|---|
| `boms` | `master.edit` | — |
| `manufacturing_vouchers` | `books.edit` | `MFG/FY<yy-yy>/<seq>` |
| `stock_journals` | `books.edit` | `SJ/FY<yy-yy>/<seq>` |
| `physical_stock` | `books.edit` | `PHY/FY<yy-yy>/<seq>` |
| `production_plans` (7S) | `books.edit` | `PP/FY<yy-yy>/<seq>` |

Numbers follow the Indian FY of the voucher date and the `series_counters` high-water mark (as for STR / PO): a deleted latest number is never issued again, and an edit that moves the date into another FY takes that FY's next number. Every save / delete
checks the period lock (PIN override is tagged in the audit row) and writes an audit entry (`bom`, `manufacturing`,
`stock_journal`, `physical_stock`). Stock item additions: `min_order_qty`, `reorder_by_godown` (optional, additive).

## How vouchers reach the stock engine

Vouchers are **not** written to `stock_moves`. Like invoices and bills they are read-only inputs: `liveInputs()` reads
the three voucher tables and `stockVoucherInputs()` turns them into `StockVoucherInput` rows, which `collectEvents`
expands into events (kinds `consumption` / `production`; physical stock → `adjustment`). So every reader — Inventory,
POS, Reports, the editor's shortage warning, godown / batch tracking — sees them, and deleting a voucher can never
leave orphan moves.

- **Order.** Voucher events sit between the day's receipts and its issues (rank 1.5); among themselves they run in
  voucher-number order, consumption before production. Physical stock runs last on its day (closing count).
- **Costing.** With vouchers present, `computeStockDetailed` costs every item in one global order: components are
  issued with the item's method (weighted average or FIFO), then production lines are received at
  `pool = consumed cost + ₹ additional + % additional × consumed − Σ(fixed-rate lines)`.
  By-products and scrap are fixed-rate lines (qty × value / unit); co-products take `cost_pct` % of the pool; the
  main finished line (and any line with neither rate nor share) takes the rest, split by quantity. Multi-level BOMs
  work: a sub-assembly made earlier (or earlier on the same day, lower number) carries its cost into the next voucher.
- **Not a sale.** Consumption counts as `consumedQty`, never as sold quantity or COGS; production as `producedQty`.
  Selling the finished goods later costs them at the produced value (FIFO / WAC downstream).
- `cost_snapshot` on a saved voucher is for display / audit only; the engine always recomputes live, so a back-dated
  purchase that changes a component's cost re-values the produced goods.

## BOM

Components per `batch_qty` finished units; `scrap_pct` is normal loss (consumption = qty × (1 + scrap %)). Outputs:
`by_product` / `scrap` (value per unit, deducted) and `co_product` (cost share %, total < 100). Several BOMs per item;
the first becomes the default and marking another default clears the old one. Validation refuses the item as its own
component and cycles through sub-assemblies' default BOMs.

## Manufacturing Journal

Pick the finished item (its default BOM is chosen and exploded), change BOM or quantity (re-fills on blur), edit any
line. Batch-tracked components are split first-expiry-first in their godown (`allocateFefo`); a shortfall stays on a
line without a batch and is refused. The finished item's batch (required for batch items) gets the voucher date as MFG
date. Not-enough-stock is a warning (Tally allows negative stock); the form shows the live cost roll-up. Serial-tracked
items go by serial (7S, below). Component lines take alternate units (7S).

## Stock Journal and godown transfers

Conversion / repacking: source lines are consumed, destination lines produced (optional value / unit or cost share,
else by quantity), plus additional costs. **Transfers are not duplicated**: the "Godown transfer" mode saves an STR
record through `transfersDb` (the same table as Inventory → Transfers, quantity only, no value change), and a
conversion that only moves the same items between godowns is refused with "save it as a godown transfer".

## Physical Stock

Enter counted quantities per item (and godown / batch). On save, `physicalLines` fixes `book_qty` (closing of that
day, the voucher itself left out), `diff = counted − book` and the unit cost; the diff is posted as an adjustment at
the end of that day, so positions after the date start from the counted figure. A back-dated entry changes the book
figure later: the list flags "Book stock has changed since this count" (`physicalDrift`); open and save to re-post.
A line without a godown counts the item company-wide (the difference lands in Main).

## Reorder

`shortfall = max(0, level − closing)`, `pending` = quantity still to receive on open / partly received POs (matched by
item name + HSN), `suggested = shortfall − pending`, raised to `min_order_qty`. Per-godown levels use the godown
balance (POs are company-wide, netted only on the company-wide row). "Create purchase order" writes a PO through
`purchaseOrdersDb` (last purchase rate, item GST rate, vendor chosen or the last supplier) and links to Expenses →
Purchase orders. The bell notice comes from `stock-alerts.ts`, loaded lazily by the bell only when an item tracks
batches or has a reorder level, so first paint is unchanged.

## Reports (`src/lib/stock-reports.ts`)

Stock Summary → item → 12 months of an FY (inward / outward / closing, qty and value) → vouchers of a month; Movement
Analysis per party (invoice client, bill vendor, "Manufacturing", …); Stock Ageing by FIFO receipt layers (buckets
0–30 / 31–60 / 61–90 / 91–180 / 180+ days, values scaled to the closing value) or by batch first-receipt date; Negative
stock exceptions (first day below zero, the voucher, lowest balance, how many times).

## Accounting

The ledger and Books do not value stock (`docs/features/ledger.md`: closing stock by journal). Manufacturing therefore
posts nothing: production value only moves value between stock items. Pay labour, power and overheads as expenses
(Expenses / payment vouchers) — the additional cost on the voucher only loads the stock valuation. Tested: the ledger's
vouchers are identical before and after manufacturing / stock journal / physical stock, and the trial balance balances.
A WIP / stock-in-hand posting arrives with the closing-stock work in `docs/GAP_ANALYSIS.md` (P0-3).

## Gaps / next steps

- ~~Job work out / in (Tally job work vouchers, material sent / received, ITC-04)~~ — Phase 7M, `docs/features/job-work.md`
  (tabs "Job work" and "Rejections in" on this page). Stock journal lines take alternate units (7M).
- ~~Serial-tracked items cannot be consumed or produced by vouchers~~ — 7S (below).
- ~~Ageing bucket labels come from the lib in English~~ — WP-8: labels are translated on screen and the slabs are
  configurable (`parseAgeSlabs`, `ageBucketBounds`).
- ~~Deleting a stock item does not check BOMs / vouchers~~ — WP-8: `stockDb.deleteItem` refuses while a BOM,
  manufacturing / stock journal or physical stock count names the item (`src/lib/item-references.ts`).
- Reorder "pending PO" now also counts goods received on receipt notes (GRN) before the bill (WP-8,
  `pendingPoQty(…, receiptNotes)`), with alternate-unit PO lines converted to base units.
- ~~No production plan / material requirement report yet~~ — 7S (below); no "kit" sale that consumes components automatically.
- Physical Stock still counts serial-tracked items with a stock adjustment (a serial count screen is open).

## 7S additions (roadmap 7.37 / 7.66 / 7.84)

### Serial-tracked items on vouchers (`src/lib/serial-vouchers.ts`)

- `VoucherStockLine.serials` and `ManufacturingVoucher.serials` (additive). A serial-tracked line is in whole units of the
  item's base unit and lists one serial per unit (`serialLineShape`, `serialShapeError` — also refuses a serial named
  twice on the voucher). The finished item of a Manufacturing Journal gets its serials in "Serial numbers of the
  finished units"; by-products / Stock Journal destinations get new serials on their line.
- Engine: `pushVoucherEvents` (inventory.ts, two `serials:` fields) and the Manufacturing Journal's main line carry the
  serials, so `computeTracking`, Serial lookup, sales pickers and the dated checks see consumption / production by serial.
- Save checks (`manufacturingDb.save` / `stockJournalsDb.save` with live inputs, the voucher's own copy left out):
  a consumed serial must be in stock in the line's godown at the end of the voucher day and not needed by a later entry
  (`dayWindow`); a produced serial must not be in stock nor received again later (`voucherSerialIssues`).
- Delete: a voucher whose produced serial a later entry used is refused (`liveRemovalIssues` with the new
  `RemovalRef.refType` values `manufacturing` / `stock_journal`).
- UI: `LinesGrid` shows a serial column for serial items (`SerialCell`: one per line or comma-separated, "Fill from
  stock" picks the first serials in stock in the line's godown on the date — `serialsAvailable`).

### Production plan / MRP (`src/lib/mrp.ts`, tab `?tab=plan`, `MrpTab.tsx`, lazy)

For planned finished quantities the default BOMs are exploded level by level. Each item is netted once at its
**low-level code** (deepest level reached), after every parent's demand is summed:
`gross` = planned + Σ parents' make quantity × component per batch × (1 + scrap %); `available` = closing stock (never below
zero) + `pendingPoQty(…, receiptNotes)` (open POs, GRNs before the bill); `net = max(0, gross − available)`; items with a
BOM are **made** (`net`, components exploded for `net`), others **bought** (`max(net, MOQ)`, last purchase rate and
supplier). "Use stock of the finished items too" can be switched off. "Create purchase order" writes one PO for the buy
rows (`poLinesFromMrp` → `purchaseOrdersDb`); "Manufacture" opens a new Manufacturing Journal at
`/manufacturing?tab=mfg&make=<item>&qty=<n>` with the default BOM exploded and FEFO-allocated. Plans are saved in
`production_plans` (`PP/FY…`, series counters, period lock on the plan date, `books.edit`, audit entity `manufacturing`,
backup + sync dated / numbered). Suggestions only: nothing is posted, no stock moves. Lead times and dated demand
buckets are not modelled (one planning horizon); deleting a stock item does not check plans (a plan line then reads "?").

### Alternate units on component lines and physical counts

- Manufacturing Journal component lines take the unit column (`unit` / `unit_factor`, as Stock Journal lines since 7M);
  `allocateFefo` allocates in base units and splits back into the typed unit.
- Physical Stock lines take a unit select for items with alternate units: `physicalLines` stores `counted`, `book_qty` and
  `diff` in base units (readers unchanged) plus `unit`, `unit_factor` and `counted_typed` for display / editing.

### Report filters, Alt+C

- Reorder Status, Movement Analysis and Stock Ageing (also by batch) take a stock group / category filter
  (`ItemFilterBar`, `filteredItemIds` in `src/lib/stock-filters.ts`, sub-groups included, "-" = none).
- Alt+C on the item and godown selects of every `LinesGrid` (BOM, Manufacturing / Stock Journal lines) creates the stock
  item / godown on the fly (`useCreateOnTheFly`).
