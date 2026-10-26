# Round 5 · R5-C — Institutions, non-profits & property

Spec: `docs/prd/round-5.md` §4 R5-C1…C6, §6, §7 Q8–Q12. Everything here is a **working paper**: the GST / income-tax /
FCRA portals and the law are the authority — verify with your CA.

## Pack gate

- Packs (`src/lib/industry-packs.ts`, declared by R5-A1): `fees` (business type `institution`), `nonprofit`
  (`nonprofit`), `leases` (`property`). With none of them on nothing changes for a company: no tab is listed, the bell
  provider returns before it reads anything, no R5-C table is read (`tests/r5c-pack-gate.test.ts`, read trace).
- Tabs (listed with the pack on; the URL always opens them, with a "pack off" line): Recurring → **Fees**, **Leases**
  (`fees` / `leases`); Receivables → **Donations** (`nonprofit`); Books → **Funds** (`nonprofit`); GST → Tools →
  **Common credit (Rule 42 / 43)** (`fees` / `nonprofit` / `leases`, `PACK_GST_TABS` in `gst-tabs.ts`). Settings →
  Profile → **Registrations** block with the `nonprofit` pack on. Ctrl+K: five `PACK_TABS` rows (block `// R5-C`).
- One lazy chunk: every screen and the bell provider sit behind `components/institutions/r5c-screens.ts`, reached only
  through the tiny door `r5c-lazy.ts` (dynamic import from each host), so the chunk's preload list is written once
  and first paint gains only the registry strings.

## C1 Fee plans (`lib/institutions/{fee-plans,enrolments,fee-billing,fee-dues}.ts`)

- Plan: heads `{name, amount, sac?, tax: exempt|nil|taxable, gst_rate?, frequency: once|per_instalment, sessions?}`,
  instalments `{label, due_date, share%}` (sum 100; the last instalment takes the rounding so heads add up exactly),
  optional fine `{flat|per_day, amount, grace_days, cap?}`, preset (education exempt / coaching 18% / clinic exempt —
  fills the tax class, "verify").
- Enrolment = `clients` row with `roll_no`, `class_label`, `guardian`, `enrolments[{plan_id, from, concessions[],
  visits[]}]`; bulk enrol from CSV (name / roll no. / class / guardian / phone, header synonyms).
- Billing run: per student and instalment the batch builder (R2-B1 `buildBatchDrafts`) drafts a **Bill of Supply**
  for exempt / nil heads (`exempt_kind` EXEMPT or NIL → GSTR-1 Table 8) and a **tax invoice** for taxable heads — a
  mixed plan gives two documents, never one mixed document. Concessions: % → share of the head, ₹ → off the head(s);
  the reason is printed on the line. One `issueBatch` call issues all (numbered in each document's FY series; period
  lock, approvals, sender snapshot intact); a `fee_runs` row records it. Idempotent per (student, plan, instalment,
  document kind) via `InvoiceRecord.fee_plan_id` / `fee_instalment`. Undo → `undoBatch` (issued documents cancelled with
  a reason, never deleted).
- Fines are shown in Dues and raised only on "Add fine" (one per document, `late_fee_for`); the fine follows the plan's
  main head's tax class (§7 Q8). Dues: per student / instalment, ageing buckets, `wa.me` reminder, CSV.
- Receipts print a "For Roll no. 12 · Class 6-A" line (additive `forLine` in `receipts.ts`).
- Clinic packages: once-heads with `sessions`; "Visit" records a ₹0 consumption entry, sessions left shown.

## C2 Common credit — Rule 42 / 43 (`lib/institutions/common-credit.ts`)

- Bill tag `itc_use`: `common` (default when untagged), `taxable_only` (T4), `exempt_only` (T2), `non_business` (T1),
  `common_capital` (Rule 43). Blocked / not-claimed bills are T3. Tagged in the tab's list of the month's bills.
- Monthly: C1 = T − (T1 + T2 + T3); C2 = C1 − T4; D1 = (E ÷ F) × C2; D2 = 5% × C2 when any input is non-business;
  C3 = C2 − D1 − D2; Rule 43 Tm = Σ Tc ÷ 60 (60 months from the bill), Te = Tm × E ÷ F. Reversal = T1 + T2 + D1 + D2 +
  Te by head. E / F from the GSTR-1 / 3B engine for the month (`turnoverOf`: nil / exempt / non-GST = E; taxable,
  zero-rated, outward RCM and Sec 9(5) supplies are taxable). All per head (IGST / CGST / SGST / cess).
- "Post" saves one journal (Dr 6370 GST input credit reversed | Cr input ledgers), class "ITC reversal — Rule 42 / 43",
  and a `common_credit_runs` row (every figure); once per month; "Undo" deletes it (period lock, recycle bin).
- GSTR-3B: `gst-reports.ts` gains the additive option `itcReversals` (4B(1)) and `journalItcReversals(vouchers)`, which
  reads the journals of that class (credits less debits on the input ledgers; a true-up reclaim is negative). The GST
  page passes it, so a posted reversal shows in 4(B)(1) of its month — verify with your CA. Other `buildGstReport`
  callers (GSTR-9, compliance, report pack) do not pass it yet.
- Annual true-up on the FY's C2 and turnover vs the monthly D1 + D2 posted; + reverse more / − reclaim (journal flips);
  due with the September return (`COMMON_CREDIT_TRUE_UP_RULES`); CSV working paper with every figure.

## C3 Donations, 80G / 35, Form 10BD / 10BE (`lib/nonprofit/{donations,donation-receipt,form-10bd,nonprofit-alerts}.ts`)

- Registrations on the sender profile (`npo`: PAN, 12A/12AB + validity, 80G URN + date + validity, 35(1) approval,
  FCRA no.), expiry warning at 60 days.
- Donor = client with `donor {id_code, id_no}` (PAN / TAN / Aadhaar checked). Receipt `DON/FY26-27/0001` (series
  counter, Indian FY, a cancelled number stays used): date, donor, amount, mode (cash / electronic / kind / others),
  reference, type (corpus / specific grant / others), fund, section (80G / 35(1)(ii) / (iia) / (iii) / none), purpose,
  anonymous. Warnings (never blocks): cash above ₹2,000 (₹10,000 before FY 2017-18, date-keyed), in kind, no valid
  donor id, anonymous above the Sec 115BBC limit.
- Books: one RECEIPT voucher — Dr cash / bank | Cr "Donations received" (other income) or "Donations — corpus fund"
  (reserves), the credit line tagged with the fund. Gifts in kind post nothing (record the goods by journal).
- Receipt page: the app's receipt (`receipts.ts`, script-free) with PAN, URN + validity, donor id, amount in words and
  "Form 10BE will be issued after Form 10BD is filed". Labels by date through `ita2025`: 80G → "Sec 133(1)(b)(ii) [old
  80G]" from 1 Apr 2026 (appended `// R5-C` entry in `ACT_REF_RULES`, unverified); 10BD / 10BE → Form 113 / 114 for FY
  2026-27 on (`formText`).
- 10BD file: one row per donor × section × type × mode in the template's column order (`FORM_10BD_COLUMNS`, date-keyed);
  unreportable donations (anonymous, no section, no valid id) listed apart. "Mark filed" stores ARN, date and the rows;
  a receipt of a filed FY is never edited — cancel + new (edit log). 10BE: certificate no. per donor, CSV import
  (matched on the donor's id number), "mark all sent", reminder text. Bell: 10BD due from 1 May; 10BE not sent after
  the due date; approval expiry.

## C4 Funds and FCRA (`lib/nonprofit/{funds,fund-statement,fcra-checks,fc4,application}.ts`)

- Fund = cost centre kind `fund` (added identically to R5-B's union line) with `fund {nature: unrestricted |
  restricted | corpus | fcra, donor_id?, purpose?, start?, end?, budget?}` (kept by `projectFields`, one line). "General
  fund" created once when the pack's tab first opens. Inter-fund transfer = one journal on "Inter-fund transfers".
- Fund statement (Books period): opening, receipts (income / own-fund ledgers, interest shown), utilisation by ledger
  (expenses and fixed assets), transfers in / out, closing; negative → warning. CSV / print.
- FCRA: bank account `fcra: designated | utilisation` (normalise line after R5-A's `clearing`). Warnings: FC received
  in cash or into a non-FCRA account; local money into the designated account; money out of an FCRA account that is no
  FCRA-fund expense / asset and no transfer to another FCRA account; administrative expenses (ledgers ticked by the
  user, `settings.npo_admin_accounts`) above the date-keyed cap of FC received (50% → 20% from 29 Sep 2020).
- FC-4 working paper: FCRA bank receipts / payments (the ledger's own lines), I&E of FCRA funds, assets bought from FC,
  fund balances, purpose-wise utilisation, interest on FC; due 31 Dec (date-keyed); "certified by a CA".
- Sec 11 tracker (estimate): income, applied (expenses except depreciation + fixed-asset additions), accumulated
  (`settings.npo_accumulated[fy]`), % against 85% (date-keyed).

## C5 Leases (`lib/property/{properties,leases,escalation,lease-gst,lease-alerts}.ts`)

- Properties with units (`commercial` / `residential_dwelling` / `other`, area). Lease: units, tenant, start / end,
  lock-in, rent, CAM (per month or per sq ft × area), billing day, due days, escalation `{every_months, pct|amount,
  value, first_on?, include_cam?}`, pro rata, 194-I, informational late interest.
- GST class (`LEASE_GST_RULES`): commercial (landlord registered) → tax invoice SAC 997212 18%; dwelling to a
  registered tenant for business → tax invoice under reverse charge (from 18 Jul 2022; tax kept out of the total);
  dwelling otherwise → exempt (Bill of Supply or no document, as picked); landlord unregistered → rent bill without GST,
  with the tenant's RCM under entry 5AB noted from 10 Oct 2024 (not for a composition tenant from 16 Jan 2025).
- Saving a lease writes an ordinary `recurring` schedule (`lease_id`, `escalation` additive); the generator's
  `amountHook` (`recurring.ts`, one additive function) bills rent / CAM escalated from each step date and pro rata
  (stub before the first billing day joins the first bill; the last month is cut at the lease end). Issued documents
  are snapshots: an escalation edit never changes them. `end_date` = lease end; End / Terminate stop the schedule.
- 194-I: `tds_section` 194I-B / 194I-A at the rate of the existing `tds-rules.ts` table on the lease start, so the TDS
  register / 26AS reconciler work unchanged. Labels via `ita2025` (Sec 393(1) [Table: Sl. No. 2(ii)] from 1 Apr 2026).
- Rent roll: unit, tenant, current rent, next escalation (from → to), deposit held, dues; CSV. Bell: escalation in 30
  days, lock-in ending in 30 days, lease ending in 60 / 30 days, Form 16A (194-I) overdue from the TDS register.

## C6 Security deposits (`lib/property/deposits.ts`)

- `received` (liability "Security deposits received", other current liabilities, created by name) or `paid` (asset
  3200). Movements through `saveVoucher` (period lock, roles, audit): receive / pay; adjust against an existing invoice
  (a journal Dr deposits received | Cr debtors whose bill-wise receipt row — stamped `deposit_adjustment_id`, so no cash /
  bank reader counts it — settles the invoice; no new document);
  damages / forfeit (a TAX invoice for the applied amount, tax inclusive, then settled the same way); refund (payment /
  receipt voucher + a refund receipt page). Balance per deposit; deposit held on the rent roll; party-wise schedule CSV.

## Storage (rows for the lead)

| Key / table | Kind | Registries |
|---|---|---|
| `mrchartist_inv_fee_plans` | rows | backup, audit, `master.edit` |
| `mrchartist_inv_fee_runs` | rows, DATED `date` | backup, audit, `doc.create`, sync |
| `mrchartist_inv_common_credit_runs` | rows, DATED `date` | backup, audit, `books.edit`, sync |
| `mrchartist_inv_donations` | rows, DATED `date`, NUMBERED `DON/FY…` | backup, audit, `doc.create`, sync |
| `mrchartist_inv_form_10bd_filings` | rows | backup, audit, `books.edit` |
| `mrchartist_inv_form_10be` | rows | backup, audit, `books.edit` |
| `mrchartist_inv_properties` | rows | backup, audit, `master.edit` |
| `mrchartist_inv_leases` | rows, DATED `start` | backup, audit, `master.edit`, sync |
| `mrchartist_inv_security_deposits` | rows, DATED `date` | backup, audit, `books.edit`, sync |
| `InvoiceRecord.fee_plan_id / fee_instalment` | additive fields | `RECORD_KEYS`, `normalizeRecord` |
| `Client.roll_no / class_label / guardian / enrolments / donor` | additive fields | — |
| `SenderProfile.npo`, `BankAccount.fcra`, `CostCentre.fund` (+ kind `fund`), `PurchaseRecord.itc_use`, `RecurringSchedule.lease_id / escalation`, settings `npo_admin_accounts / npo_accumulated` | additive fields | `bank-accounts.ts` / `cost-centres.ts` normalise lines |

New series `DON` (`series_counters`). Helper ledgers by name: "Donations received", "Donations — corpus fund",
"Security deposits received", "Inter-fund transfers". Open-export schema rows for the nine tables. Statutory values
in `src/lib/r5c-rules.ts` (date-keyed, every source "verify"): `COMMON_CREDIT_TRUE_UP_RULES`, `LEASE_GST_RULES`,
`DONATION_CASH_LIMIT_RULES`, `ANON_DONATION_RULES`, `FORM_10BD_DUE_RULES`, `FORM_10BD_COLUMNS`, `NPO_APPLICATION_RULES`,
`FCRA_ADMIN_CAP_RULES`, `FC4_DUE_RULES`.

Lead rows for ROADMAP / ARCHITECTURE / AGENTS: the nine tables and fields above; "a receipt row with
`deposit_adjustment_id` (R5-C6) moved no money: every cash / bank reader skips it, like `gift_voucher_id`"; "Rule 42 / 43
reversals are journals of class `ITC reversal — Rule 42 / 43`; `buildGstReport` takes them through `itcReversals`".

## Bundle (vite build, gzip -9; baseline = `claude/elegant-cannon-cwapiv` at 569d492)

| | before | after | delta |
|---|---|---|---|
| Initial JS | 187,028 B (182.6 kB) | 187,216 B (182.8 kB) | **+188 B** (budget +0.2 kB): `RECORD_KEYS` + `normalizeRecord` line, the `audit-edits` / `access` registry rows |
| Total JS | 2,405,073 B | 2,446,584 B | **+40.5 kB** (package budget 28 kB — **over by ~12.5 kB, needs the lead**) |

Where it goes (gzip, per chunk): the one R5-C chunk `r5c-screens` 36.6 kB (all six features, their libs and the en + hi
area ≈ 7.5 kB); the lazy door `r5c-lazy` 1.6 kB (the chunk's preload list, written once instead of into six hosts);
`recurring` +0.6 kB (the escalation / pro-rata hook every recurring user loads); `tds-register` and `batch-invoices`
now shared chunks (+0.5 kB each net); host pages, palette, bell gate, open-export schema +1.6 kB.
What was done to get here (from +60 kB on the first build): one chunk instead of seventeen (shared strings compress
once, −7 kB), the lazy door (−3 kB of preload lists), compact form / table helpers, a shorter area (−4 kB), the
donation and refund receipts reuse `receipts.ts`, no `import-mapping` / `Settings.module` splits. The PRD's own
per-item estimates for R5-C add up to ~34 kB (fees 8, common credit 5, donations 8, funds 6, leases + deposits 7);
getting under 28 kB means dropping a feature or the Hindi strings (~3.5 kB) — a call for the lead.

## Deviations from the spec

1. **Pack ids.** The brief names the packs `institution`, `nonprofit`, `property`; R5-A1 declared the pack ids `fees`,
   `nonprofit`, `leases` (implied by the business types `institution`, `nonprofit`, `property`). The gates use those ids.
2. **Statutory values** live in a new `src/lib/r5c-rules.ts` (date-keyed `Versioned`, every source "verify"), not as
   appends to `tax-rules.ts` / `tds-rules.ts`: `tax-rules.ts` is in the first-paint bundle (the same exception AGENTS.md
   makes for `gst-penalties.ts` / `payroll-rules.ts`), and one file keeps the merge with R5-B's appends trivial.
3. **GSTR-3B 4(B)(1).** The PRD assumed "the existing reversal reader" would pick up the journal; it reads reversals on
   purchase bills only (and `vouchers` drop unknown fields). Added instead: the additive `itcReversals` option in
   `gst-reports.ts` fed by `journalItcReversals` (journals of class "ITC reversal — Rule 42 / 43"), passed by the GST page.
4. **`admin_expense` flag** on accounts → the list of administrative ledgers is `settings.npo_admin_accounts` (no edit
   to `accounts.ts`, which drops unknown fields). Accumulated amounts (Form 10) → `settings.npo_accumulated`.
5. **Files.** `fc4.ts`, `application.ts`, `RentRoll.tsx`, `FundStatement.tsx`, `Fc4Panel.tsx` exist as specified; the
   shared helpers are `lib/institutions/r5c.ts` (tables, packs, accounts by name, header matcher) and
   `components/institutions/{Views.tsx,ui.ts,r5c-screens.ts,r5c-lazy.ts}`; one CSS module
   (`institutions.module.css`) serves the three folders. The doc is `institutions-property-r5.md` (as asked).
6. **10BD after filing.** "Never edited after filing; corrections go through cancel + new": edits are refused, cancel
   stays possible (edit log), and a new receipt in a filed FY is allowed.
7. **Bulk enrol / 10BE CSV** match headers with a small synonym matcher (`findCol`) instead of `scoreHeader` (keeps
   `import-mapping` out of the chunk).
8. **10BE bell** fires from the 10BE due date (31 May, `FORM_10BD_DUE_RULES.beBy`) instead of a fixed 30 June.
9. **Cost-centre kind** `fund` added on its own (R5-B's line will also add `vehicle`); the `fields` / `books-planning`
   areas and `ProjectsTab` got the `fund` label so the existing kind pickers typecheck.

## Verify with your CA

1. Education / health: entry 66 / entry 74 presets; coaching 18%; two documents for a mixed fee (vs an invoice-cum-bill
   of supply); whether a late fine on an exempt fee is exempt (built: the fine follows the plan's main head).
2. Rule 42 / 43: the formulas (D1 = E/F × C2, D2 = 5% × C2, Tc ÷ 60), exports / zero-rated and outward RCM counted as
   taxable turnover, non-GST supplies counted as exempt, T1 / T2 claimed on bills reversed in full; true-up by the
   September return, interest u/s 50.
3. Donations: cash limit ₹2,000 (₹10,000 before FY 2017-18); in-kind not deductible; Sec 115BBC limit (higher of 5% of
   total donations or ₹1 lakh); 10BD columns / code words / aggregation per donor × section × type × mode; due 31 May,
   late fee Sec 234G ₹200 / day; 10BE by 31 May.
4. ITA 2025 references (unverified): 80G approval → Sec 133(1)(b)(ii); donee statement → Sec 354(1) (Form 113, 10BE →
   Form 114 from FY 2026-27); 194-I → Sec 393(1) Table Sl. No. 2(ii); no 2025-Act label for 35(1), 11, 12AB, 115BBC yet.
5. FCRA: 20% administrative cap from 29 Sep 2020 (50% before) and what counts as "administrative"; the 2020 ban on
   transfers to other persons; FC-4 due 31 Dec; interest on FC treated as FC.
6. Sec 11: 85% application; accumulation (Form 10); corpus donations and capital expenditure in the tracker.
7. Rent: commercial 18%; dwelling to a registered person for business under RCM from 18 Jul 2022; entry 5AB from
   10 Oct 2024 and the composition-tenant exclusion from 16 Jan 2025; 194-I rates / threshold from `tds-rules.ts`;
   194-IB not offered.
8. Security deposits: not consideration until applied (proviso to Sec 2(31)); GST on the applied / forfeited part
   (built: 18% tax-inclusive tax invoice).

## Known limits

- A deposit adjustment settles the invoice through a voucher-tagged receipt row stamped `deposit_adjustment_id`; the
  cash book / cash tally / forecast (`books.ts` `buildVouchers`), BRS receipt candidates, the day summary (`today.ts`),
  payment modes (`sales-reports.ts`) and export realisation skip it; the ledger posts the journal once.
- GSTR-9 / compliance / report pack do not pass `itcReversals` yet (the GSTR-3B tab does).
- Gifts in kind create no voucher; FC-4 lists totals, not the portal's line items.
