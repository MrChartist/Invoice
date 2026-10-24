# Double-entry ledger (roadmap 6.1–6.4)

Chart of accounts, manual vouchers, automatic postings from documents, trial balance, ledger drill-down,
Schedule III balance sheet with a fixed-asset register, and an AS 3 cash-flow statement. Everything is a
**working paper — verify with your CA**; every statement carries that wording.

| | |
|---|---|
| UI | Books page tabs `vch` Vouchers, `ledger` Ledger (`acct`, `party` params), `tb` Trial balance, `bs` Balance sheet, `cf` Cash flow, `coa` Chart of accounts |
| Components | `src/components/books/ledger/*` — one lazy chunk (`LedgerPanel`, default export) loaded by `src/pages/Books.tsx` |
| Lib | `src/lib/ledger/` — `accounts.ts`, `vouchers.ts`, `assets.ts`, `postings.ts`, `reports.ts`, `index.ts` (never import from the shell) |
| Rates | `DEPRECIATION_RATE_RULES` in `src/lib/tax-rules.ts` (date-keyed by FY) |
| Tests | `tests/ledger.test.ts`, `tests/integration/ledger-year.test.ts`, contract row in `tests/purchase-contract.test.ts`, e2e step in `tests/e2e/smoke.mjs` |

## Storage (additive, all in backups)
- `accounts` — user accounts `{id, code, name, group, created_at}`. Default accounts are constants with stable ids (`sales`, `debtors`, `out_cgst` …) and are never stored, so later versions can add accounts without a migration.
- `vouchers` — manual vouchers `{id, type: JOURNAL|CONTRA|PAYMENT|RECEIPT, number, date, narration, lines: [{account_id, dr, cr, party?}], created_at, updated_at?}`. **Amounts are integer paise**; a voucher saves only when debits equal credits exactly.
- `fixed_assets` — `{id, name, block, account_id, cost (₹), acquired_on, put_to_use, paid_from, party?, created_at}`.
- Automatic vouchers are **not stored**: they are rebuilt from the documents every time (`buildLedger`).
- Writes go through the period lock (`assertUnlocked` on the old and the new date) and the audit log (entities `voucher`, `account`, `fixed_asset`). No PIN-override button is offered in the voucher editor yet: move the lock date to post into a locked period.
- Numbering: `JV/FY25-26/0001`, `CV/…` (contra), `PV/…` (payment), `RV/…` (receipt), one series per type per Indian FY.

## Chart of accounts (codes)
1xxx owner's funds: 1000 Capital, 1010 Drawings, 1090 Opening balance difference, 1100 Reserves & surplus ·
2xxx liabilities: 2000/2010 Secured/Unsecured loans, 2100 Bank OD, 2200 Sundry creditors, **Duties & taxes** 2300–2304 Output CGST/SGST/IGST/cess/unsplit GST, 2310 GST payable — reverse charge, 2311 IGST payable on imports (customs), 2320 TCS payable, 2330 TDS payable, 2350–2353 Input CGST/SGST/IGST/cess (the electronic credit ledger), 2360 GST electronic cash ledger, 2370 TDS receivable, 2400 Other current liabilities, 2500 Provisions ·
3xxx assets: 3000–3060 fixed assets, 3090 Accumulated depreciation, 3100 Investments, 3200 Security deposits, 3300 Stock-in-hand, 3400 Sundry debtors, 3500 Cash, 3510 Bank, 3600 Advances, 3700 Other current assets ·
4xxx income: 4000 Sales, 4010 Sales returns, 4020 Freight & charges recovered, 4900 Round off, 4910/4920 Other income / interest ·
5xxx direct: 5000 Purchases, 5100/5110 Direct expenses / freight inward ·
6xxx indirect: 6000 Salaries, 6100/6110 Interest / bank charges, 6200 Depreciation, 6300–6390 rent, software, professional fees, travel, utilities, marketing, office supplies, GST input credit reversed, other.

Groups follow Schedule III (Division I) headings; `direct` groups (Purchases, Direct expenses) feed gross profit.

## Posting rules (automatic)
| Source | Debit | Credit |
|---|---|---|
| Sales invoice / debit note (not Draft/Cancelled) | Sundry debtors (party) — total | Sales (items' taxable), Freight & charges (taxed or untaxed), Output CGST/SGST/IGST (+ unsplit legacy GST), Output cess, TCS payable; residual to Round off |
| Credit note | exact mirror; Sales side goes to **Sales returns** | Sundry debtors |
| Receipt | Cash (method `Cash`) or Bank — amount; **TDS receivable** — the invoice's TDS, on the receipt that takes receipts past total − TDS | Sundry debtors — amount + TDS |
| Purchase / expense | Purchases (bill) or expense account (category → account; a user account named like the category wins); cost = taxable, + GST when ITC is not available; Input CGST/SGST/IGST when ITC is available | Sundry creditors (party) — total |
| … reverse charge, import of services | same | Creditors — total − GST; **GST payable — reverse charge** — GST |
| … import of goods | same | Creditors — total − IGST; **IGST payable on imports (customs)** — IGST |
| … ITC reversed (Rules 42/43/37…) | GST input credit reversed | Input heads, pro rata |
| Supplier payment | Sundry creditors | Cash / Bank |
| Books opening balance (`book_opening`) | Cash / Bank | Opening balance difference — sized so the ledger balance at the start of `as_of` equals what was typed (entries dated earlier are absorbed, as in the Books cash book) |
| Fixed asset | Asset account | the "paid from" account (none when "already in the books") |
| Depreciation (per FY, dated 31 Mar, for every FY that has started) | Depreciation | Accumulated depreciation |

Foreign-currency documents post in rupees at their `exchange_rate` through `export-shared.invoiceAmounts` /
`fx.inrValue`; receipts at the invoice's rate (no realised exchange difference — 6.19). The readers are the same as GST
reports, Books and Tally (`invoiceAmounts`, `books.normalizePurchase` → `readPurchase`/`splitLumpTax`), so totals agree.
A voucher that does not balance or names an unknown account is left out and listed in `ledger.warnings` (shown on
the Vouchers tab).

## Statements
- **Trial balance** for the period: opening, debit, credit, closing per account. Income/expense accounts restart each
  1 April; earlier years' profit is carried in Reserves & surplus.
- **Ledger**: opening, every voucher with the contra accounts as particulars, running balance, closing; party filter
  on control accounts; click through to the invoice / bills page, or open a manual voucher in the editor.
- **Balance sheet** (Schedule III vertical) as at the period end (capped at today): owner's funds (capital net of
  drawings; reserves = direct entries + surplus brought forward + profit for the year), long-term and short-term
  borrowings, trade payables, other current liabilities (credit-balance tax ledgers, customer advances), provisions;
  PPE net of accumulated depreciation, investments, loans & advances, inventories, trade receivables (party-wise
  debit balances), cash & bank, short-term loans & advances (input credit, TDS receivable, GST cash ledger, supplier
  advances). It ties by construction; `difference` is shown and tested to be 0.
- **Cash flow** (AS 3, indirect): net profit + depreciation ± working-capital movements (receivables, inventories,
  advances, duties & taxes, payables, other liabilities, provisions) = operating; fixed assets, investments,
  long-term advances = investing; capital/drawings/opening balances, reserves, borrowings = financing. Reconciles to
  the movement in cash + bank accounts.
- CSV for every statement via `src/lib/csv.ts` `toCsv` (formula-guarded); Print uses the app's print styles.

## Fixed assets & depreciation
Income-tax Act WDV rates by block (Rule 5 / New Appendix I): building 5/10/40 (temporary 100 before FY 2017-18),
furniture 10, plant & machinery 15, motor car 15, hire vehicles 30, computers & software 40 (60 before FY 2017-18),
books 40, intangibles 25, energy-saving devices 40 (80 before). Half the rate in the first FY when the asset is used
for fewer than 180 days (put-to-use date to 31 March, inclusive). Per-asset WDV schedule plus a block-wise summary.

## Consistency with Books
For the same documents (no manual vouchers, no assets), ledger revenue, direct costs, indirect expenses and net
profit equal `books.profitAndLoss` (tested). Known, intended differences: manual vouchers and depreciation exist only in
the ledger; ITC reversals and purchase round-off are expensed in the ledger but not in Books; customer TDS sits in
TDS receivable rather than receivables.

## Assumptions to confirm with a CA
- IT Act WDV rates are used for book depreciation (Companies Act Schedule II useful lives are not applied); per-asset,
  no block-level sale/cessation handling; disposals need a manual journal.
- Import-of-goods IGST is credited to a customs payable until a payment voucher clears it; customs duty itself is not
  modelled.
- Closing stock is not valued automatically (post a journal: Dr Stock-in-hand, Cr an income/purchases account).
- Interest and income-tax are not separated in the cash-flow statement; bank overdraft is treated as financing, not a
  cash equivalent.
- Purchases module balances for RCM/import bills include the tax; if the full bill total is paid to the supplier the
  creditor shows a debit (advance) balance in the ledger.
