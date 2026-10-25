# Payroll (Phase 7 — Tally parity)

Monthly payroll modelled on TallyPrime Payroll: employee masters, pay heads with Tally's calculation types, salary
structures with effective dates, attendance / production, a monthly "auto fill" run with a review grid, a Payroll
voucher posted to the double-entry ledger, salary and statutory payments, payslips and statutory working papers.
Everything is a **working paper — verify with your CA**.

| | |
|---|---|
| Route | `/payroll` (lazy, nav under Accounts, owner only; Gateway: Create / Alter → Employee, Vouchers → Payroll voucher, Statutory reports → Payroll via `GATEWAY_EXTENSIONS`) — tabs `?tab=employees · heads · structures · attendance · leave · run · arrears · extras · loans · payments · fnf · reports · more`, month in `?month=YYYY-MM` (the five 7P tabs and the 7T `more` tab are `React.lazy`) |
| UI | `src/pages/Payroll.tsx`, `src/components/payroll/*` (CSS module `Payroll.module.css`) |
| Lib | `src/lib/payroll/` — `statutory.ts` (PF / ESI / PT / income-tax engines), `compute.ts` (payslip computation, default pay heads), `store.ts` (tables, CRUD, runs, payments), `records.ts` (run / payment readers used by the ledger), `postings.ts` (ledger vouchers), `reports.ts` (payslip HTML, registers, ECR, 24Q, Form 16); 7P: `depth.ts` (pure engines: arrears, loans, leave, gratuity, bonus, F&F, reimbursements, perquisites, PF 7Q / 14B), `depth-records.ts` (readers), `depth-store.ts` (writes, provision journals), `depth-reports.ts` (F&F statement, registers), `books-link.ts` (Books cash book / P&L), `tds-link.ts` (/tds challan list); 7T: `followups.ts` (pure: arrear ECR, relief u/s 89, Rule 3 valuation, 17(2)(vii), 201(1A), actuarial journal), `followups-records.ts` / `followups-store.ts`, `grants.ts` (per-user payroll access); `src/lib/tally-payroll.ts` (Tally export fragment) |
| Statutory values | `src/lib/payroll-rules.ts` — same `Versioned` shape / `ruleAt` as `tax-rules.ts`, kept in its own file so the first-paint bundle (where `tax-rules.ts` lives) does not grow |
| Strings | `src/i18n/areas/payroll.ts` (English + Hindi, `defineArea`); 7T tab: `src/i18n/areas/payroll-more.ts` |
| Tests | `tests/payroll.test.ts`, `tests/payroll-depth.test.ts` (7P: arrears case, F&F case, loans, leave, gratuity, bonus, EPS at 58, ESI period, senior slabs, 206AA, 80CCD(2), Books / Tally / TDS links, backup, roles), `tests/payroll-followups.test.ts` (7T: Form 10E case, 17(2)(vii) case, arrear ECR, Rule 3, ESI low wage, PT option, 201(1A), actuarial journal, payroll grant, tables); e2e step "payroll: add an employee with a salary structure, run the month, see the payslip net pay" |

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
| `payroll_arrears` (7P) | `ArrearsRecord`: employee, `from_month`, `pay_month`, `months[]` (per month: earnings difference per pay head, gross / taxable, PF wages / EE / EPS / EPF / EDLI / admin, ESI wages / EE / ER) |
| `employee_loans` (7P) | `EmployeeLoan`: `LOAN/FY…` number, employee, loan / advance, date, amount, interest % p.a. (0 = interest-free), EMI, `start_month`, `paid_from`, purpose (medical = no perquisite), optional `sbi_rate`, `payment_id` (the disbursement) |
| `leave_types` (7P) | `LeaveType`: code, name, paid, accrual (days / month), encashable, `carry_cap` |
| `leave_entries` (7P) | `LeaveEntry`: employee, type, kind opening / taken / encash / adjust, date, days, `month` (encashment pay month), optional amount |
| `payroll_adjustments` (7P) | `PayrollAdjustment`: one-off earning / deduction for a payroll month — tag `reimb` (with `head`; exempt by head + regime unless `taxable_amount` is typed), `bonus`, `adjust` |
| `perquisites` (7P) | `Perquisite`: employee, accommodation / car / other, `from_month` – `to_month`, taxable value per month |
| `payroll_relief89` (7T) | `Relief89Record`: employee, FY of receipt, regime, total income incl. arrears, earlier `years[]` (FY, regime, income, arrears), relief (snapshot, recomputed on display), `apply_tds` |
| `actuarial_valuations` (7T) | `ActuarialValuation`: `ACT/FY…` number, kind gratuity / leave, standard AS-15 / Ind AS 19, valuation date, actuary, report ref, discount / escalation %, opening, current service cost, interest cost, past service cost, benefits paid, actuarial loss (gain negative), closing, plan assets, book balance, posted `voucher_id` / `voucher_number` |
| `fnf_settlements` (7P) | `FnfSettlement`: `FNF/FY…` number, employee, reason, `pay_month`, notice (none / recover / pay, days, optional amount), leave days / amount, gratuity override, `recover_loans`, other items |

Additive fields (7P): `Employee.dob`, `Employee.notice_days`; `PayHead.nps` (employer NPS, 80CCD(2));
`PayslipAmount.tag / ref_id / taxable / interest`; `PayslipLine.arrears / perquisites / nps_er / fnf_id / age_band / notes`;
`PayrollPayment.bsr_code / challan_no / loan_id` and payment kind `loan`.

Additive fields (7T): `PayHead.superannuation` (employer heads); `ArrearsMonth.eps_wages / edli_wages`; `Perquisite.basis` and
kinds `meals` / `gift`; `PayslipLine.super_er / esi_low_wage`; `tds_working.relief89 / er_contrib_year / s17_vii`; key
`payroll_settings.pt_extra_states`; device-local user record `grants` (`mrchartist_inv_auth_users`, never backed up).
`actuarial_valuations` is in the sync engine's DATED / NUMBERED maps.

All tables (the 7P and 7T ones too) are in `TABLE_ACTIONS` (`access.ts`) under `payroll.view` and in both backup lists
(`RECORD_TABLES` / `ID_TABLES` in `backup.ts`); companies, vault and folder sync handle them like any other key.

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

### 7P additions to the computation
- **EPS stops at 58** from the date of birth: no EPS share after the month the employee attains 58 (the day before the
  58th birthday); the whole employer share goes to EPF and the payslip says so. "Not in EPS" still works as before.
- **ESI by contribution period**: coverage is decided in the period's first month (or the month of joining) — from that
  month's final payslip, else from the structure then in force — and holds for the whole period (Apr–Sep / Oct–Mar),
  both ways: covered stays covered, not covered stays out until the next period.
- **TDS**: old-regime **senior (60+) / super-senior (80+) slabs** from the date of birth (`TDS_OLD_REGIME_AGE_RULES`);
  **s. 206AA** — without a PAN the year's tax is at least 20% of income (no cess on top) when income is taxable;
  **80CCD(2)** — an employer pay head marked "employer's NPS" is added to taxable salary and deducted up to 14% (new
  regime from FY 2024-25) / 10% of Basic + DA; perquisites (typed + the loan perquisite) and the taxable part of
  one-off items are in `taxable_gross`; a full & final payslip takes the whole balance of the year's tax.
- **One-off items** (`extras`) join the payslip with their own pay-head ids (so the review grid can override them):
  arrears `arr:<head>` + `arr:pf` / `arr:esi` / employer `arr:pf_er` / `arr:pf_admin` / `arr:esi_er`; loan EMIs
  `loan:<id>`; leave encashment `leave:<entry>`; adjustments `adj:<id>`; settlement `fnf:notice` / `fnf:leave` /
  `fnf:gratuity` / `fnf:o<n>`. They are not PF / ESI wages, and PT stays on the regular gross.

## 7T — payroll follow-ups (tab "Form 10E · Rule 3 · actuarial", Reports)
- **EPFO arrear ECR** (Reports → monthly): for the arrears paid with the month, one line per UAN — arrear EPF / EPS / EDLI
  wages, EE share, EPS share, ER (EPF − EPS) share — as `#~#` text (8 fields) and a working sheet. Arrears saved from 7T on
  keep their EPS / EDLI wage differences; older records derive them from the EPS / EDLI amounts. *Layout not validated
  against the portal.*
- **Relief u/s 89(1) — Form 10E** (Rule 21A, Annexure I Table A): year of receipt — tax on total income with and without the
  arrears; each earlier year the arrears relate to — tax on that year's total income with and without its share (that
  year's slabs, rebate, surcharge, cess: `tdsSalaryRuleAnyYear`, earlier table FY 2017-18 to 2022-23 in
  `TDS_SALARY_EARLIER_RULES`); relief = the first difference − the sum of the others, nil if negative. "Fill from payroll"
  suggests the earlier-FY arrears (taxable part, by year) and each year's income from its last payslip projection; the
  incomes must be checked against the employee's returns. A working marked **allow in TDS** (s. 192(2A), Form 10E furnished)
  reduces the year's tax in the TDS projection from the next auto fill (`tds_working.relief89`, payslip note). Export:
  Form 10E sheet. The employee must still file Form 10E online.
- **Rule 3 perquisite valuation** (calculator → saved as a perquisite with its `basis`): motor car (Rule 3(2) Table II) —
  official only nil, private only actual cost − recovery, mixed by cc (≤ 1,600) and who meets running costs + chauffeur
  (recoveries not deducted); accommodation (Rule 3(1)) — employer-owned % of salary by city population (10 / 7.5 / 5% on the
  2011 census from 1 Sep 2023; 15 / 10 / 7.5% on 2001 before), leased the lower of rent and 15% of salary, + furniture 10% a
  year of cost (or hire), − rent recovered; free meals — cost above ₹50 a meal; gifts — nil below ₹5,000 for the year, the
  whole year's gifts once it is reached. Interest-free loans stay on the Loans tab (7P).
- **s. 17(2)(vii)**: employer PF (EPF + EPS), NPS (80CCD(2) heads) and superannuation (employer heads marked
  "superannuation") for the year — actual FINAL months + this month + the full-month rate for the rest — above ₹7.5 lakh is
  added to the year's taxable salary in the TDS projection (`tds_working.s17_vii`, payslip note; never in the month's
  `taxable_gross`, so it is not counted twice). Reports → annual working per employee. 17(2)(viia) accretion is noted only.
- **ESI low daily wage**: when ESI wages ÷ paid days is within the notified limit (₹176 from 2019, date-keyed), no employee
  share is deducted; the employer share is still paid (`esi_low_wage`, payslip note).
- **Interest u/s 201(1A) on salary TDS** (Reports → annual): per final month, TDS deducted on the payroll voucher date vs
  TDS-on-salary payments with that challan period; each late part bears 1.5% a month or part (calendar months, from the
  deduction date) when paid after the due date (7th of the next month, 30 April for March), on tax rounded down to ₹100
  (Rule 119A); unpaid parts run to today. Late deduction (1%) is a pure helper only (`tds201Interest`, `deductibleOn`).
- **PT on arrears / one-off items** (option per state): for the states ticked, arrears and one-off salary items (tags
  arrear, bonus, leave, adjust) join the month's gross for the PT slab; reimbursements, gratuity and notice pay never do;
  the ₹2,500 cap still applies. Off by default (unchanged behaviour).
- **Per-user payroll access**: the owner ticks a named clerk / viewer; `payroll.view` is stored on that device-local user
  (`grants`), honoured by `can` / `requireAccess` / `useCan` through `actorCan` (only `GRANTABLE_ACTIONS` count, so a grant can
  never lift any other permission), audited ("Payroll access granted to …"), and every open tab re-checks at once (the shell
  remounts on a grant change). A clerk with the grant can run payroll (has `books.edit`); a viewer only looks.
- **Actuarial valuation entry** (`ACT/FY…`, series counters, period lock on its date): the actuary's figures under AS-15 or
  Ind AS 19 — opening obligation, current service cost, interest cost, past service cost, benefits paid, actuarial loss
  (gain negative), closing obligation, plan assets, and the provision already in the books (defaults to the last valuation's
  net liability, else the opening). The roll-forward must agree within ₹1 before posting. The journal moves the provision to
  closing − plan assets: Dr Gratuity 6006 / Leave encashment 6007 (P&L part) [Dr / Cr Reserves 1100 — Ind AS 19 gratuity
  remeasurement in OCI; leave remeasurement stays in P&L] | Cr Provisions 2500 (reversed for a release), through
  `saveVoucher` (voucher class "Payroll provision"). Benefits paid during the year were already expensed through payroll,
  which is why only the movement is posted. A posted valuation cannot change or be deleted until its journal is deleted in
  Books. **The valuation itself (projected unit credit method, assumptions) must come from a qualified actuary — the app
  does not compute it.**

## Arrears (back-dated revisions)
Save the revised structure with its effective date, then Arrears → employee, "effective from" and the pay month →
Compute → Save. Every FINAL month in between is recomputed with today's structures (same attendance, grid overrides and
history); the difference per pay head is the arrear. PF follows the recomputed month (its ceiling / EPS rules); ESI is
worked on the arrear ESI wages at that month's rate only if the employee was covered then (arrears never change
coverage). The arrears are paid with the pay month's run, **shown in their own table on the payslip**, and taxed in the
year paid; arrears of an earlier FY add the **relief u/s 89 (Form 10E)** note (computed on the 7T tab). The PF on arrears is
in the PF payable; the EPFO arrear ECR is in Reports (7T). Arrears cannot change once the pay month is final.

## Loans & advances
`LOAN/FY…` (series counters), paid out through a payroll payment of kind `loan` (Dr 3615 Loans & advances to employees
| Cr cash / bank — the same ledger path as every payroll payment). Each run from `start_month` deducts the EMI: interest
on the outstanding (reducing balance, rate ÷ 12) first — credited to 4920 Interest received — then principal to 3615.
Recoveries are read back from FINAL runs, so a skipped or typed-over EMI simply moves the schedule; the schedule shows
recovered months, then the projection. **Perquisite** (Rule 3(7)(i)): when the employee's loans exceed ₹20,000,
(SBI rate − rate charged) on the outstanding at the start of the month is a taxable perquisite (medical-treatment loans
excluded); the SBI rate is a placeholder in `payroll-rules.ts` unless typed on the loan. A loan with recoveries cannot be
deleted, and its disbursement payment cannot be deleted on its own.

## Leave
Types with monthly accrual (for every month on the rolls, from the month after the latest opening balance, else from
joining), a carry-forward cap applied each 1 April, and entries for opening / taken / encashment / adjustment.
**Unpaid leave taken adds to the run's loss of pay.** Encashment during service is paid with its month at
(Basic + DA) ÷ 30 a day (or the typed amount), fully taxable, Dr 6007 Leave encashment.

## Gratuity, bonus, provisions
- **Gratuity** (Payment of Gratuity Act): 15/26 × last drawn Basic + DA × completed years (part above six months
  counts), five years' service (not needed on death / disablement; 4 years 240 days is flagged "borderline"), ceiling by
  date (₹10 lakh from 24 May 2010, ₹20 lakh from 29 Mar 2018); exempt u/s 10(10)(ii) up to the formula / ceiling.
  F&F tab → **Gratuity provision working** as at a date (accrued for everyone on the rolls, not actuarial) and
  "Post provision journal" (Dr 6006 Gratuity | Cr 2500 Provisions — the increase you type, through `saveVoucher`).
- **Bonus** (Payment of Bonus Act): months whose Basic + DA rate is within ₹21,000, bonus wages capped at ₹7,000 a month
  (or the typed minimum wage), 8.33%–20%, at least 30 working days, minimum 8.33% / ₹100 (`BONUS_RULES`; ₹10,000 /
  ₹3,500 before FY 2014-15). "Pay with payroll of <month>" adds bonus items (Dr 6002); "Post bonus provision".

## Reimbursements & perquisites
One-off items per payroll month: reimbursement heads (`REIMBURSEMENT_HEADS`: conveyance / travel / telephone exempt in
both regimes, LTA in the old regime only, medical and other taxable — bills needed; a typed taxable part wins), bonus,
other earning / deduction. Perquisites: a typed taxable value per month for a span of months (accommodation, car,
other) — added to taxable salary, never paid, printed on the payslip.

## Full & final settlement
Give the employee a date of leaving, then F&F → New settlement: reason, pay month (the DOL month or later), notice pay
(recover short notice → Cr 4910 Other income, or pay in lieu → Dr 6000), leave days to encash (defaults to the
encashable balance at the DOL; exempt u/s 10(10AA) up to the least of the amount, the cap — ₹25 lakh from FY 2023-24 —
and 10 months' Basic + DA), gratuity (computed unless typed; Dr 6006), recovery of all outstanding loans (balance +
the month's interest, replacing that month's EMI) and other items. The settlement is paid **with the payroll run of its
month**: a leaver is on that run even after the DOL month (with no salary days), the final TDS takes the year's
balance, and the run's Payroll voucher posts everything. The **F&F statement** (printable, script-free) shows the
payslip of that run plus the working (service, last drawn, gratuity formula and exemption, leave, notice, loans, TDS).
It cannot change once that month is final.

The review grid lets you type over any earning or deduction (Enter moves down the column, like Tally). A typed amount
is kept as an override for that pay head and the rest is recomputed (e.g. PF follows a changed Basic); clearing the
cell returns to the computed value. Auto fill again keeps the overrides.

## Ledger postings (derived, never stored — see `docs/features/ledger.md`)
| Voucher | Debit | Credit |
|---|---|---|
| Payroll (final run, dated the voucher date) | each earning's account — 6000 Salaries & wages, 6001 Allowances & overtime, 6002 Bonus (per employee cost centre); 6003 Employer's contribution to PF, 6004 … to ESI, 6005 PF admin & EDLI charges | 2425 Salary payable (net), 2343 PF payable (employee + employer + EDLI / admin), 2344 ESI payable, 2345 Professional tax payable, 2337 TDS payable — salaries (192), other deductions to their own account (loan recovery → 3615 Loans & advances to employees, other → 2400) |
| Payroll payment | the payable (salary / PF / ESI / PT / TDS) — 3615 Loans & advances to employees for kind `loan` (7P) | the chosen cash / bank account |
| 7P items in the Payroll voucher | arrears to their heads' accounts, 6006 Gratuity, 6007 Leave encashment, reimbursements (6001 by default), 6002 Bonus | loan EMIs: principal 3615, interest 4920 Interest received; notice pay recovered 4910 Other income |

Numbers `PRL` / `PYP` / `LOAN` / `FNF` use the shared series high-water mark (`series-counters.ts`), so a deleted latest number is never reused. Reopening a final run removes its voucher until it is finalized again; it is refused while a salary payment points at
the run.

### Books, Tally, TDS (7P)
- **Books module**: payroll payments are Payment vouchers in the Day Book and the cash / bank book (`paid_from` cash →
  cash book, `bank` / `bank:<id>` → that bank book); `books.profitAndLoss` adds the salary cost — accrual: each final
  run's earnings + employer contributions on its voucher date, by account (Salaries & wages, Allowances, Bonus,
  Gratuity, Leave encashment, employer PF / ESI / admin); cash basis: salary and statutory payments when paid (loans
  excluded; loan recoveries and other deductions are not re-added — an approximation). The indicative Books balance
  sheet keeps unpaid salaries in its balancing figure. Fields `BooksData.payrollRunRows / payrollPaymentRows`
  (`books-link.ts`).
- **Tally XML** (`tally-payroll.ts`, one call line in `tally-xml.ts`): each final run as a Journal (Dr earnings /
  employer contributions with the employee's department as cost centre; Cr one ledger per employee "<name> (<code>)"
  under Current Liabilities for the net pay, PF / ESI / PT payable, "TDS Payable 192", 3615 / Interest received for
  loans, other deductions), payments as Payment vouchers (salary split over the employees' ledgers by net pay). Included
  only when the user may see payroll (`can('payroll.view')` in `loadTallyBooksSource`).
- **TDS 192 challans**: a TDS-on-salary payment may carry its BSR code and challan serial; every such payment shows in
  **TDS & TCS → Challans** in the same list, marked "TDS · 192 (payroll)", read-only (edited in Payroll → Payments, so
  the ledger never posts it twice; Form 26Q ignores it). Form 24Q stays in Payroll → Reports.
- **PF 7Q / 14B estimate** (Reports → annual): per final month, PF due vs PF payments with that challan period;
  interest 12% p.a. and damages by months of delay (`PF_LATE_RULES`) — an estimate; EPFO decides by order.

## Period lock, audit, roles
- Finalize, reopen and payments call `assertUnlocked` on the voucher / payment date (PIN override as elsewhere).
  Masters, attendance and drafts are not dated documents and are not locked; attendance for a finalized month is.
- Every write is audited: entity `employee` (masters) and `payroll` (attendance, runs, payments).
- **Decision: a new access action `payroll.view`, owner only.** Salaries are confidential, so clerks and viewers do not
  see the Payroll screen or nav entry and the payroll tables refuse their writes (`TABLE_ACTIONS`). Writes need both
  `books.edit` and `payroll.view`. The month's Payroll voucher (totals by account) is still visible in the ledger to
  anyone who can open Books; with one employee that reveals the salary. **7T:** the owner may grant `payroll.view` to a
  named trusted user (see § 7T); still convenience control, not security.

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
**7P** (all in `payroll-rules.ts`, date-keyed; UNVERIFIED where marked): old-regime senior ₹3 lakh / super-senior
₹5 lakh basic exemption and the "attains the age the day before the birthday" convention · 80CCD(2) 10% / 14% (new
regime from FY 2024-25) of Basic + DA · s. 206AA 20% with no cess on top (UNVERIFIED) · gratuity ₹10 lakh / ₹20 lakh
ceilings, 15/26, five years (the 4 years 240 days view is only flagged) · leave encashment exemption cap ₹3 lakh /
₹25 lakh, simplified to the least of amount, cap and 10 × Basic + DA (the average-salary and 30-days-a-year limbs are not
computed) · bonus ₹21,000 / ₹7,000 (₹10,000 / ₹3,500 before), 8.33%–20%, minimum ₹100 · loan perquisite: ₹20,000
small-loan limit (a later change must be added as a new version) and the SBI-rate placeholder of 12% (UNVERIFIED — type
the real SBI rate on each loan) · PF 7Q 12% p.a. and 14B 5 / 10 / 15 / 25% p.a. by 2 / 4 / 6 / 6+ months (UNVERIFIED
estimate) · EPS exit at 58 (the birthday month counted in full — EPFO may prorate) · ESI coverage held for the period
both ways · reimbursement heads' exemptions by regime · PT not charged on arrears / one-off items · notice-pay recovery
not deducted from taxable salary.

**Phase 7 values:** EPF 12% / 12% (EPS 8.33%), ₹15,000 ceiling from 1 Sep 2014, EDLI 0.5%, admin 0.5% with ₹500 minimum from 1 Jun 2018
(older admin rates approximate) · ESI 0.75% / 3.25% from 1 Jul 2019 (1.75% / 4.75% before), ₹21,000 ceiling from
1 Jan 2017 · PT: Maharashtra (₹175 / ₹200, Feb ₹300; women exempt up to ₹25,000 from Jul 2023), Karnataka (₹200 from
₹25,000 from Apr 2023; Feb ₹300 from Apr 2025), West Bengal (₹110–₹200), Tamil Nadu half-yearly (revised Oct 2024),
Gujarat (₹200 from ₹12,000; effective date approximate), Andhra Pradesh / Telangana (₹150 / ₹200) · income tax FY
2023-24, 2024-25 and 2025-26 slabs (later years reuse FY 2025-26 until a new version is added).

**7T** (all in `payroll-rules.ts`, date-keyed; UNVERIFIED where marked): earlier slabs FY 2017-18 to 2022-23 for Form 10E
(UNVERIFIED summary) · motor car ₹1,800 / ₹2,400 (+ ₹900 chauffeur), ₹600 / ₹900 when the employee runs it, and the 2025
revision ₹8,000 / ₹10,000 / ₹3,000 / ₹4,000 (+ ₹3,000) from 1 Apr 2025 (UNVERIFIED notification and effective date) ·
accommodation 15 / 10 / 7.5% (2001 census) and 10 / 7.5 / 5% (2011 census) from 1 Sep 2023, leased 15% kept after 2023
(UNVERIFIED), furniture 10% a year · meals ₹50 · gifts ₹5,000 with the whole value taxable once reached (UNVERIFIED reading)
· s. 17(2)(vii) ₹7.5 lakh from FY 2020-21, EPS share counted in employer PF (UNVERIFIED) · ESI low daily wage ₹100 / ₹137 /
₹176 (UNVERIFIED dates) · 201(1A) 1% / 1.5% a month or part, calendar-month counting, Rule 119A rounding, due 7th / 30 April
(UNVERIFIED counting) · arrear ECR layout · PT-on-arrears state rules (you choose the states) · actuarial journal treatment
(benefits paid expensed through payroll; Ind AS 19 OCI to Reserves 1100).

## Known gaps
- 7T: 17(2)(viia) accretion (Rule 3B) not computed; the 17(2)(vii) excess is in the TDS projection only (not yet in Form 16 /
  24Q Annexure II perquisite lines or a Form 12BA); 201(1A) late deduction is not detected; arrear ECR not validated against
  the portal; funded gratuity plan-asset movements (contributions, return on assets) are not split; hotel accommodation,
  EV cars and other Rule 3 variants are typed as "other".
- The gratuity provision working on the F&F tab is a simple accrual (use the actuarial valuation entry for AS-15 / Ind AS 19).
  Leave encashment exemption limbs simplified; no leave calendar, half-day / maternity rules.
- PF: no international workers, no voluntary PF, no EPS proration in the 58th-birthday month.
- PT for other states must be typed in the grid; PT registration / challans are not produced.
- The Books cash-basis P&L approximates payroll cost by payments.
