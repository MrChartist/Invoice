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
| Tests | `tests/tally-parity.test.ts`, contract row in `tests/purchase-contract.test.ts`, e2e step in `tests/e2e/smoke.mjs` |

## Data (additive only)
- `purchases` (`PurchaseRecord`): `tds_section` (code, e.g. `194J`, `194J-T`, `194C-1`, `194I-B`), `tds_rate`, `tds_base`
  (taxable value — GST excluded, CBDT Circular 23/2017), `tds_amount`, `tds_on` (`'BILL'` default / `'PAYMENT'`),
  snapshots `tds_pan`, `tds_deductee_type`, `tds_reason` (26Q code `A` / `C` / `Y`), `tds_cert_no`.
- `vendors` (`Vendor`): `pan`, `deductee_type`, `tds_section` (default), `tds_non_filer` (206AB), `tds_lower_cert` /
  `tds_lower_rate` (Sec 197), `non_resident` (27Q flag only); 7O adds `tds_lower_limit` / `tds_lower_from` /
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

## Open items (7O)
Form 27Q return working paper and DTAA rates (non-resident flag only), TRACES justification-report import, 194-O
₹5 lakh exemption for individual / HUF participants and its 5% no-PAN rate, TDS on payment-mode bills after a return
(later payments simply carry less), TCS (27EQ) items in the bell.

## Statutory values to verify (`src/lib/tds-rules.ts`)
194C ₹30k / ₹1L; 194J ₹30k → ₹50k (1 Apr 2025); 194I ₹1.8L → ₹2.4L (1 Apr 2019) → ₹50k/month (1 Apr 2025); 194H ₹15k →
₹20k; 194A ₹5k → ₹10k; 194Q ₹50L excess; 206AA 20% / 5% (194Q); 206AB window; 201(1A) 1% / 1.5%; 206C(7) 1.5% from
1 Apr 2025; RPU section / collection codes and column order.
7O: 194-O 0.75% (1 Oct 2020 – 31 Mar 2021), 1%, 0.1% from 1 Oct 2024; 194R 10% and ₹20,000 from 1 Jul 2022; 194S 1% and
₹10,000 (₹50,000 for a specified person, not modelled) from 1 Jul 2022; RPU codes 94O / 94R / 94S; Sec 197 certificate
limit read as "credits covered in the FY".
