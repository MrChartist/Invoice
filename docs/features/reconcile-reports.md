# Bank reconciliation and sales/purchase reports

Two read-mostly modules. Neither edits existing files; the lead wires them in (see "Wiring").

## Bank reconciliation (`/reconcile`)

| | |
|---|---|
| Page | `src/pages/Reconcile.tsx` (+ `.module.css`), named export `Reconcile` |
| Components | `src/components/bank/*` (ImportPanel, LineList, MatchPicker, CreateReceiptModal, CreateExpenseModal, BrsView, StatementsPanel, `actions.ts`) |
| Lib | `src/lib/bank-recon.ts` (pure, `tests/bank-recon.test.ts`) |
| Table written | `bank_statements` `{id, imported_at, bank_label, file_name, lines[], opening_balance?, closing_balance?}`; line `{id,date,narration,ref,debit,credit,balance?,matched_to?:{type:'payment'|'purchase_payment'|'manual', id?, ids?},ignored?,note?}` (additive only; `ids` is used when one line settles several entries) |
| Reads | invoices, transactions, purchases, vendors, purchase_payments, book_opening |
| Writes to books | only via the shortcuts below, through `localDb.payments.record`, `purchasesDb.save`, `paymentsDb.record` |

- **Import**: CSV auto-detects HDFC, ICICI, SBI, Axis, Kotak and generic Date/Narration/Withdrawal/Deposit/Balance or a single signed Amount (+ Dr/Cr column or suffix). Date formats dd/mm/yy, dd-mm-yyyy, dd-MMM-yyyy, `1 April 2026`, ISO. Indian grouping, Dr/Cr, brackets. Title/summary/footer rows are skipped and counted, wrapped narrations are joined, an "Opening Balance" row is captured. If detection fails the user picks the header row and columns. Re-imports are de-duplicated on date + signed amount + narration + balance (by occurrence, so two identical real lines survive).
- **Matching** (`suggestMatches`, pure, advisory only): credits vs payments received (cash excluded), debits vs purchase payments. Amount within 0.01 is mandatory; date within 5 days (15 with an exact UTR). Score = amount 45 + date 20..3 + UTR 50 + invoice/bill number 45/40 + name overlap up to 25 + payment-mode 3, minus 10 when a competing entry or line scores within 8 (duplicates). One-to-one assignment. A credit that no single entry explains but two entries sum to is offered as a combo, capped at 89. Nothing is applied until the user presses Confirm; "Confirm all >= 90%" only takes unambiguous rank-1, non-combo suggestions and asks for confirmation first.
- **Manual**: match to any free entry (multi-select), mark reconciled (no book entry), ignore with note, unmatch. Deleting a book entry turns its line back into "needs review".
- **Create receipt from credit**: choose an invoice (ranked by balance/number/name), amount capped at the invoice balance, dated on the bank date, method inferred (UPI/NEFT/IMPS/RTGS/Cheque/Cash/Card, else Bank transfer), reference = UTR from the narration. A credit paying several invoices is recorded invoice by invoice until nothing is left. **Create expense from debit** creates an EXPENSE purchase (GST backed out of the debit) paid on the bank date, or pays an existing bill. These are implemented in-page with the existing libs; no query-param deep links to existing pages are needed.
- **BRS** (Tally layout): books balance (Books bank account) + payments not yet debited - receipts not yet credited + bank credits not in books - bank debits not in books = bank balance; compared with the statement closing balance (balance column, or typed per statement). Print (A4, `body.brs-printing`) and CSV. Books entries older than the first statement line are assumed cleared. A bank opening balance should be set in Books > Cash & bank or the difference will be off (the page warns).

## Reports (`/reports`)

| | |
|---|---|
| Page | `src/pages/Reports.tsx` (+ `.module.css`), `?tab=customers|items|monthly|top|tax|payments|expenses|profit` |
| Components | `src/components/reports/*` |
| Lib | `src/lib/sales-reports.ts` (pure, `tests/sales-reports.test.ts`) |

Period selector reuses Books' `PeriodBar` (month / last month / FY quarter / FY / last FY / custom). Every table has sortable header buttons (`aria-sort`), a totals row, an empty state and a per-tab CSV. Drill-through: last invoice -> `/invoice/:id`, customer -> `/receivables?tab=statements&party=<key>`.

Definitions match Books/Dashboard: sales = INVOICE/TAX_INVOICE not Draft/Cancelled, credit notes netted on their issue date, INR only (foreign-currency documents are counted and flagged, never added). Shares are of taxable value. Monthly YoY compares with the same months one year earlier (previous FY for an FY period); months that have not started show no change and the total change is like-for-like. Top-3 share >= 50% warns (moderate), >= 70% or a single customer is high. Item profitability uses `loadPositions()` (inventory, read-only): period COGS from the stock ledger vs taxable sales matched by item name, tracked items only.

Cross-checks (shown on the page and enforced in tests, in five time zones): customer total == `summarize().billed`, customer income == Books P&L income, tax by rate == `gstSummary().outputTotal` (+ cess), payment modes == cash + bank receipts, expenses == P&L total expenses.

## Wiring (for the lead)

`src/App.tsx`:
```tsx
const Reconcile = lazy(() => import('./pages/Reconcile').then((m) => ({ default: m.Reconcile })));
const Reports = lazy(() => import('./pages/Reports').then((m) => ({ default: m.Reports })));
<Route path="/reconcile" element={<Reconcile />} />
<Route path="/reports" element={<Reports />} />
```
Nav (`DashboardLayout` "Accounts & GST" group): `{ label: 'Reconcile', path: '/reconcile', icon: Landmark }`, `{ label: 'Reports', path: '/reports', icon: BarChart3 }` (lucide-react). Optional links: Books "Cash & bank" tab -> `/reconcile`; Dashboard top-customer card -> `/reports?tab=top`; Receivables -> `/reports`; command palette entries for both (`/reconcile?tab=brs` opens the BRS). Add `bank-recon.ts` / `sales-reports.ts` to `tests/purchase-contract.test.ts` reader list if desired (both read purchases through `readPurchase` / books' `normalizePurchase`).
