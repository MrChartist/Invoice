# Inventory masters & analysis (WP-8)

Tally's inventory masters and the analysis around them: stock groups and categories, units of measure with UQC and
decimals, alternate / compound units on document lines, group-wise stock summary, godown hierarchy, dated standard
cost / selling price lists, Stock Query, Sales Order Outstanding and landed cost. Gap ids P1-10, P1-11 (ageing slabs),
P1-12 (sales side) and the WP-8 P2 items in `docs/GAP_ANALYSIS.md`. Builds on `docs/features/inventory.md` and
`docs/features/manufacturing.md` (Stock Summary drill-down, Movement Analysis, Ageing, Negative stock are theirs —
extended here, not duplicated).

| | |
|---|---|
| UI | Inventory page (`/inventory`): header bar buttons **Groups & categories** and **Units** (lazy modals), summary filters by group / category, compound reading under the quantity ("2 BOX 3 NOS"), tabs **Stock query** and **Order outstanding** (lazy, `?tab=query&item=<id>`, `?tab=orders`). Item form: group, category, alternate units, price lists. Godowns modal: "Inside godown". Manufacturing → Stock reports: **Group summary**, ageing slabs. Invoice editor unit column, bill / PO / GRN line editor (item picker + unit), bill form **Landed cost** |
| Lib | `src/lib/units.ts` (units master, alternate units, conversion — pure + `unitsDb`), `units-live.ts` (editor context), `stock-groups.ts` (trees + `stockGroupsDb` / `stockCategoriesDb`), `stock-query.ts` (price lists + Stock Query), `landed-cost.ts`, `item-references.ts`; additions to `stock-reports.ts` (`groupWiseSummary`, `parseAgeSlabs`, `ageBucketBounds`), `sales-orders.ts` (`salesOrderOutstanding`, `groupOutstanding`), `godowns.ts` (`godownTree`, `godownParentIssue`, `rollUpGodowns`), `reorder.ts` (`pendingPoQty(…, receiptNotes)`) |
| Strings | `src/i18n/areas/inventory-masters.ts` (`imT`, screens), `src/i18n/areas/units.ts` (`unitT`, the few line-editor / landed-cost strings, so the editor chunk stays small); ageing / group-summary labels in `src/i18n/areas/manufacturing.ts` |
| Tests | `tests/inventory-masters.test.ts` (pure), `tests/integration/inventory-masters.test.ts` (storage, roles, audit, backup, delete guard, live Stock Query), WP-8 rows in `tests/purchase-contract.test.ts` |

## Data (all additive)

| Where | Field / table | Meaning |
|---|---|---|
| `stock_groups`, `stock_categories` (new) | `{id, name, parent_id?}` | Nested trees. Names unique per tree; a node cannot move under itself / a descendant; delete refused while sub-nodes or items point at it. `master.edit`, audited (entity `item`) |
| `units` (new) | `UnitMaster` | Simple unit: `symbol`, `name`, `uqc`, `decimals`. The built-in `UNITS` are implicit; a stored row with the same symbol overrides their UQC / decimals / name. Compound unit: `first`, `factor`, `second` ("1 BOX = 12 NOS"). Delete of a user unit refused while an item uses it. `master.edit`, audited |
| `StockItem` | `group_id`, `category_id` | Absent = Primary / not categorised |
| `StockItem` | `alt_units: [{unit, factor}]` | 1 `unit` = `factor` base units. Not offered for serial-tracked items (serial count = quantity) |
| `StockItem` | `standard_costs`, `selling_prices: [{from, rate}]` | Effective from `from` until the next entry (`rateOn`) |
| `InvoiceItem`, `PurchaseLine`, `PurchaseOrderLine`, `ReceiptNoteLine` | `unit_factor` | Snapshot: base units per line unit (absent = 1). `normalizeItem` keeps it only when ≠ 1 |
| `PurchaseOrderLine`, `ReceiptNoteLine` | `item_id` | Picked stock item (`PurchaseLine.item_id` existed but was never set) |
| `PurchaseRecord` | `landed_costs: [{label, amount}]`, `landed_basis: 'value' \| 'qty'` | Memo charges loaded onto the goods' stock cost |
| `Godown` | `parent_id` | Godown inside another godown |
| `PurchaseLineCore` (`readPurchaseLines`) | `itemId`, `unitFactor`, `landedUnit` | Reader fields; money readers ignore them (contract test) |
| `PoOutstandingRow` | `lineId` | So reorder can reach the PO line (item / HSN / factor) |

New tables are in backup `RECORD_TABLES` + `ID_TABLES` and `TABLE_ACTIONS` (`master.edit`). No migration: every
field is optional and absent on old rows.

## Alternate units — how a line converts

- A line typed in an alternate unit keeps `unit` = 'BOX', the **quantity and rate as typed** (2 BOX @ ₹600, amount
  ₹1,200, printed as such; GST / totals untouched) and snapshots `unit_factor: 12`.
- Stock converts on read with `lineFactor`: invoice lines (sale / return, `saleRate` per base unit), bill lines
  (`quantity × unitFactor`, cost `(unitCost + landedUnit) / unitFactor`), GRN / rejection lines, purchase returns
  (factor of the bill line they return), the shortage warning, batch checks and the FEFO split (allocated in base
  units, split back into the line's unit), PO pending quantities. The snapshot means changing an item's factor later
  never rewrites history.
- Editor: the unit column offers the item's units when the line names an item with alternate units (else the units
  master list); switching unit rescales the rate (₹50 / NOS → ₹600 / BOX) and shows "= 24 NOS". Picking a catalogue
  item resets the factor. The context is read when an item name gains focus (with the stock picker context), never per
  keystroke; the per-row lookup is one map hit. Simple users (no item with alternate units) see the old unit list.
- Bill / PO / GRN lines: the name field is a typeahead over stock items; picking one sets `item_id`, unit, HSN and GST
  rate. Typing a different name detaches `item_id` (and its factor). A unit select appears under the quantity only for
  items with alternate units. "Convert to bill" from a PO / GRN and Rejection Out carry `item_id` / `unit_factor`.
- `compoundText` gives Tally's compound reading of a base quantity ("26 NOS → 2 BOX 2 NOS", largest unit only).

## `item_id` matching (tech debt closed)

`collectEvents` takes a bill line's `item_id` first when it names a tracked item; otherwise (older rows, typed
names, an untracked / deleted item) it falls back to name + alias + HSN as before. GRN, rejection and purchase-return
lines use the same rule (`returnStockEvents` got an optional id resolver). Invoice lines still match by name.

## Reports

- **Group-wise Stock Summary** (Manufacturing → Stock reports → Group summary, `groupWiseSummary`): depth-first tree,
  each group totals its own and all sub-group items (opening / inward / outward / closing qty, closing value), then its
  items; items without a (live) group come last under "Primary (no group)". Group quantities are shown only when every
  item below shares one unit. Values come from `movementSummary`, so they match the Stock Summary to the rupee.
- **Ageing slabs**: type slabs ("15, 45, 90"); labels are translated (`ageRange` / `ageOver`), also for batch ageing.
- **Sales Order Outstanding** (Inventory → Order outstanding, `salesOrderOutstanding`): every issued SO line (not
  draft / cancelled / closed / fulfilled, dated on or before "As of") with ordered, delivered, to deliver, to invoice,
  value (to deliver × net rate) and overdue days (due date passed with goods still to deliver). Group by party, item
  or due date (overdue · due within 7 days · later · no due date). Fulfilment uses the same index as the order badges.
  The purchase side (PO outstanding, GRNI) stays on Purchases → Returns & GRN (WP-3).
- **Reorder "pending PO"** now uses the PO outstanding rule: goods accepted on a GRN count as received before the bill;
  a bill made from the GRN is not counted twice; quantities are base units (PO line factor), matched by `item_id` first.
- **Stock Query** (`loadStockQuery`): closing qty / value / average cost and compound reading, standard cost and
  selling price in force today, quantity pending on sales orders (base units) and purchase orders (incl. GRNs), stock
  per godown and batch, last 5 purchases (cost per base unit, vendor) and sales (net rate per base unit, party), and the
  open SO lines. Rates are per the item's main unit.

## Godown hierarchy

`Godown.parent_id`; the Godowns modal shows the tree and an "Inside godown" picker (no cycles; a godown with
sub-godowns cannot be deleted). Stock stays per godown; the Godowns tab shows a parent godown's column rolled up with
its sub-godowns ("(incl. inside)"; the Total column is unchanged). Transfers, pickers and batch tracking are unchanged.

## Landed cost

Bill form → "Add landed cost": rows of description + amount and a basis (line value, default, or base quantity).
`readPurchaseLines` exposes `landedUnit` per line; the stock engine (and the GRN valuation from bills) adds it to the
unit cost. It is a memo: the bill total, GST, ITC, Books, ledger and GSTR papers are unchanged (contract test) — record
the transporter's bill as its own expense. Lines with zero value fall back to quantity.

## Delete guard (manufacturing gap)

`stockDb.deleteItem` refuses while a BOM (finished item, component or output), Manufacturing Journal, Stock Journal or
Physical Stock count names the item (`itemVoucherReferences`); the Inventory page shows the reason in a toast.

## Wiring done in shared / hot files (narrow)

- `src/lib/inventory.ts`: `StockItem` fields; imports `lineFactor` / `itemVoucherReferences`; invoice loop `× factor`;
  purchases loop `item_id` first + `unitFactor` + `landedUnit`; `returnStockEvents(…, byId)`; shortfall `× factor`;
  `deleteItem` guard.
- `src/lib/events-returns.ts`: factor on GRN / rejection / return lines, `item_id` resolver, landed cost in bill rates.
- `src/lib/purchase-normalize.ts` (`itemId`, `unitFactor`, `landedUnit`), `src/lib/stock-tracking.ts` (batch check +
  FEFO split in base units), `src/lib/reorder.ts`, `src/lib/receipt-notes.ts` (`lineId`, seeds carry fields),
  `src/lib/purchase-orders.ts` (seed), `src/lib/godowns.ts`, `src/lib/stock-reports.ts`, `src/lib/sales-orders.ts`.
- `src/types/{invoice,purchases,stock}.ts` (additive), `src/store/invoice-defaults.ts` (`unit_factor`),
  `src/store/useInvoiceStore.ts` (`applyCatalogItem` resets the factor), `src/lib/backup.ts`, `src/lib/access.ts`.
- UI: `src/pages/Inventory.tsx`, `ItemFormModal.tsx`, `GodownsModal.tsx`, `creator/ItemsTable.tsx`,
  `purchases/{LineItemsEditor,BillModal,GrnModal,PurchaseOrdersTab}.tsx`, `manufacturing/StockReportsTab.tsx`.

## Performance / bundle

Nothing new loads before first paint (new screens are lazy; masters modals, Stock Query and Order outstanding are their
own chunks). The editor reads the unit context with the stock context on name focus; per keystroke it is one map lookup
per row. `tests/perf.test.ts` paths unchanged.

## Open items

- The units master's UQC is not yet used by the GSTR-1 HSN summary / e-Invoice / e-Way mappers (`uqcFor` is ready;
  those files belong to WP-6 / einvoice). Decimal places are used for display helpers only (no input rounding).
- Item-wise profitability (Reports → Item profit) costs tracked items per base unit but multiplies by the line
  quantity, so lines in an alternate unit are under-costed there: `SalesLine` / `CalcLine` would need the factor.
- Alternate units on POS lines, stock journals / manufacturing lines, transfers and adjustments (base unit only).
- Price lists are not yet applied automatically to the editor's rate (pricing.ts / price levels own that); standard
  cost is not used for valuation (FIFO / weighted average stay the methods).
- Group / category filters on Reorder, Ageing and Movement reports; categories have no summary report yet.
- Landed cost per line by hand (only by value / quantity split); landed cost on GRNs before the bill.
