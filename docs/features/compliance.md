# Compliance calendar, interest and late fee (GST)

Due dates for GSTR-1 / IFF / GSTR-3B / GSTR-9, a filed toggle, and **estimates** of Sec 50 interest and Sec 47 late fee. Everything is offline; nothing is filed. **Verify with your CA / the GST portal.** One-off due-date extensions notified by CBIC are not tracked.

- Where: GST reports page → **Compliance** tab (`/gst-reports?tab=compliance`), plus notices in the bell.
- Table written: `compliance` (`mrchartist_inv_compliance`): `FiledReturn { id, form, period_key, gstin, filed_on, marked_at }`. Included in backups automatically.
- Settings field: `gst_filing_frequency?: 'monthly' | 'qrmp'` (additive and optional; absent = monthly; `readSettings` drops unknown values). No migration is needed: no stored shape changes.

## Files

| File | Purpose |
| --- | --- |
| `src/lib/compliance.ts` | Pure, small (the bell loads it early): `returnsForMonth`, `complianceCalendar`, `returnStatus`, `pendingReturns`, `filedFor` / `setFiled` (+ `loadFiled` / `saveFiled`), `daysBetween`, `qrmp3bDay`, `FORM_LABELS` |
| `src/lib/gst-penalties.ts` | Pure, GST page only: `lateDays`, `gstInterest`, `returnLateFee`, `gstr9LateFee`, `estimateFor`, and the date-keyed `GST_INTEREST_RULES`, `RETURN_LATE_FEE_RULES`, `GSTR9_LATE_FEE_RULES` (same `Versioned` / `ruleAt` convention as `tax-rules.ts`, kept out of it because `tax-rules.ts` loads in the entry chunk) |
| `src/lib/tax-rules.ts` | Date-keyed data: `RETURN_DUE_RULES` (`returnDueDays`), `QRMP_3B_CATEGORY_X/Y`, `QRMP_TURNOVER_LIMIT` |
| `src/components/gst-reports/ComplianceView.tsx` | Tab UI: frequency select, calendar table, filed checkbox + filed date, estimates |
| `src/lib/notifications.ts` | `gstReturnsProvider` (in `BUILTIN_PROVIDERS`) |
| `tests/compliance.test.ts`, `tests/notifications.test.ts` | Rules, FY / quarter / year boundaries, QRMP, persistence, provider |

Rules are looked up by the **first day of the tax period** (for GSTR-9, the FY start), so older periods keep the values that applied then.

## Due dates

| Return | Monthly filer | QRMP filer (from Jan 2021) |
| --- | --- | --- |
| GSTR-1 | 11th of next month (10th for periods before 2021) | 13th after the quarter |
| IFF (optional) | — | 13th of next month, months 1-2 of the quarter |
| PMT-06 (payment) | — | 25th of next month, months 1-2 (shown, optional) |
| GSTR-3B | 20th of next month | 22nd (category X states) / 24th (category Y) after the quarter |
| GSTR-9 | 31 Dec after the FY ends | same |

Category X (22nd): state codes 22-37 (Chhattisgarh, MP, Gujarat, Daman & Diu, DNH, Maharashtra, AP (old & new), Karnataka, Goa, Lakshadweep, Kerala, TN, Puducherry, A&N, Telangana). Category Y (24th): 01-21 and 38 (J&K ... Odisha, Ladakh). An unknown state code is treated as X, the earlier day. The filer state comes from the selected GSTIN, else the profile's state code.

QRMP before 1 Jan 2021 falls back to monthly. A warning shows if QRMP is chosen with last-FY turnover above ₹5 crore.

The calendar covers periods from the month of the first issued tax invoice (of the selected GSTIN), at most 12 months back, up to the current month. Status: `overdue` (unfiled, past due), `due-soon` (0-3 days), `upcoming`, `filed`. IFF and PMT-06 are never overdue and never notified.

## Filed marks

`setFiled(rows, ret, gstin, filedOn | null)` stores one mark per form, period and GSTIN; a mark with a blank GSTIN, or a lookup with a blank GSTIN (the "All sender profiles" view), matches any. Ticking the box records today; the date can be edited (it drives the "incurred" estimate when filed late).

## Estimates

- **Late fee (GSTR-1, GSTR-3B)**, CGST + SGST together: ₹50/day, ₹20/day for a nil return. From the June 2021 tax period the cap goes by preceding-FY turnover: ₹2,000 up to ₹1.5 crore, ₹5,000 up to ₹5 crore, ₹10,000 above; nil ₹500 (Notifications 19/2021-CT and 20/2021-CT). Earlier periods are capped at ₹10,000 (Sec 47, ₹5,000 per Act). Days late = days after the due date up to and including the filing day.
- **Interest u/s 50(1)**: 18% p.a. simple, `cash × 18% × days / 365`, on the period's GSTR-3B net cash tax (after ITC set-off, plus cess) from `buildGstReport`. Shown for GSTR-3B only. For QRMP the quarter's cash tax is used: monthly PMT-06 deposits are not modelled. Interest u/s 50(3) on wrongly used ITC is not covered.
- **Nil return**: no reportable documents in the period (and, for 3B, no purchases).
- **GSTR-9 late fee**: from FY 2022-23, ₹50/day (turnover up to ₹5 crore) or ₹100/day (up to ₹20 crore), capped at 0.04% of turnover; ₹200/day capped at 0.5% above that (Notification 7/2023-CT). Earlier FYs: ₹200/day, capped at 0.5%. The turnover entered on the page stands in for the FY's turnover; with none, the fee is shown uncapped. GSTR-9 is optional up to ₹2 crore (noted on the page, not enforced).
- The tab header totals late fee plus interest on overdue returns "if filed today".

## Notifications

`gstReturnsProvider` shows nothing until the active profile has a GSTIN and at least one non-draft, non-cancelled tax invoice exists. After that it raises up to two notices: **N GST returns overdue** (critical) and **N GST returns due within 3 days** (warning), linking to `/gst-reports?tab=compliance`. Each id fingerprints the return ids it covers, so a dismissed notice comes back when the set changes. The context gains the optional `gstFiled` and `gstFrequency` fields (read in `buildContext`).
