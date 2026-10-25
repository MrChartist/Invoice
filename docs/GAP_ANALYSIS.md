# Gap analysis: Mr. Chartist Invoice compared with TallyPrime, Busy, Marg, Vyapar, myBillBook and Zoho Books

Written 2026-10-25 against branch `claude/elegant-cannon-cwapiv` @ `92ecbe7`. Point of view: an Indian SME owner and
their CA who already use Tally every day. Sources: `PRD.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, all 32
`docs/features/*.md`, `src/App.tsx`, `src/layouts/DashboardLayout.tsx`, `src/pages/*` and `src/lib/**`. Where a doc and the code disagreed, I checked the
code.

**Legend:** ✅ has · 🟡 partial · ❌ missing · ⛔ not feasible offline (needs a server or a government portal; the
offline alternative is named) · 🚧 **in progress** (another agent is building it now, so it is left out of the work packages below)

**Priority** (for gaps only): **P0** = a Tally user expects it every day and will struggle without it · **P1** = common
· **P2** = nice to have. **Size:** S ≤ 2 days · M ≈ 1 week · L = 2–4 weeks.

**In progress elsewhere (not repeated in the work packages):**
- ✅ **WIP-A Payroll** (`docs/features/payroll.md`): employees, pay heads, attendance, salary structures, PF / ESI / PT / TDS on salary, payslips, statutory payroll reports.
- 🚧 **WIP-B Manufacturing & stock vouchers**: BOM, manufacturing journal, stock journal, physical stock, reorder.
- 🚧 **WIP-C TDS & voucher classes**: TDS deducted on payments, 26Q / 27EQ, optional / memo / post-dated / reversing vouchers, bill-wise payables.
- 🚧 **WIP-D Gateway**: Tally-style Gateway of Tally and F-key voucher entry.
- Also found in other agents' worktrees: 🚧 e-commerce operator (Sec 52 / 9(5)) work in `src/lib/eco.ts` (worktree `agent-a9143…`), and 🚧 Hindi i18n round 2 (Settings, GST, Recurring, Bank).

---

## 1. Executive summary

The app is already far ahead of Vyapar / myBillBook on GST working papers. It also matches Tally on many statutory
details: GSTR-1/3B/9, 2B / IMS matching, amendments, composition, advances (Table 11), e-Invoice / e-Way JSON, MSME
43B(h), the TDS receivable register with 26AS matching, a hash-chained audit log, vault encryption and multi-company.

What a Tally user misses is the **accounting backbone and the "feel" of Tally**, not GST:

1. **Masters and opening balances.** The groups are fixed. Users cannot create groups or sub-groups. A ledger has no opening balance:
   only cash and bank do, through `book_opening`. Parties (clients, vendors) are not ledgers, and there are no bill-wise opening
   outstandings. A CA cannot take a Tally trial balance as at 31 March and start here on 1 April without writing journals by hand.
2. **Two accounting engines disagree.** The Day Book and the P&L tab come from `src/lib/books.ts`, which reads only the documents.
   The trial balance, balance sheet and cash flow come from the double-entry ledger (`src/lib/ledger/`). Manual
   journals and depreciation therefore show in the TB / BS but not in the Day Book or the P&L tab. Closing stock is
   never valued automatically (`docs/features/ledger.md`, "Assumptions"), so a trader's gross profit is wrong.
3. **Purchase-side returns are missing.** There are no supplier debit notes or purchase returns, no rejection in / out, no goods receipt note,
   and supplier credit notes are not recorded (the 2B CDNR lines show as "in 2B only").
4. **Tally's report grammar is missing**: Group Summary → Group Vouchers → Ledger → Voucher drill-down everywhere,
   Alt+F1 detailed / condensed, F12 configure, Alt+C new column, ratio analysis, columnar registers and exception reports.
   Drill-down exists only for TB / BS → ledger.
5. **Inventory masters are thin**: no stock groups or categories, no alternate or compound units, no stock ageing, and no item
   price lists with applicable-from dates.
6. **Data migration from Tally is one-way.** We export Tally XML but cannot import Tally masters, vouchers or opening
   balances. The import wizard reads CSV for clients, items and opening invoices only.
7. **The Tally XML export leaves out supplier payments and every manual journal / contra / payment / receipt voucher**
   (`src/lib/tally-xml.ts:213`), so creditor and bank balances in Tally come out wrong after an import.
8. **The MCA audit trail is not complete.** The audit log is capped at 5,000 rows (`AUDIT_MAX_ROWS`, `src/lib/audit.ts`), and direct
   table writers (purchases, inventory, recurring) are not logged row by row.

The rest of this document lists every item, ranks the gaps, and splits the remaining work into **9 independent
work packages** (section 8).

---

## 2. Feature inventory: what the app has today

| Area | What exists | Where |
|---|---|---|
| Sales documents | Tax Invoice / Invoice, Bill of Supply, Quotation (Accepted / Declined / Expired / Converted), Sales Order (partial fulfilment), Proforma, Delivery Challan, Credit Note (goods-returned flag), Debit Note; conversions; cancel / reinstate; amendments | `src/lib/documents.ts`, `sales-orders.ts`, `quote-status.ts`, `amendments.ts`, `docs/features/documents.md` |
| Numbering | Indian-FY series per doc type (`INV/FY25-26/0001`, CRN, DBN, SO, PO, BOS, STR, ADV, RFV, JV / CV / PV / RV), per-profile prefix, Rule 46 duplicate refusal, gap warnings | `invoice-number.ts`, `localDb.ts`, `audit-lock.md` |
| Tax maths | CGST/SGST/IGST, cess (% and per unit), TCS, TDS (receivable), inclusive pricing, export / SEZ / LUT / deemed export, taxable freight, rounding modes, outward and inward RCM, FX documents | `invoice-calc.ts`, `rcm.ts`, `fx.ts`, `calc-extensions.md`, `freight-fx.md` |
| Purchases | Bills, quick expenses, vendor master, purchase payments, POs → bills (pending qty), RCM / import of goods & services / BoE / ITC reversal / 17(5), MSME 43B(h) + MSMED interest, attachments | `purchases.ts`, `purchase-orders.ts`, `msme.ts`, `purchases.md` |
| Receivables | Party ledger, ageing (Not due / 1–30 / 31–60 / 61–90 / 90+), statements (print / PDF / WhatsApp / mailto), collections, DSO, TDS receivable register + 26AS / AIS matcher + Form 16A received flags, late-fee invoices, interest estimate, reminders (stages, Hinglish), credit limits / days at billing | `receivables.ts`, `tds-register.ts`, `late-fee.ts`, `interest.ts`, `reminders.ts`, `credit-limit.ts` |
| Advances | Receipt vouchers (Rule 50), refunds (Rule 51), apply to invoices, GSTR-1 11A/11B, 3B, ledger, Tally | `advances.ts`, `advances.md` |
| Double entry | Fixed Schedule III chart (24 groups), user accounts under those groups, Journal / Contra / Payment / Receipt vouchers (paise-exact), automatic postings rebuilt from documents, TB, ledger (party filter), Schedule III BS, AS 3 cash flow, fixed-asset register + IT-Act WDV depreciation, cost centres (1 level of parent), Project P&L, budgets vs actual, cash forecast, FX gain / loss | `src/lib/ledger/*`, `cost-centres.ts`, `cash-forecast.ts`, `fx-gain.ts`, `ledger.md`, `cost-centres-budgets.md` |
| Books (document-derived) | Day Book, Cash & bank book, P&L (accrual / cash basis), indicative BS, trend chart | `books.ts`, `components/books/*`, `books.md` |
| Banking | Multiple bank accounts, statement import (HDFC / ICICI / SBI / Axis / Kotak / generic CSV / XLSX), match suggestions, create receipt / expense from a line, Tally-layout BRS; cheque register (received / issued, deposit / clear / bounce, PDC reminders), CTS-2010 cheque printing | `bank-recon.ts`, `bank-accounts.ts`, `cheques.ts`, `cheque-print.ts`, `reconcile-reports.md`, `cash-planning.md` |
| Inventory | Stock items (opening qty / rate, reorder level), weighted avg / FIFO, derived stock, movement, dead stock, margin, batches + MFG / expiry + FEFO, serial / IMEI + warranty, godowns + transfer vouchers, barcodes + label sheets, stock warnings in the editor | `inventory.ts`, `stock-tracking.ts`, `godowns.ts`, `barcode.ts`, `inventory.md` |
| Retail | POS quick bill (F-keys, split tender, 80 mm, Z report, day close), price levels, qty slabs, buy-X-get-Y schemes | `pos.ts`, `pricing.ts`, `pos-barcode-pricing.md` |
| GST returns | GSTR-1 (B2B / B2CL / B2CS / CDNR / CDNUR / EXP / nil / 11A / 11B / HSN B2B-B2C / Docs / amendments) + JSON, GSTR-3B (incl. Rule 88A set-off), 2B / IMS matcher, GSTR-9 working paper, CMP-08 / GSTR-4, compliance calendar + Sec 50 interest + Sec 47 late fee | `gst-reports.ts`, `gstr-json.ts`, `gstr2b.ts`, `gstr9.ts`, `composition-returns.ts`, `compliance.ts` |
| e-Invoice / e-Way | Offline JSON (single + bulk), IRN response import, IRN / signed QR printed | `einvoice*.ts`, `eway.ts`, `einvoice.md` |
| Other billing | Recurring invoices, time tracking, billable expenses, mileage (pure agent), attachments, custom fields (UDF-like) | `recurring.ts`, `timesheets.ts`, `attachments.ts`, `custom-fields.ts` |
| Printing | 26 templates × 7 layouts, Design Studio, A4 / A5 / 80 mm, bilingual Hindi, header note, client-copy HTML with UPI, PDF share (Web Share L2), receipt vouchers, POs, statements | `components/templates/*`, `design-prefs.ts`, `client-copy.ts` |
| Data & security | IndexedDB store, migrations, backups (encrypted, automatic, to a folder), restore with undo, vault encryption (≈ TallyVault), local roles owner / clerk / viewer (≈ security levels), PIN lock, period lock (≈ Tally "Lock" / Edit Log), hash-chained audit log, multi-company, folder sync between devices, Tally XML export, CSV / XLSX exports, CSV / XLSX import wizard (Vyapar / Zoho / Tally / Busy presets) | `storage.ts`, `backup.ts`, `vault.ts`, `access.ts`, `period-lock.ts`, `audit*.ts`, `companies.ts`, `sync-*.ts`, `tally-xml.ts`, `importers.ts` |
| Navigation | Command palette (Ctrl+K), `g d / g i / g t / g c / g s`, `?` overlay, editor keys (Enter → next line, Alt+↑/↓, Ctrl+Enter / Ctrl+S), POS F-keys, notification bell | `useHotkeys.ts`, `components/command/*`, `line-keys.ts` |

---

## 3. Detailed comparison checklist

### 3.A Gateway, keyboard and navigation (TallyPrime)

| Feature | Status | Evidence / what is missing | Pri |
|---|---|---|---|
| Gateway of Tally home menu (Create / Alter / Chart of Accounts / Vouchers / Day Book / Display More Reports / Banking / Utilities) | 🚧 | WIP-D. Today: Dashboard + sidebar groups (`DashboardLayout.tsx`) | — |
| F-key voucher entry: F4 Contra, F5 Payment, F6 Receipt, F7 Journal, F8 Sales, F9 Purchase, Ctrl+F8 Credit Note, Ctrl+F9 Debit Note | 🚧 | WIP-D. Today: separate screens; POS has its own F-keys | — |
| Alt+F7 Stock Journal, Ctrl+F7 Physical Stock (keys) | 🚧 | Voucher logic WIP-B; keys WIP-D | — |
| Alt+C create a master from inside a voucher | 🟡 | Typeahead "save as new client" exists in the editor; no inline ledger / stock item / godown / cost-centre creation from a voucher line or bill | P1 |
| Ctrl+A accept, Esc back / quit with "Quit? Yes/No", Ctrl+Q | 🟡 | Ctrl+Enter / Ctrl+S save in the editor; Esc closes dialogs. Esc does not walk back a report drill-down stack, and there is no consistent Ctrl+A | P0 (part of WP-2 drill stack; key map in WIP-D) |
| Alt+G Go To (any report by name), Ctrl+G switch to | ✅ / 🟡 | Ctrl+K palette searches pages and documents. Missing: report names inside Books tabs (e.g. "Group Summary Sundry Debtors"), and switching while keeping the period | P1 |
| Drill-down from every report to its vouchers (Enter on a row) | 🟡 | TB / BS → ledger (`BalanceSheetTab.tsx:53`, `TrialBalanceTab.tsx:54`); ledger → document; reports → invoice. Missing: P&L rows, Day Book rows, GST tables → vouchers, stock summary → item ledger → voucher, ageing → bill → voucher, and keyboard (↑ ↓ Enter) navigation of report rows | P0 |
| Alt+F1 detailed / condensed toggle | ❌ | None of the statements has an expand-all / collapse-all view | P0 |
| F12 configure (per-report options: show opening, show narration, show zero balances, sort, scale in lakh / crore) | ❌ | No per-report configure panel; Books CSV only | P1 |
| Alt+F2 change period; F2 change date | 🟡 | `PeriodBar` (month / quarter / FY / custom) on Books / Reports. No global "current period" shared across all screens, and no key binding | P1 |
| Alt+C add column (compare periods, e.g. this FY vs last FY, month-wise) / Alt+N auto-repeat columns | ❌ | Budgets have monthly columns; statements have no comparative columns | P1 |
| Ctrl+B basis of values, Ctrl+H change view (TallyPrime) | ❌ | No basis switching (e.g. "include optional vouchers", "show in foreign currency") | P2 |
| Alt+P print / Alt+E export / Alt+M e-mail from any report | 🟡 | Print + CSV on most statements, XLSX on some; no uniform toolbar or keys | P1 |
| Help (F1), shortcut overlay | ✅ | `?` overlay (`ShortcutsOverlay.tsx`), HelpModal | — |
| Number entry "1,00,000" in Indian grouping and amount in words | ✅ | `formatCurrency`, `amountInWords` | — |
| Calculator (Ctrl+N) | ❌ | — | P2 |

### 3.B Masters (Accounts Info / Inventory Info)

| Feature | Status | Evidence / what is missing | Pri |
|---|---|---|---|
| 28 predefined groups (Tally) / Schedule III groups | ✅ | 24 Schedule III `GroupId`s (`src/lib/ledger/accounts.ts:19`) | — |
| **Create groups and sub-groups** (e.g. "Sundry Debtors – Mumbai") with nature and "behaves like sub-ledger", "used for calculation" | ❌ | `GroupId` is a closed union. User accounts must sit directly under one of the fixed groups | P0 |
| **Ledger master with opening balance Dr / Cr** | ❌ | `accounts` rows have `{id, code, name, group}` only. Opening balances exist only for cash / bank (`book_opening`) and per bank account | P0 |
| Parties as ledgers (Sundry Debtors / Creditors) | 🟡 | Clients and vendors are separate masters; the ledger shows them as `party` sub-keys of Debtors (3400) / Creditors (2200). They cannot be placed in a custom group, given an opening balance, or used freely in a journal (only through the `party` field) | P0 |
| **Bill-wise details**: opening bills per party (New Ref with date / due date) | ❌ (receivable) / 🚧 (payable) | No opening outstanding per party except importing "opening invoices" as real invoices, which then wrongly enter GSTR-1 unless they are dated before the period. Bill-wise payables: WIP-C | P0 |
| Credit period / credit limit on a party | ✅ | `Client.credit_limit` / `credit_days` (`types/invoice.ts:222`); vendor due dates | — |
| Interest parameters on a ledger (rate, on Dr / Cr balance, per bill, grace) | 🟡 | Client `late_fee` (% p.a. or flat + grace), Settings-level interest estimate, MSMED interest on payables. Missing: interest on ordinary ledgers (loans given / taken), the Tally Interest Calculation reports, and interest booked by a voucher | P1 |
| GST details on a ledger (registration type, GSTIN, state, "is e-commerce operator", type of supply) | 🟡 | On clients / vendors yes; on income / expense ledgers no (no per-ledger default GST rate / HSN, e.g. "Freight Outward @18%") | P1 |
| GST rate set at company / group / ledger / item level, with date-wise rate history ("Set/alter GST details" with applicable-from) | 🟡 | Rate on the catalogue / stock item and the line; statutory tables are date-keyed in `tax-rules.ts`. No HSN master with rate history; no group-level inheritance | P1 |
| TDS / TCS details on a ledger (nature of payment, deductee type, PAN, Section 206AB) | 🚧 / 🟡 | Client PAN / TAN exist. Payables-side TDS master: WIP-C | — |
| Mailing details, bank details on a party (for e-payments / payment advice) | 🟡 | Address, e-mail and phone yes; **party bank account / IFSC for payouts** missing | P1 |
| Cost centres | ✅ | `cost_centres` with one parent level, project / department / branch | — |
| Cost categories (parallel allocation dimensions) and % split of one entry across centres | ❌ | One centre per line; no categories; no % split (`cost-centres-budgets.md`, "Not done") | P2 |
| Budgets | ✅ | `budgets` (FY × account × centre, monthly) | — |
| Scenarios (budgets + optional / memo vouchers in reports) | ❌ | Needs WIP-C optional vouchers first | P2 |
| Currencies master + rates of exchange (standard / selling / buying by date) | 🟡 | `exchange_rate` per document; no currency master or date-wise rate table (`freight-fx.md`, "Limits") | P2 |
| Voucher Types master (custom types under a base type, numbering method, prefix / suffix with applicable-from, restart yearly / monthly, numbering classes per branch / godown, default print title, default jurisdiction / bank) | 🟡 | Fixed doc types; per-profile prefix and per-type FY series. No user-defined voucher types (e.g. "Sales – Retail", "Sales – Export"), and no monthly restart or class-based series | P1 |
| Voucher classes (preset ledgers and auto-filled GST lines for a voucher type) | ❌ | — | P2 |
| Stock groups (hierarchy) and stock categories (parallel classification) | ❌ | `StockItem` has no group or category (`src/lib/inventory.ts:29`) | P1 |
| Units: simple units with UQC and decimals | 🟡 | Free-text `unit` mapped to UQC at report time (`gst-reports.ts:504`, `einvoice.ts:145`); no units master or decimal places | P1 |
| **Compound units / alternate units** (Box of 12 Nos; purchase in Box, sell in Nos) | ❌ | Not modelled anywhere | P1 |
| Godowns / locations (hierarchy, "our stock with third party", "third party stock with us") | 🟡 | Flat godowns + transfers. No hierarchy or job-work / consignment godown flags | P2 |
| Batches with MFG / expiry | ✅ | `stock-tracking.ts` | — |
| BOM | 🚧 | WIP-B | — |
| Price levels / price lists **with applicable-from date** | 🟡 | `price_levels`, qty slabs (`pricing.ts`); no date validity or price-list history | P2 |
| Standard cost / standard selling price by date; per-item costing method | 🟡 | Company-wide weighted avg / FIFO only; no standard cost, no per-item method, no LIFO / last purchase / at zero cost | P2 |
| Item-wise opening by godown / batch | 🟡 | Opening sits in Main and unbatched (record batches with an "Add stock" adjustment) | P2 |
| `PurchaseLine.item_id` (stable item link instead of name + HSN) | ❌ | Known tech debt (AGENTS.md); renames break stock matching | P1 |
| Multi-masters creation / alteration (bulk edit grid) | ❌ | One-by-one modals; import wizard for clients / items only | P1 |

### 3.C Vouchers (transactions)

| Feature | Status | Evidence / what is missing | Pri |
|---|---|---|---|
| Sales (item invoice and accounting invoice modes) | ✅ / 🟡 | Item invoice ✅. An "as voucher" accounting-mode sales entry (sales of services posted straight to income ledgers, without catalogue lines) is possible only through manual journals | P2 |
| Purchase (item / accounting) | ✅ | Bills + expenses | — |
| Receipt / Payment with bill-wise allocation (Agst Ref / New Ref / Advance / On Account) | 🟡 / 🚧 | Receipts against an invoice = Agst Ref; advances = Advance; unlinked payments = On Account (`receivables.md`). Manual Payment / Receipt vouchers have only a `party` field and **no bill allocation** (`ManualVoucherLine`). Payables: WIP-C | P0 (receivable side, manual vouchers) |
| Contra | ✅ | `CV/` vouchers | — |
| Journal | ✅ | `JV/` vouchers, paise-exact | — |
| Credit Note / Debit Note (sales) | ✅ | CRN / DBN with links, GSTR routing, e-invoice | — |
| **Debit Note to a supplier / purchase return** (goods sent back; GST input reversed; GSTR-2B CDNR matching) | ❌ | No purchase return or supplier-note document. `gstr2b.md`: "Supplier credit notes are not recorded in purchases" | P0 |
| **Supplier credit note received** (rate difference, discount) | ❌ | Same | P0 |
| Optional, memorandum, post-dated, reversing journals | 🚧 | WIP-C | — |
| Narration per voucher and per line | 🟡 | Voucher narration yes; per-line narration no | P2 |
| Multi-currency vouchers (forex ledgers) | 🟡 | FX on sales documents + realised gain / loss; no foreign-currency payment or purchase, no forex bank ledger | P2 |
| Stock journal, physical stock, manufacturing journal | 🚧 | WIP-B | — |
| Delivery Note (outward, before invoice) | ✅ | Delivery Challan with the "challans reduce stock" toggle | — |
| **Receipt Note / GRN** (inward, before the supplier bill) | ❌ | PO → Bill directly; no goods-received document, so stock arrives only with the bill | P1 |
| Rejection Out (return to supplier before billing) / Rejection In (customer rejects a delivery) | ❌ | — | P1 |
| Material Out / Material In (job work) | ❌ | — | P1 |
| Attendance / payroll vouchers | ✅ | WIP-A (`/payroll`) | — |
| Voucher duplication, insert voucher (Ctrl+I), add voucher (Ctrl+A in Day Book), delete with numbering re-sequence choice | 🟡 | Duplicate exists for sales documents. Manual vouchers have no duplicate. Numbering never re-sequences (correct for GST) | P2 |
| Voucher-level cost-centre allocation | ✅ | Per line (`ManualVoucherLine.cost_centre_id`) | — |
| Excise / VAT legacy | n/a | Not relevant post-GST | — |

### 3.D Order processing

| Feature | Status | Evidence / what is missing | Pri |
|---|---|---|---|
| Sales Order with pending qty → challan / invoice | ✅ | `sales-orders.ts` | — |
| Purchase Order with pending qty → bill | ✅ | `purchase-orders.ts` | — |
| Tracking numbers (Delivery Note ↔ Invoice, Receipt Note ↔ Bill) | 🟡 | `sales_order_id` / `order_line_id` / `po_id` / `po_line_id` + `doc_links`. No GRN tracking (no GRN doc) | P1 (with GRN) |
| Sales / Purchase Order Outstanding reports (party-wise, item-wise, due-date overdue) | 🟡 | Per-order fulfilment panel + list filter. No consolidated "Sales Orders Pending" / "Purchase Orders Pending" report by item / party / due date | P1 |
| Order book / order vs delivery analysis | ❌ | — | P2 |
| Quotation with expiry | ✅ | `quote-status.ts` | — |
| Proforma | ✅ | — | — |

### 3.E Manufacturing / job work

| Feature | Status | Evidence / what is missing | Pri |
|---|---|---|---|
| BOM, manufacturing journal, by-products / scrap, additional cost | 🚧 | WIP-B | — |
| Job work in / out orders, material in / out, job work reports, ITC-04 | ❌ | Not in WIP-B's stated scope. ITC-04 (goods sent to job workers) is a statutory return for manufacturers who send goods out for job work | P1 |
| Production plan / material requirement (shortfall vs BOM) | ❌ | Depends on WIP-B | P2 |

### 3.F Inventory reports

| Report | Status | Evidence / what is missing | Pri |
|---|---|---|---|
| Stock Summary (qty, rate, value; opening / inward / outward / closing) with drill-down to item vouchers | 🟡 | Summary + item ledger modal (`LedgerModal`); no group-wise summary (no groups), no inwards / outwards columns for a period with drill to the voucher | P1 |
| Godown summary | ✅ | Godowns tab (multi-godown) | — |
| Movement analysis (party-wise, item-wise, group-wise) | 🟡 | `movementSummary` item-wise; no party-wise "who bought / supplied what" movement | P1 |
| **Stock ageing analysis** (by inward batch / FIFO layer: 0–30 / 31–60 / …) | ❌ | Only "dead stock" | P1 |
| Reorder status | 🚧 | Basic low-stock count exists (`lowStockCount`); full reorder: WIP-B | — |
| Negative stock report | 🟡 | `statusOf` flags negative; there is no exception report listing negative-stock days | P1 (WP-2 exceptions) |
| Batch-wise / expiry report | ✅ | Batches & expiry tab | — |
| Item-wise gross profit / margin | ✅ | Margin tab; Reports → Item profit | — |
| Stock query (one item: stock per godown, last purchase / sale prices, party-wise rates) | 🟡 | Stock chip in the editor; no single "Stock Query" view | P2 |
| Purchase / sales bills pending (goods received not billed / delivered not invoiced) | ❌ | Needs GRN; challan side partly via fulfilment | P1 |
| Physical stock register / variance | 🚧 | WIP-B | — |
| Closing stock valuation feeding P&L and BS | ❌ | `ledger.md`: "Closing stock is not valued automatically (post a journal)" | **P0** |

### 3.G Accounting reports

| Report | Status | Evidence / what is missing | Pri |
|---|---|---|---|
| Balance Sheet (Schedule III vertical) | ✅ | `ledgerBalanceSheet` | — |
| Balance Sheet in Tally horizontal format (Liabilities / Assets) with group drill-down | ❌ | Vertical only | P1 |
| **Profit & Loss from the ledger** (incl. manual journals, depreciation, closing stock; Trading account section) | 🟡 | `ledgerProfitAndLoss` exists (used only by `ProjectsTab`); the **P&L tab uses `books.ts`**, which reads only the documents. The two disagree once journals or depreciation exist | **P0** |
| Trading account (opening stock + purchases + direct exp → gross profit with closing stock) | ❌ | No opening / closing stock lines | P0 (with closing stock) |
| Trial Balance (group-wise, ledger-wise, opening / transactions / closing columns) | 🟡 | Ledger-wise with opening / Dr / Cr / closing. Missing: group-wise condensed view with expand (Alt+F1) | P0 (with groups) |
| **Day Book from the ledger** (all vouchers incl. manual JV / CV / PV / RV, fixed assets, advances, transfers) with voucher-type filter | 🟡 | Day Book tab reads `books.buildVouchers` (documents only). Manual vouchers appear only on the Vouchers tab | **P0** |
| Ledger (account books) with opening, running balance, narration toggle | ✅ | `accountStatement` | — |
| Group Summary / Group Vouchers | ❌ | — | P0 |
| Cash Book / Bank Book | ✅ | Cash & bank tab; per bank account balance | — |
| Cash Flow (Tally: month-wise inflow / outflow) and Funds Flow | 🟡 / ❌ | AS 3 cash-flow statement ✅; Tally-style monthly cash in / out ❌; funds flow ❌ | P1 / P2 |
| **Ratio Analysis** (working capital, cash-in-hand, current ratio, quick ratio, debt / equity, gross / net profit %, inventory turnover, receivable turnover in days, return on WC) | ❌ | `computeDso` only | P1 |
| Sales / Purchase / Journal registers (month-wise totals → voucher list), columnar registers (choose columns: GSTIN, taxable, each tax head, narration) | 🟡 | Reports "By month" (sales), invoice list XLSX. No register for purchases / journals / payments, and no columnar configuration | P1 |
| **Outstandings: receivables bill-wise with ageing and interest** | ✅ / 🟡 | Ageing + bill expansion ✅; interest-in-report 🟡 (late fee and interest estimate separate); ageing by **due date vs bill date** switch ❌; custom ageing slabs ❌ | P1 |
| Outstandings: payables bill-wise | 🚧 | WIP-C | — |
| Ledger outstandings / group outstandings (e.g. all debtors of "Mumbai" group) | ❌ | Needs custom groups | P1 |
| Cost centre reports (category summary, centre break-up, ledger-wise per centre) | 🟡 | Project P&L by centre ✅; centre-wise ledger / break-up of a ledger by centre ❌ | P2 |
| Budget variance | ✅ | Budgets tab | — |
| Statement of accounts: "Confirmation of Accounts" letter, "Reminder Letters" print | 🟡 | Statements + reminders exist; no formal balance-confirmation letter for year-end audit | P1 |
| Interest calculation reports (party-wise, ledger-wise, bill-wise) | 🟡 | Estimates only, no report list | P1 |
| Forex gain / loss | ✅ | FX tab | — |
| Comparison of periods (this year vs last, month-wise columns) | ❌ | See Alt+C | P1 |
| Statistics (voucher counts per type, account counts) | ❌ | — | P2 |

### 3.H Exception reports (Tally "Exception Reports")

| Report | Status | Evidence / what is missing | Pri |
|---|---|---|---|
| Negative ledgers (cash in hand negative, debtor with credit balance) | ❌ | — | P1 |
| Negative stock | 🟡 | Flag only | P1 |
| Overdue receivables / payables | ✅ / 🚧 | Ageing + notifications; payables WIP-C | — |
| Memorandum register, optional vouchers, post-dated summary, reversing journals | 🚧 | WIP-C (the register views can come from WIP-C or WP-2) | — |
| Unbalanced / problem vouchers | 🟡 | `ledger.warnings` on the Vouchers tab | P2 |
| Unreconciled bank entries | ✅ | BRS / reconcile | — |
| GST "Uncertain transactions" (TallyPrime GST: incomplete HSN / GSTIN / POS, mismatched tax) | 🟡 | Reconciliation banner on GST reports (`gst-reports.md`); no list with a "resolve" drill into each voucher | P1 |
| Edited after printing / edit log | 🟡 | Audit log per document; no "altered after sharing" flag | P2 |

### 3.I GST (statutory)

| Feature | Status | Evidence / what is missing | Pri |
|---|---|---|---|
| GSTR-1 all main tables + JSON | ✅ | `gst-reports.ts`, `gstr-json.ts` | — |
| IFF (QRMP) | 🟡 | Due date in the calendar; no separate IFF B2B-only JSON for months 1–2 | P2 |
| GSTR-3B incl. Rule 88A set-off | ✅ | — | — |
| GSTR-2A | ⛔ | Portal-only; the offline alternative is the 2B import | — |
| GSTR-2B / IMS matcher | ✅ | `gstr2b.ts` (the loaded file is kept in memory only; decisions persist) | — |
| GSTR-9 | ✅ | `gstr9.ts` (limits listed in its doc) | — |
| **GSTR-9C** (reconciliation of audited financials with GSTR-9: turnover, tax, ITC) | ❌ | — | P1 (only above ₹5 cr turnover, but CAs prepare it) |
| CMP-08 / GSTR-4 | ✅ | — | — |
| e-Invoice JSON + IRN import + QR on print | ✅ | — | — |
| e-Invoice ShipDtls / DispDtls / PayDtls | ❌ | `einvoice.md`, "Limits" | P1 |
| e-Way bill JSON (incl. transporter, vehicle) | ✅ | `eway.ts`, `EInvoiceModal.tsx` | — |
| e-Way consolidated / Part-B update / extension | ⛔ / ❌ | Portal; a consolidated-EWB JSON could be generated offline | P2 |
| Direct IRP / GSP / portal filing, 2B auto-fetch, GSTIN live verification | ⛔ | Offline-tool JSON in / out, checksum validation (`gstin.ts`) | — |
| GST liability / ITC set-off **posting** (Tally "Stat Payment" / GST adjustment journals: Dr Output, Cr Input; Dr Output, Cr Electronic cash ledger; interest / late fee ledgers) | ❌ | 3B computes set-off, but nothing posts it to the ledger, so Duties & Taxes balances keep growing. Account 2360 (electronic cash ledger) exists but is unused by any flow | **P0** |
| GST challan (PMT-06) record with CIN / BRN and allocation per head (tax / interest / penalty / fee / others) | ❌ | — | P0 (with set-off) |
| RCM: self-invoice (Rule 46(f)) for unregistered purchases, payment voucher (Rule 52) | 🟡 | RCM tax computed and posted to 2310; no self-invoice document or series | P1 |
| ITC-04 (job work) | ❌ | — | P1 (with job work) |
| ISD (GSTR-6), TDS / TCS under GST (GSTR-7 / 8) | ❌ | Niche for SMEs | P2 |
| E-commerce operator Sec 52 / 9(5), GSTR-1 Table 14 / 15 | 🚧 | Worktree `src/lib/eco.ts` | — |
| Export amendments (EXPA), HSN / doc amendments | ❌ | `composition-amendments.md`, "Not covered" | P2 |
| Cess on purchase bills | ❌ | ROADMAP Phase 3 known gaps | P1 |
| HSN master with description, UQC, rate history | 🟡 | HSN on the item / line; no master | P1 |
| GST rate-wise / HSN-wise sales and purchase registers | 🟡 | Tax by rate (sales) ✅; purchase-side HSN / rate register ❌ | P1 |
| Annual computation: GSTR-1 vs 3B vs books reconciliation (month-wise) | 🟡 | GSTR-9 "differences"; no standing monthly 1-vs-3B-vs-books table | P1 |

### 3.J TDS / TCS (income tax)

| Feature | Status | Evidence / what is missing | Pri |
|---|---|---|---|
| TDS receivable (customers deduct) + 26AS / AIS matching + Form 16A tracker | ✅ | `tds-register.ts` | — |
| TDS deduction on payments / bills (194C / J / H / I / Q …), threshold tracking, 206AB higher rate, lower-deduction certificates | 🚧 | WIP-C | — |
| 26Q / 27EQ returns | 🚧 | WIP-C | — |
| 24Q (salary) | ✅ | WIP-A (payroll, Annexure I / II working) | — |
| 27Q (non-resident payments, DTAA rates) | ❌ | Not in WIP-C's stated scope | P2 |
| TDS challan (ITNS 281) record with BSR / CIN and challan reconciliation (CSI file match) | ❌ / 🚧 | Ask WIP-C; if not covered → WP-6 | P1 |
| Form 16A / 27D generation (issuing certificates to deductees) | ❌ / 🚧 | TRACES issues the official one (⛔); offline: a summary "TDS certificate working" PDF | P2 |
| TCS on sale of goods (206C(1H)) | ✅ | Withdrawn from Apr 2025; dated presets in `tax-rules.ts` | — |
| Interest on late TDS deduction / payment (Sec 201(1A)), late fee 234E | ❌ | — | P2 |

### 3.K Payroll — ✅ WIP-A done (`docs/features/payroll.md`)

Employees, employee groups, pay heads (earnings / deductions / employer contributions), attendance / production types,
salary structures, payroll vouchers, PF (ECR text), ESI, PT (state slabs), TDS on salary (24Q, Form 16), payslips,
pay sheet, statutory reports. Two follow-ups, P2, for after WIP-A: gratuity and bonus provisions, and loans / advances to employees.

### 3.L Banking

| Feature | Status | Evidence / what is missing | Pri |
|---|---|---|---|
| Bank reconciliation (manual + statement import + auto-suggest) | ✅ | `bank-recon.ts` | — |
| BRS print | ✅ | Tally layout | — |
| **Each bank account as its own ledger** in TB / BS / Tally export | 🟡 | `bank_accounts` per account exist, but the ledger, Books bank book and Tally keep **one Bank total (3510)** (`reconcile-reports.md`) | **P0** (a Tally user has "HDFC CA", "SBI OD" ledgers) |
| Cheque register, PDC management, reminders | ✅ | `cheques.ts` | — |
| Cheque printing (CTS-2010, offsets) | ✅ | `cheque-print.ts` | — |
| Cheque covering several invoices | ❌ | One link per cheque (`cash-planning.md`, "Known gaps") | P1 |
| Bounce charges posting | ❌ | Same doc | P2 |
| Deposit slip (pay-in slip print, cheques + cash denominations) | ❌ | — | P1 |
| Payment advice (to vendors: bills settled, TDS deducted) | ❌ | — | P1 |
| e-Payments: bulk payment upload file in a bank format (HDFC / ICICI / SBI CMS / generic NEFT-RTGS CSV) | ❌ | Feasible offline (file generation only). Needs party bank details | P1 |
| Connected banking (live statement feed, payment initiation) | ⛔ | Statement CSV / XLSX import; bulk upload file | — |
| UPI collection / payment links | ⛔ / ✅ | Gateways ⛔; UPI QR + `upi://` deep links + UTR matching ✅ | — |
| Cash denominations (cash tally at day end) | 🟡 | POS day close counts cash; no denomination grid; not for non-POS cash | P2 |
| Inter-bank transfer, cash withdrawal / deposit as contra | ✅ | Contra vouchers (but with one Bank ledger) | — |

### 3.M Data management, security and audit

| Feature | Status | Evidence / what is missing | Pri |
|---|---|---|---|
| Multiple companies | ✅ | `companies.ts` (one IndexedDB per company) | — |
| Group company / consolidation | ❌ | — | P2 |
| **Split company by period / start a new FY company with carried-forward balances** | ❌ | Not needed for continuity (one company spans years and the FY numbering resets), but there is no year-end close checklist, no "freeze last year" step beyond the period lock, and no way to archive old years to shrink the data set | P1 |
| Year-end: closing stock, provisions, depreciation run, P&L to reserves | 🟡 | Depreciation automatic; P&L rolls into reserves automatically; closing stock ❌; no year-end wizard | P1 |
| Backup / restore (encrypted, automatic, folder) | ✅ | `backup.ts`, `auto-backup.ts` | — |
| TallyVault (encryption) | ✅ | Vault mode (`vault.ts`) | — |
| Security levels / users | ✅ | Owner / clerk / viewer (`access.ts`). Missing: custom role builder (Tally allows per-voucher-type rights, "allow back-dated entry N days") | P2 |
| **Audit trail per MCA rule** (Companies (Accounts) Rules, Rule 3(1) proviso, from 1 Apr 2023: edit log of every change to books, cannot be disabled, kept 8 years) | 🟡 | Hash-chained log ✅, but **capped at 5,000 rows**, oldest dropped (`AUDIT_MAX_ROWS`, `src/lib/audit.ts:26`); direct table writes (purchases, inventory, recurring schedule edits, importer rows) are not logged row by row (`audit-lock.md`, "Limits"); no "before / after" capture for every table | **P0** for companies / their auditors |
| Edit Log view per voucher (TallyPrime 3.0+) | 🟡 | Document timeline / Activity panel for invoices; not for purchases, vouchers, stock | P1 |
| Import from Tally: masters + vouchers XML ("Import of data"), opening TB | ❌ | Import wizard: CSV / XLSX clients, items, opening invoices only (`import.md`) | **P0** (migration is the first thing a Tally user does) |
| Export to Tally XML (masters + vouchers) | 🟡 | `TallyVoucherType` is only `Sales / Credit Note / Receipt / Purchase / Payment` (`src/lib/tally-xml.ts:213`). **Supplier payments, manual Journal / Contra / Payment / Receipt vouchers, fixed-asset purchases and depreciation are not exported** (`Payment` is used only for advance refunds). Also missing: cost centres, godowns, batches, stock transfers, FX at the realised rate (`exports.md`, `inventory.md`, `freight-fx.md`) | **P0** (supplier payments + manual vouchers) / P1 (the rest) |
| Excel / CSV export of masters and vouchers | ✅ / 🟡 | Registers, parties, items, GST; no "all vouchers" export or chart-of-accounts export with balances | P1 |
| Excel import of ledgers / vendors / stock items / opening balances / vouchers | 🟡 | Clients, items, invoices only | P0 (ledgers + openings) / P1 (vouchers, vendors, stock items) |
| Data verification / repair (Tally "Repair") | 🟡 | Migrations, storage health, backup validation, audit chain verify; no "books integrity check" (orphan payments, links, unbalanced vouchers, negative stock, numbering) | P2 |
| Remote access / Tally on cloud / browser access | ⛔ | Folder sync between devices (`sync.md`, Chrome / Edge desktop) | — |
| Data sync between branches | 🟡 | Folder sync | — |
| Period lock / back-dated entry restriction | ✅ | `period-lock.ts` | — |

### 3.N Printing and communication

| Feature | Status | Evidence / what is missing | Pri |
|---|---|---|---|
| Invoice customisation (templates, logo, signature, fields, bilingual) | ✅ | 26 templates + Design Studio | — |
| **Multiple copies in one print** (Original for Recipient / Duplicate for Transporter / Triplicate for Supplier, Rule 48) | 🟡 | One static `header_note` ("e.g. Original for recipient", `DesignPanel.tsx:420`). No copy selector that prints N labelled copies in one PDF / print job | **P0** (goods traders print triplicate daily) |
| Print preview | ✅ | — | — |
| Print configuration at print time (Tally F12 on print: copies, with / without logo, signature, bank details, rate column, "Print as Delivery Note") | 🟡 | Design Studio is global; no per-print overrides | P1 |
| Voucher printing (Journal / Payment / Receipt / Contra vouchers with "Prepared by / Checked by / Authorised by") | 🟡 | Receipt and advance vouchers print; manual JV / PV / CV / RV do not | P1 |
| Batch print / ZIP of PDFs for a period | ❌ | `zip.ts` ready, not wired (`import.md`) | P1 |
| Print reports (all statements) with company header, period and page numbers | 🟡 | Print styles exist; inconsistent headers | P2 |
| E-mail a document / report | 🟡 / ⛔ | `mailto:` (no attachment) + Web Share of the PDF; app-sent e-mail ⛔ | — |
| WhatsApp a document | ✅ / ⛔ | `wa.me` text + PDF share sheet; WhatsApp Business API ⛔ | — |
| Bulk statements / reminder letters to all overdue parties | 🟡 | One at a time (`ReminderModal`) | P1 |
| Barcode / label printing | ✅ | Label sheets | — |
| Thermal 80 mm | ✅ | — | — |
| Dot-matrix / pre-printed stationery mode | ❌ | Older Tally / Busy users print on pre-printed forms | P2 |

### 3.O MIS and dashboards

| Feature | Status | Evidence / what is missing | Pri |
|---|---|---|---|
| Dashboard (sales, receivables, net profit, low stock, attention list) | ✅ | `Dashboard.tsx`, `stats.ts` | — |
| Configurable TallyPrime 4.0+ dashboard tiles (cash, bank, payables, GST payable, top items, stock value) | 🟡 | Fixed cards; no payables / GST payable / bank-wise tiles; no tile picker | P1 |
| Sales person / agent / broker-wise reports and commission (Busy, Marg) | ❌ | — | P2 |
| Area / route / beat-wise sales (Marg distribution) | ❌ | — | P2 |

### 3.P Strengths of Busy, Marg, Vyapar, myBillBook and Zoho Books

| Feature | Who has it | Status | Notes | Pri |
|---|---|---|---|---|
| Barcode and POS | Vyapar, myBillBook, Marg, Busy | ✅ | `/pos`, scan | — |
| Weighing-scale barcodes (price / weight embedded "2…" EAN-13), cash-drawer kick (ESC/POS via Web Serial) | Marg, Busy | ❌ | `pos-barcode-pricing.md`, "Limitations"; Web Serial is offline-capable (Chrome) | P2 |
| POS returns / exchange screen | Vyapar, Marg | ❌ | A credit note from the invoice list only | P1 |
| Loyalty points / wallet | Vyapar, myBillBook, Marg | ❌ | Nothing in the code | P2 |
| Multi-price / price lists | Tally, Marg, Vyapar | ✅ | Price levels + slabs | — |
| Bill-value offers, "buy A get B", coupon discounts | Vyapar, Marg | ❌ | Same-item schemes only | P2 |
| MRP-based billing, MRP-inclusive tax back-calculation, Retail Sale Price (RSP) | Marg, Busy (pharma) | 🟡 | MRP stored on items / batches; inclusive pricing exists; no "bill at MRP minus %" mode | P2 |
| Pharma: drug licence no. on parties / print, schedule H / H1 register, salt / composition search, near-expiry return to supplier (breakage / expiry claims) | Marg | ❌ | Batch / expiry base exists | P2 |
| E-commerce, online store | Vyapar, myBillBook, Zoho Commerce | ⛔ | Offline alternative named in the ROADMAP: a **static catalogue HTML** to share. **Not built** (no code found) | P2 |
| Payment reminders | all | ✅ | `reminders.ts` | — |
| Recurring invoices | Zoho, Vyapar, myBillBook | ✅ | — | — |
| Client portal | Zoho | ⛔ / ✅ | Client-copy HTML with UPI pay | — |
| Expense receipt OCR (autoscan) | Zoho, myBillBook | ⛔ | Cloud OCR ⛔ (on-device OCR would add a heavy dependency); attachments + manual entry ✅ | — |
| Projects / timesheets | Zoho | ✅ | `/time`, cost centres as projects | — |
| Approvals (maker-checker: a clerk's invoice / bill / payment awaits owner approval before it is issued) | Zoho, Busy | ❌ | Local roles exist, so this is feasible offline | P1 |
| Branches (separate GSTIN per branch, branch-wise reports, inter-branch stock transfer with tax invoice) | Zoho, Busy, Tally (multi-GSTIN) | 🟡 | Multi-profile sender identities (several GSTINs), cost-centre kind "branch", filer-GSTIN filter on GST reports. Missing: branch-wise P&L / TB, branch stock transfer as a taxable supply between distinct persons | P1 |
| Delivery challans | all | ✅ | — | — |
| Transport details on invoice (transporter, LR / GR no., vehicle, e-way no. printed) | Tally, Busy, Vyapar | 🟡 | Captured in the e-Way dialog; check that LR no. / transporter print on all templates; no transport details on the invoice form itself | P1 |
| Service / AMC management (contracts, visit schedule, renewal reminders, warranty claims, job cards) | Busy, Marg ERP, Vyapar (lite) | ❌ | Recurring + serial warranty lookup exist as building blocks | P2 |
| Quotation templates / terms library, quote versions (revisions) | Zoho | 🟡 | Default terms; no revision history (Q-001 Rev 2) | P2 |
| Sales targets, party-wise schemes and discounts | Marg, Busy | ❌ | — | P2 |
| Multi-language UI | Vyapar, myBillBook | 🟡 / 🚧 | Hindi round 2 in progress | — |
| Mobile app | all | ✅ | PWA, bottom tab bar | — |
| SMS / e-mail automatic sending | Vyapar, Zoho | ⛔ | `wa.me` / `mailto:` / `sms:` links | — |
| Automatic bank feeds | Zoho | ⛔ | CSV / XLSX import | — |
| Automatic FX rates | Zoho | ⛔ | Typed rate; a currency-rate table imported from RBI / FBIL CSV (P2) | — |
| Vendor portal, customer self-service | Zoho | ⛔ | — | — |
| Inventory adjustments with reasons, landed cost allocation (freight / duty spread on items) | Zoho, Busy | 🟡 / ❌ | Adjustments ✅ (reason free text); landed cost ❌ | P2 |
| Composite items / kits | Zoho, Vyapar | ❌ / 🚧 | Overlaps BOM (WIP-B): a "kit" sold as one line that consumes components | P2 |

---

## 4. Prioritised gaps: P0 (build first)

Each item lists what to build, the files it touches, size, dependencies, and the "Tally feel" to aim for. WP-n = the work package in section 8.

### P0-1 Groups, ledgers and opening balances ("Accounts Info") — WP-1, size L
- **Build:** user-defined groups and sub-groups under the Schedule III primaries (name, parent, nature inherited,
  "behaves like sub-ledger", "net Dr/Cr in reports"). Ledger master gains an `opening_balance` (paise, Dr / Cr) and
  `opening_as_of`, optional GST / TDS defaults, interest parameters and party bank details. The opening difference posts to "Difference in opening balances"
  (1090, already exists). The warning banner reads "Difference in opening balances: ₹x Dr", exactly Tally's wording.
- **Party ledgers:** let a client / vendor carry an `opening_balance` and optional `group_id` (a sub-group of Sundry
  Debtors / Creditors). The ledger shows parties under their sub-group.
- **Touches:** `src/lib/ledger/accounts.ts` (open `GroupId` to `string` with built-in ids kept stable; new `groups`
  table), `src/lib/ledger/postings.ts` (opening vouchers dated the day before `opening_as_of`; coordinate with WIP-C),
  `src/components/books/ledger/ChartTab.tsx`, new `src/components/masters/*`, `src/types/invoice.ts` (`Client`, additive), `src/types/purchases.ts`
  (`Vendor`, additive, plus a `tests/purchase-contract.test.ts` row), `src/lib/backup.ts` (`RECORD_TABLES` for `groups`).
- **Depends on:** nothing. Unblocks the group summary (P0-4) and the opening TB import (P0-7).
- **Tally feel:** screen titles "Group Creation", "Ledger Creation", "Chart of Accounts". Fields in Tally order (Name,
  (alias), Under, Opening Balance with Dr / Cr). Enter moves field to field; Ctrl+A accepts; Alt+C from any ledger field.

### P0-2 Bill-wise opening outstandings for debtors — WP-1, size M
- **Build:** an `opening_bills` table: `{party_key, side: 'receivable'|'payable', ref_no, date, due_date, amount, dr_cr}`.
  Receivables ageing, statements, the receipt "Agst Ref" picker and the ledger read these bills like invoices, but they
  are **never** in GSTR / revenue / stock. The payable side is defined here and consumed by WIP-C.
- **Touches:** new `src/lib/opening-bills.ts`, `src/lib/receivables.ts` (`buildReceivables` input), `src/components/modals/PaymentModal.tsx`
  (allocate against an opening ref), `src/lib/ledger/postings.ts` (opening bill vouchers, or reuse P0-1's opening voucher with bill breakup).
- **Tally feel:** "Bill-wise Details for: <party>" sub-screen with Type of Ref (New Ref), Name, Due Date / Credit Days,
  Amount, Dr / Cr; the total must equal the ledger opening balance.

### P0-3 One accounting truth: Day Book and P&L from the ledger, plus closing stock — WP-2, size M
- **Build:** switch the Day Book to vouchers from `buildLedger`, so it includes manual JV / CV / PV / RV, depreciation,
  fixed assets, advances and opening entries. Keep a type filter (Sales / Purchase / Receipt / Payment / Journal /
  Contra / Credit Note / Debit Note / Stock Journal once WIP-B lands). Switch the P&L tab to `ledgerProfitAndLoss`, with a
  **Trading account** block (Opening stock + Purchases + Direct expenses − Closing stock = Gross profit). Keep the books.ts cash-basis P&L as a
  "Cash basis (indicative)" view.
- **Closing stock:** new `src/lib/ledger/closing-stock.ts` values stock as at the period end through
  `inventory.computeStock` (company costing method). It is shown in the P&L (Trading) and the BS (Inventories), the way
  Tally does when "Integrate accounts and inventory" is on, with a toggle to use a typed closing-stock figure instead
  (ledger "Closing Stock" with a date-wise value). Build it as a report-time line, not a stored voucher, so `postings.ts` stays untouched.
- **Touches:** `src/components/books/DayBookTab.tsx`, `ProfitLossTab.tsx`, `src/pages/Books.tsx` (tab wiring — lead),
  `src/lib/ledger/reports.ts` (`ledgerProfitAndLoss` / `ledgerBalanceSheet` take an optional closing-stock provider), new
  `closing-stock.ts`. Tests: the ledger P&L ties to the BS profit; `tests/integration/ledger-year.test.ts`.
- **Depends on:** nothing (WIP-B stock journals feed in automatically if they extend `collectEvents`).
- **Tally feel:** P&L horizontal by default (Particulars | Particulars), with "Gross Profit c/o" / "b/f" and "Nett Profit".

### P0-4 Group Summary, drill-down everywhere, Alt+F1 — WP-2, size L
- **Build:** a `groupSummary(ledger, period, groupId)` report (sub-groups and ledgers with opening / Dr / Cr / closing)
  and "Group Vouchers". A drill stack component: Enter / click goes one level down, **Esc goes back one level** and keeps the
  scroll and selected row. BS → Group → Ledger → Voucher (opens the document / voucher editor); P&L the same; TB
  group-wise with Alt+F1 expand-all; Day Book row → voucher; stock summary → item → voucher; ageing → bill → voucher.
  Rows are keyboard-navigable (↑ ↓ Enter, Home / End, PgUp / PgDn) with a visible highlight bar.
- **Touches:** new `src/lib/ledger/group-summary.ts`, new `src/components/books/ledger/DrillStack.tsx` + `GroupSummaryTab.tsx`,
  `BalanceSheetTab.tsx`, `TrialBalanceTab.tsx`, `LedgerTab.tsx`, `DayBookTab.tsx`, inventory `LedgerModal.tsx` (read-only drill target).
- **Depends on:** P0-1 for custom groups (works on the built-in groups before that). Key bindings in coordination with WIP-D.
- **Tally feel:** report titles in Tally words ("Group Summary", "Ledger Vouchers", "Day Book"), a period strip at top-right, Alt+F1
  "Detailed / Condensed" button label, Esc back.

### P0-5 Purchase returns, supplier debit / credit notes — WP-3, size M — ✅ done (`docs/features/purchase-returns.md`; P1-8 GRN / Rejections Out and P1-12 purchase side done too, P1-9 open)
- **Build:** a `PURCHASE_RETURN` / supplier debit note document (`DN/FY…` our series) against a bill: lines limited to
  the billed quantities, goods leave stock, ITC reversed. Also a "supplier credit note received" entry (the supplier's
  number / date, value-only or with goods). GSTR-2B CDNR lines match these. 3B nets ITC in 4A(5) (supplier notes reduce ITC; verify with your CA).
  Ledger: Dr Creditor, Cr Purchase returns (new account "Purchase returns" under Purchases) + Input heads. Tally export: Debit
  Note voucher.
- **Touches:** `src/types/purchases.ts` (additive `kind: 'RETURN' | 'SUPPLIER_CN'`, `return_of`), `src/lib/purchases.ts`,
  new `src/lib/purchase-returns.ts`, `src/components/purchases/ReturnModal.tsx`, `src/lib/inventory.ts` (`collectEvents`
  purchase-return effect: coordinate with WIP-B), `src/lib/gst-reports.ts` (ITC net), `src/lib/gstr2b.ts` (`bookBills` include notes),
  `src/lib/ledger/postings.ts`, `src/lib/tally-xml.ts`, `tests/purchase-contract.test.ts` (Critical Rule 9: every reader).
- **Depends on:** coordinate with WIP-C (bill-wise payables: the return must reduce the bill's balance as an Agst Ref).
- **Tally feel:** "Debit Note" voucher (Ctrl+F9 from the purchase side), "Original Invoice No. / Date" fields, reason
  for note (GST "Reason for issuing note" list).

### P0-6 GST set-off and payment posting — WP-6, size M
- **Build:** from the GSTR-3B of a period, a "GST liability set-off" journal (Dr Output IGST / CGST / SGST / cess,
  Cr Input heads per Rule 88A order, already computed in 3B) and a "GST payment" voucher (PMT-06 challan: CIN, BRN,
  date, bank; per head tax / interest / late fee / penalty / others → Dr electronic cash ledger 2360, Cr Bank; then
  set-off from the cash ledger). Late fee and interest go to expense ledgers. A "Liability to be paid" vs "Paid" card on the GSTR-3B tab.
- **Touches:** new `src/lib/gst-setoff.ts`, `src/components/gst-reports/Gstr3bView.tsx` (button + dialog), writes
  `vouchers` through the public `saveVoucher` API (no `postings.ts` edit), new `gst_challans` table.
- **Depends on:** none. If WIP-C adds voucher classes, use them.
- **Tally feel:** Tally's "Stat Payment" (Alt+S in a Payment voucher) and "GST Adjustment" journal, with the same names
  "Increase of Tax Liability", "Decrease of Tax Liability", "Set Off of GST".

### P0-7 Migration from Tally (masters, opening TB, vouchers) — WP-7, size L
- **Build:** a Tally XML importer (`ENVELOPE/BODY/IMPORTDATA/REQUESTDATA/TALLYMESSAGE` with `GROUP`, `LEDGER`,
  `STOCKITEM`, `STOCKGROUP`, `UNIT`, `GODOWN`, `VOUCHER`): masters → groups / ledgers with openings / parties (GSTIN,
  state, credit period, bill-wise openings from `BILLALLOCATIONS`) / stock items with opening. Vouchers → sales and purchase
  documents (only if the user wants history; default: opening balances as at a date). Also an Excel template path:
  "Trial balance as at 31-Mar" (Ledger, Group, Dr, Cr) and "Outstanding bills". Dry run with an error report, as in the existing wizard.
- **Touches:** new `src/lib/tally-import.ts` (pure, tested), new `src/components/import/TallyImport.tsx` (a separate modal,
  not the CSV wizard), writes through P0-1 / P0-2 APIs and `localDb`. Reuses `src/lib/xlsx.ts`.
- **Depends on:** P0-1, P0-2 (API contracts can be agreed first and built in parallel).
- **Tally feel:** steps named the way a Tally user exports ("Display More Reports → List of Accounts → Export XML",
  "Day Book → Export"); the trial balance after import must match the Tally TB to the paisa, shown side by side.

### P0-8 Each bank account as a ledger — WP-5, size M
- **Build:** a posting-line `bank_account_id` resolves to a per-account ledger ("HDFC Bank CA", group Bank Accounts or
  Bank OD for overdrafts). The TB / BS show each account; contra between banks works; the Books bank book picks an account;
  Tally export emits one ledger per bank. The main account keeps id 3510, so old data is unchanged.
- **Touches:** `src/lib/ledger/postings.ts` (receipts / payments / advances / cheques carry `bank_account_id`;
  coordinate with WIP-C), `src/lib/ledger/accounts.ts` (synthesise bank ledgers from `bank_accounts`), `src/lib/books.ts`
  (bank book per account), `src/lib/tally-xml.ts`, `src/components/bank/BankAccountsCard.tsx` (OD flag, opening).
- **Tally feel:** banks are ledgers under "Bank Accounts" / "Bank OD A/c", visible in the Contra F4 picker.

### P0-9 Multiple invoice copies (Original / Duplicate / Triplicate) — WP-4, size S–M
- **Build:** a print / PDF option "Copies: Original for Recipient, Duplicate for Transporter, Triplicate for
  Supplier, Extra copy". It renders the same snapshot N times with a per-copy banner (accent colour; the banner is a template part)
  into one multi-page PDF / print job. A per-profile default (goods: 3 copies; services: 2, "Duplicate for supplier", Rule 48 / 49).
- **Touches:** `src/components/preview/InvoicePreview.tsx`, new `src/components/templates/parts/CopyBanner.tsx`,
  `src/lib/design-prefs.ts` (additive `copies`), PDF export helper. Keep `html-to-image` + `jspdf` (Critical Rule 6).
- **Tally feel:** Tally's print screen "No. of Copies" + "Copy names" with Ctrl+P → Enter to print.

### P0-10 Complete MCA audit trail — WP-7, size M
- **Build:** audit every write to every books table, not only `localDb` calls. Add a central hook in `setTable` for the books tables
  (purchases, purchase_payments, vouchers, stock_moves, stock_transfers, advances, cheques, fixed_assets, recurring,
  bank_statements…) that diffs by row id and records create / alter / delete with before / after field values.
  Replace the 5,000-row cap with yearly archive segments (still hash-chained, still in backups; older segments compressed).
  An auditor export: CSV + chain head hash per FY. A "cannot be disabled" statement in Settings.
- **Touches:** `src/lib/storage.ts` (shared core; one narrow hook), `src/lib/audit.ts`, `src/lib/audit-chain.ts`,
  `src/components/audit/*`, `src/lib/backup.ts`. Tests: every books table emits rows; the chain verifies across segments.
- **Tally feel:** TallyPrime "Edit Log" (Alt+G → Edit Log) per voucher / master with "Altered by / on" and a "View
  Changes" diff.

### P0-12 Tally export of every voucher — WP-7, size S–M
- **Build:** export supplier payments (`purchase_payments` → Payment voucher, Dr vendor with Agst Ref to the bill number,
  Cr Bank / Cash), manual JV / CV / PV / RV (`vouchers` → Journal / Contra / Payment / Receipt, mapping our accounts to
  Tally ledgers under the matching Tally groups), fixed-asset purchases and depreciation journals, and debit notes as their own
  type. Without these, a CA who imports our XML gets wrong creditor, bank and expense balances in Tally.
- **Touches:** `src/lib/tally-xml.ts` (extend `TallyVoucherType`, ledger masters for user accounts), `src/lib/export-shared.ts`
  (source gains `purchasePayments`, `vouchers`, `fixedAssets`), `src/components/exports/ExportCenter.tsx` (counts), `tests/tally-xml.test.ts`.
- **Tally feel:** imported vouchers keep our numbers and narration; ledgers land under Tally's own groups (Sundry
  Creditors, Bank Accounts, Indirect Expenses, Fixed Assets).

### P0-11 Bill allocation in manual receipt / payment vouchers (receivable side) — WP-1 (with WIP-C), size S–M
- **Build:** on a manual RV / PV line against Sundry Debtors, a bill-wise sub-screen (Agst Ref to open invoices /
  opening bills, Advance, On Account) that records `transactions` rows (receipts) so receivables agree with the ledger.
  **Coordinate with WIP-C**, which builds the payable side and probably the bill-wise UI component: reuse one
  `BillAllocation` component.
- **Touches:** `src/components/books/ledger/VoucherEditor.tsx`, `src/lib/ledger/vouchers.ts` (additive
  `bill_allocations` on a line). Both are likely touched by WIP-C, so do this **after WIP-C merges**, or hand it to WIP-C.

---

## 5. Prioritised gaps: P1

| # | Gap | Build | Touches | Size | Depends | Tally feel |
|---|---|---|---|---|---|---|
| P1-1 | Ratio Analysis | Working capital, cash / bank / OD, Sundry Debtors / Creditors, stock, current ratio, quick ratio, debt / equity, GP %, NP %, operating cost %, receivable turnover (days), inventory turnover, return on investment / WC — each drillable | new `src/lib/ledger/ratios.ts`, `components/books/ledger/RatiosTab.tsx` | S–M | P0-3 (closing stock) | Tally "Ratio Analysis" two-pane layout (Principal Groups / Principal Ratios) |
| P1-2 | Comparative columns (Alt+C) and month-wise columns | Column model for TB / P&L / BS / Group Summary: add column = another period, or auto-repeat by month / quarter | `src/lib/ledger/reports.ts` (period array), report tabs | M | P0-4 | "New Column" dialog, "Auto Repeat Columns" |
| P1-3 | F12 configure per report | Options panel per report (show opening, narration, zero balances, scale ₹ / lakh / crore, sort by name / amount, show percentages), remembered per report | new `src/lib/report-prefs.ts` (device-local or a table), each tab | S–M | P0-4 | F12 panel with Yes / No toggles |
| P1-4 | Registers: Sales / Purchase / Journal / Payment / Receipt / Contra / Debit Note / Credit Note, month-wise → vouchers, columnar | `registers(ledger, type, period)` + column picker (GSTIN, taxable, each tax, cess, TCS / TDS, narration) | new `src/lib/ledger/registers.ts`, `RegistersTab.tsx` | M | P0-3 | Tally "Sales Register" month list (Alt+F5 columnar) |
| P1-5 | Exception reports | Negative ledgers, negative stock days, cash-in-hand negative on any date, debtors in credit / creditors in debit, vouchers with warnings, GST "uncertain transactions" with a resolve link | new `src/lib/ledger/exceptions.ts`, `ExceptionsTab.tsx`; reads `inventory`, `gst-reports` reconciliation | M | P0-3 | "Exception Reports" menu |
| P1-6 | Receivables polish | Ageing by **due date or bill date**, user ageing slabs, interest column (party interest parameters), group-wise outstanding, bulk statements / reminder letters, "Confirmation of Accounts" letter for a date | `src/lib/receivables.ts`, `src/pages/Receivables.tsx`, `components/receivables/*` | M | P0-1 (groups) | "Bills Receivable", "Ledger Outstandings", "Confirmation of Accounts" |
| P1-7 | Interest Calculation reports | Party / ledger / bill-wise interest using the ledger interest parameters (both sides, incl. loans), with "book interest" → a journal or a debit-note draft | `src/lib/interest.ts` (extend), new `InterestTab.tsx` | M | P0-1 | Tally "Interest Calculations" (Alt+I in a ledger) |
| P1-8 | GRN / Receipt Note, Rejection In / Out, pending-bill reports | `RECEIPT_NOTE` doc (stock in before the bill; PO → GRN → Bill tracking), `REJECTION_OUT` (return before billing), `REJECTION_IN` (customer rejects a challan); "Goods received not billed", "Delivered not invoiced" | `src/types/purchases.ts`, new `src/lib/receipt-notes.ts`, `src/lib/inventory.ts` events (coordinate with WIP-B), `components/purchases/GrnTab.tsx` | M–L | WP-3 base | "Receipt Note" (Alt+F9), "Rejections In / Out" |
| P1-9 | Job work in / out + ITC-04 | Material Out (to job worker, challan under Rule 55, 1-year / 3-year return clocks), Material In, job-worker godowns ("our stock with third party"), ITC-04 working paper (half-yearly / annual by turnover) | new `src/lib/job-work.ts`, `src/lib/itc04.ts`, godown flag, `components/inventory/JobWorkTab.tsx` | L | WIP-B (BOM / stock journal) | "Job Work Out Order", "Material Out" |
| P1-10 | Inventory masters depth | Stock groups (tree) + categories, units master with UQC + decimals, **alternate / compound units** with conversion on lines (qty in Box → stock in Nos), group-wise stock summary, `PurchaseLine.item_id` | new `src/lib/stock-groups.ts`, `src/lib/units.ts`, additive `StockItem` fields, `components/inventory/{StockGroupsModal,UnitsModal}.tsx`, line editors | L | coordinate `inventory.ts` with WIP-B | "Stock Group", "Unit of Measure" (Simple / Compound), "Alternate Units: 1 Box = 12 Nos" |
| P1-11 | Stock ageing + party-wise movement | Ageing by FIFO inward layers (slabs configurable), party-wise movement (who supplied / bought what) | new `src/lib/stock-ageing.ts`, Inventory tabs | M | — | "Ageing Analysis", "Movement Analysis → Party-wise" |
| P1-12 | Order outstanding reports | Sales / purchase orders pending by party / item / due date, overdue orders | `src/lib/sales-orders.ts` / `purchase-orders.ts` (pure additions), a new Reports tab | S–M | — | "Sales Order Outstandings" |
| P1-13 | Voucher Types master | User voucher types under a base type (Sales – Retail, Sales – Export), own prefix / suffix / starting number / restart (yearly, monthly), default print title / template, default bank, "use for POS" | new `src/lib/voucher-types.ts`; integrates with `invoice-number.ts` (numbering contract **must keep the Indian-FY default**) | M–L | coordinate with WIP-D | "Voucher Type Creation" |
| P1-14 | Banking documents | Deposit slip print, payment advice (bills settled + TDS), bulk e-payment upload file (generic NEFT / RTGS CSV + HDFC / ICICI / SBI presets), cheque against several invoices, party bank details | new `src/lib/deposit-slip.ts`, `payment-advice.ts`, `bank-upload.ts`; `cheques.ts` (multi-allocation); `Vendor` bank fields | M | — | Banking menu: "Deposit Slip", "Payment Advice", "e-Payments" |
| P1-15 | Print and communication | Per-print configuration (copies, logo / signature / bank / rate column, title override), manual voucher printing (JV / PV / RV / CV with "Prepared / Checked / Authorised by"), **batch print / ZIP of PDFs**, standard report print header | `components/preview/*`, new `src/lib/voucher-print.ts`, `src/lib/pdf-batch.ts` (uses `zip.ts`) | M | P0-9 | "Print Configuration" (F12 at print), "Multi-Voucher Print" |
| P1-16 | GST depth | e-Invoice ShipDtls / DispDtls / PayDtls; cess on purchase bills; RCM self-invoice + Rule 52 payment voucher series; HSN master with rate history and default rate inheritance (company → group → item); purchase-side HSN / rate register; month-wise "GSTR-1 vs 3B vs Books" reconciliation; GSTR-9C working paper | `src/lib/einvoice.ts`, `purchases.ts`, new `src/lib/hsn-master.ts`, `src/lib/gstr9c.ts`, `components/gst-reports/*` | L | WP-3 (supplier notes for 9C ITC) | TallyPrime "GST Rate Setup", "Reconciliation of Returns" |
| P1-17 | Dashboard tiles | Tile picker: cash, each bank, receivables, payables, GST payable (from P0-6), stock value, top items / parties, overdue POs | `src/pages/Dashboard.tsx`, `src/lib/stats.ts` | S–M | P0-6, P0-8 | TallyPrime 4 Dashboard "Add Tile" |
| P1-18 | Approvals (maker-checker) | Optional: a clerk's invoices / bills / payments save as "Pending approval" (not issued, no number consumed until approved, or a provisional number); the owner approves or rejects with a note; bell notice | `src/lib/access.ts` (new action), `localDb.invoices.save` path, a new `approvals` table | M | — | Zoho-style; Tally users know it as "Approval Workflow" from Tally ERP add-ons |
| P1-19 | Branch accounting | Branch = a profile GSTIN; branch-wise TB / P&L filter (from the document's sender GSTIN / cost centre), inter-branch stock transfer as a tax invoice between distinct persons (Sec 25(4)) with "Branch Transfer" accounts | `src/lib/ledger/reports.ts` (filter), `godowns.ts` (godown → branch) | M–L | P0-3 | Tally multi-GSTIN "Registration" selector in reports |
| P1-20 | Year-end wizard | Checklist: closing stock, depreciation run, provisions journal, lock FY, opening bills check, carry-forward report, optional archive of old FYs to a separate "history" company | new `src/lib/year-end.ts`, `components/year-end/*` | M | P0-3, P0-10 | Tally "Split Company Data" (presented as "Start new year") |
| P1-21 | Excel import of ledgers, vendors, stock items, vouchers | New import kinds in the wizard, mapped like clients / items | `src/lib/import-mapping.ts`, `importers.ts` (new kinds), wizard steps | M | P0-1 | TallyPrime 4 "Import → Excel" templates |
| P1-22 | Tally XML export completeness (beyond P0-12) | Cost-centre allocations, godown / batch allocations (with masters), stock transfers as Stock Journal, per-bank ledgers, receipts at the realised FX rate, opening balances in masters | `src/lib/tally-xml.ts` | M | P0-1, P0-8 | — |
| P1-23 | Alt+C inline master creation and edit log views | Inline create for ledger / stock item / godown / cost centre / unit from any picker; Edit Log for purchases / vouchers / stock | pickers (`VendorPicker`, `CostCentreSelect`, account picker in `VoucherEditor`), `components/audit/*` | M | P0-1, P0-10 | Alt+C |
| P1-24 | Transport details on the invoice form, printed | Transporter name / ID, LR / GR no. and date, vehicle no., mode, distance on the document (feeds e-Way); printed on GST layouts | `src/types/invoice.ts` (additive + `RECORD_KEYS`, `normalizeRecord`), `DocumentMetaCard.tsx`, templates | S–M | — | "Dispatch details" sub-screen in a Tally Sales voucher |
| P1-25 | POS returns / exchange | Return screen from a scanned bill number; credit note + refund tender; exchange nets the new bill | `src/pages/Pos.tsx`, `src/lib/pos.ts`, `documents.createCreditNote` | M | — | — |
| P1-26 | Global period and Go To | One current period / date (Alt+F2 / F2) shared across Books, Reports, GST and Inventory; report names inside Books tabs in the palette | `src/lib/period-context.ts` (new, device-local), `PeriodBar.tsx`, `search.ts` | S–M | coordinate with WIP-D | Tally "Period" and "Date" buttons at the top-right |

---

## 6. P2 (nice to have)

- Cost categories + percentage splits of an entry across centres; centre-wise ledger break-up; Tally export of allocations.
- Scenarios (budgets × optional / memo vouchers, after WIP-C).
- Currency master + date-wise rates (CSV import of RBI / FBIL rates); forex payments and purchases; forex bank ledgers.
- Voucher classes (default ledgers / GST auto-lines per class); accounting-mode sales voucher; per-line narration;
  duplicate manual vouchers.
- Funds flow statement; statistics report; Ctrl+B / Ctrl+H basis / view switches; calculator.
- Godown hierarchy; standard cost / price lists with applicable-from dates; per-item costing method; opening by godown /
  batch; stock query screen; landed-cost allocation; kits / composite items (after WIP-B).
- IFF JSON; consolidated e-Way JSON; EXPA / HSN / document amendments; ISD; GSTR-7 / 8; 27Q; 201(1A) / 234E interest;
  Form 16A working PDF.
- Group company consolidation; custom role builder (per-voucher-type rights, back-date window); books integrity check ("Repair").
- Loyalty points / wallet; bill-value and "buy A get B" offers; MRP-minus billing; pharma pack (drug licence, Schedule H
  register, expiry claims); weighing-scale barcodes; ESC/POS cash-drawer via Web Serial; static catalogue HTML ("online store"
  offline alternative); service / AMC contracts and job cards; quote revisions; sales person / broker commission; area / beat-wise
  sales; sales targets; pre-printed stationery mode; cash denominations; dashboard per user.
- Payroll follow-ups after WIP-A: gratuity / bonus provisions, employee loans.

⛔ **Not feasible offline (kept out; the offline alternative is already provided):** direct GST / IRP / e-Way / GSP
filing and 2A / 2B auto-fetch (JSON in / out + 2B file import); GSTIN live status (checksum); connected banking and payment
initiation (statement import + bulk upload file); payment-gateway links / auto-charge (UPI QR / deep link + UTR match);
app-sent SMS / e-mail / WhatsApp API (`wa.me`, `mailto:`, `sms:`, Web Share PDF); cloud OCR (attachments); online store /
e-commerce (static catalogue HTML, P2); client / vendor portal (client-copy HTML); remote / browser access à la Tally on
cloud (encrypted folder sync); automatic FX rates (typed / CSV rates); TRACES Form 16A download (register + 26AS match).

---

## 7. UX and terminology alignment for Tally users

**Naming** (the UI label can say both while users get used to it, e.g. "Vouchers (Invoices)"):

| App today | Tally term to adopt | Where |
|---|---|---|
| Dashboard | Gateway of Tally (WIP-D) with Dashboard as a tile | shell |
| Invoices / Transactions | Sales Vouchers (Day Book filtered to Sales) | `/transactions` title, nav |
| Expenses → Bills | Purchase Vouchers; "Expenses" = Payment / Journal against expense ledgers | `/expenses` |
| Books → Vouchers | Accounting Vouchers | Books tab |
| Chart of accounts | Chart of Accounts → Groups / Ledgers | Books tab |
| Account | **Ledger** | everywhere in Books |
| Account group | **Group** (Primary / Sub-group) | ChartTab |
| Clients / vendors | Parties: Sundry Debtors / Sundry Creditors ledgers | Clients, Vendors |
| Receivables → Aging | Outstandings → Receivables (Bills Receivable) | `/receivables` |
| Receivables → Statements | Ledger / Statement of Accounts | — |
| Payment received | **Receipt** (F6) | PaymentModal title |
| Supplier payment | **Payment** (F5) | PurchasePaymentModal |
| Stock transfer | Stock Journal (transfer) | Inventory |
| Adjustment | Physical Stock / Stock Journal (WIP-B) | Inventory |
| Catalogue item | Stock Item (goods) / Service ledger | Settings → Items |
| Reports | Display More Reports | nav |
| Period lock | Lock / "Disallow entries before" | Settings |
| Local users / roles | Security Control / User Roles | Settings |
| Vault mode | TallyVault | Settings |
| Reconcile | Banking → Bank Reconciliation | nav |
| Exports | Export / Data Exchange | nav |

**Keyboard map** (to be agreed with WIP-D, which owns the global bindings): F4–F9, Ctrl+F8 / F9, Alt+F7, Ctrl+F7 for voucher
types; F2 date, Alt+F2 period; Alt+F1 detailed / condensed; F12 configure; Alt+C create master (in pickers) / new column (in reports);
Ctrl+A accept; Esc back one drill level, then "Quit? Y/N" when there are unsaved changes; Alt+G Go To (map to the palette
with report names); Alt+P print; Alt+E export; Alt+M mail; Ctrl+I insert line; Ctrl+D delete line; Alt+D delete voucher; Alt+2
duplicate voucher; Ctrl+B basis; Page Up / Page Down = previous / next voucher in the editor. The current reservations
(`mod+s`, `mod+p` reserved for the editor in `useHotkeys.ts`) do not clash. Note that browsers capture F5 (reload), Ctrl+F (find) and Alt+F4: WIP-D
needs to `preventDefault` inside the app, with a fallback hint ("Alt+5") where a browser refuses.

**Report interaction rules** (WP-2 builds the shared component; every report tab adopts it):
1. A selected-row bar moved with ↑ ↓; Enter drills; Esc returns to the same row.
2. The period is shown top-right on every report; Alt+F2 changes it for the whole drill stack.
3. Detailed / Condensed toggle on every hierarchical report.
4. Dr / Cr suffixes on balances ("12,500.00 Dr"), not signed numbers, in accounting reports.
5. Amounts in Indian grouping; optional scale (₹ / thousands / lakhs / crores) in F12.
6. Footers "Grand Total", "Opening Balance", "Current Total", "Closing Balance" exactly as Tally words them.
7. Voucher screens: Tally field order (Date top-right, Voucher No. top-left, Party A/c name, Current balance shown under
   each ledger as you pick it, Narration at the bottom).
8. Show the **current balance of a ledger inside voucher entry** (Tally shows "Cur Bal: 45,000 Dr" next to each ledger),
   including cash going negative, which is a warning.

---

## 8. Work packages for parallel agents

Rules for every package: follow `AGENTS.md` and `docs/ARCHITECTURE.md` (additive snake_case fields, new tables via
`getTable/setTable` + `RECORD_TABLES`, pure lib + `node:test`, no new runtime dependencies, CSS Modules with tokens, "verify
with your CA" wording, Indian-FY numbering). Shared shell files (`src/App.tsx`, `src/layouts/DashboardLayout.tsx`,
`src/pages/Books.tsx` tab list, `src/hooks/useHotkeys.ts`) are wired by the lead from each package's
`docs/features/<pkg>.md`. **Hot files** touched by several packages are marked ⚠ with the agreed rule.

| WP | Name | Covers (gap ids) | Owns (new or primary files) | Touches (narrow, coordinated edits) | Size |
|---|---|---|---|---|---|
| **WP-1** | Masters & openings ("Accounts Info") | P0-1, P0-2, P0-11 (after WIP-C), P1-7 lib part (interest parameters), P1-21 (ledger / vendor / opening import kinds), P2 cost categories | `src/lib/ledger/groups.ts` (new), `src/lib/ledger/openings.ts` (new), `src/lib/opening-bills.ts` (new), `src/components/masters/**` (new: GroupForm, LedgerForm, BillwiseOpening), `src/components/books/ledger/ChartTab.tsx`, `tests/groups.test.ts`, `tests/openings.test.ts`, `docs/features/masters.md` | ⚠ `src/lib/ledger/accounts.ts` (GroupId → string; WP-1 is the only editor), ⚠ `src/lib/ledger/postings.ts` (one `openingVouchers()` call added — see note), `src/lib/receivables.ts` (accept `openingBills`), `src/types/invoice.ts` `Client` + `src/types/purchases.ts` `Vendor` (additive), `src/lib/backup.ts` (tables), `tests/purchase-contract.test.ts` | L |
| **WP-2** | Reports engine & Tally report grammar | P0-3, P0-4, P1-1, P1-2, P1-3, P1-4, P1-5, P1-26 (period context), P2 funds flow / statistics / scenarios view | `src/lib/ledger/reports.ts` (owner), `src/lib/ledger/closing-stock.ts`, `group-summary.ts`, `ratios.ts`, `registers.ts`, `exceptions.ts`, `funds-flow.ts` (new), `src/lib/report-prefs.ts`, `src/lib/period-context.ts`, `src/components/books/ledger/{DrillStack,GroupSummaryTab,RatiosTab,RegistersTab,ExceptionsTab,ReportToolbar}.tsx` (new), `BalanceSheetTab.tsx`, `TrialBalanceTab.tsx`, `LedgerTab.tsx`, `CashFlowTab.tsx`, `src/components/books/{DayBookTab,ProfitLossTab,PeriodBar}.tsx`, `docs/features/reports-engine.md` | reads `inventory.computeStock` (no edit); `src/pages/Books.tsx` tab list (lead) | L |
| **WP-3** | Purchase returns, GRN, rejections, job work | P0-5, P1-8, P1-9, P1-12 (purchase side) | `src/lib/purchase-returns.ts`, `src/lib/receipt-notes.ts`, `src/lib/job-work.ts`, `src/lib/itc04.ts` (new), `src/components/purchases/{ReturnModal,GrnTab,RejectionModal}.tsx`, `src/components/inventory/JobWorkTab.tsx` (new), `tests/purchase-returns.test.ts`, `tests/job-work.test.ts`, `docs/features/purchase-returns.md` | ⚠ `src/types/purchases.ts` (additive kinds), ⚠ `src/lib/inventory.ts` `collectEvents` (one event source added; coordinate with WIP-B), ⚠ `src/lib/ledger/postings.ts` (one `purchaseReturnPostings()`), `src/lib/gst-reports.ts` (ITC net), `src/lib/gstr2b.ts` (`bookBills`), `src/lib/tally-xml.ts` (Debit Note voucher), `src/lib/purchase-normalize.ts`, `tests/purchase-contract.test.ts` | L |
| **WP-4** | Printing & documents output | P0-9, P1-15, P1-24, P1-6 print parts (confirmation-of-accounts letter, bulk statements), P2 pre-printed mode | `src/components/templates/parts/CopyBanner.tsx`, `src/lib/print-copies.ts`, `src/lib/pdf-batch.ts`, `src/lib/voucher-print.ts`, `src/lib/confirmation-letter.ts` (new), `src/components/preview/**`, `src/components/receivables/{StatementDocument,StatementViewer}.tsx`, `docs/features/printing.md` | `src/lib/design-prefs.ts` (additive `copies`), `src/components/templates/TemplateEngine.tsx` (mount banner + transport block; accent variable only), `src/types/invoice.ts` + `src/store/useInvoiceStore.ts` `RECORD_KEYS` + `normalizeRecord` (transport fields), `src/components/creator/DocumentMetaCard.tsx` | M |
| **WP-5** | Banking & payments | P0-8, P1-14, P2 bounce charges, cash denominations, forex bank ledgers | `src/lib/bank-ledgers.ts`, `src/lib/deposit-slip.ts`, `src/lib/payment-advice.ts`, `src/lib/bank-upload.ts` (new), `src/lib/cheques.ts`, `src/lib/bank-accounts.ts`, `src/components/bank/**`, `src/components/cheques/**`, `src/pages/{Reconcile,Cheques}.tsx`, `docs/features/banking.md` | ⚠ `src/lib/ledger/postings.ts` (bank ledger resolution in one helper `bankAccountFor(line)`), ⚠ `src/lib/ledger/accounts.ts` (read-only: synthesised bank ledgers via an exported hook provided by WP-1), `src/lib/books.ts` (bank book per account), `src/lib/tally-xml.ts` (bank ledgers), `src/types/purchases.ts` `Vendor` bank fields (additive) | M |
| **WP-6** | GST depth & statutory postings | P0-6, P1-16, P2 IFF / EXPA / ISD / consolidated e-Way | `src/lib/gst-setoff.ts`, `src/lib/gstr9c.ts`, `src/lib/hsn-master.ts`, `src/lib/gst-recon-monthly.ts` (new), `src/components/gst-reports/{SetOffDialog,ChallanList,Gstr9cView,HsnMasterPanel,ReconMonthly}.tsx` (new), `Gstr3bView.tsx`, `src/lib/einvoice.ts` (Ship / Disp / PayDtls), `docs/features/gst-setoff.md` | `src/lib/gst-reports.ts` (purchase cess, HSN purchase register — ⚠ coordinate with WP-3 ITC-net edit and the eco worktree), `src/lib/tax-rules.ts` (append only), `src/types/purchases.ts` (cess on bills, additive), writes `vouchers` via `saveVoucher` only | L |
| **WP-7** | Migration, audit & year-end | P0-7, P0-10, P0-12, P1-20, P1-22, P1-23 (edit-log part), P2 integrity check / consolidation | `src/lib/tally-import.ts`, `src/lib/year-end.ts`, `src/lib/books-integrity.ts` (new), `src/components/import/TallyImport.tsx` (new, separate from the CSV wizard), `src/components/year-end/**`, `src/lib/audit.ts`, `src/lib/audit-chain.ts`, `src/lib/audit-query.ts`, `src/components/audit/**`, `src/lib/tally-xml.ts` (owner of export extensions), `docs/features/migration-audit.md` | ⚠ `src/lib/storage.ts` (one `onTableWrite` hook for audit; reviewed by the lead), `src/lib/backup.ts` (audit segments), consumes WP-1 / WP-5 APIs for import and export | L |
| **WP-8** | Inventory masters & analysis — ✅ done (`docs/features/inventory-masters.md`) | P1-10, P1-11, P1-12 (sales side), P2 godown hierarchy / standard cost / price-list dates / stock query / landed cost | `src/lib/stock-groups.ts`, `src/lib/units.ts`, `src/lib/stock-ageing.ts`, `src/lib/stock-query.ts` (new), `src/components/inventory/{StockGroupsModal,UnitsModal,AgeingTab,PartyMovementTab,StockQuery}.tsx` (new), `src/components/inventory/ItemFormModal.tsx`, `docs/features/inventory-masters.md` | ⚠ `src/lib/inventory.ts` (`StockItem` additive fields + unit conversion in `collectEvents`: coordinate with WIP-B and WP-3; the agreed rule is one function per package), `src/components/creator/ItemsTable.tsx` + `src/components/purchases/LineItemsEditor.tsx` (alternate-unit qty input), `src/types/purchases.ts` (`item_id`, `alt_qty`, additive) | L |
| **WP-9** | Business extras (Busy / Marg / Vyapar / Zoho strengths) | P1-17, P1-18, P1-19, P1-25, P2 loyalty / offers / AMC / commission / catalogue HTML / ESC-POS / pharma | `src/lib/approvals.ts`, `src/lib/loyalty.ts`, `src/lib/amc.ts`, `src/lib/catalogue-html.ts`, `src/lib/branch.ts` (new), `src/components/{approvals,loyalty,amc}/**` (new), `src/pages/Pos.tsx`, `src/lib/pos.ts`, `src/pages/Dashboard.tsx` tiles, `docs/features/business-extras.md` | `src/lib/access.ts` (new action `doc.approve`), `localDb.invoices.save` status path (⚠ `src/lib/localDb.ts`: a single guarded branch), `src/lib/ledger/reports.ts` branch filter (request from WP-2 as an option parameter, not a direct edit) | L |

**Hot-file protocol** (to keep the packages parallel):
- `src/lib/ledger/postings.ts` is touched by WIP-C, WP-1, WP-3 and WP-5. Each package adds **one exported function in its own new file**
  (`postings-openings.ts`, `postings-returns.ts`, `postings-bank.ts`); `postings.ts` itself gets only a one-line call per
  package, merged by the lead in the order WIP-C → WP-1 → WP-5 → WP-3.
- `src/lib/inventory.ts` is touched by WIP-B, WP-3 and WP-8. The same pattern: event sources in new files
  (`events-returns.ts`, `units.ts`), one registration line each.
- `src/types/purchases.ts` and `tests/purchase-contract.test.ts`: additive fields only. Each package appends its own
  contract rows (Critical Rule 9).
- `src/lib/ledger/accounts.ts`: only WP-1 edits it. Others consume its exports.
- `src/lib/tally-xml.ts`: WP-7 owns it. WP-3 and WP-5 deliver their XML fragments as functions in their own files for WP-7 (or the
  lead) to call.
- `src/lib/gst-reports.ts`: WP-6 owns it. WP-3 delivers an `itcAdjustmentsFromNotes()` function that WP-6 wires in.

**Suggested order:** WP-1 and WP-2 first (they unblock the CA's day-one experience: opening TB → correct P&L / BS with closing
stock → drill-down). In parallel, WP-4 (copies, quick win), WP-6 (set-off) and WP-8. Then WP-3 and WP-5 after WIP-C merges
(they share `postings.ts` / payables). WP-7 once the WP-1 APIs are frozen. WP-9 can start any time.

---

## 9. Notes for the lead

- **Biggest correctness risk found:** the P&L tab and Day Book (`books.ts`) diverge from the TB / BS (`ledger/`) as soon as a
  manual journal, depreciation or fixed asset exists. A CA comparing the two screens will lose trust. This is the first
  item of WP-2.
- **Closing stock** is absent from both P&L engines. For any trading business the gross profit shown today is
  purchases-based, not COGS-based.
- **Opening invoices as a migration path** (the import wizard) put old invoices into the documents table. If they are dated inside a
  return period they can leak into GSTR-1 working papers. P0-2's `opening_bills` table is the safer path, and the
  import docs should say so.
- **Audit cap:** at 5,000 rows a busy shop overwrites a year's trail in weeks. Under the MCA rule this matters for every
  company client of a CA.
- Statutory values added by WP-6 (and by WIP-A / WIP-C) must go to `src/lib/tax-rules.ts` date-keyed (append only).
  The GST interest / late-fee tables live in `src/lib/gst-penalties.ts`.
- Every new output keeps the "working paper — verify with your CA" line (Critical Rule 10).
