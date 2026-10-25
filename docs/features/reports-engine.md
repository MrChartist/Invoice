# Reports engine & Tally report grammar (WP-2)

One accounting truth for every statement, closing stock valued from the inventory, and Tally's report grammar
(Group Summary → ledger → monthly summary → vouchers → voucher, Enter / Esc, Alt+F1, F12, Alt+F2, comparative
columns), plus ratios, registers, exception reports, statistics and funds flow. Every output is a **working paper
— verify with your CA**.

| | |
|---|---|
| UI | Books tabs `day` Day Book, `pnl` Profit & loss, `tb`, `bs`, `cf`, and the new `rpt` **Reports** tab (Group Summary · Registers · Exception reports · Statistics · Funds Flow; Ratio analysis is its own tab). All in the lazy ledger chunk (`LedgerPanel`). |
| Lib (pure) | `src/lib/ledger/` — `reports.ts` (owner; re-exports everything below), `closing-stock.ts`, `report-groups.ts`, `group-summary.ts`, `columns.ts`, `registers.ts`, `exceptions.ts`, `funds-flow.ts`, `drill.ts`; `src/lib/period-context.ts`, `src/lib/report-prefs.ts` |
| Components | `src/components/books/ledger/` — `DrillStack.tsx`, `drill-hooks.ts`, `report-env.ts`, `report-frames.tsx`, `ReportViews.tsx`, `ReportToolbar.tsx`, `DayBookTab.tsx`, `PnlTab.tsx`, `ClosingStockDialog.tsx`, `ReportsHub.tsx`; edited `TrialBalanceTab.tsx`, `BalanceSheetTab.tsx`, `CashFlowTab.tsx`, `LedgerPanel.tsx`, `../PeriodBar.tsx` |
| Shell edits | `src/pages/Books.tsx`: `day` / `pnl` / `rpt` routed to `LedgerPanel`, one `rpt` tab added, period from `usePeriodContext()` |
| i18n | `src/i18n/areas/reports-engine.ts` (`reportsT`, English + Hindi) |
| Tests | `tests/reports-engine.test.ts`; e2e step "reports engine" in `tests/e2e/smoke.mjs` |

## P0-3: one accounting truth
- **Day Book** (`ledgerDayBook(ledger, period, kinds?)`) lists every ledger voucher: documents, receipts, payments,
  advances, manual JV / CV / PV / RV, fixed assets, depreciation, openings — and any posting a later package adds
  to `buildLedger` (payroll, manufacturing, TDS) with no change here. Type filter chips come from the kinds present;
  Alt+F1 shows each voucher's ledger lines (By / To). Totals equal the trial balance's debit / credit movement
  (tested). The old documents-only Day Book component is removed; `books.ts` keeps `buildVouchers` for the cash book.
- **Profit & loss** (`ledgerProfitAndLoss(ledger, period, stock?)`): Tally horizontal layout — **Trading account**
  (Opening stock + Purchase accounts + Direct expenses | Sales accounts + Closing stock → Gross Profit c/o) and
  **Profit & Loss account** (Gross Profit b/f + indirect incomes | indirect expenses → Nett Profit). New fields:
  `trading {sales, openingStock, purchases, directExpenses, closingStock, grossProfit}`, `indirectIncome`,
  `stockLabel`. `netProfit` / `grossProfit` include the stock change; without a valuer they equal the old figures
  (books.ts compatibility tests unchanged). The documents-only P&L stays as **"Documents view (cash / accrual,
  indicative)"** (the untouched `ProfitLossTab`). Optional previous-period column.
- **Balance sheet** (`ledgerBalanceSheet(ledger, asOf, stock?)`): Inventories gets "Closing stock (<method>)";
  capital gets "Opening stock (difference in opening balances)"; this year's stock change is in the profit for the
  year and earlier years' in surplus b/f, so the sheet still ties. New fields `closingStock`, `openingStock`; every
  `BsItem` has `groupId` (drill target) and party detail rows carry `party`.
- **Cash flow** (`cashFlowStatement(…, stock?)`): the stock change is added to profit and removed again as
  "(Increase) / decrease in inventories" — cash is unchanged.
- **Trial balance** stays ledger-pure (closing stock is not a ledger balance); a memo row shows its value.

### Closing stock (`closing-stock.ts`)
A report-time line, never a stored voucher, so `postings.ts` is untouched.

| Mode | Value at date d | Opening stock |
|---|---|---|
| `inventory` | `inventory.computeStock` with the company costing method (FIFO / weighted average): each item's running value after its last movement on or before d; a negative item value counts as nil | item-master opening quantity + dated "opening" moves |
| `manual` | the latest typed entry on or before d, else the typed opening figure | the typed opening figure |
| `none` | not valued (old behaviour: purchases fully expensed) | — |
| absent (automatic) | `inventory` when any item tracks stock, else `none` | |

Statements call `stockChange(stock, end, dayBeforeStart)` → `{opening: value(start − 1) + openings inside, closing: value(end)}`;
opening stock never becomes profit. Config is stored in **`mrchartist_inv_closing_stock`** (one JSON object
`{mode?, opening?, entries: [{date, value (paise)}]}`, company data, backed up and synced like every `mrchartist_inv_*`
key; additive, no migration). Edit it from P&L → **Closing stock**. If you earlier posted closing stock by journal to
Stock-in-hand, choose **Do not value stock** (or reverse those journals) so it is not counted twice.

## P0-4: Group Summary and drill-down
- `groupSummary(ledger, period, groupId | null, {showZero, parties})` → rows (sub-groups, ledgers and, for debtors /
  creditors / customer advances, **party sub-ledgers**) with opening / debit / credit / closing; each row carries
  `children` for the detailed view (`flattenRows(rows, detailed)`). Root totals equal the trial balance.
- `groupVouchers`, `monthlySummary(ledger, accountId, period, party?)` ("Ledger Monthly Summary"), `accountStatement`
  ("Ledger Vouchers"), `partyFigures`, `accountFigures`.
- **Drill model** (`drill.ts`): `DrillLevel` (`group` / `groupVouchers` / `ledger` / `vouchers` / `voucher`),
  `drillDown(level, row)`, `drillTitle(level, ledger)`, `findVoucher`, `voucherTarget(v)` (document link, manual editor, none).
- **Paths in the UI:** BS line → Group Summary → (sub-group) → ledger / party → Ledger Monthly Summary → month →
  Ledger Vouchers → voucher (document page or voucher editor); P&L line → group or ledger, same path; TB group / ledger
  rows; Day Book row → voucher; Reports: Group Summary, register month → vouchers → voucher, negative ledgers → ledger.
- **Group tree adapter** (`report-groups.ts`): reports never read `GROUPS` directly. Default tree = Tally-style headings
  (`head:<slug>` per Schedule III head) → the 24 primaries → **WP-1's user sub-groups** (`allGroups(loadUserGroups())`,
  nested by `parent`) → ledgers (each account in `immediateGroupOf(a)`: its `under` sub-group, else its primary).
  `syncReportGroups()` re-reads the tree (Group Summary and the TB call it). Another tree can be plugged in with
  `setGroupSource({ nodes, groupOfAccount })`. Read API: `reportGroups`, `reportGroup`, `childGroups`, `reportGroupPath`,
  `reportLedgersInGroup`, `ledgersDirectlyIn`, `isDirectGroup`, `natureOfGroup` (prefixed so they do not clash with
  WP-1's `groupPath` / `ledgersInGroup` in `groups.ts`). Debtor / creditor parties are split from the control
  account by party name; parties that WP-1 places in a sub-group are not yet re-homed under that sub-group in the summary.

### DrillStack (reusable — e.g. the Gateway "Display" viewer)
```tsx
import { DrillStack } from '…/books/ledger/DrillStack';
import { useDrill, useDrillRows, useReportPrefs } from '…/books/ledger/drill-hooks';
import { ReportEnvProvider, GroupSummaryView, LedgerMonthlyView, LedgerVouchersView } from '…/books/ledger/ReportViews';
import { groupFrame, ledgerFrame, vouchersFrame, groupVouchersFrame } from '…/books/ledger/report-frames';
import { loadLedger, loadStockValuer } from '…/lib/ledger';

<ReportEnvProvider value={{ ledger, stock: loadStockValuer(), onOpenManual: (v) => openEditor(v.manualId) }}>
  <DrillStack rootTitle="Group Summary" resetKey={`${period.start}:${period.end}`}>
    <GroupSummaryView groupId={null} period={period} />
  </DrillStack>
</ReportEnvProvider>
```
- Enter / click pushes the next frame (`useDrill().push({key, title, render})`); **Esc** pops one level (ignored while
  typing or while a dialog is open); the breadcrumb pops to any level. The root stays mounted (hidden) so its state
  survives; every level remembers its **scroll position and selected row**.
- `useDrillRows(count, onActivate)` → ↑ ↓ Home End PgUp PgDn / Enter with a highlight bar: spread `nav.table` on the
  focusable container, put `id={nav.bodyId}` on the row container and `{...nav.row(i)}` on each row.
- `ReportOptions` (`ReportToolbar.tsx`): **Alt+F1** detailed / condensed, **F12** configure (zero balances, opening
  column, debit / credit columns, narration), comparative-column picker. Keys act only while the bar is visible.
- `loadStockValuer()` / `loadStockPositions()` (`ledger/index.ts`) read the company setting and the inventory.

## P1 reports
- **Comparative columns** (`columns.ts`, P1-2): `columnsFor(period, 'previous' | 'monthly' | 'quarterly')`,
  `previousPeriod` (previous FY / the same months before / the same days before), `groupSummaryColumns(ledger,
  columns, groupId, opts)` — income / expense rows compare movements, balance-sheet rows closing balances. UI: Group
  Summary column picker (any group, including the primary-group root), P&L previous-period column.
- **F12 / report prefs** (`report-prefs.ts`, P1-3): `{detailed, showZero, showOpening, showTransactions, showNarration,
  columns}` per report id, **device-local** in `localStorage['mrchartist_report_prefs']` (outside the `mrchartist_inv_`
  prefix: never backed up or synced).
- **Period context** (`period-context.ts`, P1-26): `usePeriodContext()`, `setPeriodContext(preset, period)`,
  `getPeriodContext()`, `subscribePeriodContext()`; device-local `localStorage['mrchartist_report_period']`; presets are
  re-resolved against today, so "This FY" rolls over by itself. Books uses it; **Alt+F2** switches the period bar to a
  custom range with the cursor in "From". GST / Inventory / Reports pages can adopt it with one hook call.
- **Ratio Analysis** (P1-1): reuses the TDS package's `src/lib/ledger/ratios.ts` / Books → Ratio analysis tab;
  WP-2 added an optional 4th argument `ratioAnalysis(ledger, period, asOf, stock?)` so stock-in-hand, current assets,
  gross / net profit and the stock ratios include the valued closing stock (the tab passes `loadStockValuer()`).
- **Registers** (`registers.ts`, P1-4): `voucherRegister(ledger, 'sales' | 'purchase' | 'journal' | 'payment' |
  'receipt' | 'contra' | 'debit_note' | 'credit_note', period)` month-wise → vouchers → voucher; `columnarRegister`
  (one signed column per ledger the vouchers touch: party, sales, each tax head, round off …).
- **Exception reports** (`exceptions.ts`, P1-5): cash / bank below zero on any day (first date, lowest balance),
  debtors in credit, creditors in debit, asset ledgers in credit, liability ledgers in debit, negative stock (first
  date, lowest quantity), overdue receivables (from `buildReceivables`), post-dated vouchers (dated after today; the
  automatic 31 March depreciation excluded), vouchers the ledger left out (`ledger.warnings`).
- **Statistics** (`voucherStatistics`, P2): voucher counts by type, automatic vs manual, ledgers in use.
- **Funds flow** (`fundsFlow`, P2): funds from operations (net profit + depreciation), opening stock brought in,
  non-current movements (capital, reserves, loans, fixed assets, investments, long-term advances) = change in working
  capital (stock included); `difference` is 0 for consistent books (tested).

## Data
- New company key `mrchartist_inv_closing_stock` (JSON object; in backups automatically; not a record table).
- Device-local, never backed up: `mrchartist_report_prefs`, `mrchartist_report_period`.
- No key renamed; `postings.ts`, `accounts.ts`, `inventory.ts` untouched.

## Gaps / follow-ups
- Memorandum / optional / reversing registers wait for WIP-C's voucher classes: new `LedgerVoucherKind`s appear in the
  Day Book filter, statistics and registers automatically; a dedicated exception section can read them from `ledger.vouchers`.
- Stock summary → item → voucher and receivables ageing → bill drill-downs still use their own pages; `DrillStack` can wrap them.
- Balance sheet stays Schedule III vertical (no Tally horizontal Liabilities | Assets view).
- Comparative columns: Group Summary and P&L only; TB / BS read one period.
- Keys: Alt+F2 (period), Alt+F1 and F12 are handled in the capture phase on Books report screens, so they win over the
  global Tally keys (`src/lib/tally-keys.ts`: Alt+F2 → Gateway period, F12 → Settings) there; elsewhere the global keys apply.
- The Gateway's own Display viewer (`src/lib/gateway/drill.ts`, `DisplayReport.tsx`) predates this engine; pointing it
  at `DrillStack` + `ReportViews` (and passing `loadStockValuer()` to its BS / P&L calls) is left to the lead.
- Closing stock per godown / cost centre and "lower of cost or NRV" are not modelled.
