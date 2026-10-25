# Inventory (stock summary)

Tally/Vyapar-style stock. Stock is **derived on read** from opening balance + manual moves + invoice lines + purchase lines. Invoices and purchases are never mutated.

- **Route**: `/inventory`
- **Nav label / icon**: `Inventory` / `Boxes` (lucide-react)
- **Page**: `src/pages/Inventory.tsx` (named export `Inventory`)
- **Tables** (via `getTable`/`setTable`): `stock_items`, `stock_moves`. Read-only: `invoices`, `purchases` (defensive; see below).
- **Extra key**: `mrchartist_inv_inventory_settings` = `{ method: 'WEIGHTED_AVG'|'FIFO', includeChallans: boolean, expiryAlertDays?: number, defaultGodown?: string }`. Not in `KEYS`; the lead should include it in backup if backup does not already sweep every `DB_PREFIX` key (`collectAppData` does).

## Rules implemented

- INVOICE / TAX_INVOICE reduce stock; a CREDIT_NOTE returns stock **only when goods actually came back**
  (`creditNoteReturnsGoods`, `src/lib/credit-restock.ts`): the note's `goods_returned` flag (the "Goods returned to
  stock" box on the credit-note form, ticked by default only for the "Sales return" reason), else for older notes the
  reason on its `doc_links` row / "Reason: …" sentence — Discount, Rate difference, GST correction and Cancellation of
  service move no stock; a custom reason or an unknown note does (the old behaviour). Profitability follows the same
  rule: a value-only note reduces revenue with no cost and no quantity; QUOTATION / PROFORMA never touch stock; DELIVERY_CHALLAN reduces stock only when the "Delivery challans reduce stock" toggle is on. Draft and Cancelled documents are excluded.
- Lines match a stock item by name (case-insensitive), then by an earlier name (`aliases`, recorded by `stockDb.saveItem`
  on rename); if both sides carry an HSN they must agree, where a code that only adds digits to the other agrees
  (8517 ↔ 85171300, digits compared after stripping spaces — `hsnCompatible`). So renaming an item or refining its HSN
  keeps its history (and opening serials are not "resurrected"); the item form warns before a rename / an HSN change that
  would detach history. Only `track_stock` items participate.
- Bill of Supply (and a row with no type) is a sale everywhere: costing, the editor's picker context, issue checks, POS
  and stock warnings (`isOutgoingDoc`).
- Purchases: any row in the `purchases` table with `lines` (or `items`) of `{name, hsn, quantity, rate}`; date from `bill_date | date | issue_date | invoice_date`; Draft/Cancelled skipped. Field names are read defensively because `src/types/purchases.ts` did not exist in this worktree. If the real `PurchaseRecord` differs, adjust `PurchaseLike` / `PurchaseLineLike` and `purchaseDate` in `src/lib/inventory.ts`.
- Same-day ordering: opening, then receipts, then issues, then sales returns (a same-day credit note follows the sale it reverses).
- Costing: weighted average (default) or FIFO, switchable on the page. COGS is costed at issue time; returns re-enter at the last issue unit cost; negative stock is valued at the last known cost and (FIFO) is covered by the next receipt.

## Exported symbols (`src/lib/inventory.ts`)

Pure: `computeStock`, `collectEvents`, `buildItemIndex`, `summarize`, `movementSummary`, `deadStock`, `marginReport`, `makeAdjustment`, `shortfallsFor`, `describeShortfall`, `stockSummaryCsv`, `ledgerCsv`, `statusOf`, and the types `StockItem`, `StockMove`, `StockPosition`, `LedgerRow`, `StockShortfall`, `StockLevel`, `PurchaseLike`, `InventorySettings`, `CostingMethod`.

Browser helpers for the lead:

```ts
getStockLevel(itemName: string, hsn?: string): StockLevel | null
// { itemId, qty, unit, avgCost, value, reorderLevel, status } or null if not a tracked stock item.
// Recomputes everything per call; in loops use findLevel(loadPositions(), name, hsn).
lowStockCount(): number          // tracked items with qty <= reorder_level (> 0); includes negative
stockWarningForInvoice(invoice): StockShortfall[]   // [] when fine; pass the draft (id optional)
describeShortfall(s): string     // "Widget: only 3 NOS in stock (need 5)"
```

Components (`src/components/inventory/`): `StockChip` (`{status}`), `ItemFormModal`, `AdjustModal`, `LedgerModal`.

## Wiring snippets for the lead

Route (`src/App.tsx`):

```tsx
import { Inventory } from './pages/Inventory';
<Route path="/inventory" element={<Inventory />} />
```

Nav (layout sidebar):

```tsx
import { Boxes } from 'lucide-react';
{ to: '/inventory', label: 'Inventory', icon: Boxes }
```

Invoice item picker badge (creator):

```tsx
import { getStockLevel } from '../../lib/inventory';
import { StockChip } from '../inventory/StockChip';
const lvl = getStockLevel(item.name, item.hsn);
{lvl && <><StockChip status={lvl.status} /> {lvl.qty} {lvl.unit}</>}
```

Creator warning (only for INVOICE/TAX_INVOICE; other types return `[]`):

```tsx
import { stockWarningForInvoice, describeShortfall } from '../../lib/inventory';
const shortfalls = stockWarningForInvoice(invoice); // memoise on invoice.items / doc_type
{shortfalls.map((s) => <p key={s.itemId} role="alert">{describeShortfall(s)}</p>)}
```

Dashboard badge: `lowStockCount()` -> link to `/inventory`.

## Notes

- `stock_moves` of kind `opening` are honoured if a future import writes them; the item form's opening qty/rate is the normal way.
- Deleting a stock item removes its manual moves only; invoice history is untouched.
- CSV cells starting with `= + - @` are prefixed with `'` to prevent spreadsheet formula injection.
- Page uses `surface.module.css` classes for stat tiles/page head because `StatCard` / `PageHeader` / `NumberInput` do not exist in this worktree's `components/ui`.
- When "Delivery challans reduce stock" is on, goods leave once per sale: an invoice converted from a live challan (or a
  challan converted from a live invoice) does not move stock again (`StockInputs.links`, read from `doc_links`).

## Batches, godowns and serials (roadmap 6.6 / 6.10 / 6.11)

Everything is **opt-in** and **derived on read** — no balance is stored. `src/lib/stock-tracking.ts` runs over the
same events as costing (`collectEvents`, now carrying `godown`, `batch`, `mfg`, `expiry`, `mrp`, `serials`, document
number and party) plus stock transfers. `computeStock` (costing) never sees transfers, so **costing stays
company-wide**: one weighted-average / FIFO cost per item across all godowns and batches.

### Switching it on

| Feature | Turn on | What appears |
|---|---|---|
| Batches + expiry | Item form → "Track batches with MFG / expiry dates" (`StockItem.track_batches`) | Batch / MFG / expiry / MRP fields on bill lines of that item; batch picker on invoice / challan lines; Inventory → *Batches & expiry* tab, expiry banner, bell alerts, expiry-window setting |
| Serials / IMEI | Item form → "Track serial / IMEI numbers" (`track_serials`, `warranty_months`, `opening_serials`) | Serial list (one per line, count = qty) on bill lines; serial picker on sales lines; *Serial lookup* tab |
| Godowns | Inventory → *Godowns* → add a second godown (table `godowns`; "Main" is implicit) | Godown picker on bill lines, sales lines and adjustments; *Godowns* (stock per godown) and *Transfers* tabs; default-godown setting |

A simple user (no tracked items, one godown) sees no new field anywhere; the editor's picker context is `null`.

### Data (all additive)

- `PurchaseLine`: `batch_no`, `mfg_date`, `expiry_date`, `mrp`, `serials[]`, `godown_id` (`src/types/purchases.ts`,
  read by `readPurchaseLines`; guarded by `tests/purchase-contract.test.ts`).
- `InvoiceItem`: `batch_no`, `batch_expiry` / `batch_mfg` (snapshot for printing), `serials[]`, `warranty_months`
  (snapshot of the item's warranty at sale), `godown_id` — normalised in `normalizeItem` (absent on untracked lines).
- `StockMove` (adjustments): `godown_id`, `batch_no`, `mfg_date`, `expiry_date`, `serials[]`.
- `godowns` (`Godown`), `stock_transfers` (`StockTransfer`, `src/types/stock.ts`). Both are in backup
  `RECORD_TABLES` / `ID_TABLES` (with `stock_items`; `stock_moves` is shape-checked without the id rule).
- Lines without a `godown_id` belong to **Main**. Opening stock is in Main and unbatched (record opening batches as an
  "Add stock" adjustment with a batch). When several godowns exist, new tracked lines are saved with the default godown.

### Batches (6.6)

- `batchOptions(tracking, day, godown?)` lists batches with stock in **FEFO** order (earliest expiry, then no expiry,
  then oldest receipt); expired batches are flagged and listed last. A batch's MFG / expiry / MRP come from its first
  receipt. Unbatched stock is kept in an `''` bucket and is never suggested.
- Editor: a new line of a batch item pre-selects the FEFO batch (`fefoBatch`); the user can pick another. If the
  quantity exceeds the batch, "Split across batches (FEFO)" (`splitLineByFefo`) splits the line, one batch per line.
- Issuing (not drafts): a batch is required when batches are in stock; an **expired batch blocks the save until the
  user confirms** "Sell anyway"; a batch running short is a warning (`docTrackingIssues`).
- Expiry alerts: `expiringBatches(tracking, today, days)`; bell notices from `expiryNotices` (one critical for expired
  stock, one warning for the window), registered lazily by `src/lib/stock-alerts.ts` only when an item tracks
  batches, so the stock engine never loads in the shell. Window = Inventory setting `expiryAlertDays` (default 30).
- Printing: templates print a small sub-line under the item ("Batch B12 · Mfg 01/2026 · Exp 06/2027",
  "S/N: … · Warranty 12 months") with the existing description style; Design Studio → "Batch, expiry & serial
  numbers" (`show_tracking`, default on) hides it.

### Godowns (6.10)

- `godownsDb` (`src/lib/godowns.ts`): add / rename (unique names) / delete, all audited (entity `godown`). Delete is
  refused while anything names it (`liveGodownReferences`): stock adjustments, bill lines, document lines of any type
  and status (drafts, quotations, cancelled) and untracked items, transfers, recurring templates, the default godown.
- Stock per godown: `ItemTracking.byGodown`, `godownSummary`.
- **Stock transfer voucher** (`transfersDb`): `STR/FY<yy-yy>/<seq>` per Indian FY of its date (highest issued or the
  `series_counters` high-water mark + 1, so a deleted number — even the latest — is never reused; an edit that moves the
  date into another FY takes that FY's next number, as advances do; purchase orders follow the same rules); lines of item × qty (+ batch / serials). Create / edit / delete go through
  `assertUnlocked` (period lock, PIN override) and are written to the audit log (`entity: 'stock_transfer'`).
  `transferIssues` refuses moving more than the source godown holds on that date **or than later documents leave**
  (lowest running balance from the date onwards), a missing batch, or serials that are not in the source godown then /
  leave it later. Deleting a transfer whose moved serials were sold from the destination is refused; when later
  documents used the moved quantity it needs an explicit confirmation (`StockDependencyError`).
- A transfer moves **quantity only**: no value, GST, Books voucher or ledger posting (tested in
  `tests/integration/stock-tracking.test.ts`).

### Serials / IMEI and warranty (6.11)

- Bill lines list one serial per unit (paste or scan, one per line); a serial already in stock is refused
  (`billTrackingIssues`). Sales lines pick from in-stock serials (in the line's godown); the quantity follows the count.
- A serial is in stock after its last receipt / return and out after its last sale. Issuing refuses a serial that is
  not in stock (`sold on INV/…`), was never received, is in another godown, or appears twice.
- **Returns**: a credit note that returns goods and lists the serial puts it back in stock. "Raise credit note" copies
  the invoice line's serials not already returned by an earlier live credit note (none when the note returns no goods);
  a partial credit keeps the first N of those (edit the credit note to choose others). A credit note can only name serials that are currently sold; a value-only note is not checked.
- Warranty: `warranty_months` is snapshotted on the sale line; valid until the day before the same date N months later
  (`warrantyUntil('2026-05-10', 12) = '2027-05-09'`).
- Lookup (Inventory → *Serial lookup*, `/inventory?tab=serials&serial=…`): purchase bill + vendor, sale invoice +
  client, return, current godown and warranty status (`lookupSerial`).

### Point-in-time checks (integrity review, `src/lib/stock-timeline.ts`)

Every check runs on the dated event list, never on the end state:
- **Issuing** (invoice, tax invoice, Bill of Supply, challan): a serial must be in stock at the end of the document's day
  *and* no later document may depend on it (lowest running balance from that day ≥ what the document takes) — so a
  back-dated sale of a serial received later, or a sale that pulls a serial out from under a later sale, is refused.
  Batches warn on the same rule. Credit notes may only take back a serial sold as of their date.
- **Bills** (`billTrackingIssues(lines, input, date)`): a serial already in stock on the bill date, or received again
  later, is refused.
- **Removing** a purchase bill (`purchasesDb.remove`), a transfer (`transfersDb.remove`) or a goods-returning credit
  note (delete from the list, or cancel): if a later document sold / moved a serial it provided the removal is refused;
  if later documents used its quantities or batch (stock would go below zero) the user must confirm (`confirmStock` /
  `acknowledgeStock`; screens ask with a confirm box).
- **Manual adjustments** respect the period lock (by their date) and are audited (`stock_adjustment`); inventory
  settings are owner-only (`settings.manage`) and audited.
- **Editor cost**: `stockWarningForInvoice` returns before reading documents unless the type moves stock and a line
  names a tracked item, and caches positions (without the open document) until a stock input changes;
  `StockWarnings` defers the items, so a keystroke with 10k invoices stays cheap (`tests/integrity-review.test.ts`).
- Issue-mode recurring schedules run the same checks; an invoice with tracked items that need a serial / batch is
  saved as a **Draft** and the run reports why (`GenerateResult.heldAsDraft`).

### Limitations

- Checks run in the editor's issue path, POS, credit notes, reinstating, recurring issue runs and the bill / transfer
  forms; importers and the API-less data layer do not re-validate serials or batches. Deleting a stock adjustment is not
  dependency-checked yet. Recurring templates drop serials and batches (each occurrence is a
  new sale), so auto-issued recurring invoices of batch items reduce the unbatched bucket.
- Bill lines still match stock items by name + HSN (`PurchaseLine.item_id` is not set).
- **Tally XML does not export batch or godown allocations** (`BATCHALLOCATIONS.LIST` / `GODOWNNAME` need godown and
  batch-enabled stock-item masters we do not export); Tally books everything to its main location. Stock transfers are
  not exported (they would be Stock Journal vouchers).
- Godown pickers on purchase-order lines are not offered (a PO is not a stock document).

## Barcodes (6.7)

Stock items carry an optional `barcode` next to `sku` (item form). A scan in the editor or the POS matches it (after the
catalogue's own barcode / SKU) and adds the item; label sheets include stock items with a code that are not in the
catalogue. POS bills move stock like any invoice (FEFO batch auto-pick and serial checks as in the editor). See
`docs/features/pos-barcode-pricing.md`.

## Manufacturing & stock vouchers (Phase 7)

BOMs, Manufacturing Journal (`MFG/…`), Stock Journal (`SJ/…`), Physical Stock (`PHY/…`), reorder levels / Reorder
Status and the Tally-style stock reports live on `/manufacturing` — see `docs/features/manufacturing.md`.
Engine changes here: `StockInputs.vouchers` (read by `liveInputs()`), new move kinds `consumption` / `production`
(not sales: `consumedQty` / `producedQty` on the position, no COGS), `computeStockDetailed` (global costing order when
vouchers exist, plus each voucher's cost roll-up), `LedgerRow.party` / `refNumber`, and the additive stock-item fields
`min_order_qty` and `reorder_by_godown`. Godown transfers remain STR records; the Stock Journal's transfer mode writes
them too.
