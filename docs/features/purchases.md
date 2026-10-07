# Purchases module — Expenses & purchases

Tally-style purchase and payment vouchers: supplier bills with GST, quick expenses,
payables, input tax credit (ITC), vendor master.

- **Route:** `/expenses`
- **Nav label:** "Expenses" (suggested lucide icon: `Receipt`; alt `ShoppingCart`)
- **Page:** `export function Expenses()` from `src/pages/Expenses.tsx` (no props)

## Tables (additive only)
| table | shape |
|---|---|
| `vendors` | `Vendor` (`src/types/purchases.ts`) |
| `purchases` | `PurchaseRecord` (`src/types/purchases.ts`); expenses use `kind: 'EXPENSE'` with one synthesised line |
| `purchase_payments` | `PurchasePayment { id, purchase_id, amount, date, method, reference?, created_at? }` |

`purchases.amount_paid` is the running sum of that bill's `purchase_payments`.
Status is derived, never stored: Paid / Overdue (balance > 0 and due_date < today) / Partially paid / Unpaid.

## Exported symbols
`src/lib/purchases.ts` (pure unless noted): `computePurchaseTotals`, `gstModeFor`, `expenseLine`,
`blankPurchaseLine`, `balanceOf`, `deriveStatus`, `payablesOutstanding`, `paidInMonth`, `itcTotals`,
`categorySummary`, `monthBuckets`, `filterPurchases`, `purchasesToCsvRows`, `validatePayment`,
`monthKey`, `sumTax`, `PAYMENT_METHODS`, `PURCHASE_STATUSES`; storage: `purchasesDb` (`all/get/save/remove`),
`paymentsDb` (`all/forPurchase/record/remove`).
`src/lib/vendors.ts`: `vendorsDb` (`all/get/save/remove`), `validateVendor`, `vendorBalances`, `searchVendors`.
`src/lib/purchases-context.ts` (reads localDb): `businessContext()` -> `{ stateCode, hasGstin }` from the active sender profile.

Components in `src/components/purchases/`: `BillModal`, `ExpenseModal`, `PurchasePaymentModal`,
`PurchasesTable`, `VendorsTab`, `VendorPicker`, `LineItemsEditor`, `PurchaseStatusBadge`.

GST: intra-state (place of supply == business state code) -> CGST+SGST, otherwise IGST; unknown state defaults to CGST+SGST.
Lines are costed through `calculateInvoice` (no discount / round-off).

## Wiring the lead must add

`src/App.tsx`:
```tsx
import { Expenses } from './pages/Expenses';
// inside the authenticated <Routes>:
<Route path="/expenses" element={<Expenses />} />
```

`src/layouts/DashboardLayout.tsx` nav list:
```tsx
import { Receipt } from 'lucide-react';
{ to: '/expenses', label: 'Expenses', icon: Receipt },
```

Optional cross-links:
- Dashboard "Payables" tile: `payablesOutstanding(purchasesDb.all())` from `src/lib/purchases`.
- GST reports: read ITC with `itcTotals(purchasesDb.all(), 'yyyy-mm')` (returns cgst/sgst/igst/total/ineligible);
  month buckets via `monthBuckets`, category P&L via `categorySummary`.
- Inventory stock-in: `PurchaseLine.item_id` is preserved on lines (the bill editor does not set it yet).

Backup/restore needs no change: all three tables use the `mrchartist_inv_` prefix.

## Notes
- No network, no new dependencies; CSV export reuses `src/lib/download.ts`.
- Tests: `tests/purchases.test.ts` (shims `localStorage`).
