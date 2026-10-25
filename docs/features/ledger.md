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
| Masters & openings | groups / sub-groups, ledger and party opening balances, bill-wise openings: `docs/features/masters.md` (WP-1) |
| Tests | `tests/ledger.test.ts`, `tests/integration/ledger-year.test.ts`, contract row in `tests/purchase-contract.test.ts`, e2e step in `tests/e2e/smoke.mjs` |

## Storage (additive, all in backups)
- `accounts` — user accounts `{id, code, name, group, created_at}`; additive (WP-1) `under` (user sub-group; `group` stays the primary), `alias`, `interest`. Default accounts are constants with stable ids (`sales`, `debtors`, `out_cgst` …) and are never stored, so later versions can add accounts without a migration.
- `vouchers` — manual vouchers `{id, type: JOURNAL|CONTRA|PAYMENT|RECEIPT, number, date, narration, lines: [{account_id, dr, cr, party?}], created_at, updated_at?}`. **Amounts are integer paise**; a voucher saves only when debits equal credits exactly.
- `fixed_assets` — `{id, name, block, account_id, cost (₹), acquired_on, put_to_use, paid_from, party?, created_at}`.
- Automatic vouchers are **not stored**: they are rebuilt from the documents every time (`buildLedger`).
- Writes go through the period lock (`assertUnlocked` on the old and the new date) and the audit log (entities `voucher`, `account`, `fixed_asset`). No PIN-override button is offered in the voucher editor yet: move the lock date to post into a locked period.
- Numbering: `JV/FY25-26/0001`, `CV/…` (contra), `PV/…` (payment), `RV/…` (receipt), one series per type per Indian FY.

## Chart of accounts (codes)
1xxx owner's funds: 1000 Capital, 1010 Drawings, 1090 Opening balance difference, 1100 Reserves & surplus ·
2xxx liabilities: 2000/2010 Secured/Unsecured loans, 2100 Bank OD, 2200 Sundry creditors, **Duties & taxes** 2300–2304 Output CGST/SGST/IGST/cess/unsplit GST, 2310 GST payable — reverse charge, 2311 IGST payable on imports (customs), 2320 TCS payable, 2330 TDS payable, 2350–2353 Input CGST/SGST/IGST/cess (the electronic credit ledger), 2360 GST electronic cash ledger, 2337 TDS payable — salaries (192), 2343–2345 PF / ESI / Professional tax payable (payroll), 2370 TDS receivable, 2380 GST paid on advances received, 2400 Other current liabilities, 2410 Advances from customers, 2425 Salary payable, 2500 Provisions ·
3xxx assets: 3000–3060 fixed assets, 3090 Accumulated depreciation, 3100 Investments, 3200 Security deposits, 3300 Stock-in-hand, 3400 Sundry debtors, 3500 Cash, 3510 Bank, 3600 Advances, 3615 Loans & advances to employees, 3700 Other current assets ·
4xxx income: 4000 Sales, 4010 Sales returns, 4020 Freight & charges recovered, 4900 Round off, 4910/4920 Other income / interest, 4930 Foreign exchange gain / loss ·
5xxx direct: 5000 Purchases, 5100/5110 Direct expenses / freight inward ·
6xxx indirect: 6000 Salaries, 6001 Allowances & overtime, 6002 Bonus, 6003 / 6004 Employer's contribution to PF / ESI, 6005 PF admin & EDLI charges, 6100/6110 Interest / bank charges, 6200 Depreciation, 6300–6390 rent, software, professional fees, travel, utilities, marketing, office supplies, GST input credit reversed, other.

Groups follow Schedule III (Division I) headings; `direct` groups (Purchases, Direct expenses) feed gross profit.
User groups / sub-groups (WP-1) nest under these 24 primaries and inherit nature and `direct`; an account in a sub-group
keeps the primary in `group` and the sub-group in `under`, so every statement here is unchanged (`docs/features/masters.md`).
A receipt row without an invoice now posts to its `client_name` party instead of "Unknown customer"; receipt rows a
manual voucher allocated bill-wise (`voucher_id`) are not posted again (the voucher posts them).

## Posting rules (automatic)
| Source | Debit | Credit |
|---|---|---|
| Sales invoice / debit note (not Draft/Cancelled) | Sundry debtors (party) — total | Sales (items' taxable), Freight & charges (taxed or untaxed), Output CGST/SGST/IGST (+ unsplit legacy GST), Output cess, TCS payable; residual to Round off |
| … outward reverse charge (`reverse_charge`) | Sundry debtors — what the customer owes (`receivableTotal`: taxable + untaxed charges + TCS ± round off; an older record's stored total minus the GST in it) | Sales / Freight / TCS only — **no output-tax lines**: the recipient pays the GST (Sec 9(3)/(4)); the narration notes "reverse charge: GST … payable by the recipient" |
| Credit note | exact mirror; Sales side goes to **Sales returns** | Sundry debtors |
| Receipt | Cash (method `Cash`) or Bank — amount; **TDS receivable** — the invoice's TDS, on the receipt that takes receipts past total − TDS | Sundry debtors — amount + TDS |
| Purchase / expense | Purchases (bill) or expense account (category → account; a user account named like the category wins); cost = taxable, + GST when ITC is not available; Input CGST/SGST/IGST when ITC is available | Sundry creditors (party) — total |
| … reverse charge, import of services | same | Creditors — total − GST; **GST payable — reverse charge** — GST |
| … import of goods | same | Creditors — total − IGST; **IGST payable on imports (customs)** — IGST |
| … ITC reversed (Rules 42/43/37…) | GST input credit reversed | Input heads, pro rata |
| Advance received (5.3) | Cash / Bank; GST paid on advances — tax on a service advance | Advances from customers (party); Output CGST/SGST/IGST |
| Advance adjusted (payment row with `advance_id`) | Advances from customers (+ TDS receivable when it settles the TDS); Output heads — its GST share | Sundry debtors (party); GST paid on advances |
| Advance refunded | Advances from customers; Output heads — its GST share | Cash / Bank; GST paid on advances |
| Supplier payment | Sundry creditors | Cash / Bank |
| Ledger / party openings (WP-1, `ledger_openings`, `opening_bills`) — one voucher dated the day before the books-beginning date | each opening's Dr side (party lines on Debtors / Creditors with the party) | each opening's Cr side; the residual to **Opening balance difference** (1090), reported as "Difference in opening balances" |
| Books opening balance (`book_opening`) | Cash / Bank | Opening balance difference — sized so the ledger balance at the start of `as_of` equals what was typed (entries dated earlier are absorbed, as in the Books cash book) |
| Fixed asset | Asset account | the "paid from" account (none when "already in the books") |
| Depreciation (per FY, dated 31 Mar, for every FY that has started) | Depreciation | Accumulated depreciation |
| Payroll (final payroll run, Phase 7) | earnings' accounts (Salaries & wages, Allowances & overtime, Bonus …), employer PF / ESI / admin & EDLI expense | Salary payable, PF / ESI / PT / TDS (192) payable, other deductions' accounts — `docs/features/payroll.md` |
| Payroll payment | Salary / PF / ESI / PT / TDS payable | Cash / Bank |

Foreign-currency documents post in rupees at their `exchange_rate` through `export-shared.invoiceAmounts` /
`fx.inrValue`; receipts clear the debtor at the invoice's rate. When a receipt carries a `realised_rate` (6.19), Bank is
debited with the realised rupees and the difference goes to **4930 Foreign exchange gain / loss** (Other income; credit
= gain, debit = loss) — see `docs/features/cash-planning.md`. The readers are the same as GST
reports, Books and Tally (`invoiceAmounts`, `books.normalizePurchase` → `readPurchase`/`splitLumpTax`), so totals agree.
A voucher that does not balance or names an unknown account is left out and listed in `ledger.warnings` (shown on
the Vouchers tab).

## Cost centres (6.16)
Every posting line can carry `cost_centre` (from the document, bill or manual voucher line; an invoice's lines with
their own centre split the Sales credit by taxable value). The Project P&L and Budgets tabs read it; the statements
above ignore it. See `docs/features/cost-centres-budgets.md`.

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
- RCM / import bills: the purchases module, Books and Tally all owe the supplier `supplierPayable(bill)` (total − the
  GST we pay ourselves), the same figure the ledger credits to Creditors, so paying the supplier its balance closes the
  creditor exactly. The self-assessed GST stays on 2310 / 2311 until a payment or journal clears it.

## Voucher variants (Tally parity, Phase 7)
Additive fields on manual vouchers (`vouchers` table), set in the voucher editor (`src/components/books/tally/VoucherVariantFields.tsx`);
logic in `src/lib/ledger/voucher-variants.ts`; registers on Books → **Voucher registers** (`?tab=vreg`).

| Field | Meaning | In the books |
|---|---|---|
| `variant: 'OPTIONAL'` | Optional voucher | never, until **Make regular** (`makeRegular`: period lock on its date, `books.edit`, audited; sets `regularised_at`) |
| `variant: 'MEMO'` | Memorandum voucher | never (memo register only) |
| `post_dated: true` | Post-dated voucher | from its date (`today >= date`); listed in the post-dated summary with post-dated cheques from the cheque register (read-only) |
| `reverse_on` (JOURNAL only, after `date`) | Reversing journal | yes, plus an automatic mirror-image journal `<number>-R` dated `reverse_on` (id `mvrev:<id>`). Saving / deleting checks the period lock on both days |
| `voucher_class` | free-text class | register filter only |

`buildLedger` skips vouchers that are not `inBooks(v, today)`, so the trial balance and every statement stay balanced by
construction (tested). Unlike Tally's scenario-only Reversing Journal voucher type, our reversing journal is posted in the
books on both days (the common provision / accrual use); scenarios are not modelled.

## TDS on payables, challans, supplier advances (Phase 7)
- Purchase with TDS on booking: Cr Creditors (total − self-assessed GST − TDS), Cr the section's TDS payable account
  (2331 194C, 2332 194J, 2333 194I, 2334 194H, 2335 194Q, 2336 194A; 2330 otherwise). TDS on payment: the payment
  voucher debits Creditors with cash + TDS and credits TDS payable. See `docs/features/tds-payables.md`.
- TDS / TCS challan (`tds_challans`): Dr the linked deductions' TDS accounts (TCS payable for TCS), unlinked rest to
  2330 / 2320, interest + fee + others to **6380 Interest & fees on TDS / TCS** | Cr Cash / Bank. Ledger-only (not in the
  Books cash book), like manual vouchers.
- Supplier advance / on-account / new-ref payment (`vendor_payments`): Dr Creditors (party) | Cr Cash / Bank (also in the
  Books cash book). Adjusting it against a bill moves nothing in the ledger (bill-wise only).

## Bill-wise payables (Phase 7)
Books → **Bill-wise payables** (`?tab=billwise`, `src/lib/billwise.ts`): outstanding bills per supplier with Agst Ref
allocations (payments, advance adjustments), ageing by due date or bill date (not due / 1–30 / 31–60 / 61–90 / 90+),
unadjusted advances, net payable, MSMED Sec 16 interest for micro / small suppliers (`msme.ts`), "settled bills" party
ledger view. **Pay bills**: one payment split over several bills (FIFO helper, partial allowed; rows share `group_id`),
the remainder as On Account / Advance / New Ref; **Adjust** an advance against a bill later. The party's creditor
balance in the ledger equals its net bill-wise outstanding (tested). Receivables were already bill-wise (payments carry
`invoice_id`; advances adjust through `advance_id`; ageing in `receivables.ts`).

## Ratio analysis (Phase 7)
Books → **Ratio analysis** (`?tab=ratio`, `src/lib/ledger/ratios.ts`): Tally's principal groups (working capital,
cash-in-hand, bank, bank OD, debtors, creditors, sales, purchases, stock-in-hand, net profit, working-capital and
inventory turnover) and ratios (current, quick, debt / equity, gross / net profit %, operating cost %, receivable and
payable days, ROI %, return on working capital %). Balances at the period end (capped at today), flows over the period;
÷ 0 gives "—". Each figure drills to its first account; CSV export. Closing stock counts only when journalised. Ratio
labels / formulas come from the lib in English.
