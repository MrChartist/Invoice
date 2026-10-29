# TDS / TCS on the payables side (Tally parity, Phase 7)

TDS **we deduct** from suppliers (the receivables-side register of TDS customers deduct from us is
`src/lib/tds-register.ts`, `receivables.md`), TDS / TCS challans, Sec 201(1A) interest estimates, the deposit and
return calendar and quarterly return working papers: Form 26Q, Form 27EQ (TCS collected on invoices) and Form 16A
data. Everything is a **working paper — verify with your CA**; the return files are **unverified** against the NSDL
RPU / FVU and say so in every export.

| | |
|---|---|
| UI | `/tds` (nav "TDS & TCS"): Overview · Deductions · Challans · Returns (26Q / 27EQ) · Form 16A data — `src/pages/Tds.tsx`, `src/components/tds/TdsTabs.tsx` (lazy page). Bill / expense form block `TdsBillPanel`; "TDS deducted now" on the supplier payment dialog |
| Lib | `src/lib/tds-rules.ts` (dated statutory values), `src/lib/tds-payables.ts` (rates, thresholds, register, challans, interest, calendar, storage), `src/lib/tds-returns.ts` (26Q / 27EQ / 16A rows, CSV / XLSX / RPU text) |
| Strings | `src/i18n/areas/tds.ts` (`tdsT`, English + Hindi) |
| Tests | `tests/tally-parity.test.ts`, contract row in `tests/purchase-contract.test.ts`, e2e step in `tests/e2e/smoke.mjs`; 7R: `tests/gst-tds-7r.test.ts` |
| 7R | `src/lib/tds-27q.ts` (Form 27Q, DTAA vs Act rate), `src/lib/traces-justification.ts` (TRACES import, table `tds_justifications`), tabs "Form 27Q" and "TRACES defaults" (`src/components/tds/Tds7rTabs.tsx`, lazy); strings `src/i18n/areas/gst-tds-7r.ts` (`r7T`) |

## Data (additive only)
- `purchases` (`PurchaseRecord`): `tds_section` (code, e.g. `194J`, `194J-T`, `194C-1`, `194I-B`), `tds_rate`, `tds_base`
  (taxable value — GST excluded, CBDT Circular 23/2017), `tds_amount`, `tds_on` (`'BILL'` default / `'PAYMENT'`),
  snapshots `tds_pan`, `tds_deductee_type`, `tds_reason` (26Q code `A` / `C` / `Y`), `tds_cert_no`.
- `vendors` (`Vendor`): `pan`, `deductee_type`, `tds_section` (default), `tds_non_filer` (206AB), `tds_lower_cert` /
  `tds_lower_rate` (Sec 197), `non_resident` (27Q — 7R adds the `nr_*` details below); 7O adds `tds_lower_limit` / `tds_lower_from` /
  `tds_lower_to` (certificate limit and validity). All of them are editable on the **vendor form** (7O, 7.95 —
  `vendorTdsProblem` / `cleanVendorTds`); the bill form pre-fills from them (PAN is snapshotted on the bill).
- `purchase_returns` (7O, 7.94): `tds_reversed`, `tds_section` — TDS taken back by a return on a bill with TDS at booking.
- `purchase_payments`: `tds_amount` (TDS deducted on that payment), `group_id` (multi-bill payment).
- New tables (in backups — `RECORD_TABLES` / `ID_TABLES`; clerk+ write — `TABLE_ACTIONS`):
  `tds_challans` (`TdsChallan`: kind TDS/TCS, date, `bsr_code` 7 digits, `challan_no` 5 digits, tax, interest, fee,
  others, minor head, method, `deduction_keys`), `tds_deductions` (manual register-only deductions),
  `tds_returns` (filed marks `26Q:<fy>-Q<n>` / `27EQ:…` with token).

## Rules
- **Deduct on bill** (Tally's default): `supplierPayable(bill)` = total − self-assessed GST − TDS, so balance, status,
  payment checks, vendor balances, MSME tracker, cash forecast, Books payables and Tally all owe the supplier the net.
  Ledger: Cr Creditors (net), Cr the section's **TDS payable** account (2331 194C · 2332 194J · 2333 194I · 2334 194H ·
  2335 194Q · 2336 194A; 2330 anything else). Tally XML: Cr ledger `TDS Payable <section>` (Duties & Taxes).
- **Deduct on payment**: the bill is not reduced up front; each payment may carry `tds_amount`; `amount_paid` rises by
  cash + TDS. Ledger payment: Dr Creditors (cash + TDS) | Cr Bank, Cr TDS payable. Tax became deductible on the bill
  date (earlier of credit and payment), so later deduction shows 1% / month interest.
- **Rate** (`tdsRateFor`): Act rate from `tdsSections(date)` (194A in `tds-rules.ts`); 194C by deductee type (from the
  PAN's 4th character when not set: C company, P individual, H HUF, F firm); no valid PAN → Sec 206AA 20% (194Q 5%,
  reason `C`); Sec 197 certificate → its rate (reason `A`); non-filer → Sec 206AB max(2 × rate, 5%) only 1 Jul 2021 –
  31 Mar 2025. TDS rounded to the rupee (Sec 288B). 7O: the certificate applies only inside its validity
  (`certificateInForce`) and up to its limit (`certificateRoom`; credits already deducted under it in the FY via
  `certificateUsed` on `PriorCredit.cert`); `suggestTds` taxes the excess over the limit at the normal (Act / 206AA /
  206AB) rate and shows the effective rate.
- **Sections added later** (7O, 7.97): 194-O, 194R, 194S — rates date-keyed in `tax-rules.ts` (`TDS_EXTRA_SECTION_RULES`,
  merged by `tdsSections` before "Custom rate", so the invoice editor's receivable list has them too), payable rows in
  `TDS_PAYABLE_SECTIONS` (RPU codes 94O / 94R / 94S unverified), thresholds `TDS_EXTRA_THRESHOLD_RULES` (194R ₹20,000;
  194S ₹10,000; none for 194-O). Ledger: TDS payable 2330 (no section account).
- **Purchase return on a TDS bill** (7O, 7.94): `tdsReversalForReturn(bill, noteTaxable, earlier)` = bill TDS × note
  value ÷ TDS base, rupee-rounded, capped at what earlier notes left; 0 for TDS on payment. The note's supplier amount
  is net of it (bill balance / Agst Ref), the ledger and the Tally debit note debit the section's TDS payable for it,
  Books' TDS payable falls, and the register nets it from the bill's deduction (`returnReversed`, `returnDate`; the
  Deductions tab warns when the return is dated after the deposit — excess TDS: adjust or claim through TRACES).
- **Thresholds** (`thresholdCheck`, same payee = PAN / vendor id / name, same FY, same section family): single and
  FY aggregate; crossing the aggregate brings earlier untaxed credits of the FY into the base (catch-up); 194Q taxes
  only the excess over ₹50 lakh; 194I from 1 Apr 2025 is ₹50,000 per month (checked per bill). Earlier bills of the
  supplier without a section count as the same nature.
- **Challans**: link deductions by key (`bill:<id>`, `pay:<id>`, `man:<id>`, `tcs:<invoice id>`); one challan per
  deduction; linked total ≤ tax. Ledger: Dr each linked deduction's TDS account (TCS payable for TCS), unlinked rest to
  2330 / 2320, interest + fee + others to **6380 Interest & fees on TDS / TCS** | Cr Cash / Bank. Period lock on the
  challan date; audit entity `tds`.
- **Interest** (`interestFor`): late deduction 1% / month from deductible to deducted; late deposit 1.5% / month from
  deducted to deposited when deposited after the due date (unpaid: to today, "accruing"); months or part = calendar
  months, both ends counted. TCS 206C(7): 1% (late payment 1.5% from 1 Apr 2025 — verify).
- **Due dates** (`depositDueDate`, `returnDueDate`, `certificateDueDate`): 7th of next month, TDS of March by 30 April,
  TCS of March by 7 April; 26Q 31 Jul / 31 Oct / 31 Jan / 31 May; 27EQ 15 Jul / 15 Oct / 15 Jan / 15 May; 16A / 27D 15
  days later. Shown on the Overview "Due dates" table and (7O, 7.96) in the GST **compliance calendar** (lazy
  `TdsDueCalendar`, `loadTdsDue`) and the **notification bell** (`tdsDueReminders` in `business-alerts.ts`: deposit /
  26Q overdue, or due within 5 days; loaded only once TDS is used — `usesTds`).

## Returns
`form26Q` / `form27EQ` → challan block + deductee / collectee block in RPU column order (dd/mm/yyyy dates; section
codes 94C, 4JA, 4JB, 4IA, 4IB, 94H, 94Q, 94A; collection codes 6CR (1H), 6CQ (1G) — **unverified**), warnings for
unlinked deductions, missing PAN (`PANNOTAVBL`), challan/quarter mismatches and non-residents (left out of 26Q: Form
27Q is out of scope). CSV, XLSX (own writer, loaded on click) and tab-separated text. `form16AData` per deductee per
quarter (the certificate itself comes from TRACES). Credit notes are not netted in 27EQ.

## Form 27Q — non-residents (7R, 7.120)
- Sections **195-R / 195-F / 195-I / 195-O** (royalty / FTS / interest / other sums) in `TDS_PAYABLE_SECTIONS`; their
  Act rate is `nrActRate` (`NR_ACT_RATE_RULES` in `tds-rules.ts`, date-keyed, append-only, with health & education
  cess: 3% to 31 Mar 2018, 4% after) — royalty / FTS 10% → 20% from 1 Apr 2023; interest 20%; other sums 30%
  (non-company), 40% → 35% for a foreign company from 1 Apr 2024. Surcharge, Sec 194LB / LC / LD and grossing-up
  (Sec 195A) are not modelled. The Act rates sit in `tds-rules.ts` (not `tax-rules.ts`) so the shell does not grow
  (same reason as `gst-penalties.ts`).
- Vendor form (non-resident ticked): country, foreign TIN, TRC number + last valid day, Form 10F, no-PE declaration,
  DTAA rate and article (`Vendor.nr_*`, additive; cleared when the payee is not non-resident).
- `nrRateCheck`: the DTAA rate applies only with a TRC valid on the credit date **and** Form 10F (Sec 90(4) / 90(5)),
  and only when lower than the Act rate (Sec 90(2)); no PAN → Sec 206AA 20% floor unless the Rule 37BC details
  (country, TIN, TRC) are on file. A non-resident booked under a resident section is flagged.
- `form27Q(rows, vendors, challans, fy, q)`: challan block + deductee block (RPU-like order, **unverified**) with tax /
  cess split (Act basis), "rate as per IT Act (A) / DTAA (B)", nature of remittance, country, TIN, TRC / 10F,
  required rate and **short deduction**; warnings for unlinked deductions, missing country / PAN, blocked DTAA rates.
  CSV / XLSX. Filed mark `27Q:<fy>-Q<n>` (`setReturnFiled`). 26Q keeps leaving non-residents out and points to the tab.
- Due dates: `loadTdsDue` now returns deposit items for every deduction, 26Q return items for residents and a
  separate **27Q** return item (`DueItem.form = '27Q'`) for non-residents; the bell names the form.

## TRACES justification report (7R, 7.120)
`parseJustification(text)` reads the TRACES report (text / CSV, `^`-separated text too): section titles (short
deduction, short payment, late deduction / payment interest, late filing fee, PAN errors) and header columns are found
by keywords; dates `dd-mm-yyyy` / `dd/mm/yyyy` / `dd-Mon-yyyy` / ISO; amounts with Indian grouping. **Untrusted input**:
at most 2,000,000 characters / 20,000 lines / 5,000 findings, cells trimmed to 200 characters with control characters
removed, a formula-looking cell is not a number, unreadable rows are counted, exports go through `toCsv`.
`matchFindings` ties each finding to a register row (same PAN — or name without PAN —, compatible section code
(94J ~ 194J), then date and ₹1 amount match); `importJustification` stores one row per import in
`tds_justifications` (backups both lists, `TABLE_ACTIONS` books.edit, audit `tds`), `flagsByKey` gives the open
defaults per deduction, findings can be marked resolved, "Match again" re-runs after register edits. The layout of the
TRACES file is **not verified**.

## Other 7R changes
- **194-O**: an individual / HUF participant with a valid PAN is exempt while the FY gross stays within ₹5 lakh
  (crossing it brings the FY amount in — catch-up); without PAN / Aadhaar the rate is 5% instead of 20%
  (`TDS_194O_RULES`, from 1 Oct 2020, unverified). `thresholdCheck(…, payee)` takes the payee (additive argument).
- **TDS on payment after a return**: `paymentTdsLeft(bill, payments, returns)` = bill TDS − TDS on the value taken
  back by supplier notes (pro rata to the TDS base, rupee-rounded) − TDS already deducted on payments; the payment
  dialog uses it and says how much the returns took off.
- **TCS (27EQ) in the bell**: `loadTcsDue` / `tcsRowsLite` (light reader of live sales invoices with `tcs_amount`, INR
  at the exchange rate — no Books import, so the bell chunk stays small) feed `businessNotices({ tcsDue })`; the bell
  provider loads once an invoice carries TCS.

## 27Q follow-ups (PENDING 40, 7.131)
- **Surcharge** (`NR_SURCHARGE_RULES`, `nrSurchargePct` in `tds-rules.ts`; `verified: false`): % of the tax by the
  payee's income subject to deduction in the FY (`nrAggregates` over the FY's register rows — the paper and the tab
  pass the whole FY): individual / HUF / AOP 10% > ₹50 lakh, 15% > ₹1 crore, 25% > ₹2 crore, 37% > ₹5 crore (from
  FY 2019-20; 10 / 15% before); firm 12% > ₹1 crore; foreign company 2% > ₹1 crore, 5% > ₹10 crore. Applied on the
  Act rate only (`actRate` = base × (1 + SC) × (1 + cess)); never on a DTAA or Sec 206AA rate. The 27Q deductee rows
  split the TDS into tax / surcharge / cess. The 15% cap on dividends / capital gains is not modelled (CA T27).
- **Sec 195A grossing-up**: vendor tick "We bear the tax" (`Vendor.nr_tax_borne`, additive). The amount credited is
  the net; `grossUp195A(net, rate)` = net × 100 ÷ (100 − rate), rupee-rounded; the required TDS and the 27Q "amount
  paid / credited" use the grossed figure, re-checked against the surcharge slab after grossing (CA T28).
- **Form 15CA / 15CB** (`form15caPlan`, Rule 37BB as understood; `FORM15CA_RULES` ₹5 lakh Part A limit from 1 Apr
  2016, `verified: false`): Part D when the rate that applies is nil, Part B with a Sec 197 / 195(2) certificate
  number, Part A while the payee's FY remittances (this one included) stay within the limit, else Part C after a
  Form 15CB. Shown as a table on the Form 27Q tab and as the last column of the 27Q paper. The Rule 37BB(3)
  specified list (no form) is not modelled. Rules-2026 labels Form 145 / 146 through `ita2025.ts` (`verified: false`,
  CA T29); Sec 195A's 2025-Act provision is not confirmed (label "provision to confirm").
- **TRACES flags in the Deductions tab**: open justification findings matched to a register row show under the
  payee ("TRACES: Short deduction, …", `flagsByKey`).

## Open items
TDS 27Q FVU text file — **skipped**: the NSDL / Protean FVU file format cannot be read or validated here, so the app
keeps the RPU-column working paper (import through the RPU, validate with the FVU). 194-O Aadhaar in place of PAN.

## Statutory values to verify (`src/lib/tds-rules.ts`)
194C ₹30k / ₹1L; 194J ₹30k → ₹50k (1 Apr 2025); 194I ₹1.8L → ₹2.4L (1 Apr 2019) → ₹50k/month (1 Apr 2025); 194H ₹15k →
₹20k; 194A ₹5k → ₹10k; 194Q ₹50L excess; 206AA 20% / 5% (194Q); 206AB window; 201(1A) 1% / 1.5%; 206C(7) 1.5% from
1 Apr 2025; RPU section / collection codes and column order.
7O: 194-O 0.75% (1 Oct 2020 – 31 Mar 2021), 1%, 0.1% from 1 Oct 2024; 194R 10% and ₹20,000 from 1 Jul 2022; 194S 1% and
₹10,000 (₹50,000 for a specified person, not modelled) from 1 Jul 2022; RPU codes 94O / 94R / 94S; Sec 197 certificate
limit read as "credits covered in the FY".
7R: `NR_ACT_RATE_RULES` (all rates and dates above, cess 3% / 4%); Sec 206AA floor 20% for non-residents and the Rule
37BC relief; DTAA conditions (TRC + Form 10F) as applied; 27Q section code '195', deductee codes, the A / B rate flag
and remittance nature codes; `TDS_194O_RULES` (₹5 lakh, 5%, catch-up reading of Sec 194-O(2)); TRACES report layout.
