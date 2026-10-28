# Cash forecast, exchange gain/loss, profitability & credit limits, cheques (roadmap 6.18 / 6.19 / 6.25 / 6.26)

Everything here is local-first and pure where it can be (`src/lib/*.ts` with `node:test` tests). Tax-relevant
outputs keep the "working paper — verify with your CA" wording.

| | UI | Lib | Tests |
|---|---|---|---|
| 6.18 Cash-flow forecast | Books → **Forecast** tab (`?tab=fcst`, lazy chunk `components/books/planning/ForecastTab`) | `src/lib/cash-forecast.ts` | `tests/cash-forecast.test.ts`, contract row |
| 6.19 Exchange gain/loss | Payment modal (realised rate), Books → **FX gain/loss** tab (`?tab=fx`, lazy `FxTab`) | `src/lib/fx-gain.ts`, ledger `postings.ts`, `localDb.payments` | `tests/fx-gain.test.ts` |
| 6.25 Profitability | Reports → **Item profit** (rewritten) and **Party profit** tabs | `src/lib/profitability.ts` | `tests/profitability.test.ts`, contract row |
| 6.25 Credit limits | Client form (credit limit ₹, credit days); editor notice under Parties (`creator/CreditWarning`) | `src/lib/credit-limit.ts` | `tests/credit-limit.test.ts` |
| 6.26 Cheques & PDC | New lazy page `/cheques` (nav: Accounts & GST → Cheques); bell notices | `src/lib/cheques.ts`, `cheque-reminders.ts`, `cheque-print.ts` | `tests/cheques.test.ts`, e2e step |

## 6.18 Cash-flow forecast (estimate)
- **Opening** = today's cash + bank from the Books cash/bank books (`openingCash`, incl. opening balances).
- **Receivables**: open sales documents (invoice / tax invoice / debit note, not draft/cancelled) at
  `due date + client lag`. The lag is the amount-weighted average of (receipt date − due date) over the client's past
  receipts, rounded and clamped to −30…+120 days; no history → the due date. Anything expected before today lands
  today and is marked overdue; an option leaves out invoices 90+ days overdue.
- **Recurring**: every future occurrence of active schedules (`previewOccurrences`), total − TDS, expected
  `occurrence + due_in_days + lag`. Foreign-currency schedules are left out (no rate yet).
- **Payables**: unpaid bills (`readPurchase`: total − paid) at their due date; no due date → the bill date. MSME
  (micro/small) suppliers: the MSMED Act limit (`msme.paymentLimit`) when earlier.
- **Cheques**: received cheques not yet cleared (in hand / deposited) and issued ones not cleared, at their cheque date;
  a cheque linked to an invoice / bill replaces that much of the document's expected flow.
- **Average expenses** (optional): expense-type bills of the last 3 full months ÷ 3, spread per day across the weeks.
- Weekly buckets from today (30 → 5, 90 → 13, 180 → 26 weeks; the last may be short). SVG chart (in/out bars, closing
  line), table, item list with the basis of each date, CSV (`forecastCsv`). Clearly labelled **Estimate, not a statement**.
- Foreign documents at their invoice rate; rate-less ones are counted and left out.

## 6.19 Exchange gain / loss
- `Payment.realised_rate?` (additive, ₹ per unit, only on foreign-currency invoices with an `exchange_rate`;
  `amount` stays in the invoice currency). Entered in the Payment modal (with a live gain/loss preview) or later in the
  FX tab (`localDb.payments.setRealisedRate`, audited, period lock on the receipt date and the invoice).
- **Realised** = `round2(amount × realised rate) − round2(amount × invoice rate)` (each side rounded on its own).
- **Ledger posting** (automatic, rebuilt on the fly): Dr Bank/Cash = realised rupees; Cr Sundry debtors = invoice-rate
  rupees (+ TDS as before); difference to new default account **4930 Foreign exchange gain / loss** (group Other income;
  credit = gain, debit = loss). Every voucher still balances; tests prove the trial balance and balance sheet tie,
  including a fuzzed run.
- **Books cash book** books the realised rupees too (`fx-gain.receiptInr`), so the Books bank figure agrees with the ledger.
  The simple Books P&L does not show the FX line (it exists only in the ledger, like depreciation).
- **Revaluation** (AS 11, unrealised): open foreign receivables on a chosen date (total − TDS − receipts up to that
  date) restated at user-entered closing rates per currency. Report + CSV only, never posted; the tab spells out the
  reversing journal (Dr Debtors / Cr 4930 on the date, reversed the next day) for the CA to post if wanted.
- **GST is unaffected**: GSTR-1/3B, e-Invoice, e-Way and every tax figure keep the invoice-date rate (Rule 34).

## 6.25 Profitability
- Revenue = taxable value of live sales docs in the period (credit notes negative), foreign at invoice rate.
- Line cost, best source first: (1) **stock** — tracked inventory item: the COGS the inventory engine issued for *that*
  invoice (weighted average / FIFO), returns on credit notes; (2) **purchases** — weighted average unit cost of purchase
  lines with the same name (and HSN when both have one) from bills on or before the sale date (any bill if none);
  (3) **none** — not costed, shown as such ("Not costed" column) so a 100 % margin is visibly an assumption.
- Party profit also deducts **billable expenses** (bills with `billable_to_client_id`, at cost: taxable when ITC is
  claimed, else total), re-billed or not. CSV for both reports. Management estimate.

## 6.25 Credit limits at billing
- `Client.credit_limit?` (₹) and `Client.credit_days?` — additive, edited in the client form.
- The editor reads the **client master** (by id, else name), never the snapshot. Warning when
  `outstanding (other open docs, ₹) + this document (total − TDS − received) > limit`, when a bill with a balance is older
  than `credit_days` (from issue date), or when cheques from the party bounced. Never blocks saving.
- Saving an invoice no longer copies `credit_limit` / `credit_days` from the snapshot back into the client master, so an
  old snapshot cannot reset the terms.

## 6.26 Cheque register & PDC
- Table `cheques` (`Cheque`, `src/types/cheques.ts`): direction received/issued, 6-digit number, bank, cheque date,
  amount, party, client/vendor id, linked `invoice_id` / `purchase_id`, status, lifecycle dates, bounce reason/count,
  `payment_id` / `purchase_payment_id`, `account_payee`, additive `bank_account_id` (our account it is deposited into /
  drawn on; "Deposit into" / "Drawn on" picker in the form once a second bank account exists). Clearing passes it to
  the recorded receipt / supplier payment, so multi-account BRS sees the money in the right account.
- **Dangling payment**: deleting the linked invoice / bill deletes its payments. `linkedPaymentMissing` detects this;
  the register shows "Linked payment no longer exists", the cheque can be edited or deleted again, and a later bounce /
  cancel has nothing to reverse (it says so).
- Flow — received: in hand → deposited → cleared | bounced (bounced → deposited again; cleared → bounced for a return
  after credit). Issued: issued → presented → cleared | cancelled.
- No deposit / presentation / clearing before the cheque date or in the future; received cheques expire 3 months after
  their date (RBI), shown as "valid till".
- **Clearing** a received cheque linked to an INR invoice records the payment via `localDb.payments.record` (method
  Cheque, reference = number, date = clearing date); a cheque larger than the balance is refused (or clear without
  recording). Clearing an issued cheque linked to a bill records a supplier payment (`paymentsDb.record`).
- **Bounce** removes the recorded payment (`localDb.payments.remove`), reopening the invoice; cancel does the same for
  a supplier payment. The period lock is enforced by those APIs: if it refuses, the cheque status does not change.
  Bounced cheques flag the party (count shown in the register and in the editor's credit notice).
- **PDC reminders** (`cheque-reminders.ts`, wired as `chequeProvider` in `notifications.ts`): ready to deposit (dated
  today or earlier), due within 3 days, about to expire / expired (≤ 7 days of validity left), issued cheques due.
- **Printing** (`cheque-print.ts`): CTS-2010 leaf (203 × 92 mm) with two layouts, payee, amount in Indian-system words
  (`amountInWords`, "Rupees" dropped since the leaf prints it) split over two lines, figures `**1,23,456/-`, date in
  DDMMYYYY boxes, optional "A/C PAYEE" crossing. Whole-print and per-line offsets in mm (±30, 0.5 steps) are stored in
  `mrchartist_inv_cheque_print`. Printed from a script-free HTML window with `@page` sized to the leaf (no PDF library);
  a "test print" draws the outline for alignment on plain paper.
- Audit entity `cheque`; CSV export of the register.

## Storage (additive)
- New tables: `cheques` (in backup `RECORD_TABLES` / `ID_TABLES`), `cheque_print` (prefs object).
- New fields: `Payment.realised_rate`, `Client.credit_limit`, `Client.credit_days`. No `InvoiceRecord` fields.
- New default ledger account `fx_gain` (code 4930) — constants, nothing stored.

## Known gaps
- ~~Cheques link to one document; a cheque covering several invoices must be recorded unlinked and payments entered by hand.~~ Done in WP-5: `Cheque.allocations` (`types/cheques.ts`) — stale note struck by R6-C6.
- ~~Clearing does not auto-record against foreign-currency invoices~~ — done (PENDING 39): `chequeReceiptFor` settles
  cheque ₹ ÷ the rate the bank paid (typed in the clear dialog, else the invoice's `exchange_rate`) in the invoice
  currency, with `realised_rate` = ₹ ÷ that amount, so the bank gets exactly the cheque's rupees and the difference
  posts to exchange gain / loss; no rate at all → nothing recorded and the note says why. Allocations work the same way.
- No bank charges on bounce; post them as an expense / journal.
- Bank-specific leaf positions are not known exactly — the offsets exist for that.
- ~~Forecast ignores taxes payable (GST/TDS deposits), loans and salaries unless they are bills; credit notes not yet
  set off are not deducted from receivables~~ — done (PENDING 39): live credit notes come off receivables (linked ones
  off their bill via `doc_links`, unlinked ones off the party's first expected receipts); "Add GST / TDS deposits, loan
  EMIs and salaries" (on by default) adds `gstTdsCommitments` (output tax − ITC + reverse charge of each month on the
  20th of the next; TDS on bills on the 7th — from documents, an estimate; a month already paid still shows until its
  due date), `loanCommitments` (unpaid EMIs of `business_loans`) and `payrollCommitments` (the latest final run's net pay
  each later month end, its PF / ESI / PT / TDS on the 15th). Tests: `tests/cash-forecast-commitments.test.ts`.

## 8G additions
- A document with a `payment_schedule` is expected instalment by instalment (open balance spread pro rata over the unpaid instalments), each shifted by the client's usual lag. See `docs/features/invoicing-ux.md` § 8.100.
