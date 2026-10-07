# Inventory (stock summary)

Tally/Vyapar-style stock. Stock is **derived on read** from opening balance + manual moves + invoice lines + purchase lines. Invoices and purchases are never mutated.

- **Route**: `/inventory`
- **Nav label / icon**: `Inventory` / `Boxes` (lucide-react)
- **Page**: `src/pages/Inventory.tsx` (named export `Inventory`)
- **Tables** (via `getTable`/`setTable`): `stock_items`, `stock_moves`. Read-only: `invoices`, `purchases` (defensive; see below).
- **Extra key**: `mrchartist_inv_inventory_settings` = `{ method: 'WEIGHTED_AVG'|'FIFO', includeChallans: boolean }`. Not in `KEYS`; the lead should include it in backup if backup does not already sweep every `DB_PREFIX` key (`collectAppData` does).

## Rules implemented

- INVOICE / TAX_INVOICE reduce stock; CREDIT_NOTE returns stock; QUOTATION / PROFORMA never touch stock; DELIVERY_CHALLAN reduces stock only when the "Delivery challans reduce stock" toggle is on. Draft and Cancelled documents are excluded.
- Lines match a stock item by name (case-insensitive); if both sides carry an HSN they must agree. Only `track_stock` items participate.
- Purchases: any row in the `purchases` table with `lines` (or `items`) of `{name, hsn, quantity, rate}`; date from `bill_date | date | issue_date | invoice_date`; Draft/Cancelled skipped. Field names are read defensively because `src/types/purchases.ts` did not exist in this worktree. If the real `PurchaseRecord` differs, adjust `PurchaseLike` / `PurchaseLineLike` and `purchaseDate` in `src/lib/inventory.ts`.
- Same-day ordering: opening, then receipts, then issues.
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
