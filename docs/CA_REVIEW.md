# CA review pack — Mr. Chartist Invoice

Prepared 26 Oct 2026 for the app's reviewing Chartered Accountant. Baseline: branch `claude/elegant-cannon-cwapiv` at
`3765b16` (Phases 0–8, Rounds 2–5 merged).

## What this is and how to answer

Mr. Chartist Invoice is an offline invoicing and accounting app for Indian businesses. It prepares GST, TDS / TCS,
payroll, accounting and export **working papers**. Every screen carries the line "working paper — verify with your CA".
The app files nothing and connects to no portal.

The developers built each statutory rule from notifications, circulars, portal advisories and secondary sources as they
understood them. This pack lists **every point they asked a CA to confirm**, from the 66 feature documents and the
Round 2–5 specifications. Repeated points have been merged.

Each item gives:
- **Question** — what we need you to confirm.
- **App's assumption** — what the app does today.
- **Where** — the file under `src/lib/` (unless another path is given) and the rule-table key. Dated rule tables hold
  one row per change. A document uses the row in force on its own date, and old rows are never edited, so a
  correction is a **new dated row**.
- **From** — the date from which the app applies the value (the latest row unless stated). "—" means the point is
  not date-keyed.
- **Source used** — the citation stored in the code or the feature document. "(unverified)" means the developers
  flagged the value themselves.

**How to reply.** Quote the item id (for example `G7`) and choose one:
- **OK** — the assumption is right.
- **Change** — give the correct value, the date it applies from, and the source.
- **Depends** — say on what.

Items marked ★ are the ones beta testers' figures are most likely to depend on. Please answer these first.

| Area | Ids | Items | ★ priority |
|---|---|---|---|
| 1. GST | G1–G48 | 48 | 12 |
| 2. TDS / TCS and the Income-tax Act 2025 | T1–T26 | 26 | 7 |
| 3. Payroll | P1–P22 | 22 | 4 |
| 4. Accounting and Schedule III | AC1–AC18 | 18 | 2 |
| 5. Industry packs | I1–I36 | 36 | 6 |
| 6. Exports and customs | X1–X10 | 10 | 3 |
| **Total** | | **160** | **34** |

---

## 1. GST

### 1.1 Rates, thresholds and values

| Id | Question | App's assumption | Where | From | Source used |
|---|---|---|---|---|---|
| G1 ★ | Is the B2CL threshold ₹1 lakh for invoices from 1 Aug 2024? | Unregistered inter-State invoices above ₹1 lakh go to B2CL, and to B2CS otherwise. Invoices before that date use ₹2.5 lakh. | `tax-rules.ts` `B2CL_THRESHOLD_RULES` | 2024-08-01 | Notification 12/2024-CT |
| G2 ★ | From 22 Sep 2025, is the rate list 0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 18, 28 and 40% (12% removed; 28% kept only for tobacco / pan masala until compensation cess ends)? | Rate pickers and the exceptions report ("rate outside slab") use the list in force on the document date. An old 12% bill being edited keeps its rate. | `tax-rules.ts` `GST_SLAB_RULES`; `gst-guards.ts` `gstExceptions` | 2025-09-22 | 56th GST Council; Notification 9/2025-CT(R) as understood (unverified) |
| G3 | No GST on advances for goods from 15 Nov 2017, and GST on advances for services on receipt (Sec 13(2)). Is that right? | A goods advance is reported in neither 11A nor 3B. A service advance is taxed in the month received and adjusted in 11B. | `tax-rules.ts` `ADVANCE_GST_ON_GOODS_RULES`, `ADVANCE_GST_ON_SERVICES_RULES` | 2017-11-15 | Notification 66/2017-CT; CGST Act Sec 13(2) |
| G4 | When an advance is refunded (Rule 51), should its tax be reported in **11B of the refund month** or as an **amendment of 11A** of the receipt month? | 11B of the refund month. | `advances.ts`; `gst-reports.ts` (tables `at` / `txpd`) | — | Developers' reading |
| G5 | Taxable freight / other charges: is the rate of the **highest-rated line** correct for a mixed-rate invoice (Sec 15)? | Taxable charges take the highest line rate and are reported as one more rate row under the main HSN. | `invoice-calc.ts`; `docs/features/freight-fx.md` | — | Sec 15 as understood |
| G6 | Interest or late fee charged to a customer for delayed payment: is it part of the value of the supply at the principal supply's rate (Sec 15(2)(d))? | The late-fee draft invoice takes the rate, HSN / SAC and reverse-charge setting of the largest line of the original. | `late-fee.ts` (`principalTaxRate`, `principalItem`) | — | Sec 15(2)(d) CGST Act |
| G7 | Pure-agent reimbursements (Rule 33): may they stay outside the taxable value when the user ticks "pure agent"? | The line is billed at 0% with a note. Whether the Rule 33 conditions are met is left to the user. | `timesheets.ts`; `annexure.ts` | — | Rule 33 CGST Rules |
| G8 | Settlement discount / kasar after the supply: is a **financial credit note without GST** right (Circular 92/11/2019)? May the GST variant be used only if the discount was agreed before supply and the buyer reverses ITC (Sec 15(3)(b))? | The default is a financial credit note `FCN/FY…` with no GST, kept out of GSTR-1 and the composition returns. The optional pro-rata GST variant is offered on the dialog with no proof check. | `financial-note.ts` (`isNonGstFinancialNote`); `settlement.ts` (`gst_variant`) | — | Circular 92/11/2019-GST as understood |
| G9 | Bad debts: is it right that **no output GST is reversed** when a bill is written off? | The write-off posts Dr Bad debts / Cr Debtors only. GST already paid stays paid. | `write-off.ts` | — | No GST relief on bad debts (developers' reading) |
| G10 | Buy-X-get-Y and bill-value offers: is GST due only on the price charged, with the free item as a ₹0 line and no ITC reversal? | The free goods are a ₹0 line (left out of the HSN summary). Bill-value offers are a discount before tax. | `offers.ts`, `pricing.ts` | — | Circular 92/11/2019-GST |
| G11 | Loyalty-point redemption: is it a discount at the time of supply (Sec 15(3)(a)), with GST on the reduced value? | Yes: it is added to the bill's amount discount. | `loyalty.ts` (`applyRedemption`) | — | Sec 15(3)(a) |
| G12 ★ | Counter (POS) sales to a customer from another State: is the place of supply our own State when goods are handed over at the counter? | Intra-State by default. A "deliver to the customer's State" tick makes it IGST. | `pos.ts` (`makeDraft`) | — | Sec 10(1)(a)/(c) IGST Act |

### 1.2 Returns: GSTR-1, GSTR-3B, IFF, GSTR-1A

| Id | Question | App's assumption | Where | From | Source used |
|---|---|---|---|---|---|
| G13 ★ | Outward supplies on which the **recipient** pays tax (outward RCM): where should the supplier report the value in GSTR-3B? | Kept out of 3.1(a) and shown separately (`outwardRcmTaxable`). It is not added to any 3B row. GSTR-9 shows it in 5C. | `gst-reports.ts` | — | Developers' reading; the portal form has no row for it |
| G14 ★ | A document dated in a month whose GSTR-1 / 3B is already filed is cancelled or deleted: should it be corrected through GSTR-1A (same period, before 3B) or a later amendment? | Only amendments are frozen against a filed period. The app recommends locking each month after filing. The GSTR-1A paper lists same-period changes until the period's 3B is marked filed. | `gst-guards.ts` `GSTR1A_RULES`; `period-lock.ts` | 2024-07-01 | Rule 59(4A), Notification 12/2024-CT (unverified first period) |
| G15 | Is GSTR-3B Table 3.2 (inter-State supplies to unregistered persons) editable again after the advisory of 16 May 2025? | Non-editable from the April 2025 period (advisory of 11 Apr 2025), then editable again from 16 May 2025. | `gst-guards.ts` `GSTR3B_T32_LOCK_RULES` | 2025-05-16 | GSTN advisories of 11 Apr and 16 May 2025 |
| G16 | HSN summary: 4 digits up to ₹5 crore aggregate turnover and 6 above, and from 1 Jan 2025 separate B2B / B2C tabs (JSON keys `hsn_b2b` / `hsn_b2c`, with the old `hsn.data` array kept as well)? | As stated. The JSON keys are set in one place. | `tax-rules.ts` `HSN_DIGIT_RULES`, `HSN_TABLE_SPLIT_RULES`; `gstr-json.ts` `HSN_JSON_LAYOUT` | 2021-04-01 / 2025-01-01 | Notification 78/2020-CT; GSTN HSN Phase-III advisory |
| G17 | HSN quantity for lines sold in an alternate unit (2 BOX of 12): may Table 12 show the item's base unit (24 NOS), even though the e-invoice line shows 2 BOX? | Base unit and its UQC in the HSN summary. As typed on the e-invoice / e-way. | `gst-reports.ts` (`hsnLineQty`); `units.ts` (`uqcFor`) | — | Table 12 accepts any valid UQC (developers' reading) |
| G18 | Which purchase heads are "non-supply" and kept out of GSTR-3B Table 5 (salaries, statutory dues, taxes, depreciation)? Is bank interest an exempt inward supply? | The keyword list below. Bank interest stays in Table 5 as exempt. | `purchase-normalize.ts` `NON_SUPPLY_CATEGORY_PATTERNS` (`isNonSupplyCategory`) | — | Working rule |
| G19 | Supplies on which an e-commerce operator pays tax u/s 9(5): report only in GSTR-1 Table 14(b) and 3B 3.1.1(ii), or also in Table 12 (HSN) and Table 8? | Only in 14(b) and 3.1.1(ii). | `tax-rules.ts` `ECO_REPORTING_RULES`; `gstr-json.ts` `ECO_JSON_LAYOUT` (unverified) | 2022-07-05 (3.1.1); 2022-12-26 (Table 14) | Notifications 14/2022-CT, 26/2022-CT |
| G20 | Table 13 (documents issued): may delivery challans of different purposes share one `DCH/…` series? | Yes. The rows do not count each other's numbers as cancelled. | `gst-reports.ts` (Table 13) | — | Developers' reading |
| G21 ★ | A month whose credit notes exceed its other liability: may the excess be carried forward? | GSTR-3B never goes negative in the app. The excess is not carried, so GSTR-9 Table 9 can differ from 4N. | `gst-reports.ts` (`buildGstr3b`) | — | Developers' reading |
| G22 ★ | **Negative net ITC (4C):** should the 3B JSON carry a signed (negative) 4C, with the shortfall added to the cash liability? | Signed 4C in the JSON. A head still negative after carried-forward credit is paid in cash. | `gstr-json.ts` `GSTR3B_JSON_LAYOUT.signedNetItc`; `gst-setoff.ts` (`itcNegative`) | — | Circular 170/02/2022-GST as understood |
| G23 | IFF (QRMP months 1–2): is the limit ₹50 lakh a month? Is the IFF JSON layout right? | ₹50 lakh check. The JSON is unverified. | `iff.ts` `IFF_LIMIT_RULES` | 2021-01-01 | Rule 59(2), Notification 82/2020-CT (unverified) |
| G24 | Due dates of GSTR-1 / IFF / 3B (monthly and QRMP) and GSTR-9. CBIC one-off extensions are **not** tracked. Is that acceptable for a working paper? | Standard calendar only. | `tax-rules.ts` `RETURN_DUE_RULES` | 2021-01-01 | Sec 37 / 39 / 44; Rules 59, 61, 61A; Notifications 82–85/2020-CT |
| G25 | The 3-year time bar for filing returns (Sec 37(5), 39(11), 44(2), 52(13)): from which date does it apply, and from which period? | Applied from 1 Oct 2023, with a reminder 90 days before. | `gst-guards.ts` `RETURN_TIME_BAR_RULES` | 2023-10-01 | Finance Act 2023; Notification 28/2023-CT; GSTN advisory of 7 Jun 2025 |
| G26 | IMS: from which return period is a remark required on Pending / Rejected credit notes? Should a declared ITC reduction feed 3B 4(B)? | From the Oct 2025 period. The reduction is shown on the IMS summary only, and the 3B builder is unchanged. The IMS file layout is unverified. | `tax-rules.ts` `IMS_REMARK_RULES`; `gstr2b.ts`; `ims-file.ts` | 2025-10-01 | GSTN IMS advisory (Oct 2025) as understood |
| G27 | The JSON layouts of amendments (`b2ba` …), advances (`at` / `txpd`), e-commerce (`supeco`, `etin`) and the GSTR-1 error report / downloaded GSTR-1: are they current? | All flagged "layout unverified". | `gstr-json.ts` `AMEND_JSON_LAYOUT`, `ADVANCE_JSON_LAYOUT`, `ECO_JSON_LAYOUT`; `gst-portal-files.ts` | — | GST offline tool as understood |

### 1.3 ITC, set-off, payment, interest

| Id | Question | App's assumption | Where | From | Source used |
|---|---|---|---|---|---|
| G28 ★ | Set-off order: Rule 88A / Sec 49A from 29 Mar 2019, the 1 Feb – 28 Mar 2019 window, and "own head first" before that? | Date-keyed utilisation order, with IGST credit used first from 29 Mar 2019. | `tax-rules.ts` `GST_SETOFF_RULES` | 2019-03-29 | Sec 49(5), 49A; Rule 88A; Circular 98/17/2019-GST (unverified) |
| G29 | Rule 86B: 1% of output tax in cash when taxable supplies exceed ₹50 lakh a month. Exceptions are not modelled. | A warning only. | `tax-rules.ts` `RULE_86B_RULES` | 2021-01-01 | Notification 94/2020-CT (unverified) |
| G30 ★ | Interest u/s 50: is 18% p.a. on the **net cash** tax, for every head including cess and reverse charge, right? (24% u/s 50(3) on wrongly availed ITC is not modelled.) | 18% on net cash tax. | `gst-penalties.ts` `GST_INTEREST_RULES` | 2017-07-01 | Sec 50(1) proviso; Notification 13/2017-CT |
| G31 ★ | Late fee for GSTR-1 / 3B (₹50 / ₹20 nil per day, turnover caps from June 2021, half CGST / half SGST), GSTR-9 (from FY 2022-23) and GSTR-4: are these right? QRMP months 1–2 carry none. | As stated. | `gst-penalties.ts` `RETURN_LATE_FEE_RULES`, `GSTR9_LATE_FEE_RULES`, `GSTR4_LATE_FEE_RULES` | 2021-06-01; 2022-04-01; 2021-04-01 | Notifications 19/2021, 20/2021, 7/2023, 21/2021-CT |
| G32 | PMT-06: is a CPIN valid for 15 days, and is the CIN 17–18 characters? | 15 days; CIN = CPIN + bank code. | `gst-setoff.ts` `CPIN_VALID_DAYS` | — | Not verified against the portal |
| G33 | Refunds (RFD-01): 2 years from the relevant date (the day before the anniversary), 90% provisional, 60 days, 6% interest u/s 56, and the Rule 89(4) formula and caps? | As stated. Refund postings by category credit the cash ledger (2360) or the input heads. | `gst-penalties.ts` `REFUND_TIME_RULES`; `gst-cash-refunds.ts` | 2017-07-01 | Sec 54, 56; Rule 89, 91; Notification 13/2017-CT (unverified) |
| G34 | ISD: mandatory for common input services from 1 Apr 2025? Rule 39 distribution by the previous FY's turnover, with CGST / SGST becoming IGST for another State, and GSTR-6 due on the 13th? | As stated. ISD credit received goes to 3B 4A(4). ISD ledger postings are not built. | `gst-penalties.ts` `ISD_MANDATORY_RULES`, `GSTR6_DUE_RULES`; `isd.ts` | 2025-04-01 | Finance Act 2024, Notification 16/2024-CT (unverified) |
| G35 | RCM self-invoice: within 30 days of receipt (Rule 47A) from 1 Nov 2024? May one consolidated self-invoice cover a month? Does the 16-character limit (Rule 46) apply to the `RCM/` and `RPV/` series? | 30 days. Monthly consolidation offered. 16-character limit applied. | `gst-penalties.ts` `RCM_SELF_INVOICE_DAYS_RULES`; `rcm-self-invoice.ts` | 2024-11-01 | Rule 47A, Notification 20/2024-CT (unverified) |
| G36 | Customs cess on imports: credited to the "IGST payable on imports" ledger together with the customs IGST? | Yes (ledger 2311). | `ledger/postings*.ts`; `purchases.ts` (`selfAssessedCessOf`) | — | Developers' reading |
| G37 | Supplier credit notes / our debit notes: in which month is ITC reduced (our note date, the supplier's note date, or the 2B period)? May the buyer reverse ITC on its own debit note before the supplier's credit note? Which reason codes (01–07) are current? How are RCM / import returns reversed? | ITC is reduced on our note date. The self-assessed liability is reversed with the ITC. Codes 01–07. | `purchase-returns.ts`, `purchase-returns-gst.ts` | — | Sec 34; GSTR-1 / Tally reason list |
| G38 | Destroyed, expired, lost-in-transit or QC-scrapped goods: the app only **reminds** of the ITC reversal (Sec 17(5)(h)) and estimates it as cost × item rate. Is that reversal estimate right? | A reminder plus the estimate for 3B 4(B)(1). | `expiry-ops.ts`; `retail/transfer-requests.ts`; `production/qc.ts` | — | Sec 17(5)(h) |

### 1.4 Annual returns, composition, job work

| Id | Question | App's assumption | Where | From | Source used |
|---|---|---|---|---|---|
| G39 | GSTR-9 Part V cut-off: next-FY documents up to 30 Nov (20 Oct before FY 2021-22)? | As stated. TRAN credit, 8C / 8E, Table 13 and Part VI are not modelled. | `gst-penalties.ts` `NEXT_FY_CUTOFF_RULES`; `gstr9-partv.ts` | 2021-04-01 | Sec 16(4) / 34(2); Finance Act 2022 (unverified) |
| G40 | GSTR-9C: self-certified from FY 2020-21 above ₹5 crore. Table numbering and the adjustment list follow the pre-2021 form. Rate-wise Table 9 and the Table 14 expense mapping are keyword based. | As stated. | `gstr9c.ts` `GSTR9C_THRESHOLD`; `gstr9c-extra.ts` | — | Notifications 29/2021, 30/2021-CT |
| G41 ★ | Composition rates (manufacturer 1%, trader 1% on taxable supplies only, restaurant 5%, service provider 6% u/s 10(2A)), turnover limits and CMP-08 / GSTR-4 due dates? | As stated. Limits are warnings, not enforced. | `tax-rules.ts` `COMPOSITION_RATE_RULES`, `COMPOSITION_LIMIT_RULES`, `COMPOSITION_DUE_RULES` | 2019-04-01; 2024-04-01 (GSTR-4 by 30 Jun) | Rule 7; Notifications 3/2018-CT, 2/2019-CT(R), 14/2019-CT, 12/2024-CT |
| G42 | Composition service providers (6%): are exempt services left out of the base? Does a composition restaurant's turnover through a 9(5) operator count in CMP-08? Does the Sec 10(2)(d) bar on supplies through a TCS operator still apply (goods allowed from 1 Oct 2023)? | Exempt services are left out. 9(5) turnover is counted. The operator bar is a warning only. | `composition-returns.ts` (`buildCmp08`) | — | Notification 2/2019-CT(R) |
| G43 | ITC-04: half-yearly above ₹5 crore and annual otherwise from FY 2021-22, due on the 25th? Does the 1-year (inputs) / 3-year (capital goods) Sec 143 clock end on the anniversary or the day before? How should Table 5 report inputs consumed? Is the ITC-04 JSON layout right? | Applied from the H1 2021-22 period. The clock ends the day before the anniversary (conservative). Table 5 reports the original goods in the base unit. The JSON is unverified, and the CSV is the reference. | `tax-rules.ts` `ITC04_RULES`; `job-work.ts`; `itc04-json.ts` | 2021-04-01 | Rule 45(3), Notification 35/2021-CT (unverified) |
| G44 | GST rate on job charges (5 / 12 / 18% by goods and the principal's registration), and deemed-supply valuation and interest when a Sec 143 clock expires. | The rate is typed by the user. On expiry the app only flags. | `job-work.ts` (`jobChargesLine`); `job-work-alerts.ts` | — | — |

### 1.5 e-Invoice and e-Way bill

| Id | Question | App's assumption | Where | From | Source used |
|---|---|---|---|---|---|
| G45 ★ | e-Invoice mandate thresholds (₹500 → 100 → 50 → 20 → 10 → 5 crore) and the **30-day IRP reporting window** (AATO ≥ ₹100 crore from 1 Nov 2023 for invoices; ≥ ₹10 crore from 1 Apr 2025 for invoices and credit / debit notes)? Are notes excluded for the ₹100 crore group before Apr 2025? | Window counted with the document date as day 1. Unknown AATO → no window shown. | `gst-guards.ts` `EINVOICE_MANDATE_RULES`, `IRP_REPORTING_WINDOW_RULES` | 2023-08-01 (₹5 cr); 2025-04-01 (window) | Notifications 13/2020 … 10/2023-CT; GSTN advisories of 13 Sep 2023 and 5 Nov 2024 |
| G46 | e-Way bill: validity of 1 day per 200 km (20 km for over-dimensional / multimodal cargo) from 1 Jan 2021, with each day ending at midnight; extension window 8 hours before / after expiry; sub-type 4 "Job work" (challan, tax nil) and sub-type 5 "For own use" (challan, value at cost); the ₹50,000 intra-State limit for branch moves; the bulk Part-B / transporter-update JSON, consolidated EWB-02 JSON and e-invoice `ShipDtls` / `DispDtls` / `PayDtls` / `EwbDtls` (NIC schema v1.1). Are these right? | As stated. Every layout is unverified. A typed or imported valid-upto always wins. | `eway-validity.ts` `EWAY_VALIDITY_RULES`, `EWAY_EXTENSION_RULES`; `eway.ts` (`EWAY_SUB_JOB_WORK`); `eway-job-work.ts`; `eway-consolidated.ts` `CEWB_LAYOUT`; `einvoice.ts` | 2021-01-01 | Rule 138(10) as understood; e-Way Bill API as understood |

### 1.6 Gift vouchers and branch transfers

| Id | Question | App's assumption | Where | From | Source used |
|---|---|---|---|---|---|
| G47 | Gift vouchers: the sale is neither goods nor services (no invoice, no GST), and GST is due on the underlying supply at redemption on its full value. Does this hold for PPI and non-PPI vouchers? Was Sec 12(4) omitted from 1 Oct 2025? Is a free promotional voucher a discount at redemption? | As stated. Breakage goes to Other income with no GST. | `retail/gift-voucher-core.ts`, `retail/gift-vouchers.ts` | — | Circular 243/37/2024-GST; a secondary source on Sec 12(4) |
| G48 | Transfers between two of our GSTINs (Sec 25(4)): value per Rule 28 (default average cost). Same-GSTIN transfers: a Rule 55(1)(c) challan at cost with no tax. Is that right? | A tax invoice + matching bill posted to Branch transfer 4030 / 5020, or a challan only. | `branch-transfer.ts` (`BRANCH_TRANSFER_CA_NOTE`); `retail/transfer-challan.ts` | — | Sec 25(4); Schedule I para 2; Rules 28, 55 |


---

## 2. TDS / TCS and the Income-tax Act 2025

| Id | Question | App's assumption | Where | From | Source used |
|---|---|---|---|---|---|
| T1 ★ | TDS rate history: 194J technical 2% from 1 Apr 2020; the 25% COVID cut from 14 May 2020 to 31 Mar 2021; 194Q 0.1% from 1 Jul 2021; 194H 2% from 1 Oct 2024. | As stated, on both the receivable and the payable side. | `tax-rules.ts` `TDS_SECTION_RULES`; `tds-rules.ts` `TDS_194A_RATE_RULES` | 2024-10-01 | Finance Acts 2020, 2021, (No. 2) 2024; press release of 13 May 2020 |
| T2 ★ | Thresholds from 1 Apr 2025: 194C ₹30,000 single / ₹1 lakh a year; 194J ₹50,000; 194-I ₹50,000 a **month**; 194H ₹20,000; 194A ₹10,000; 194Q above ₹50 lakh. | As stated. | `tds-rules.ts` `TDS_THRESHOLD_RULES` | 2025-04-01 | Finance Act 2025 |
| T3 | Sec 206AA without PAN: 20% (5% for 194Q) with no cess on top. Sec 206AB omitted from 1 Apr 2025. | As stated. | `tds-rules.ts` `TDS_NO_PAN_RULES`, `TDS_206AB_RULES` | 2025-04-01 (206AB off) | Sec 206AA; Finance Acts 2021, 2025 |
| T4 ★ | Interest: 201(1A) 1% a month or part for late deduction, 1.5% for late payment; TCS 206C(7) late payment 1.5% from 1 Apr 2025. Is calendar-month counting right? | As stated. Calendar months, TRACES style. | `tds-rules.ts` `TDS_INTEREST_RULES` | 2025-04-01 | Finance Act 2010; Finance (No. 2) Act 2024 |
| T5 ★ | Due dates: deposit by the 7th (March TDS by 30 Apr); 26Q / 27Q by 31 Jul, 31 Oct, 31 Jan, 31 May; 27EQ by the 15th. Under the 2025 Act, is **Form 143 (TCS)** due on the 15th or the 31st? | The 15th, kept as the conservative date. CBDT extensions are not tracked. | `tds-rules.ts` `TDS_DUE_RULES` | 2017-07-01 | Rules 30, 31, 31A, 37CA; Form 143 guide vs Jan 2026 TCS guide (conflict) |
| T6 | TCS presets: 206C(1H) withdrawn from 1 Apr 2025; 206C(1G) LRS 20%. The Finance Act 2026 proposals (2% on overseas tour packages, LRS for education / medical, liquor, scrap, minerals, tendu leaves): should presets be added, and from which date? | Only the LRS 20% preset. | `tax-rules.ts` `TCS_PRESET_RULES` | 2025-04-01 | Finance Acts 2020, 2023, 2025 |
| T7 | 194-O / 194R / 194S presets: 194-O 1% (0.75% in the COVID window), 0.1% from 1 Oct 2024; 194R 10% above ₹20,000; 194S 1% above ₹10,000 (₹50,000 for a specified person is not modelled). Also the 194-O ₹5 lakh exemption for individual / HUF participants and the 5% no-PAN rate. | As stated. | `tax-rules.ts` `TDS_EXTRA_SECTION_RULES`; `tds-rules.ts` `TDS_EXTRA_THRESHOLD_RULES`, `TDS_194O_RULES` | 2024-10-01 | Finance Acts 2020, 2022, (No. 2) 2024 (all unverified) |
| T8 | Form 26Q / 27EQ / 27Q working papers: RPU section codes (94C, 4JA, 4JB, 4IA, 4IB, 94H, 94Q, 94A, 94O, 94R, 94S; TCS 6CR / 6CQ; 27Q code 195), column order, deductee codes and the A / B rate flag. | Codes as listed. Files are for import through the RPU and must be validated with the FVU. | `tds-rules.ts` `TDS_PAYABLE_SECTIONS`, `TCS_27EQ_CODES`; `tds-returns.ts`; `tds-27q.ts` | — | NSDL RPU as understood (unverified) |
| T9 | Non-residents (27Q): Act rates with cess (royalty / FTS 20% from 1 Apr 2023; foreign company 35% from 1 Apr 2024); the DTAA rate only with a TRC **and** Form 10F; the 206AA floor and Rule 37BC relief. Form 15CA / 15CB, surcharge and Sec 195A grossing-up are **not** built. | As stated. | `tds-rules.ts` `NR_ACT_RATE_RULES`; `tds-27q.ts` | 2024-04-01 | Sec 115A; First Schedule; Finance Acts 2018, 2023, (No. 2) 2024 (unverified) |
| T10 | Sec 197 lower-deduction certificate: is the limit read as "credits covered in the FY", with the excess at the normal rate and the certificate used only inside its validity? | Yes. | `tds-payables.ts` | — | Developers' reading |
| T11 | TDS on a supplier bill later reduced by a debit note: pro-rata reversal (Dr TDS payable). What if the TDS was already deposited? | Reversed pro rata, rupee-rounded, with a warning when the return comes after the deposit. | `purchase-returns.ts` (`tdsReversalForReturn`) | — | Left to the CA |
| T12 | TDS receivable register (customers deducting from us): bucketed by invoice date; part-paid invoices pending in full; credit notes do not reduce the TDS expected. Acceptable for a 26AS / AIS match? | As stated. A flat 26AS / AIS CSV is matched. | `tds-register.ts` | — | Working paper |
| T13 | Early-pay discount: is the buyer's TDS on the gross invoice? How does a later discount note affect the TDS receivable? | Gross. The register is not adjusted. | `tds-register.ts`; `settlement.ts` | — | Open |
| T14 ★ | 194C(6) transporters: no TDS when the transporter owns ≤ 10 goods carriages at any time in the year and gives PAN and a declaration. Effective from 1 Jun 2015 or 1 Apr 2015? Is the 26Q code `T` right? | 1 Jun 2015; nil deduction with reason `T`. | `tds-rules.ts` `TDS_194C6_RULES` | 2015-06-01 | Finance Act 2015 (unverified) |
| T15 | Sales commission to agents: TDS u/s 194H is **not** computed. Should it be? | No deduction. The journal narration asks the CA. | `sales-commission.ts` | — | — |
| T16 ★ | **Income-tax Act 2025, Sec 393 table items** beside the old codes for documents from 1 Apr 2026: 192 → Sec 392(1); 194C → 393(1) Sl. 6(i); 194J → 6(iii); 194-I → 2(ii); 194H → 1(ii); 194D → 1(i); 194Q → 8(ii); 194A → 5(iii); 194-O → 8(v); 194R → 8(iv); 194S → 8(vi); 194-IA / 194-IB / 194M → 3(i) / 2(i) / 6(ii); 195 → 393(2) Sl. 17; TCS 206C(1G) → Sec 394(1) Sl. 7. | Only 192 and 194C are marked verified (official FAQ). The rest show "(verify with your CA)" on screens and papers. | `ita2025.ts` `ACT_REF_RULES` | 2026-04-01 | CBDT FAQ (192, 194C); the Bill's tables and secondary sources (rest) |
| T17 | Form numbers under the 2025 Act: 24Q → 138, 26Q → 140, 27Q → 144, 27EQ → 143, 16 / 16A / 27D → 130 / 131 / 133, 26AS → 168, 10BD / 10BE → 113 / 114, 15G / 15H → 121, 26QB–QE → 141. | 143 and 130 / 131 / 133 were seen only in official page titles via a search index. | `ita2025.ts` `FORM_REF_RULES` | 2026-04-01 | Utility manuals; form mapping guide (incometax.gov.in) |
| T18 | RPU / payment section codes for Forms 140 / 143 / 144: secondary sources disagree (for example 1023 / 1024 or 1018 / 1019 for 6(i)). | The working papers keep the 1961 RPU codes plus a "Section references" block and a warning. | `ita2025.ts`; `tds-returns.ts` | 2026-04-01 | Conflicting secondary sources |
| T19 | Other 1961 references not yet mapped: 201(1A) → Sec 398?; 40(a)(ia) → Sec 35(b)?; 206AA / 206AB; salary sections (17, 10, 16, 80C, 87A, 89, 115BAC). | Old references shown. Form 16 Part B adds a note. | `ita2025.ts` (`OLD_CODE_SHOWN_RULES`) | 2026-04-01 | — |
| T20 ★ | MSME payments: the Sec 15 MSMED limit (45 days agreed / 15 days without agreement, from the bill date as the acceptance date); Sec 16 interest at 3 × the RBI bank rate compounded monthly; and Sec 43B(h) disallowance from FY 2023-24 (unpaid by the later of the limit and 31 March, expense share only). The **RBI bank-rate table ends with 5.50% from 5 Dec 2025**: is there a later rate? | As stated. | `tax-rules.ts` `MSME_PAYMENT_DAYS`, `MSME_43BH_FROM`, `RBI_BANK_RATE_RULES`; `msme.ts` | 2025-12-05 | MSMED Act Sec 15, 16; RBI notifications |
| T21 | MSME 45-day note on **our** invoices (a warning to the seller about the buyer's 43B(h)): useful? Should it depend on the buyer being a business and on our Udyam category (micro / small, traders excluded)? | Shown when the seller profile has an Udyam number. | `payment-terms.ts`; `SenderProfile.msme_udyam` | — | — |
| T22 | Bad-debt write-off: deduction u/s 36(1)(vii) on write-off in the books, recovery taxed u/s 41(4), and TDS already deducted by the customer on the written-off bill. | Write-off and recovery register. No tax computation. | `write-off.ts` | — | — |
| T23 | Gift-voucher breakage: is it taxable income in the year of expiry? | Other income on expiry. | `retail/gift-voucher-core.ts` | — | — |
| T24 | Depreciation: the app uses **IT Act WDV block rates** for book depreciation (40% cap from AY 2018-19), per asset. Is that acceptable for non-company entities? Companies need Schedule II useful lives. | IT Act WDV rates only. Disposals need a manual journal. | `tax-rules.ts` `DEPRECIATION_RATE_RULES`; `ledger/assets.ts` | 2017-04-01 | IT Rules, New Appendix I |
| T25 | Pure-agent reimbursements appear as an expense and as income in the P&L. Is gross presentation acceptable? | Gross. | `ledger/postings.ts` | — | — |
| T26 | Retainer fees, forfeited hours and overage (service billing): time of supply for continuous services (Sec 13, 31(5)). Is a forfeited block plain income with no GST change, and is overage a separate supply? | Fee invoice on its own date. Forfeiture: no credit note. Overage billed later as its own invoice. | `retainers.ts` | — | Sec 13, 31(5) CGST Act |

> T24–T26 are counted here because they are income-tax / time-of-supply points raised by the TDS and service screens.

---

## 3. Payroll

Unless stated, every key is in `src/lib/payroll-rules.ts`.

| Id | Question | App's assumption | Where | From | Source used |
|---|---|---|---|---|---|
| P1 ★ | Salary TDS slabs: FY 2023-24, 2024-25 and 2025-26 are tabled. **FY 2026-27 reuses FY 2025-26** until a new row is added. Did the Finance Act 2026 / the 2025 Act change the slabs, rebate or standard deduction from 1 Apr 2026? | FY 2025-26 values carried forward. | `TDS_SALARY_RULES` | 2025-04-01 | Finance Act 2025 |
| P2 | Old-regime senior (₹3 lakh) / super-senior (₹5 lakh) exemption, and the convention that a person "attains the age the day before the birthday". | As stated. | `TDS_OLD_REGIME_AGE_RULES` | 2012-04-01 | First Schedule, Finance Acts |
| P3 | 80CCD(2) employer NPS: 10% of Basic + DA, and 14% in the new regime from FY 2024-25. | As stated. | `CCD2_RULES` | 2024-04-01 | Finance (No. 2) Act 2024 |
| P4 | Sec 206AA on salary without PAN: 20% with no cess on top. | As stated (unverified). | `NO_PAN_SALARY_RULES` | 2010-04-01 | Sec 206AA |
| P5 ★ | EPF 12% / 12% (EPS 8.33%), wage ceiling ₹15,000 from 1 Sep 2014, EDLI 0.5%, admin 0.5% with a ₹500 minimum from 1 Jun 2018. EPS stops at 58, with the birthday month counted in full (EPFO may prorate). | As stated. Older admin rates are approximate. | `PF_RULES` | 2018-06-01 | EPF Scheme; GSR 609(E) |
| P6 ★ | ESI 0.75% / 3.25% from 1 Jul 2019, ceiling ₹21,000 from 1 Jan 2017; coverage decided per contribution period. No employee share at or below the low daily wage (₹100 / ₹137 / ₹176 — which dates?). | As stated. The low-wage dates are unverified. | `ESI_RULES`, `ESI_LOW_WAGE_RULES` | 2019-07-01; 2019-01-01 | GSR 423(E); ESI (Central) Rules r. 51 |
| P7 ★ | Professional tax slabs: Maharashtra (₹175 / ₹200, Feb ₹300; women exempt up to ₹25,000 from Jul 2023), Karnataka, West Bengal, Tamil Nadu (half-yearly, revised Oct 2024), Gujarat (effective date approximate), Andhra Pradesh / Telangana. Other States are typed by the user. | As stated. | `PT_RULES` | per State | State PT Acts |
| P8 | PT on arrears and one-off items: should arrears, bonus and leave encashment join the month's gross for the PT slab? | Off by default. The user ticks States. | `payroll/compute.ts`; `payroll/followups-store.ts` | — | — |
| P9 | Gratuity: 15/26 × last drawn × years, the 5-year rule (the 4 years 240 days view is only flagged), ceiling ₹20 lakh from 29 Mar 2018. | As stated. | `GRATUITY_RULES` | 2018-03-29 | Payment of Gratuity (Amendment) Act 2018 |
| P10 | Leave encashment exemption cap ₹25 lakh from 1 Apr 2023, simplified to the least of amount, cap and 10 × Basic + DA (the average-salary and 30-days-a-year limbs are not computed). | As stated. | `LEAVE_ENCASH_RULES` | 2023-04-01 | Notification 31/2023 |
| P11 | Bonus Act: eligibility ₹21,000, calculation ceiling ₹7,000, 8.33%–20%, minimum ₹100. | As stated. | `BONUS_RULES` | 2014-04-01 | Payment of Bonus (Amendment) Act 2015 |
| P12 | Interest-free / concessional loan perquisite: ₹20,000 small-loan limit; the SBI rate is a 12% **placeholder** to be typed per loan. | As stated. | `LOAN_PERQ_RULES` | 2001-04-01 | Rule 3(7)(i) (SBI rate unverified) |
| P13 | PF interest u/s 7Q (12% p.a.) and damages u/s 14B (5 / 10 / 15 / 25% p.a. by delay). | Estimate only (unverified). | `PF_LATE_RULES` | 2008-09-26 | EPF Scheme para 32A |
| P14 | Relief u/s 89(1) (Form 10E): the earlier-year slabs FY 2017-18 to 2022-23. | Summary table (unverified). | `TDS_SALARY_EARLIER_RULES` | 2017-04-01 | Finance Acts 2017–2020 |
| P15 | Motor car perquisite: ₹1,800 / ₹2,400 (+ ₹900 chauffeur) before, and ₹8,000 / ₹10,000 (+ ₹3,000) from 1 Apr 2025. Which notification, and from which date? | As stated (unverified). | `CAR_PERQ_RULES` | 2025-04-01 | Income-tax amendment rules 2025 (unverified) |
| P16 | Accommodation perquisite: 10 / 7.5 / 5% on the 2011 census from 1 Sep 2023. Is the leased-accommodation 15% kept after 2023? | As stated (unverified). | `ACCOMMODATION_PERQ_RULES` | 2023-09-01 | Notification 65/2023 |
| P17 | Meals ₹50 a meal; gifts below ₹5,000 a year are nil, and the whole year's gifts are taxable once ₹5,000 is reached. | As stated (the gift reading is unverified). | `MEAL_GIFT_PERQ_RULES` | 2001-04-01 | Rule 3(7)(iii), (iv) |
| P18 | s. 17(2)(vii): employer PF + NPS + superannuation above ₹7.5 lakh a year is a perquisite. Is the EPS share counted? 17(2)(viia) accretion is noted but **not computed**. | EPS counted. The excess goes into the TDS projection only, not Form 16 / 12BA. | `S17_2_VII_RULES`; `payroll/followups.ts` | 2020-04-01 | Finance Act 2020 |
| P19 | Interest u/s 201(1A) on salary TDS: 1.5% a month or part, calendar months, Rule 119A rounding, due on the 7th (30 April for March). | As stated (unverified counting). Late **deduction** is not detected. | `TDS_201_RULES` | 2010-07-01 | Sec 201(1A); Rule 30(2) |
| P20 | Reimbursement heads: exemptions by regime. Notice-pay recovery is not deducted from taxable salary. | As stated. | `payroll/compute.ts` | — | — |
| P21 | Statutory file layouts: PF ECR (`#~#`), arrear ECR, ESI monthly contribution, Form 24Q / Form 16 Part B working papers. | Not validated against the EPFO / ESIC / TRACES portals. | `payroll/reports.ts`, `payroll/statutory.ts`, `payroll/followups.ts` | — | Portal layouts as understood |
| P22 | Actuarial valuation journal: AS-15 / Ind AS 19. Ind AS 19 gratuity remeasurement goes to Reserves (OCI, ledger 1100), leave remeasurement to P&L, and benefits paid during the year are already expensed through payroll. | As stated. The valuation itself must come from an actuary. | `payroll/followups-store.ts` | — | AS-15 / Ind AS 19 |

---

## 4. Accounting and Schedule III

| Id | Question | App's assumption | Where | From | Source used |
|---|---|---|---|---|---|
| AC1 ★ | Closing stock is a **report-time valuation** (FIFO / weighted average from the inventory engine, or a typed figure), not a journal. When valuation is on, any closing-stock journal is netted off so stock is never counted twice. "Lower of cost and NRV" and cost-centre stock are not modelled. Is this acceptable for the P&L and balance sheet? | As stated. | `ledger/closing-stock.ts` (`loadStockValuer`, `netOfStockJournals`) | — | AS 2 as understood |
| AC2 ★ | Annual accounts pack: Schedule III Division I wording, with simpler entity wording for proprietorship / firm / LLP. MSMED Act Sec 22 disclosure from the vendor's Udyam category. Which notes are mandatory for small companies? Should the pack carry a "prepared by" block and the audit-trail chain head? | Automatic + text notes. Entity wording per type. | `ledger/annual-pack.ts`, `ledger/notes-auto.ts` | — | Schedule III Div I |
| AC3 | Cash-flow statement (indirect, AS 3): interest and income tax are not separated, and bank overdraft is treated as financing, not a cash equivalent. | As stated. | `ledger/reports.ts` (cash flow) | — | AS 3 |
| AC4 | RCM / import GST stays on 2310 / 2311 until a payment or journal clears it; customs duty is not modelled in the ledger. | As stated. | `ledger/postings*.ts` | — | — |
| AC5 | Deferred revenue / prepaid expenses: straight line by calendar month or by days (AS 9 / Ind AS 115). Should AMC contracts create deferrals automatically? | Manual schedules. | `deferrals.ts` | — | AS 9 / Ind AS 115 |
| AC6 | Exchange difference: realised on receipt to ledger 4930. Period-end revaluation of receivables (AS 11) is a **report only**, not posted. Forex bank revaluation is posted and not reversed. Is that presentation right? | As stated. GST keeps the invoice-date rate (Rule 34). | `fx-gain.ts`; `forex-bank.ts` | — | AS 11 / Ind AS 21 |
| AC7 | Settlement discount: book it as an indirect expense ("Discount allowed") or as a reduction of revenue? | Indirect expense in the P&L and in Sales-by-customer. | `financial-note.ts`; `stats.ts`; `sales-reports.ts` | — | Product decision pending |
| AC8 | Inter-branch supplies between two of our GSTINs post to 4030 / 5020 "Branch transfer" so they net to nil on consolidation. Is that acceptable? | As stated. | `branch-transfer.ts` | — | — |
| AC9 | Order costing (production): a management working (materials standard + a typed conversion rate). Variances are **not posted**. The yield variance is carved out of usage on closed orders. | As stated. | `production/costing.ts` | — | — |
| AC10 | Landed cost: the freight / CHA bill stays an expense in Books while the landed-cost voucher restates stock valuation. Should freight inward sit in Purchases for gross profit? | As stated. | `landed-voucher.ts`, `landed-cost.ts` | — | — |
| AC11 | Loyalty points: an outstanding-points × point-value report only. Do Ind AS 115 / AS 9 entities need a provision journal? | No journal. | `retail/loyalty-tiers.ts`; `loyalty.ts` | — | Ind AS 115 |
| AC12 | Opening balances: the residual goes to "1090 Opening balance difference" (never forced to zero). Income / expense openings dated before 1 April roll into reserves. | As stated. | `ledger/openings.ts`, `ledger/postings-openings.ts` | — | Tally practice |
| AC13 | Audit trail (Rule 11(g), Companies (Accounts) Rules): the edit log is hash-chained and "cannot be disabled", with archive segments. Is CSV + an integrity text acceptable evidence, or is a signed PDF expected? Should the pack include the backup log for Rule 3(5)? The app's backups are user-located. | Auditor pack = CSV + integrity text. | `audit-edits.ts`, `audit-chain.ts`; `trust/auditor-pack.ts` | — | Rule 11(g); Rule 3(5) |
| AC14 | Recycle bin keeps deleted rows for 30 days (5 MB cap). Is that consistent with the DPDP Act 2023 (the owner can delete permanently)? Should rows replaced by a restore or a sync "Use theirs" also go to the bin? | 30 days. Not captured on restore / sync. | `trust/recycle-bin.ts` | — | DPDP Act 2023 |
| AC15 | Cost centres: one centre per line (no percentage split); not carried into GST reports or the cash-basis P&L. Budgets are not period-locked. | As stated. | `cost-centres.ts`; `ledger/budgets.ts` | — | — |
| AC16 | The Books cash-basis P&L approximates payroll cost by payments, and ignores supplier notes. Is the accrual ledger the only statement a CA should rely on? | Ledger statements are the accrual truth. | `books.ts` | — | — |
| AC17 | Bad-debt write-off posting: Dr Other expenses / Cr Debtors, never cash; a recovery in a later FY goes through a receipt voucher. | As stated. | `write-off.ts` | — | — |
| AC18 | Payroll accrual: the Payroll voucher posts on the run date; salary payable and PF / ESI / PT / TDS payables clear on payment. Is the ledger grouping (Provisions 2500, employee ledgers) acceptable? | As stated. | `payroll/books-link.ts` | — | Tally payroll practice |

---

## 5. Industry packs

Round 5 statutory values live in `src/lib/transport-works-rules.ts` (transport, works), `src/lib/r5c-rules.ts`
(institutions, non-profits, property) and `src/lib/marketplace/*`. Every source there is marked "verify".

### Marketplace sellers

| Id | Question | App's assumption | Where | From | Source used |
|---|---|---|---|---|---|
| I1 ★ | May invoices the marketplace issues in the seller's name be imported, with the marketplace's own numbers, as the seller's Rule 46 record? Files without an invoice number (Meesho) are stored as `<prefix>/<order id>`. | As stated. | `marketplace/sales-import.ts` | — | Developers' reading |
| I2 | e-Invoicing of B2B marketplace orders when the seller's AATO is above the mandate: whose IRN — the marketplace's or the seller's? | No IRN is created by the app for imported orders. | `marketplace/sales-import.ts` | — | Open |
| I3 | B2C orders summarised per State × rate × day as the books record and the GSTR-1 Table 7 source: acceptable? | Offered above 3,000 rows. | `marketplace/sales-import.ts` | — | — |
| I4 ★ | GST TCS u/s 52: 0.5% (0.25 + 0.25 / 0.5 IGST) from 10 Jul 2024. Is the credit taken on **acceptance** or on filing? If GSTR-8 differs from GSTR-1, is a Sec 52(8) liability due? | Credit on acceptance. A difference is shown as "value mismatch" only. | `tax-rules.ts` `ECO_TCS_RATE_RULES`; `marketplace/tcs-credit.ts` | 2024-07-10 | Notification 15/2024-CT (unverified) |
| I5 | 194-O receivable from operators (0.1% from 1 Oct 2024) matched to 26AS under the operator's TAN. | As stated. | `marketplace/tcs-credit.ts`; `tds-register.ts` | 2024-10-01 | See T7 |
| I6 | RTO (undelivered goods returned after the invoice): credit note (Sec 34, 30 Nov limit) or cancellation? | Credit note through "Restock". | `marketplace/returns-desk.ts` | — | — |
| I7 | GST on marketplace fees: forward charge with ITC, parked as "awaiting invoice" until the fee tax invoice is recorded? | As stated. | `marketplace/settlement-post.ts` | — | — |
| I8 | Stock in marketplace warehouses in other States (FBA): additional place of business required? | Not checked by the app. | — | — | — |
| I9 | Claim windows: Amazon 60 days, Flipkart 14 days. | From secondary sources (platform policy). | `marketplace/returns-desk.ts` `CLAIM_WINDOW_RULES` | 2017-07-01 | Seller portals as published (unverified) |

### Transport (GTA)

| Id | Question | App's assumption | Where | From | Source used |
|---|---|---|---|---|---|
| I10 ★ | GTA rates from 22 Sep 2025: RCM 5%; forward charge 5% without ITC or 18% with ITC (12% before). Which notification? Is SAC 996791 the default? | As stated. | `transport-works-rules.ts` `GTA_RATE_RULES` | 2025-09-22 | N 11/2017, 13/2017, 03/2022-CT(R); N 15/2025-CT(R) as understood |
| I11 | Annexure V / VI option window (1 Jan – 31 Mar of the preceding FY), deemed continuation, and the notified RCM recipient list (including composition-registered recipients). | As stated. | `GTA_OPTION_WINDOW_RULES`, `GTA_RCM_RECIPIENT_KINDS` | 2017-07-01 | N 03/2022-CT(R), 13/2017-CT(R) as understood |
| I12 | An unregistered payer under the RCM option: billed at 5% forward charge, or exempt? | 5% forward charge. | `transport/freight-bill.ts` | — | — |
| I13 | Consignment-note contents (serial no., consignor, consignee, vehicle, goods, origin, destination, person liable, GSTINs): complete? | As printed. | `transport/consignment-notes.ts`, `transport/lr-print.ts` | — | Rule 46 as understood |
| I14 | Lorry hire from an owner booked without GST (hire of a goods carriage to a GTA); driver advances through ledger 3615. | As stated. | `transport/trips.ts` | — | — |

### Works contracts

| Id | Question | App's assumption | Where | From | Source used |
|---|---|---|---|---|---|
| I15 ★ | Works-contract rates: 18% general; government works 12% before 22 Sep 2025 and 18% from then. Which government / affordable-housing works keep a lower rate? | As stated. | `transport-works-rules.ts` `WORKS_CONTRACT_RATE_RULES` | 2025-09-22 | N 11/2017-CT(R) entry 3 (unverified) |
| I16 | Retention money: GST on the full value at invoice time, not on release? | At invoice time. | `works/deductions.ts` | — | — |
| I17 | Mobilisation advance: GST at receipt through an advance receipt voucher, and recovery by advance adjustment? | As stated. | `works/deductions.ts`; `advances.ts` | — | Sec 13 |
| I18 | GST TDS u/s 51: 2% on the value excluding GST, ₹2.5 lakh tested on the contract value, credit on acceptance of GSTR-7A. Which PSUs / local authorities are deductors? | As stated. | `GST_TDS_51_RULES` | 2018-10-01 | Sec 51; N 50/2018-CT |
| I19 | Labour (BOCW) cess 1% of the value before GST: State practice? Is it an expense or recoverable? Is GST on a value that includes the cess? | 1% before GST. | `LABOUR_CESS_RULES` | 2017-07-01 | BOCW Cess Act 1996 Sec 3 |

### Clinics, schools, coaching

| Id | Question | App's assumption | Where | From | Source used |
|---|---|---|---|---|---|
| I20 | Exempt presets: entry 66 (education) and entry 74 (health care); coaching / tuition at 18%. | Presets on fee heads. | `institutions/fee-plans.ts` | — | N 12/2017-CT(R) |
| I21 | A mixed fee (exempt tuition + taxable items): two documents per instalment, or an invoice-cum-bill of supply (Rule 46A)? Is a late fine on an exempt fee exempt? | Two documents. The fine follows the plan's main head. | `institutions/fee-billing.ts` | — | — |
| I22 | Rule 42 / 43 common credit: D1 = E/F × C2; D2 = 5% × C2; Rule 43 Tc ÷ 60. Exports / zero-rated and outward RCM counted as taxable, non-GST supplies as exempt, T1 / T2 reversed in full. True-up by the September return with interest u/s 50. | As stated. The journal feeds 3B 4(B)(1). | `r5c-rules.ts` `COMMON_CREDIT_TRUE_UP_RULES`; `institutions/common-credit.ts` | 2022-07-05 | Rules 42 / 43; N 14/2022-CT (unverified) |

### Non-profits and trusts

| Id | Question | App's assumption | Where | From | Source used |
|---|---|---|---|---|---|
| I23 | 80G: cash limit ₹2,000 (₹10,000 before FY 2017-18); donations in kind not deductible; anonymous donations u/s 115BBC above the higher of 5% of total donations or ₹1 lakh. | As stated. | `r5c-rules.ts` `DONATION_CASH_LIMIT_RULES`, `ANON_DONATION_RULES` | 2017-04-01 | Sec 80G(5D); Sec 115BBC (unverified) |
| I24 ★ | Form 10BD: columns, code words, aggregation per donor × section × type × mode; due 31 May; late fee u/s 234G ₹200 a day; 10BE by 31 May. | As stated. Edits refused after filing (cancel + new). | `FORM_10BD_DUE_RULES`, `FORM_10BD_COLUMNS`; `nonprofit/form-10bd.ts` | 2021-04-01 | Rule 18AB; portal CSV template (unverified) |
| I25 | 2025-Act references: 80G approval → Sec 133(1)(b)(ii); donee statement → Sec 354(1) (Form 113; 10BE → Form 114 from FY 2026-27). No 2025-Act label for 35(1), 11, 12AB, 115BBC yet. | As stated (unverified). | `ita2025.ts` `ACT_REF_RULES`, `FORM_REF_RULES` | 2026-04-01 | Form mapping guide |
| I26 | FCRA: administrative cap 20% of FC received from 29 Sep 2020 (50% before), and what counts as "administrative"; the ban on transfers; FC-4 due 31 Dec; interest on FC treated as FC. | As stated. Admin ledgers are chosen by the user. | `FCRA_ADMIN_CAP_RULES`, `FC4_DUE_RULES`; `nonprofit/fcra-checks.ts` | 2020-09-29 | FCRA 2010 Sec 8(1)(b); Rule 17 (unverified) |
| I27 | Sec 11: 85% application, accumulation (Form 10), and the treatment of corpus donations and capital expenditure in the tracker. | As stated. | `NPO_APPLICATION_RULES`; `nonprofit/application.ts` | 1961-04-01 | Sec 11(1)(a) |

### Landlords / property

| Id | Question | App's assumption | Where | From | Source used |
|---|---|---|---|---|---|
| I28 ★ | Rent: commercial 18%; a dwelling let to a registered person for business under RCM from 18 Jul 2022; an unregistered landlord of commercial property → RCM (entry 5AB) from 10 Oct 2024, with composition tenants excluded from 16 Jan 2025. | As stated. | `r5c-rules.ts` `LEASE_GST_RULES`; `property/lease-gst.ts` | 2025-01-16 | N 04/2022, 05/2022, 09/2024, 07/2025-CT(R) (unverified) |
| I29 | Security deposit: not consideration until applied (proviso to Sec 2(31)); GST on the applied / forfeited part as an 18% tax-inclusive invoice. | As stated. | `property/deposits.ts` | — | Sec 2(31) proviso |
| I30 | 194-IB (individual tenants, 2% from 1 Oct 2024): should leases offer it? | Not offered. | `property/leases.ts` | — | — |

### Restaurants, pharma, production

| Id | Question | App's assumption | Where | From | Source used |
|---|---|---|---|---|---|
| I31 | Restaurant service 5% without ITC; "specified premises" 18% with ITC; outdoor catering? Should "specified premises" become a date-keyed rule? | Rates come from items / the profile. Nothing is hard-coded. | `restaurant/*` | — | — |
| I32 | Service charge: optional, removable and labelled voluntary; taxed at the food rate as a taxable charge. Is that enough under the consumer-protection guidelines (also a legal question)? Exclude it from staff payout reports? | As stated. Off by default. | `restaurant/tables.ts` | — | CCPA guidelines as understood |
| I33 | Split bills: item / seat splits create separate tax invoices, while equal / custom splits keep one invoice with several payers. Must sub-invoices reference each other on paper? Is a paisa CGST / SGST swap from rounding acceptable? | As stated. The link is kept in the data only. | `restaurant/split-bill.ts` | — | — |
| I34 | Aggregator orders (Sec 9(5)): value-only reporting in Table 14(b) / 3B 3.1.1(ii) with the operator GSTIN. Should commission invoices be prompted as purchases with ITC? | Value only. | `restaurant/tables.ts`; `eco.ts` | — | Sec 9(5) |
| I35 | Pharma: Schedule H1 register format (CSV), and Schedule X records. | H1 register as CSV. No Schedule X book. | `pharma.ts` | — | Drugs and Cosmetics Rules (verify with the drug inspector) |
| I36 | Batch genealogy and recall: every edge kept for mixed batches (no quantity weighting). Does this meet FSSAI / CDSCO practice, and what must a recall notice carry? | As stated. | `production/genealogy.ts` | — | (QA head / regulator question) |

---

## 6. Exports and customs

| Id | Question | App's assumption | Where | From | Source used |
|---|---|---|---|---|---|
| X1 ★ | Export realisation: 9 months before, **15 months** from the date of export for shipments from 13 Nov 2025. Does it cover shipments before the amendment? Is a second rule needed for 18 months on INR-settled exports (proposed FEMA regulations 2026)? Should SOFTEX / service exports start from the invoice date? | Applied by shipment date. | `trade/trade-rules.ts` `EXPORT_REALISATION_MONTHS_RULES` | 2025-11-13 | RBI FEMA (Export of Goods & Services) amendment, Nov 2025 (date unverified) |
| X2 ★ | Rule 96A: what must be done when an LUT export is not realised (pay IGST with interest within 15 days of the period ending)? | Warning only. | `trade/export-register.ts`, `trade/lut-register.ts` | — | Rule 96A |
| X3 | Export incentives: accrual of RoDTEP / drawback income on shipment or on credit (ICDS VII / AS 9); GST on the sale of RoDTEP scrips (believed exempt); scrips used against BCD. | Receivable credited at face value; the sale difference goes to incentive income. | `trade/export-incentives.ts` | — | ICDS VII / AS 9 |
| X4 | Customs assessable value: no 1% landing charge from 26 Sep 2017? | No landing charge from that date. | `trade/trade-rules.ts` `CUSTOMS_LANDING_CHARGE_PCT_RULES` | 2017-09-26 | Notification 91/2017-Customs (N.T.) as understood |
| X5 ★ | Import IGST base = AV + BCD + SWS + other duties, excluding compensation cess; SWS 10% from 2 Feb 2018, with exemptions per tariff line not modelled. | As stated. | `CUSTOMS_IGST_BASE_RULES`, `CUSTOMS_SWS_PCT_RULES` | 2018-02-02 | Customs Tariff Act Sec 3(8), (9); Finance Act 2018 Sec 110 |
| X6 | Bill of Entry duty: spread over the bill's lines **by value** (not by each line's BCD rate); duty expensed to "Customs duty on imports" while stock valuation carries it. Or should it post to "Purchases — customs duty"? | As stated. | `trade/boe-duty.ts`; `landed-cost.ts` | — | — |
| X7 | Exchange rate on export / import documents: the currency master picks the latest typed / imported RBI or FBIL rate on or before the document date. For GST valuation and customs, is the **notified customs rate** required instead? | User-chosen rate, with a note. | `currency-rates.ts` (`rateOn`) | — | Rule 34 CGST Rules |
| X8 | Shipping-bill fields in the EXP JSON (`sbpcode` / `sbnum` / `sbdt`) and export amendments (EXPA). | As understood (unverified). | `gstr-json.ts`; `gst-reports.ts` | — | GST offline tool |
| X9 | Refund of IGST on exports of goods with payment (the shipping-bill route) is **not tracked**, and filed ITC refunds are not netted in the carried credit. Acceptable for a working paper? | Not tracked. | `gst-cash-refunds.ts` | — | — |
| X10 | Forex (EEFC) bank accounts: money in at a typed rate; realised difference on conversion; period-end revaluation (unrealised, AS 11) posted to 4930 and not reversed. | As stated. Supplier payments in FCY are not supported. | `forex-bank.ts` | — | AS 11 / Ind AS 21 |

---

## Counting note

Each id is counted once, in the area where it is listed. Points raised in several documents (for example the
settlement discount in Round 2, the collections doc and the QA report) were merged into one id. Gift vouchers (G47)
and branch transfers (G48) come from the retail-chains pack but are GST questions, so they sit in area 1.
T24–T26 (depreciation, pure-agent presentation, retainer time of supply) were raised on the TDS and service screens.

## Sources this pack was built from

- Feature documents: `docs/features/*.md`, especially the "Verify with your CA" / "Open questions" / "Statutory values"
  sections of `gst-reports`, `gst-setoff`, `composition-amendments`, `advances`, `purchases`, `purchase-returns`,
  `job-work`, `einvoice`, `docs-compliance-r3`, `tds-payables`, `income-tax-act-2025`, `payroll`, `ledger`,
  `books-output-r2`, `collections-r2`, `sales-r2`, `service-billing-r3`, `business-extras`, `retail-chains-r4`,
  `trade-trust-r4`, `production-r4`, `restaurant`, `marketplace-r5`, `transport-works-r5`,
  `institutions-property-r5`.
- Open-question lists: `docs/prd/round-2.md` §8, `round-3.md` §8, `round-4.md` §7, `round-5.md` §7.
- Rule tables, read directly from the code: `src/lib/tax-rules.ts`, `tds-rules.ts`, `gst-penalties.ts`,
  `gst-guards.ts`, `payroll-rules.ts`, `ita2025.ts`, `iff.ts`, `eway-validity.ts`, `transport-works-rules.ts`,
  `r5c-rules.ts`, `trade/trade-rules.ts`, `marketplace/returns-desk.ts`.

When a CA answer changes a value, the developer appends a new dated row to the table named in "Where" (never edits
an old one), adds a test, and records the answer here with the date and the CA's name.
