# Books (Day book, Cash & bank, Profit & loss, Balance sheet)

Tally-style books built read-only from invoices, payments received and (if present) purchases / vendors / purchase payments.

| | |
|---|---|
| Route | `/books` (tabs via `?tab=day\|cash\|pnl\|bs`) |
| Nav label / icon | "Books" / `BookOpen` (lucide-react) |
| Page | `src/pages/Books.tsx` (+ `Books.module.css`), named export `Books` |
| Components | `src/components/books/*` (PeriodBar, TrendChart, DayBookTab, CashBankTab, ProfitLossTab, BalanceSheetTab, OpeningBalanceModal, download.ts) |
| Lib | `src/lib/books.ts` (pure, tested in `tests/books.test.ts`) |

## Tables
- **Writes:** `book_opening` rows `{id, account: 'cash'|'bank', amount, as_of}` (one row per account, replaced on save). Nothing else is ever written.
- **Reads (read-only):** `invoices`, `transactions`, and defensively `purchases`, `vendors`, `purchase_payments` (may be empty/absent).

## Accounting rules
- Sales = `INVOICE`/`TAX_INVOICE` that are not Draft/Cancelled; credit notes = `CREDIT_NOTE`. Quotations, proformas and challans are ignored.
- Income = **taxable value** of sales less credit notes. GST on sales is a liability, never income.
- Purchase cost = taxable + GST only when the bill is **not ITC-eligible**; eligible GST is ITC (asset), excluded from expenses.
- Purchases (`kind`/`type` not containing "EXPENSE") are direct costs -> gross profit; rows whose `kind`/`type`/`doc_type` contains `EXPENSE` are indirect -> net profit.
- Accrual: invoice/bill dates. Cash basis: receipts/payments apportioned by `taxable/total` (receipt) and `cost/total` (payment); credit notes reduce income on issue date either way.
- Cash book = method `Cash`; bank book = everything else (UPI, Bank transfer, Cheque, Card, other).
- Balance sheet is labelled **indicative**: cash+bank, receivables, ITC receivable, payables, GST payable, retained earnings (cumulative accrual profit) and a balancing "Capital & other" line (absorbs opening balances, capital, drawings, GST remitted).
- Purchase rows are read through tolerant aliases (`date|bill_date|purchase_date`, `taxable_value|taxable|subtotal`, `tax_amount|gst_amount|gst|tax|cgst+sgst+igst`, `total|grand_total|amount`, `itc_eligible` (default true), `category`, `vendor_id|vendor_name`, `status` Draft/Cancelled skipped, `amount_paid` fallback when no payment rows) so the purchases module's exact field names are not a hard dependency. Align by editing `normalizePurchase` if they differ.

## Exported symbols (`src/lib/books.ts`)
`buildVouchers`, `dayBook`, `dayBookRange`, `cashBook`, `accountBalanceAt`, `accountForMethod`, `profitAndLoss`, `monthlyTrend`, `gstSummary`, `balanceSheet`, `periodForPreset`, `fyPeriod`, `fyStartYearOf`, `monthsIn`, `toIsoDate`, `loadBooksData`, `loadOpenings`, `saveOpening`, `getProfitSnapshot`, CSV helpers (`toCsv`, `dayBookCsv`, `cashBookCsv`, `profitLossCsv`, `balanceSheetCsv`), types `Voucher`, `VoucherType`, `Period`, `PeriodPreset`, `Basis`, `BooksData`, `OpeningBalance`, `ProfitLoss`, `BalanceSheet`, `GstSummary`, `TrendPoint`, `CashBook`.

### Dashboard hook
```ts
import { getProfitSnapshot } from '../lib/books';
const s = getProfitSnapshot('this_fy');          // or a {start,end} Period, optional 2nd arg 'accrual' | 'cash'
// -> { period, basis, income, expenses, netProfit, margin }
```
Never throws; empty storage returns zeros.

## Wiring the lead must add
`src/App.tsx`:
```tsx
import { Books } from './pages/Books';
<Route path="/books" element={<DashboardLayout onLogout={() => setAuthed(false)}><Books /></DashboardLayout>} />
```
Nav (layout sidebar): `{ to: '/books', label: 'Books', icon: BookOpen }`.

Cross-links (optional): Dashboard "Net profit" card -> `/books?tab=pnl`; Transactions page header -> `/books?tab=cash`.

## Notes
- No network calls, no new dependencies; charts are inline SVG / CSS bars; CSV export uses a Blob download.
- CSV cells starting with `= + - @` are prefixed with `'` to neutralise formula injection.
- The Balance Sheet "as of" date is the period end, capped at today.
