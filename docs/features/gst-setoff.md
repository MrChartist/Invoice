# GST set-off, payment posting and GST depth (WP-6)

Closes `docs/GAP_ANALYSIS.md` **P0-6** (GST set-off and payment posting) and the main parts of **P1-16** (cess on purchase
bills, e-Invoice Ship / Disp / Pay details, HSN master with rate history, purchase-side HSN register, month-wise
"GSTR-1 vs 3B vs Books", GSTR-9C working paper). Everything is a **working paper — verify with your CA**: nothing is
filed or paid from the app, and the GST portal's own set-off screen and PMT-06 are what count.

| | |
|---|---|
| UI | GST reports page (`/gst-reports`), new lazy tabs: **Set-off & payment** (`SetOffPanel` + `SetOffDialog` + `ChallanList`), **Purchase HSN** (`PurchaseHsnView`), **1 vs 3B vs Books** (`ReconMonthly`), **HSN master** (`HsnMasterPanel`), **GSTR-9C** (`Gstr9cView`) — all in `src/components/gst-reports/`, styles `gst-setoff.module.css`. The GSTR-3B tab shows a "Liability to be paid in cash" card with a link to the set-off tab. Purchase bill form: "Compensation cess on the bill (₹)" under the advanced section. |
| Lib | `src/lib/gst-setoff.ts` (plan, journal, challans, cash ledger), `src/lib/hsn-master.ts`, `src/lib/hsn-purchase-register.ts`, `src/lib/gst-recon-monthly.ts`, `src/lib/gstr9c.ts`; narrow edits in `gst-reports.ts`, `purchase-normalize.ts`, `gstr9.ts`, `einvoice.ts`, `ledger/postings.ts` (one line), `tax-rules.ts` (appended) |
| Strings | `src/i18n/areas/gst-setoff.ts` (`soT`, English + Hindi); tab names in `areas/gst.ts`; 3B card in `areas/gst-views.ts`; cess field in `areas/purchases.ts` |
| 7O | `src/lib/rcm-self-invoice.ts`, `src/lib/iff.ts`, `RcmDocsPanel.tsx`; strings `src/i18n/areas/gst-tds-7o.ts` (`o7T`); tests `tests/gst-tds-7o.test.ts` + a 7O row in `tests/purchase-contract.test.ts` |
| Tests | `tests/gst-setoff.test.ts` (order, plan, journal, challans, cash ledger, purchase cess in 3B), `tests/gst-depth.test.ts` (HSN master, purchase register, monthly recon, e-Invoice details, 9C), WP-6 row in `tests/purchase-contract.test.ts` |
| 7R | `src/lib/gst-cash-refunds.ts` (PMT-09, RFD-01, Rule 89(4)), `src/lib/isd.ts` (ISD, GSTR-6), `src/lib/eway-consolidated.ts` (EWB-02), `src/lib/gstr9c-extra.ts` (9C Table 9 rate-wise, Table 14), `src/lib/gst-by-gstin.ts`; lazy tabs "Cash ledger & refunds", "ISD / GSTR-6", "Consolidated e-Way", "By GSTIN" (`Gst7rPanel.tsx`, one chunk); strings `r7T` (`src/i18n/areas/gst-tds-7r.ts`); tests `tests/gst-tds-7r.test.ts` + a 7R row in `tests/purchase-contract.test.ts` |

## Data (additive only)

New tables — in backups (`RECORD_TABLES` / `ID_TABLES` in `backup.ts`), write access in `TABLE_ACTIONS` (`access.ts`):

| table | action | shape |
|---|---|---|
| `gst_setoffs` | `books.edit` | `GstSetOffRecord`: `period_key` (`2025-05` / `2025-Q1`), `gstin`, `from` / `to`, posting `date`, `due`, `voucher_id` / `voucher_number`, and the posted figures by head (`liability`, `rc_liability`, `itc_used`, `cash_tax`, `interest`, `late_fee`). One row per period × GSTIN. |
| `gst_challans` | `books.edit` | `GstChallan`: `cpin` (14 digits), `generated_on`, `cin`, `brn`, `deposited_on`, `mode`, `bank_ledger_id`, `period_key`, `gstin`, `amounts` = major head (`igst` / `cgst` / `sgst` / `cess`) × minor head (`tax` / `interest` / `penalty` / `fee` / `others`), `voucher_id` / `voucher_number`, `notes`. |
| `hsn_master` | `master.edit` | `HsnMasterRow`: `code`, `description`, `uqc`, `kind` (goods / services), `rates: [{from, rate, cess_rate?, source?}]` oldest first. |

Additive fields: `PurchaseRecord.cess_amount` (₹, inside `total`, outside cgst / sgst / igst); `PurchaseCore.cess`
(shared reader), `PurchaseLineCore.taxRate` / `unit`; `NormalizedPurchase.cess`; `SetOffResult.cessLiability` /
`cessItcUsed` / `cessItcCarry` (3B); e-Invoice payload `ShipDtls` / `DispDtls` / `PayDtls` / `EwbDtls`; audit entity
`gst`. Two expense ledgers are added to `accounts` the first time a set-off carries interest or late fee:
`gst_interest` (code 6385 "Interest on GST (Sec 50)") and `gst_late_fee` (6386 "Late fee on GST returns (Sec 47)") —
an existing account with the same name is reused, a taken code gets a `-n` suffix.

## Set-off (P0-6)

1. **Plan** (`planSetOff(gstr3b, {period, due, paidOn, turnover, nil?, includeInterest, includeLateFee})`): output tax
   by head (3.1(a) + (b)), reverse-charge tax (3.1(d), cash only), net ITC (4C), ITC used per credit head and the
   Table 6.1 matrix, ITC carried, tax in cash, Sec 50(1) interest on the cash tax (`gstInterest`) and Sec 47 late fee
   (`returnLateFee`, split half CGST / half SGST) from `gst-penalties.ts`, totals by head. Due date: `threeBDue(period,
   frequency, stateCode)` from the compliance calendar (monthly 20th; QRMP 22nd / 24th by state; QRMP months 1–2 show
   the PMT-06 deposit day and no interest / late fee is computed for them). A whole FY is refused.
2. **Utilisation order** (date-keyed, `GST_SETOFF_RULES` in `tax-rules.ts`, looked up by the period's first day and
   applied by `computeSetOff(..., order)` in both GSTR-3B and the journal):
   - from 29 Mar 2019 — **Rule 88A** (Notification 16/2019-CT; Circular 98/17/2019-GST): IGST credit first against
     IGST, the rest against CGST and SGST *in any order* — the app picks the split that leaves the least cash
     (shortfalls first, CGST before SGST); IGST credit is used up before CGST / SGST credit; CGST credit → CGST then
     IGST; SGST credit → SGST then IGST; CGST never pays SGST and vice versa;
   - 1 Feb – 28 Mar 2019 — Sec 49(5) + Sec 49A: IGST credit first, remainder to CGST then SGST "in that order";
   - before 1 Feb 2019 — original Sec 49(5): each head's own credit first, then the cross-utilisation.
   - Compensation cess credit pays cess only (Sec 11(2) Compensation Cess Act); reverse-charge cess is cash.
3. **Journal** (`postSetOff(plan, {date, gstin, narration})` → `saveVoucher`, type JOURNAL, voucher class "GST
   set-off"): Dr Output IGST / CGST / SGST / cess (liability), Dr GST payable — reverse charge (2310), Dr Interest on
   GST, Dr Late fee | Cr Input IGST / CGST / SGST / cess (ITC used), Cr **GST electronic cash ledger (2360)** — the
   balancing figure in paise, so the voucher always balances. Posting again for the same period × GSTIN updates the
   same voucher; deleting the set-off deletes the voucher. Period lock, roles and audit come from `saveVoucher`.
   A credit balance on 2360 is tax still to deposit ("GST payable").
4. **Rule 86B** warning (date-keyed `RULE_86B_RULES`): taxable outward supplies above ₹50 lakh a month and less
   than 1% of the output tax in cash. Exceptions are not modelled — warning only.

Tally names: the journal is Tally's "GST adjustment" ("Set Off of GST" / "Decrease of tax liability"); the challan
payment is "Stat Payment".

## PMT-06 challans

`saveGstChallan` validates CPIN (14 digits, unique), the challan date, at least one amount, and — once a deposit date
is entered — the CIN (17–18 letters / digits) and a cash / bank ledger. A paid challan posts a PAYMENT voucher
(class "GST payment (PMT-06)"): **Dr GST electronic cash ledger (2360) | Cr bank** (main bank or any bank ledger,
WP-5). Clearing the deposit removes the voucher; deleting the challan removes it too. Warnings: paid more than 15 days
after the CPIN was generated (`CPIN_EXPIRED`), CIN not starting with the CPIN.

`cashLedgerBalance(challans, setoffs, asOf?)` = paid challans by major head less what set-offs took (tax + interest +
late fee). `periodPaymentStatus` gives "to pay / deposited / shortfall / posted" for the card on the tab;
`challanFromPlan(plan, balance)` pre-fills a challan with only what the head's balance does not cover. The portal keeps
minor heads apart and moves money between heads only through PMT-09; this is a working view by major head.

## Cess on purchase bills

`cess_amount` on the bill is read by `readPurchase` (`cess`) and `normalizePurchase` (GST reports). GSTR-3B: cess in
4A (and 4B for reversals pro rata), 4C net cess, 3.1(d) cess for reverse-charge bills, set-off cess credit against
output cess only (`payment.cess` = cash part). GSTR-9 Table 6 / 7 carry it; Table 9 shows cess credit used month by
month. Ledger: Dr Input cess (2353) when ITC is claimed, else the expense / purchase account. (7O, 7.90) closed the remaining readers: Books `gstSummary` adds `itcCess` / `rcmCess` / `netCessPayable` (cess credit is
kept out of `itc` / `netPayable` because it pays cess only; `itcWithCess(g)` is the figure 3B 4C, GSTR-9 Table 6 and 9C
Table 12 compare with), `purchaseCost` adds cess that is not claimed, the balance sheet nets cess credit; `itcTotals`
has `cess` (inside `total`); the accounting purchase register has a "Cess" column and `roundOff` no longer contains
cess; Tally posts it to an **Input Cess** ledger (Duties & Taxes, Cess) or into the purchase ledger when ITC is
blocked. **Reverse-charge cess** (and customs cess on imported goods) is self-assessed: `selfAssessedCessOf` takes it
out of `supplierPayable`, and the ledger / Tally credit it to GST payable — reverse charge (2310) / IGST payable on
imports (2311) with the GST, so the set-off journal's Dr 2310 (which includes 3.1(d) cess) clears it.

## ITC carry-forward and negative net ITC (7O, 7.91)

- A posted set-off stores `itc_carry` (unutilised ITC by head after the period), plus `itc_opening` / `itc_negative`
  when used. `carryForwardFor(setoffs, from, gstin)` returns the carry of the latest set-off posted for an earlier
  period of the same GSTIN, with notes `CARRY_GAP` (a period in between was not posted) and `CARRY_UNKNOWN` (that
  set-off was posted before 7O — re-post it). `creditLedgerBalance(setoffs, gstin, asOf?)` is the "Credit ledger
  (carried)" stat on the tab.
- `planSetOff(..., { openingItc })` (the tab passes the carry; a checkbox turns it off): credit = 4C (signed) +
  opening, and the date-keyed order is re-run on it (`computeSetOff`); without an opening and with a non-negative 4C
  the plan is exactly the 3B's own Table 6.1. The plan carries `itcOpening` and the "ITC brought forward" column.
- **Negative 4C**: `buildGstr3b` keeps `itc.net` floored at zero (the set-off never uses a negative credit) and adds
  `itc.netSigned` when a head is below zero (reversals in 4B / supplier notes above the period's credit). The 3B
  view shows the signed figure in 4C with a note. In the plan, a head still negative after the carry-in is
  `itcNegative`: added to the cash tax (warning `NEGATIVE_NET_ITC`) and the journal debits that input ledger (it
  carries a credit balance from the reversal) against the cash ledger. GSTR-9 Table 9 subtracts it from the credit
  carried between months. **Flag for the CA** (portal practice: added to the liability — Circular 170/02/2022-GST as
  understood).

## RCM self-invoice and payment voucher (7O, 7.92)

`src/lib/rcm-self-invoice.ts`, table `rcm_documents` (backups, `TABLE_ACTIONS` books.edit, edit log), tab "RCM
self-invoice" (`RcmDocsPanel`, lazy). `rcmBills` lists domestic reverse-charge bills (unregistered suppliers by
default; registered ones for payment vouchers) with the documents issued and the self-invoice due date
(`selfInvoiceDueDate`: `RCM_SELF_INVOICE_DAYS_RULES` in `gst-penalties.ts` — 30 days from receipt from 1 Nov 2024,
Rule 47A; no limit before). Self-invoice `RCM/FY<yy-yy>/<seq>`: one bill, or a **consolidated** invoice for one month
(every bill of that month); lines from the bill lines with the bill's heads spread by value (cess included). Payment
voucher `RPV/FY<yy-yy>/<seq>`: amount ≤ what the supplier is still owed (less earlier vouchers); tax pro rata.
Numbers via `nextSeriesNumberFor` + `recordSeries` (never re-issued after a delete), at most 16 characters (Rule 46),
unique; period lock and audit (`gst`). Printable script-free HTML ("Tax payable on reverse charge: Yes", rule
citation, amount of tax in words). Nothing posts to the ledger — the tax is booked with the bill.

## Supplier notes in GSTR-9 and the compliance estimates (7O, 7.93)

`buildGstr9(..., { purchaseNotes })` passes the notes to every monthly build (3B 4A / 4C and Table 9 follow) and
reduces Table 6B–6F (and 8 for notes on bills whose ITC was not claimed) in the bucket of the bill the note is against
(capital / services share of that bill), so 6J stays nil. Gstr9Modal and Gstr9cView pass `books.purchaseReturns`; the
Compliance tab passes `purchase_returns` to its 3B builds for the late-fee / interest base.

## IFF working paper (7O, 7.98)

`src/lib/iff.ts`: `isIffMonth` (months 1–2 of an FY quarter), `iffCheck` (B2B + CDNR taxable value vs
`IFF_LIMIT_RULES` ₹50 lakh from 1 Jan 2021; `NOT_IFF_MONTH`, `OVER_LIMIT`, `EMPTY`), `buildIffJson` (the GSTR-1 JSON's
`b2b` / `cdnr` / `b2ba` / `cdnra` only, no turnover). "IFF JSON" button on the GST page header in months 1–2. Layout
not verified against the offline tool.

## HSN master, purchase register, reconciliation, e-Invoice, GSTR-9C

- **HSN master** (`hsn-master.ts`): codes with description, UQC, goods / services and a dated rate history (append a
  row to change a rate; earlier rows stay). `findHsn` matches the exact code, else the longest master prefix.
  `resolveGstRate(master, {itemRate, hsn, date, groupRate, companyRate})` = item → HSN master (on the date) → group →
  company. "Add codes used on documents" seeds the master from invoices, the catalogue and bills (most frequent rate,
  earliest date). The app ships **no rate schedule** — rates are what you enter.
- **Purchase HSN / rate register** (`purchaseHsnRegister`): bills of the period by HSN × rate × UQC with qty, taxable,
  IGST / CGST / SGST / cess (bill heads spread over lines by value, so totals equal the bills) and a rate-wise summary.
  Purchase returns are not netted.
- **1 vs 3B vs Books** (`reconMonthly`): per month of the FY, GSTR-1 tax (sections + Table 11 + in-month amendment
  differences, outward RCM excluded), GSTR-3B 3.1(a)+(b), Books output tax + cess (`gstSummary`), ITC 3B 4C vs Books;
  "Check" when any difference exceeds ₹1.
- **e-Invoice** (`buildEInvoice`): `ShipDtls` from `invoice.ship_to` (GSTIN, name, address, PIN, state; warns on a
  missing PIN or a GSTIN / state mismatch), `DispDtls` from the new `dispatch` option, `PayDtls` from the sender's bank
  details (name, account, IFSC, terms, credit days, paid / due for INR documents; opt out with `withPayment: false`),
  `EwbDtls` from `invoice.transport` (transporter id / name, mode 1–4, LR no. / date, vehicle, distance; opt out with
  `withEwb: false`).
- **GSTR-9C** (`buildGstr9c`): Table 5 (books turnover + adjustments vs GSTR-9 5N), Table 7 (taxable turnover vs 4N −
  4G), Table 9 (tax by head, books vs GSTR-9 Table 9 payable), Table 12 (books ITC ± earlier / later-year ITC vs 7J).
  Books figures come from Books (P&L income, output tax, ITC); adjustments are typed on the tab (not stored).

## Cash ledger depth: PMT-09 and refunds (7R, 7.121)

- `cashLedgerDetail(challans, setoffs, transfers, refunds, asOf?, gstin?)`: the electronic cash ledger by **major ×
  minor head** — paid PMT-06 challans in; set-offs out (cash tax from "tax", interest from "interest", late fee from
  "fee"); PMT-09 moves; an EXCESS_CASH refund claim debits "tax" on its filing day and its rejected part comes back
  (PMT-03) on the last trail date. `detailByHead` sums by major head; the set-off tab's balance now uses it (when
  PMT-09 / refunds exist), so pre-filled challans account for them.
- **PMT-09** (`gst_pmt09`, Rule 87(14)): `savePmt09` checks the source head × minor head holds the amount on the day,
  period lock, books.edit, audit `gst`. Nothing posts: the books keep one cash-ledger account (2360).
- **Refund claims** (`gst_refunds`): categories excess cash, export / SEZ supply under LUT (accumulated ITC), export
  of services with IGST, inverted duty structure, other; period, relevant date, filing day, ARN, amounts by head.
  `advanceRefund` moves the trail FILED (RFD-01) → ACKNOWLEDGED (RFD-02) → DEFICIENCY (RFD-03) → PROVISIONAL (RFD-04)
  → SANCTIONED / REJECTED (RFD-06) → PAID (RFD-05) / WITHDRAWN, with provisional / sanctioned / rejected amounts.
  **PAID** with a bank ledger posts a RECEIPT voucher (class "GST refund (RFD)") through `saveVoucher`: Dr bank | Cr
  GST electronic cash ledger (2360) for cash refunds, Cr Input IGST / CGST / SGST / cess for ITC refunds (other
  categories credit 2360 — verify the ledger with your CA). `refundDeadline` (Sec 54(1), two years from the relevant
  date, last day the day before the anniversary) and `refundDelayInterest` (Sec 54(7) 60 days, Sec 56 6% p.a.) come
  from `REFUND_TIME_RULES` in `gst-penalties.ts` (date-keyed, unverified).
- **Rule 89(4) working paper** (`rule894Refund`, `rule894Basis`): refund = zero-rated turnover under LUT × net ITC ÷
  adjusted total turnover, by head in proportion to 4C, capped by the credit ledger (carried) per head; basis from the
  page period's build (EXP WOPAY + SEZ WOPAY net of their notes; 3B 3.1(a) + (b); 3B 4C). The 1.5 × domestic value cap
  and capital-goods exclusion are left to the user (note on screen). "Use in a new claim" pre-fills the claim form.

## Input Service Distributor (7R, 7.122)

`isd_documents` (backups, books.edit, sync DATED, audit `gst`): `INWARD` (invoices / supplier credit notes received by
our ISD registration), `DISTRIBUTION` (ISD invoices / credit notes issued, `ISD/FY<yy-yy>/<seq>` via series-counters,
never re-issued, tagged with the month they distribute), `RECEIVED` (ISD credit our unit received).
`planIsdDistribution` (Rule 39): shares by the units' previous-FY turnover (typed), eligible and ineligible pools
separately, IGST → IGST, CGST / SGST → CGST / SGST in the ISD's State and IGST elsewhere, cess → cess, rounding to the
last unit; `issueDistribution` saves the documents. `buildGstr6` (Tables 3, 4, 5, 8, undistributed credit, warnings:
not distributed in the month, documents dated outside the month, invalid GSTINs) with `gstr6DueDate` (13th, date-keyed,
unverified) and CSV. `isdInwardRows` → `BuildOptions.isdInward` (additive): GSTR-3B **4A(4)** (`itc.isd`; ineligible to
4D(2)) and into 4C, the 3B JSON `itc_avl` ISD row, GSTR-9 **6G** (sum of the months). Nothing posts to the ledger.
ISD is mandatory for common input services from 1 Apr 2025 (`ISD_MANDATORY_RULES`, as understood).

## Consolidated e-Way Bill (7R, 7.126)

`buildConsolidatedEway` (EWB-02, Rule 138(9)): generator GSTIN / transporter id, from place and State, mode, vehicle
(road; same plate check as `eway.ts`) or transport document no. / date (rail / air / ship), the individual 12-digit
EWB numbers (picked from saved invoices' `einvoice_meta.eway_no` or pasted — `parseEwbList`, capped at 500), expired
bills flagged. JSON `{ version, tripSheets: [{ userGstin, fromPlace, fromState, transMode, vehicleNo, transDocNo,
transDocDate, tripSheetEwbBills: [{ ewbNo }] }] }` — **layout unverified** (`CEWB_LAYOUT`).

## GSTR-9C extras, supplier-note cess, exports, 3B JSON (7R)

- **9C Table 9 rate-wise** (`gstr9cRateWise`): 9A–9K (5 / 12 / 18 / 28% with RC rows, 3%, 0.25%, 0.1%, "other rates")
  from the twelve monthly GSTR-1 HSN summaries (notes netted) and reverse-charge / import-of-services bills by rate,
  9L–9O typed, 9P = GSTR-9 Table 9 payable, 9Q unreconciled. **Table 14** (`gstr9cTable14`): bills of the FY in the
  form's expense heads 14A–14Q (imports → 14D, `capital_goods` → 14O, then category keywords, else 14N), value / total
  ITC / eligible ITC (net of reversals; supplier notes netted in the bill's head), 14R vs GSTR-9 7J (14S) → 14T.
  **Table 12 split**: `Gstr9cBooks.notesItc` (`notesItcForFy`) shows ITC given back by supplier notes as line 12A-N, so
  12D compares like with like (books ITC is gross of notes, 7J nets them).
- **Cess on supplier notes** (`PurchaseReturn.cess_amount`, additive): set on save as the bill's `cess_amount` pro rata
  to the note's taxable value (`noteCessFor`, capped by earlier notes; inside `total`). Read by 3B (4A cess / 3.1(d)
  cess come down), GSTR-9 Table 6 / 8F, Books (ITC / self-assessed tax / cost), the ledger (Cr Input cess 2353, or back
  to cost when ITC was not claimed; reverse-charge cess reversed from GST payable) and the Tally debit note ("Input
  Cess"). Notes saved before 7R carry none.
- **Accounting `gst_summary`** has a **Cess** column (sales lines, credit notes, bills) and "Total Tax" includes it.
- **GSTR-3B JSON** writes Table 4(C) **signed** (`itc.netSigned`) as the portal computes 4(A) − 4(B) — a negative 4(C)
  is shown and added to the liability on the portal (Circular 170/02/2022-GST as understood). `GSTR3B_JSON_LAYOUT.
  signedNetItc` switches back to the floored figure if the offline tool rejects it. The 3B CSV shows the same signed 4C.
- **GSTR-1 / 3B by GSTIN** (`buildByGstin`, tab "By GSTIN"): one column per registration (`gstinColumns`: branches,
  profiles, invoice snapshots), invoices by sender GSTIN, bills (and their supplier notes) by the receiving branch's
  GSTIN, else the one registration in the bill's place-of-supply State, else "Not assigned" (listed); ISD credit by
  unit. Rows: B2B / B2CL / B2CS / notes / exports / documents; 3.1(a) value and tax, 3.1(b), 3.1(d), 4A, 4B, 4C, cash.
  CSV. Documents without a sender GSTIN are counted under every GSTIN by the builder — warned.

## PENDING 40 follow-ups (7.131)

- **ITC refunds netted in the carried credit**: `creditLedgerRefundMoves(refunds)` (gst-cash-refunds.ts) turns ITC
  refund claims (`ITC_REFUND_CATEGORIES`: export / SEZ under LUT, inverted duty) into dated credit-ledger moves — the
  claim debited on its filing day (Rule 89(3)), the rejected part re-credited on the RFD-06 step (PMT-03), a
  withdrawn claim re-credited on the withdrawal day. `carryForwardFor(setoffs, from, gstin, moves, upTo)` nets the
  moves dated after the previous set-off's posting day and up to this period's own posting day (note `REFUND_NETTED`,
  `refundNet`; floored at zero); `creditLedgerBalance(…, moves)` does the same for the "Credit ledger (carried)" stat
  and the Rule 89(4) cap. Re-credit on a deficiency memo (Rule 90(3)) and re-filing are not modelled (CA G49).
- **Books column on 9C Table 9** (`gstr9cBooksColumn`): the sales register by line rate (`taxByRate(salesDocs)`,
  sales less credit notes, financial notes and foreign-currency documents left out) beside each outward rate row,
  reverse-charge rows equal to the bills, "Difference" = books − documents, and a row for output tax in the books
  (`gstSummary`) that is on no document line by rate (CA G50).

Skipped, with reasons:
- **ISD ledger postings** — whether ISD credit received is booked against a head-office / branch account or the
  distributing registration's own ledger is an accounting judgement (CA G51); nothing is posted.
- **GSTR-6 amendments** (Tables 6 / 7 / 9) — the amendment tables' layout could not be read from a primary source.
- **GSTR-9 Part V Table 13** — the app claims every bill's ITC in the month of its date and keeps no "claimed in
  period" record or stored GSTR-2B history, so it has nothing to put there beyond nil; enter it on the portal.
- **Operator-side GSTR-1 Table 15 / GSTR-3B 3.1.1(i)** — the app has no record of other suppliers' sales through an
  own platform (no invoice field for "supplied by X through us under 9(5)", and the editor is owned by Round 20).

## Wiring for the lead

Nothing in the shell: the tabs live inside the existing lazy GST reports page (`src/pages/GstReports.tsx`, `TABS` +
`sectionBody`). Optional cross-links: Books → Vouchers register filter on voucher classes "GST set-off" / "GST payment
(PMT-06)"; Dashboard "GST due" tile (WP-9) can read `periodPaymentStatus`. Wired: Gateway Statutory **O** and a
palette destination open the tab; the notification bell reminds when the last 3B period has no set-off posted (from 5
days before the due date, once the set-off screen has been used — `src/lib/business-alerts.ts`). The HSN master's
default rate now fills invoice / bill lines when an HSN is typed (`src/lib/hsn-defaults.ts`).

## Statutory values to verify with a CA

- 7O: `RCM_SELF_INVOICE_DAYS_RULES` (30 days from 1 Nov 2024, Rule 47A / Notification 20/2024-CT as understood); the
  consolidated monthly self-invoice route (offered as a convenience — confirm it applies); Rule 46 16-character limit
  applied to the self-invoice and payment-voucher series; `IFF_LIMIT_RULES` (₹50 lakh a month from 1 Jan 2021) and the
  IFF JSON layout; treatment of a negative 4C (Circular 170/02/2022-GST as understood); customs cess credited to the
  "IGST payable on imports" ledger with the customs IGST.

- `GST_SETOFF_RULES`: the three dates and the reading of Sec 49(5) / 49A / Rule 88A (in particular the pre-Feb-2019
  "own head first" practice and the 1 Feb – 28 Mar 2019 "CGST then SGST" window).
- `RULE_86B_RULES`: ₹50 lakh a month, 1% in cash, from 1 Jan 2021 (Notification 94/2020-CT); exceptions not modelled.
- `CPIN_VALID_DAYS = 15` and the CIN length (17–18 = CPIN + bank code) — not verified against the current portal.
- Interest: 18% p.a. on the net cash tax (Sec 50(1) proviso) for every head including cess and reverse-charge tax;
  24% (Sec 50(3)) for wrongly availed ITC is not modelled. Late fee: `RETURN_LATE_FEE_RULES` (₹50 / ₹20 per day,
  caps by turnover from June 2021) split half CGST / half SGST — QRMP months 1–2 carry none.
- `GSTR9C_THRESHOLD` ₹5 crore and the self-certified form (Notifications 29/2021 and 30/2021-CT); Table numbering and
  the adjustments list follow the pre-2021 form as best known.
- 7R: `REFUND_TIME_RULES` (2 years, 90% provisional, 60 days, 6% interest) and the "day before the anniversary" reading
  of Sec 54(1); refund postings by category; Rule 89(4) formula and its caps; `GSTR6_DUE_RULES` (13th); Rule 39 heads
  mapping (CGST / SGST → IGST for another State) and the previous-FY turnover basis; `ISD_MANDATORY_RULES` (1 Apr
  2025); consolidated EWB JSON keys; 9C rate rows / expense heads; the signed 4(C) in the 3B JSON; pro-rata cess on
  supplier notes.
- e-Invoice `PayDtls` / `EwbDtls` / `ShipDtls` field names and limits per NIC schema v1.1 as best known; `Mode` /
  `PayInstr` / `CrTrn` / `DirDr` are left empty.

## Open items

- (7O closed: purchase cess in Books / itcTotals / exports / Tally, RCM cess out of the supplier payable, ITC
  carry-forward, negative 4C, RCM self-invoice + Rule 52 series, IFF JSON, supplier notes in GSTR-9.)
- Interest / late fee are estimates on the filing date typed on the tab. The carry-forward is the app's view of the
  credit ledger: credit used outside the app, or periods never posted, are not known to it.
- (7R closed: PMT-09 and refund claims, ISD / GSTR-6, consolidated e-Way, cess on supplier notes, signed 4C in the 3B
  JSON, `gst_summary` cess, 9C Table 12 split / rate-wise Table 9 / Table 14. EXPA was built earlier — `gst-reports.md`.)
- Refund of IGST on exports of goods with payment (shipping bill route) is tracked as an export-incentive row (R4-C2);
  provisional-refund 90% and Sec 56 interest are estimates. (PENDING 40: filed ITC refund claims are now netted in
  the carried credit.)
- ISD: no ledger postings (CA G51); the Rule 39 turnover basis is typed; Table 6 / 7 / 9 amendments of GSTR-6 not
  built (layout not verified).
- 9C Table 14 heads are a keyword mapping. (PENDING 40: rate-wise Table 9 has a books column.)
- ~~HSN master defaults are not yet applied automatically in the invoice / bill line editors (`resolveGstRate` is ready
  for them).~~ Done: `useHsnDefaultRate` in the invoice editor and `hsn-defaults` in `BillModal.tsx` (stale note struck by R6-C6).
