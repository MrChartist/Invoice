# Loans & EMI tracker (8H, roadmap 8.123)

Status: **done**. Business borrowings only — term, vehicle, machinery loans. Employee loans are payroll
(`employee_loans`, `docs/features/payroll.md`).

| Piece | Where | Tests |
|---|---|---|
| Schedule maths, statement, vouchers | `src/lib/loans.ts` | `tests/reach-8h.test.ts` (EMI maths, vouchers, undo) |
| Screen `/loans` (lazy, sidebar "Loans & EMIs", module `loans`) | `src/pages/Loans.tsx`, strings `src/i18n/areas/loans.ts` | — |

## Model

Table `business_loans` (`BusinessLoan`): number `LOAN/FY<yy-yy>/<seq>` (from the disbursement date, through
`series-counters` so a deleted latest number is never reissued), lender, principal, annual rate %, tenure in months,
disbursement date, first EMI date, the cash / bank ledger EMIs are paid from (default Bank), the loan's ledger id,
the disbursement voucher id and `payments` (EMI number — 0 for a prepayment — date, principal, interest, voucher id and
number). Registered in backup (`TABLE_KEYS` and id tables), `TABLE_ACTIONS` (`books.edit`), sync `DATED` (disbursement
date, period lock) and `NUMBERED` (duplicate-number repair), and the audit edit labels.

## Maths

Reducing balance: `EMI = P·r·(1+r)^n / ((1+r)^n − 1)`, `r = rate / 12 / 100`; 0 % → `P / n`. Each row: interest =
opening × r rounded to paise, principal = EMI − interest. The last row takes the remaining principal so the loan closes
at exactly 0 (only paise move). EMI dates keep the first EMI's day and clamp to the month end (31 Jan → 28/29 Feb →
31 Mar). Bare dates are local days throughout.

## Books

- Each loan gets its **own ledger** on first use: "Loan - <lender> (<number>)" under Long-term borrowings, or Short-term
  borrowings for 12 months or less.
- **Disbursement** (optional, "Post disbursement"): Receipt voucher Dr Bank | Cr loan ledger, on the disbursement date.
- **EMI**: Payment voucher Dr loan ledger (principal) + Dr Interest on loans (interest) | Cr Bank / Cash. Amounts default
  to the schedule row; a prepayment (n = 0) takes typed principal / interest. All through `saveVoucher`, so the period
  lock, roles and audit log apply; "Undo" deletes the voucher (period lock again).
- Terms of a loan with recorded EMIs cannot change (undo them first); a loan with EMIs cannot be deleted.

## Statement

Outstanding principal, interest paid, total interest over the term, next EMI, EMIs due and not recorded, and a CSV of
the schedule with the voucher number of each paid EMI. Not modelled: moratoriums, floating-rate resets, re-scheduling
after a prepayment, interest certificates — verify with your lender / CA.
