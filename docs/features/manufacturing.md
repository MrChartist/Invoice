# Manufacturing & stock vouchers (Phase 7, Tally parity)

Tally-style Bill of Materials, Manufacturing Journal, Stock Journal, Physical Stock, reorder levels and the inventory
reports Tally users expect. Stock only: nothing here posts to Books or the double-entry ledger.

- **Route**: `/manufacturing` (lazy page `src/pages/Manufacturing.tsx`, tabs `?tab=boms|mfg|journal|physical|reorder|reports`).
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
items are refused (gap).

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

- Job work out / in (Tally job work vouchers, material sent / received, ITC-04) — not built.
- Serial-tracked items cannot be consumed or produced by vouchers (use stock adjustments).
- Ageing bucket labels come from the lib in English.
- Deleting a stock item does not yet check BOMs / vouchers that use it (their lines for that item are then ignored);
  godown deletion does check them (`godownReferences`).
- No production plan / material requirement report yet; no "kit" sale that consumes components automatically.
