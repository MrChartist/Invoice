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
| Tests | `tests/gst-setoff.test.ts` (order, plan, journal, challans, cash ledger, purchase cess in 3B), `tests/gst-depth.test.ts` (HSN master, purchase register, monthly recon, e-Invoice details, 9C), WP-6 row in `tests/purchase-contract.test.ts` |

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
month. Ledger: Dr Input cess (2353) when ITC is claimed, else the expense / purchase account. Readers that ignore cess
(Books summary, accounting / Tally exports) see it inside `roundOff` exactly as before, so they still balance — see
open items.

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

## Wiring for the lead

Nothing in the shell: the tabs live inside the existing lazy GST reports page (`src/pages/GstReports.tsx`, `TABS` +
`sectionBody`). Optional cross-links: Books → Vouchers register filter on voucher classes "GST set-off" / "GST payment
(PMT-06)"; Dashboard "GST due" tile (WP-9) can read `periodPaymentStatus`.

## Statutory values to verify with a CA

- `GST_SETOFF_RULES`: the three dates and the reading of Sec 49(5) / 49A / Rule 88A (in particular the pre-Feb-2019
  "own head first" practice and the 1 Feb – 28 Mar 2019 "CGST then SGST" window).
- `RULE_86B_RULES`: ₹50 lakh a month, 1% in cash, from 1 Jan 2021 (Notification 94/2020-CT); exceptions not modelled.
- `CPIN_VALID_DAYS = 15` and the CIN length (17–18 = CPIN + bank code) — not verified against the current portal.
- Interest: 18% p.a. on the net cash tax (Sec 50(1) proviso) for every head including cess and reverse-charge tax;
  24% (Sec 50(3)) for wrongly availed ITC is not modelled. Late fee: `RETURN_LATE_FEE_RULES` (₹50 / ₹20 per day,
  caps by turnover from June 2021) split half CGST / half SGST — QRMP months 1–2 carry none.
- `GSTR9C_THRESHOLD` ₹5 crore and the self-certified form (Notifications 29/2021 and 30/2021-CT); Table numbering and
  the adjustments list follow the pre-2021 form as best known.
- e-Invoice `PayDtls` / `EwbDtls` / `ShipDtls` field names and limits per NIC schema v1.1 as best known; `Mode` /
  `PayInstr` / `CrTrn` / `DirDr` are left empty.

## Open items

- Cess on purchase bills is not yet in Books' `gstSummary` ITC, the accounting / Tally exports (it sits in round-off
  there) or `purchases.ts` `itcTotals`; reverse-charge cess is not split out of the supplier's payable.
- Interest / late fee are estimates on the filing date typed on the tab; ITC carried forward between months is not
  fed back into the next month's set-off plan (3B uses the month's own 4C, like GSTR-3B itself).
- Electronic cash ledger is tracked by major head only; PMT-09 transfers and refunds (RFD-01) are not modelled.
- RCM self-invoice / Rule 52 payment voucher series, ISD, IFF JSON, EXPA, consolidated e-Way — not in this package.
- GSTR-9C: supplier notes (WP-3) are not separated in Table 12; rate-wise Table 9 and Table 14 (expense-wise ITC)
  are not generated.
- HSN master defaults are not yet applied automatically in the invoice / bill line editors (`resolveGstRate` is ready
  for them).
