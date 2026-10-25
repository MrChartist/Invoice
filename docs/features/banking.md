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
  "Bank Accounts" or "Bank OD A/c"; cash → cash ledger. Supplier payments are not in the Tally export yet (pre-existing).

## Banking documents (P1-14)
- **Deposit slip** (`deposit_slips`): pick in-hand, due, still-valid received cheques + count cash by denomination
  (₹500…₹1; ₹2,000 left out — withdrawn 2023). Save numbers it `PIS/FY<yy-yy>/<seq>`, tags the cheques with the account and
  slip, and marks them **deposited** via `transitionCheque` (lock + audit). The cash part is printed only — record the
  cash deposit as a Contra (Dr bank | Cr cash). The slip prints the full account number (the bank needs it).
- **Payment advice**: one supplier payment = `purchase_payments` with the same `group_id` (+ the `vendor_payments`
  remainder) or a single row. Lines: bill no. / date / amount, TDS on bill + on this payment, paid now, balance; the
  advance / on-account part; amount in words; vendor bank masked (`••••1234`). Reads `purchases` via `readPurchase`.
- **e-Payments**: rows of supplier + amount + mode (NEFT / RTGS / IMPS / within-bank) + reference, "Fill with what is due"
  from vendor balances, inline vendor bank-detail editor. Validation: IFSC `AAAA0XXXXXX`, account 6–20 alphanumerics,
  RTGS ≥ ₹2,00,000, debit account no. required for bank presets. Presets: generic CSV (header), HDFC ENet-style (no header),
  ICICI CIB-style, SBI CMP-style. Downloaded without a BOM. **Check the format with your bank** (on screen and here). No
  payment is recorded by the file.
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

## Known gaps
Forex bank ledgers; supplier payments in Tally XML; recording payments back from an e-payment file; Gateway / VoucherEditor show bank ledgers through the chart but have no account
picker of their own; dashboard per-bank tiles (P1-17).
