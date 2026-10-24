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
`src/lib/msme.ts`: `paymentLimit`, `msmeBills`, `msmedInterest`, `disallowance43Bh`, `validateUdyam`, `isMse`, `fyStartYear`.
`src/lib/vendors.ts`: `vendorsDb` (`all/get/save/remove`), `validateVendor`, `vendorBalances`, `searchVendors`.
`src/lib/purchases-context.ts` (reads localDb): `businessContext()` -> `{ stateCode, hasGstin }` from the active sender profile.

Components in `src/components/purchases/`: `BillModal`, `ExpenseModal`, `PurchasePaymentModal`,
`PurchasesTable`, `VendorsTab`, `VendorPicker`, `LineItemsEditor`, `PurchaseStatusBadge`, `MsmeCard`.

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

## Advanced GST on bills (Roadmap 3.2)

All optional and additive on `PurchaseRecord`, so old rows read as domestic, forward-charge, no reversal
(no migration needed). Set from the collapsible "Advanced GST" block in `BillModal`.

| field | meaning | GSTR-3B |
|---|---|---|
| `reverse_charge` | tax payable by us (RCM) | 3.1(d) liability, ITC 4A(3) |
| `import_type: 'GOODS'` + `boe_number` / `boe_date` / `port_code` | import on a Bill of Entry; tax forced to IGST | ITC 4A(1); not in 3.1 (paid at customs) |
| `import_type: 'SERVICES'` | import of services (always reverse charge) | 3.1(d) liability, ITC 4A(2) |
| `itc_reversed` + `itc_reversal_reason` | partial ITC reversal | `RULE_42` / `RULE_43` / `SEC_17_5` → 4B(1); `RULE_37` / `OTHER` → 4B(2) |
| `itc_eligible: false` + `itc_reversal_reason: 'SEC_17_5'` | blocked credit | full tax in 4A and in 4B(1) |

`itc_eligible: false` without a 17(5) reason keeps its old meaning (4D(2) ineligible).
The bill's `total` still includes the GST for RCM and import bills (same convention as every bill, so Books
and Tally stay balanced); the supplier balance therefore includes tax that is really paid to the government.

## MSME payments (Roadmap 3.8)

Vendors carry optional `msme_udyam` (`UDYAM-XX-00-0000000`, validated by `validateVendor`) and
`msme_category` (`MICRO` / `SMALL` / `MEDIUM`). `src/lib/msme.ts` (pure):

- `paymentLimit(billDate, dueDate?)`: agreed due date capped at 45 days; 15 days when the bill has no due
  date (MSMED Act Sec 15). The bill date stands in for the date of acceptance.
- `msmeBills(purchases, vendors, payments, asOf)`: bills from micro / small vendors with limit, balance,
  days late and Sec 16 interest (compound, monthly rests, 3 × RBI bank rate in force the day after the limit).
- `disallowance43Bh(purchases, vendors, payments, fyStart, asOf)`: Sec 43B(h) for an FY (from FY 2023-24).
  Amount unpaid by the later of the limit and 31 March is disallowed; `final` once that date has passed,
  otherwise "at risk". Only the expense share counts (taxable value when ITC is claimed, else the total).
  `amount_paid` not backed by payment rows (legacy / imported) is treated as paid on the bill date.

Statutory values (`MSME_PAYMENT_DAYS`, `MSME_43BH_FROM`, `RBI_BANK_RATE_RULES`) live in `src/lib/tax-rules.ts`.
`MsmeCard` shows open MSE bills and the 43B(h) totals for the current and previous FY on the Expenses
page; it renders nothing until a vendor is marked micro or small. Estimates — verify with your CA.

## Notes
- No network, no new dependencies; CSV export reuses `src/lib/download.ts`.
- Tests: `tests/purchases.test.ts` (shims `localStorage`), `tests/msme.test.ts`, GSTR-3B cases in
  `tests/gst-reports.test.ts`, field contract in `tests/purchase-contract.test.ts`.
