# Cost centres / projects and budgets vs actual (roadmap 6.16, 6.17)

Tag income and costs with a **cost centre** (a project, department or branch, as in Tally cost centres, Xero
tracking categories or Zoho projects). The **Project P&L** then shows income, direct costs, margin and net result
per cost centre, and **Budgets** compare monthly budgets with the ledger's actuals. Everything is a **working
paper: verify with your CA**.

| | |
|---|---|
| UI | Books page tabs `proj` **Projects** (cost-centre master + Project P&L) and `budget` **Budgets**. Both are in the lazy ledger chunk (`LedgerPanel`), so the initial bundle does not grow |
| Pickers | `src/components/cost-centres/CostCentreSelect.tsx` (+ `useCostCentres.ts`). Shown only once at least one cost centre exists: invoice editor (document level, "1 · Document" card) and per line (under the description), bill and quick-expense forms, voucher editor (income / expense lines, in the party column), time-entry and mileage forms |
| Lib | `src/lib/cost-centres.ts` (master; ledger-free so the forms stay small), `src/lib/ledger/cost-centre-pnl.ts`, `src/lib/ledger/budgets.ts` |
| Tests | `tests/cost-centres.test.ts` (P&L reconciliation, line split, note inheritance, master rules, budget spreading, variance signs, copy from actuals, backup round trip), a row in `tests/purchase-contract.test.ts`, the persisted-field test in `tests/invoice-store.test.ts`, an e2e step in `tests/e2e/smoke.mjs` |

## Storage (additive, all in backups)
- `cost_centres`: `{id, name, kind: project|department|branch, client_id?, active, parent_id?, notes?, created_at, updated_at?}`.
  Names are unique (case-insensitive). One level of grouping: a parent must be top level, and a centre that already
  groups others cannot get a parent. A centre that is referenced anywhere (documents and their line overrides, bills
  and bill lines, vouchers, time, mileage, budgets, child centres, recurring templates and their lines) cannot be deleted; mark it **inactive** instead (hidden from pickers, kept in reports).
- `budgets`: `{id, fy_start_year, account_id, cost_centre_id?, months: [12 integer paise, April → March], notes?, created_at, updated_at?}`.
  One row per FY × account × cost centre (no cost centre = account level). Income and expense accounts only.
- New optional fields (never renamed, absent on old rows):
  - `InvoiceRecord.cost_centre_id` (in `RECORD_KEYS` and `normalizeRecord`) and `InvoiceItem.cost_centre_id` (line override);
  - `PurchaseRecord.cost_centre_id` (bills and expenses, `src/types/purchases.ts`);
  - `ManualVoucherLine.cost_centre_id` (kept only on income / expense lines by the editor);
  - `TimeEntry.cost_centre_id`, `MileageEntry.cost_centre_id`.
- Both tables are in `RECORD_TABLES` / `ID_TABLES` (`src/lib/backup.ts`); audit entities `cost_centre` and `budget`.

## How the cost centre reaches the ledger
- `PostingLine.cost_centre` is stamped on every line of an automatic voucher from its source: the invoice / note's
  `cost_centre_id`, the bill's / expense's `cost_centre_id`. Manual vouchers carry each line's own centre.
  Receipts, supplier payments, openings, fixed-asset purchases and depreciation are unallocated. Reports read the
  centre only on income and expense accounts.
- **Line overrides**: when an invoice's lines name different centres (a line without one uses the document's), the
  Sales (or Sales returns) credit is split by each line's taxable value from `calculateInvoice`, exact to the paisa
  (`itemsByCostCentre`; the largest share absorbs rounding). Freight, round off and taxes follow the document's centre.
- **Inheritance**: duplicate (Transactions), conversions, credit notes and debit notes copy the source record, so they
  keep the document's centre; credit-note lines keep their line overrides, so returns post against the same centres.
  A recurring schedule made from an invoice keeps the document centre (`RecurringTemplate.cost_centre_id`) and the line
  overrides, and every generated invoice carries them.
- **Time & billable costs**: a time entry's `cost_centre_id` (or, when absent, a `project` label that exactly matches
  one active cost centre's name) is copied onto its invoice line; mileage and re-billed expenses copy theirs. When
  every billed line shares one centre, "Bill" sets it on the document instead. The timer card has no picker (its
  project label is matched by name when billed).
- Editing a cost centre on an invoice, bill or voucher goes through the existing save paths, so the **period lock**
  applies. The master and budgets are not dated documents and are not period-locked.

## Project P&L
Columns: every cost centre with postings in the period (parents then children; "Parent › Child"), a "Deleted cost
centre" column if a posting names a centre missing from the master, and **Unallocated**, plus Total. Rows: each
income, direct-cost (Purchases, Direct expenses) and indirect-expense account, then Income, Direct costs, **Margin**
(income − direct costs), Margin %, Indirect expenses and **Net profit / (loss)**. "Group under parent" merges children
into their parent's column. Every income / expense line lands in exactly one column, so the columns add up to the
Profit & loss for the period (tested; the toolbar shows "Ties to the P&L"). CSV and Excel export, Print.

## Budgets vs actual
- Indian FY (April–March). Enter an annual amount spread evenly (exact to the paisa; the odd paise go one each to the
  first months) or month by month.
- View: month, quarter (Apr–Jun = Q1), year to date (April → chosen month) or full year; scope: account-level budgets or
  one cost centre (never mixed, so totals do not double count).
- Actuals from the ledger: income credit − debit, expense debit − credit; an account-level budget compares with every
  posting on the account, a cost-centre budget only with lines tagged to it.
- Variance = actual − budget; % of budget (— when the budget is 0). Income at/above budget and expenses at/below
  budget are **favourable** (`--profit`), the rest **adverse** (`--loss`); the word is also given to screen readers.
  Totals for income, expenses and net (income − expenses; favourable when the actual net is at or above budget).
- **Copy last year's actuals**: each month of the previous FY's actuals × (1 + x%), rounded to the rupee, one line per
  income / expense account with postings (or per account × cost centre; untagged entries are then left out). Existing
  lines for the year are kept unless "Replace" is ticked.
- CSV (with period and scope rows) and Excel (`src/lib/xlsx.ts`, loaded on click).

## Not done / limits
- ~~**Tally XML does not export cost-centre allocations.** Tally needs cost-centre masters, "cost centres applicable"
  on each ledger and `CATEGORYALLOCATIONS.LIST` → `COSTCENTREALLOCATIONS.LIST` per ledger entry; emitting that
  without being able to validate imports in Tally risks rejected vouchers, so vouchers are exported without it.~~
  Done in 7.46: `tally-xml.ts` emits `COSTCENTREALLOCATIONS.LIST` (stale note struck by R6-C6).
  Accounting CSVs do not carry the centre either.
- No percentage split of one bill / line across several centres (one centre per line); one level of grouping only.
- The GST reports, Books (cash basis) P&L and dashboard ignore cost centres.
- Budgets are not period-locked and are not versioned (edit history is in the audit log only).
