# Banking & payments (WP-5, Phase 7.20–7.22)

Each bank account as its own ledger (gap P0-8), banking documents (P1-14) and the P2 items bounce charges and the
day-end cash tally. Everything is local: files are generated in the browser, nothing is sent to a bank. Outputs are
**working papers — verify with your CA**, and the e-payment presets must be **checked with your bank**.

| | |
|---|---|
| UI | Bank accounts card (Reconcile → Statements): OD flag + limit, full account no., IFSC, branch. Reconcile → **Banking documents** tab (lazy chunk `src/components/bank/docs/BankingDocs.tsx`): Deposit slip · Payment advice · e-Payments · Cash tally. Books → Cash & bank: bank-account picker. Cheque form: our bank account + "Against several documents". Bounce dialog: bank charges + charge to expense / party |
| Lib | `src/lib/bank-ledgers.ts`, `src/lib/ledger/postings-bank.ts`, `src/lib/tally-bank.ts`, `src/lib/deposit-slip.ts`, `src/lib/denominations.ts`, `src/lib/cash-tally.ts`, `src/lib/payment-advice.ts`, `src/lib/bank-upload.ts`; `src/lib/cheques.ts`, `src/lib/bank-accounts.ts`, `src/lib/books.ts` (`bankAccountBook`) |
| Strings | `src/i18n/areas/banking.ts` (`bnkT`, English + Hindi). Printed slips / advices / upload files stay English (bank forms) |
| Tests | `tests/banking.test.ts`, contract row in `tests/purchase-contract.test.ts` |

## Bank ledgers (P0-8)
- Ledgers are synthesised from `bank_accounts`, never stored. The main account (`default`) keeps ledger `bank`, code
  **3510** (renaming the main account renames the ledger; "Main bank account" keeps "Bank account"); every other account is
  `bank:<id>`, code `3510-<n>` (order in the master), group **Cash & bank**, or **Short-term borrowings** ("Bank OD A/c")
  with the new `od` flag. Inactive accounts keep their ledger. The main account cannot be flagged OD.
- Registration: `bank-ledgers.ts` calls `registerLedgerSource()` — the single hook added to `ledger/accounts.ts`; `chartOf()`
  appends synthesised ledgers (a row with a default id only renames it). Loaded by `postings-bank.ts`, `ledger/vouchers.ts`
  and `gateway/voucher-entry.ts`, so every chart consumer sees the banks.
- Postings: `buildLedger` still posts bank money to 3510; `applyBankLedgers()` (`postings-bank.ts`, one call line at the
  end of `buildLedger`) re-targets each line through `bankAccountFor(line)` using the source's `bank_account_id`:
  receipts (`rcpt:`), supplier payments (`pay:`), supplier advances (`vpay:`), advance receipts / refunds (`adv:` /
  `advrf:`), TDS challans (`tdsch:`). Cheques record their payments with the cheque's account, so they follow. An unknown
  (deleted) account stays on 3510. **With only the main account the pass returns immediately — old data is unchanged.**
- Openings (only once a second account exists): an account with its own opening gets Dr ledger | Cr Opening balance
  difference sized to that opening at `opening_as_of`; the main account without its own opening keeps the Books bank
  opening, re-sized against 3510 alone; with its own opening, that replaces the Books one. This equals
  `bankAccountBalanceAt` (BRS) and `bankAccountBook` (Books per account). The combined Books bank book (all accounts) is the
  legacy figure and ignores other accounts' own openings — known difference, by design of the existing BRS rule.
- Contra / payment / receipt validation and the Gateway contra picker accept any bank ledger, OD included
  (`isCashOrBankLedger`). TB / BS / ledger / ratios read the chart, so each bank shows by itself; OD ledgers count as
  short-term borrowings (ratios, cash flow financing).
- Tally: `tallyBankResolver()` (`tally-bank.ts`, called from `tally-xml.ts` receipts + advances): main account → the
  configured bank ledger (default "Bank Account", unchanged), other accounts → a ledger named after the account under
  "Bank Accounts" or "Bank OD A/c"; cash → cash ledger. Supplier payments are exported by `tally-books.ts` (WP-7).

## Banking documents (P1-14)
- **Deposit slip** (`deposit_slips`): pick in-hand, due, still-valid received cheques + count cash by denomination
  (₹500…₹1; ₹2,000 left out — withdrawn 2023). Save numbers it `PIS/FY<yy-yy>/<seq>`, tags the cheques with the account and
  slip, and marks them **deposited** via `transitionCheque` (lock + audit). The cash part posts a Contra
  (Dr bank | Cr cash) automatically since 7U. The slip prints the full account number (the bank needs it).
- **Payment advice**: one supplier payment = `purchase_payments` with the same `group_id` (+ the `vendor_payments`
  remainder) or a single row. Lines: bill no. / date / amount, TDS on bill + on this payment, paid now, balance; the
  advance / on-account part; amount in words; vendor bank masked (`••••1234`). Reads `purchases` via `readPurchase`.
- **e-Payments**: rows of supplier + amount + mode (NEFT / RTGS / IMPS / within-bank) + reference, "Fill with what is due"
  from vendor balances, inline vendor bank-detail editor. The downloaded batch is kept for confirmation (7U). Validation: IFSC `AAAA0XXXXXX`, account 6–20 alphanumerics,
  RTGS ≥ ₹2,00,000, debit account no. required for bank presets. Presets: generic CSV (header), HDFC ENet-style (no header),
  ICICI CIB-style, SBI CMP-style. Downloaded without a BOM. **Check the format with your bank** (on screen and here). No
  payment is recorded by the file itself — see 7U below.
- **Cheque against several documents**: `allocations[]` (`invoice_id` / `purchase_id` + amount) instead of the single link;
  sum ≤ cheque amount, no duplicates. Clearing checks every document first, then records one payment per allocation
  (all or nothing) into the cheque's bank; ids in `payment_ids` / `purchase_payment_ids`. Bounce / cancel reverse them all.
  The single `invoice_id` / `purchase_id` path is unchanged.
- **Vendor bank details**: additive `Vendor.bank_account_no`, `bank_ifsc`, `bank_name`, `beneficiary_name`.

## P2
- **Bounce charges**: on Bounce, optional charges post a manual **Payment voucher** (`saveVoucher`: lock + audit) Dr Bank
  charges (6110) — or Dr the party (Debtors / Creditors, recoverable) — | Cr the cheque's bank ledger. Ids in
  `bounce_voucher_ids`, amount in `bounce_charges`. Posted first and deleted again if the receipt reversal is refused.
- **Cash tally** (`cash_tally`): denomination grid vs the Books cash balance at the end of the day; one count per day,
  excess / short shown. Changes nothing in the books.

## Data (additive only)
- `bank_accounts`: `od`, `od_limit`, `account_no`, `ifsc`, `branch`.
- `cheques`: `bank_account_id`, `allocations`, `payment_ids`, `purchase_payment_ids`, `bounce_charges`, `bounce_voucher_ids`,
  `deposit_slip_id`.
- `vendors`: `bank_account_no`, `bank_ifsc`, `bank_name`, `beneficiary_name`.
- New tables `deposit_slips`, `cash_tally`: in backups (`RECORD_TABLES` / `ID_TABLES`), clerk+ write (`TABLE_ACTIONS` books.edit).

## Wiring
- Gateway Banking rows **D / A / E / T** and palette destinations → `/reconcile?tab=documents&doc=deposit` · `…&doc=advice`
  · `…&doc=epay` · `…&doc=cash` (the tab works with no statements imported). Vendor form: bank account no., IFSC
  (validated), bank, beneficiary (integration pass).
- Hot files touched (one line / one hook each): `ledger/postings.ts` (import + `applyBankLedgers` call before `return`),
  `ledger/accounts.ts` (`registerLedgerSource` + `chartOf` merge), `tally-xml.ts` (import, `bankOf` resolver, two 2-line
  call sites), `ledger/vouchers.ts` + `gateway/voucher-entry.ts` (`isCashOrBankLedger` in the cash/bank check),
  `types/purchases.ts` (Vendor fields), `backup.ts`, `access.ts`.

## 7U follow-ups (roadmap 7.23, 7.150–7.153)
- **Forex bank ledgers** (`src/lib/forex-bank.ts`, Reconcile → Banking documents → **Forex bank**, lazy
  `ForexBankPanel.tsx`): additive `BankAccount.currency` (ISO, never the main account) + `fcy_opening` (the
  rupee opening stays `opening`). FCY balance = FCY opening + receipts of invoices in that currency received
  into the account (`Payment.amount` is in the invoice currency) + entries in table `fx_bank_moves`; rupee balance
  = the account's ledger (receipts at their realised rate, 6.19); carrying rate = rupees ÷ FCY. Entries post one
  manual **Journal** each through `saveVoucher` (period lock, audit, roles; `voucher_class` "Forex bank"):
  `in` (typed rate: Dr bank | Cr counter ledger), `out` / conversion (counter ledger Dr the rupees received,
  bank Cr at carrying value, difference = **realised** gain / loss on 4930), `revalue` (closing rate typed:
  Dr / Cr bank vs 4930 = **unrealised** difference, AS 11 / Ind AS 21, not reversed). All or nothing with
  `withTablesRollback`. No live rates. Postings on the account without a currency amount (supplier payments,
  INR receipts) are counted in a warning. **Verify the rates and treatment with your CA.**
- **Pay a supplier in the currency (PENDING 46)** — entry *Pay a supplier in the currency* (`payVendorFromForex`): the
  FCY amount, the day's rate and the rupees it settles on the supplier's bills (default amount × rate; usually the
  bill's booked rupee value). The rupees go through `recordSupplierPayment` from the EEFC account (bills oldest first,
  the rest on account — so bill-wise payables, ageing and Tally see an ordinary supplier payment), and the bank is
  relieved at its **carrying value**: a Journal (class "Forex bank") posts only the difference, Dr / Cr 4930 realised.
  Stored as an `out` move with `payment_group_id` / `vendor_id`; the warning above no longer counts those payment rows;
  deleting the entry removes its payment rows (bills reopened) and its Journal, all or nothing. Bills stay in rupees.
- **Revaluation reversal (PENDING 46)** — optional *Reverse on* date on a revaluation: the Journal is saved as a
  reversing journal (`reverse_on`, mirrored by the ledger on that day), the statement shows a *Revaluation reversed*
  row and the period's unrealised figure nets it. Without a date nothing changes (not reversed, as before).
- **Payments from an e-payment file after confirmation** (`src/lib/epay-confirm.ts`, lazy
  `EpayConfirmPanel.tsx` under e-Payments): downloading a file keeps the batch in `epay_batches`
  (`EPB/FY…`, series counter; rows: supplier, amount, mode, reference, last four digits of the account, status
  sent / paid / failed). The bank's response / status file or statement rows (CSV; columns recognised by name;
  a statement row without status = paid) are matched by reference + amount, then amount + account last four,
  then a unique amount. **Record confirmed payments** is all or nothing (purchase payments, bills, vendor
  payments and the batch restored on any refusal): each paid row = `recordSupplierPayment` (oldest bills first,
  rest on account) from the batch's bank on the bank's date, reference = UTR; failed rows are marked failed.
- **Contra for a deposit slip's cash**: saving a slip with cash posts a **Contra** Dr the slip's bank ledger |
  Cr Cash on the slip date (`DepositSlip.cash_voucher_id` / `cash_voucher_number`), before the cheques move (a
  locked period refuses the slip); "Post the cash as a Contra" can be unticked. The simple Books cash book
  (`books.ts`) does not read manual vouchers — the ledger, TB, Day Book and Tally do (pre-existing split).
- **Supplier payments in the Tally export**: confirmed — `tally-books.ts` (WP-7) exports each `purchase_payments`
  row as a Payment voucher (Agst Ref, TDS ledger) and `vendor_payments` as Advance / On account / New Ref; tested
  in `tests/tally-books.test.ts` and `tests/banking-7u.test.ts`. The forex / Contra / commission journals are manual
  vouchers, so they reach Tally too.
- Tests: `tests/banking-7u.test.ts`; contract row in `tests/purchase-contract.test.ts`.

## Bank rules + memory (8C, roadmap 8.45)
Zoho Books banking rules / Xero bank rules + JAX-style suggestions for imported statements. Reconcile → **Rules** tab
(lazy `components/bank/rules/BankRulesPanel.tsx`) and a suggestions strip above the line list (lazy `RuleSuggestions.tsx`).
Lib: `src/lib/bank-rules.ts` (pure matching, memory, storage), `src/lib/bank-rules-apply.ts` (writes). Strings `capT`.
Tests: `tests/capture-bank-rules.test.ts`.

- **Rule** (table `bank_rules`): conditions joined by ALL / ANY — narration contains / starts with / regex (≤ 120 chars,
  no back-references, lookbehind or quantified groups containing a quantifier / alternation; narrations capped at 500
  chars), counterparty token (`counterpartyToken` = `nameTokens(guessCounterparty(…))`), amount range, debit / credit, bank
  account; priority (lower first). Action: **expense** (head, supplier, GST slab included in the amount + ITC — e.g. bank
  charges 18% with ITC — cost centre, branch, mode), **voucher** (Payment / Receipt voucher to a ledger, party for control
  ledgers), **receipt** against a customer's open invoices (oldest first), **contra** to another cash / bank ledger (an
  existing contra of the same amount between the same ledgers within ±3 days is reused, so importing both banks never
  posts twice), **ignore**.
- **Order**: suggestions run after invoice matching — a line already matched / ignored or carrying a Match suggestion
  gets none. First matching rule wins; **Memory** only for lines no rule caught. Each suggestion is labelled **Rule** or
  **Memory** in the strip; the engine's matches stay labelled in the line list (Match).
- **Memory** is derived, never stored: debit lines matched to a payment of an expense teach counterparty token → expense
  head / supplier / GST rate (most frequent wins). Categorising a line by hand ("Create expense") therefore teaches it,
  and the screen offers **"Create a rule for similar lines?"** pre-filled from that line (`ruleDraftFromLine`).
- **Apply** (`applyBankBatch`): every item is checked first (direction, GST rate gives the amount, ledger exists,
  approval threshold, receipt within the open balance), then written through `purchasesDb.save` + `paymentsDb.record`,
  `saveVoucher` or `localDb.payments.record` inside `withTablesRollback` — roles, period lock, approval gate and audit
  apply, and one refusal undoes the whole batch. One audit row summarises the batch. A clerk's expense above the bill
  approval limit is refused (record it from the expense form to send it for approval).

## Known gaps
Gateway / VoucherEditor show bank ledgers through the chart but have no account picker of their own; dashboard
per-bank tiles (P1-17); bills in a foreign currency (EEFC supplier payments settle rupee bills: PENDING 46); bank
response presets per bank (the reader stays header-driven: banks do not publish their response layouts, so a preset
could not be verified — PENDING 46 skipped it). Revaluation reversal: PENDING 46 (*Reverse on*).

