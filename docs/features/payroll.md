# Payroll (Phase 7 — Tally parity)

Monthly payroll modelled on TallyPrime Payroll: employee masters, pay heads with Tally's calculation types, salary
structures with effective dates, attendance / production, a monthly "auto fill" run with a review grid, a Payroll
voucher posted to the double-entry ledger, salary and statutory payments, payslips and statutory working papers.
Everything is a **working paper — verify with your CA**.

| | |
|---|---|
| Route | `/payroll` (lazy, nav under Accounts, owner only; Gateway: Create / Alter → Employee, Vouchers → Payroll voucher, Statutory reports → Payroll via `GATEWAY_EXTENSIONS`) — tabs `?tab=employees · heads · structures · attendance · run · payments · reports`, month in `?month=YYYY-MM` |
| UI | `src/pages/Payroll.tsx`, `src/components/payroll/*` (CSS module `Payroll.module.css`) |
| Lib | `src/lib/payroll/` — `statutory.ts` (PF / ESI / PT / income-tax engines), `compute.ts` (payslip computation, default pay heads), `store.ts` (tables, CRUD, runs, payments), `records.ts` (run / payment readers used by the ledger), `postings.ts` (ledger vouchers), `reports.ts` (payslip HTML, registers, ECR, 24Q, Form 16) |
| Statutory values | `src/lib/payroll-rules.ts` — same `Versioned` shape / `ruleAt` as `tax-rules.ts`, kept in its own file so the first-paint bundle (where `tax-rules.ts` lives) does not grow |
| Strings | `src/i18n/areas/payroll.ts` (English + Hindi, `defineArea`) |
| Tests | `tests/payroll.test.ts`; e2e step "payroll: add an employee with a salary structure, run the month, see the payslip net pay" |

## Tables (all additive, in backups — `RECORD_TABLES` / `ID_TABLES` in `backup.ts`)
| table | shape (`src/types/payroll.ts`) |
|---|---|
| `employees` | `Employee`: code, name, designation, `cost_centre_id` (department), `group_id`, DOJ / DOL, gender, PAN, UAN, ESI IP no., salary bank / account / IFSC, `state` (GST state code, decides PT), `tax_regime` new / old, flags `pf`, `pf_on_actual`, `eps_excluded`, `esi`, `pt`, `active`, annual declarations (`tax_deductions`, `hra_exemption`, `other_income`, `prev_salary`, `prev_tds`) |
| `employee_groups` | `{id, name}` |
| `pay_heads` | `PayHead`: kind earning / deduction / employer, calc `flat · attendance · percent · production · computed · user`, `statutory` pf / esi / pt / tds / pf_er / esi_er / pf_admin, base heads, %, slabs, production type, `pf_wage` / `esi_wage` / `taxable`, ledger `account_id`, order. While empty, the starter set (`DEFAULT_PAY_HEADS`, stable ids `ph_*`) is used; the first save stores it |
| `salary_structures` | per employee **or** group, `effective_from`, lines `{pay_head_id, amount}` — the latest structure in force on the month's last day; an employee's own structure beats the group's |
| `attendance_types` | user production types `{id, name, unit}`; overtime hours (`ot_hours`) is built in |
| `attendance` | `{employee_id, month, lop, units}` — present days = days on the rolls − LOP |
| `payroll_runs` | `PayrollRun`: month, `PRL/FY25-26/0001` number (on finalize), voucher date (default month end), status draft / final, `lines: PayslipLine[]` (full snapshot: amounts, PF / ESI / PT / TDS figures, employer contributions, grid overrides), employer snapshot (`company`) |
| `payroll_payments` | `PayrollPayment`: kind salary / pf / esi / pt / tds, `PYP/FY…` number, date, amount, `paid_from` (cash / bank ledger account), run, challan period, reference |
| key `payroll_settings` | object: PF establishment code, ESI employer code, TAN (printed on payslips) |

All tables are in `TABLE_ACTIONS` (`access.ts`) under `payroll.view`; companies, vault and folder sync handle them
like any other key.

## Computation (Auto fill)
1. Days on the rolls from DOJ / DOL; paid days = that − LOP.
2. Non-statutory heads in the structure, in dependency order (percent / computed heads after their base heads; loops
   are refused): *flat* = amount; *attendance* = amount × paid days / calendar days; *production* = rate × units;
   *percent* = % of the sum of base heads; *computed* = slab on the base; *user* = structure amount, typed per month.
3. **PF** on `pf_wage` earnings: employee 12% on wages up to ₹15,000 (or actual wages with `pf_on_actual`); employer
   12% split EPS 8.33% (on wages up to the ceiling; nil for `eps_excluded`) and EPF = 12% − EPS; EDLI 0.5% and admin
   0.5% (minimum ₹500 per establishment per month, the shortfall is added to the first member). Each rounded to the rupee.
4. **ESI** on `esi_wage` earnings when the monthly *rate* of wages (full month, overtime excluded) is ≤ ₹21,000;
   coverage continues to the end of the contribution period (Apr–Sep / Oct–Mar) once it applied. 0.75% / 3.25%
   rounded up to the next rupee.
5. **Professional tax** by state slab on gross (Maharashtra, Karnataka, West Bengal, Tamil Nadu, Gujarat, Andhra
   Pradesh, Telangana), February ₹300 in Maharashtra (and Karnataka from FY 2025-26), Maharashtra women's slab, Tamil
   Nadu half-yearly (on gross × 6, deducted in April and October); never more than ₹2,500 in the FY.
6. **TDS u/s 192** — annual projection: previous employer salary + this FY's final payslips + this month + the full-month
   taxable salary × remaining months; standard deduction (₹75,000 new / ₹50,000 old), PT and declared exemptions /
   Chapter VI-A deductions only in the old regime; slab tax, 87A rebate (new regime ₹12 lakh / ₹60,000 with marginal
   relief from FY 2025-26), surcharge with marginal relief, 4% cess, rounded to ₹10; minus TDS already deducted,
   spread evenly over the remaining months (the last month takes the balance).
7. Net = gross − deductions. Warnings: negative net, missing UAN / ESI number / PAN, state without PT slabs.

The review grid lets you type over any earning or deduction (Enter moves down the column, like Tally). A typed amount
is kept as an override for that pay head and the rest is recomputed (e.g. PF follows a changed Basic); clearing the
cell returns to the computed value. Auto fill again keeps the overrides.

## Ledger postings (derived, never stored — see `docs/features/ledger.md`)
| Voucher | Debit | Credit |
|---|---|---|
| Payroll (final run, dated the voucher date) | each earning's account — 6000 Salaries & wages, 6010 Allowances & overtime, 6020 Bonus (per employee cost centre); 6030 Employer's contribution to PF, 6040 … to ESI, 6050 PF admin & EDLI charges | 2420 Salary payable (net), 2340 PF payable (employee + employer + EDLI / admin), 2341 ESI payable, 2342 Professional tax payable, 2337 TDS payable — salaries (192), other deductions to their own account (loan recovery → 3610 Loans & advances to employees, other → 2400) |
| Payroll payment | the payable (salary / PF / ESI / PT / TDS) | the chosen cash / bank account |

Numbers `PRL` / `PYP` use the shared series high-water mark (`series-counters.ts`), so a deleted latest number is never reused. Reopening a final run removes its voucher until it is finalized again; it is refused while a salary payment points at
the run. Payroll is not part of the Books cash book / `books.profitAndLoss` (like manual vouchers, it exists only in the
ledger statements: trial balance, P&L, balance sheet, cash flow).

## Period lock, audit, roles
- Finalize, reopen and payments call `assertUnlocked` on the voucher / payment date (PIN override as elsewhere).
  Masters, attendance and drafts are not dated documents and are not locked; attendance for a finalized month is.
- Every write is audited: entity `employee` (masters) and `payroll` (attendance, runs, payments).
- **Decision: a new access action `payroll.view`, owner only.** Salaries are confidential, so clerks and viewers do not
  see the Payroll screen or nav entry and the payroll tables refuse their writes (`TABLE_ACTIONS`). Writes need both
  `books.edit` and `payroll.view`. The month's Payroll voucher (totals by account) is still visible in the ledger to
  anyone who can open Books; with one employee that reveals the salary. A per-user grant for a trusted clerk is a
  possible follow-up.

## Outputs (Reports tab; CSV / Excel through `toCsv` / `downloadXlsx`)
- **Payslip**: script-free printable HTML (`payslipHtml`, opened with `openPrintable`; every value escaped) with the
  employer snapshot, PF / ESI codes, TAN, masked bank account, amount in words. Also shown in a dialog from the grid.
- Pay sheet (salary register), salary bank advice, attendance register.
- **PF ECR working**: EPFO ECR 2.0 text (11 `#~#` fields: UAN, name, gross, EPF / EPS / EDLI wages, EE, EPS, ER
  difference, NCP days, refunds) and a working sheet with the A/c 1 / 10 / 21 / 2 split. *Layout not validated against
  the portal.*
- ESI monthly contribution working (IP no., days, wages, reason code, contributions). *Not validated against the portal.*
- Professional tax register (month / FY, by state).
- Form 24Q Annexure I (quarter, section 92B) and Annexure II (annual, regime, exemptions, 87A, cess, shortfall).
- Form 16 Part B working (per employee).

## Statutory values to verify with your CA
EPF 12% / 12% (EPS 8.33%), ₹15,000 ceiling from 1 Sep 2014, EDLI 0.5%, admin 0.5% with ₹500 minimum from 1 Jun 2018
(older admin rates approximate) · ESI 0.75% / 3.25% from 1 Jul 2019 (1.75% / 4.75% before), ₹21,000 ceiling from
1 Jan 2017 · PT: Maharashtra (₹175 / ₹200, Feb ₹300; women exempt up to ₹25,000 from Jul 2023), Karnataka (₹200 from
₹25,000 from Apr 2023; Feb ₹300 from Apr 2025), West Bengal (₹110–₹200), Tamil Nadu half-yearly (revised Oct 2024),
Gujarat (₹200 from ₹12,000; effective date approximate), Andhra Pradesh / Telangana (₹150 / ₹200) · income tax FY
2023-24, 2024-25 and 2025-26 slabs (later years reuse FY 2025-26 until a new version is added).

## Known gaps
- No arrears / back-dated revision calculation, gratuity / leave encashment / bonus Act computation, full & final
  settlement, loan schedules (recovery is a user-defined deduction), reimbursements, or perquisite valuation.
- Senior-citizen old-regime slabs, s. 206AA higher TDS without PAN (only a warning), 80CCD(2) employer NPS, relief u/s 89.
- ESI: no exemption of the employee share for low daily wages; coverage decided on the month's rate of wages, not on
  the period's first month when an employee joins mid-period.
- PF: no EPS stop at 58 by date of birth (use "Not in EPS"), no international workers, no voluntary PF.
- PT for other states must be typed in the grid; PT registration / challans are not produced.
- Statutory late-payment interest / damages (PF 7Q / 14B, TDS 201(1A)) are not computed.
- Payroll entries are not in the Books cash book or Tally XML export yet.
