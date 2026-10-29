/**
 * Payroll (Phase 7, Tally parity) — persisted shapes. Field names are snake_case and additive only.
 * Tables: `employees`, `employee_groups`, `pay_heads`, `salary_structures`, `attendance_types`,
 * `attendance`, `payroll_runs`, `payroll_payments` (docs/features/payroll.md).
 */

export type TaxRegime = 'new' | 'old';

export interface Employee {
  id: string;
  /** Employee code / number, unique. */
  code: string;
  name: string;
  designation?: string;
  /** Cost centre (department / branch) the salary cost is booked to. */
  cost_centre_id?: string;
  group_id?: string;
  /** Date of joining / leaving, local `YYYY-MM-DD`. */
  doj?: string;
  dol?: string;
  gender?: 'M' | 'F' | 'O';
  pan?: string;
  uan?: string;
  esi_no?: string;
  /** Salary bank account (shown on the payslip, used for the bank advice). */
  bank_name?: string;
  bank_account?: string;
  bank_ifsc?: string;
  /** Two-digit GST state code of the place of work — decides the Professional Tax slab. */
  state?: string;
  tax_regime: TaxRegime;
  /** PF member (default true). */
  pf: boolean;
  /** Contribute PF on actual PF wages instead of the ₹15,000 ceiling (employee + employer). */
  pf_on_actual?: boolean;
  /** Not an EPS member (aged 58+, or joined after 2014 above the ceiling): the whole employer share goes to EPF. */
  eps_excluded?: boolean;
  /** ESI applies when gross is within the ceiling (default true). */
  esi: boolean;
  /** Professional Tax applies (default true). */
  pt: boolean;
  /** Annual figures for the TDS projection (old regime only, except other_income). */
  tax_deductions?: number;
  hra_exemption?: number;
  other_income?: number;
  /** Salary and TDS from an earlier employer this FY (Form 12B). */
  prev_salary?: number;
  prev_tds?: number;
  /** Additive (7P): date of birth — EPS stops after the month of the 58th birthday; old-regime senior slabs. */
  dob?: string;
  /** Additive (7P): notice period in days (full & final settlement). */
  notice_days?: number;
  active: boolean;
  created_at: string;
  updated_at?: string;
}

export interface EmployeeGroup {
  id: string;
  name: string;
  created_at: string;
}

export type PayHeadKind = 'earning' | 'deduction' | 'employer';

/** Tally's calculation types. */
export type PayHeadCalc = 'flat' | 'attendance' | 'percent' | 'production' | 'computed' | 'user';

/** Statutory pay heads are computed by the payroll engine from payroll-rules.ts. */
export type StatutoryKind = 'pf' | 'esi' | 'pt' | 'tds' | 'pf_er' | 'esi_er' | 'pf_admin';

export interface PayHeadSlab {
  /** Upper bound of the base (inclusive); null = no limit. */
  up_to: number | null;
  /** Amount, or percent of the base when `percent` is true. */
  value: number;
  percent?: boolean;
}

export interface PayHead {
  id: string;
  name: string;
  kind: PayHeadKind;
  calc: PayHeadCalc;
  statutory?: StatutoryKind;
  /** 'percent' and 'computed': base = the sum of these pay heads (current month). */
  base_heads?: string[];
  /** 'percent': rate in percent of the base. */
  percent?: number;
  /** 'computed': slabs on the base. */
  slabs?: PayHeadSlab[];
  /** 'production': the attendance / production type whose units are multiplied by the rate. */
  unit_type?: string;
  /** Earnings only: part of PF wages (Basic, DA, retaining allowance). */
  pf_wage?: boolean;
  /** Earnings only: part of ESI wages (default true). */
  esi_wage?: boolean;
  /** Earnings only: taxable salary u/s 17(1) (default true). */
  taxable?: boolean;
  /** Ledger account the head posts to (default chosen by kind). */
  account_id?: string;
  /** Sort order on the payslip. */
  order?: number;
  /** Additive (7P), employer heads: employer's NPS contribution — taxable salary, deductible u/s 80CCD(2). */
  nps?: boolean;
  /** Additive (7T), employer heads: contribution to an approved superannuation fund (s. 17(2)(vii)). */
  superannuation?: boolean;
  active: boolean;
  created_at: string;
}

export interface StructureLine {
  pay_head_id: string;
  /** Monthly amount (flat / attendance / user), rate per unit (production); ignored for percent / computed. */
  amount: number;
}

export interface SalaryStructure {
  id: string;
  /** Exactly one of employee_id / group_id. */
  employee_id?: string;
  group_id?: string;
  /** Local `YYYY-MM-DD`. The latest structure in force on the month's last day applies. */
  effective_from: string;
  lines: StructureLine[];
  created_at: string;
  updated_at?: string;
}

export interface AttendanceType {
  id: string;
  name: string;
  /** Unit shown in the grid, e.g. "hrs", "pcs". */
  unit: string;
  created_at: string;
}

/** Built-in production type: overtime hours. */
export const OT_HOURS_TYPE = 'ot_hours';

export interface AttendanceRow {
  id: string;
  employee_id: string;
  /** `YYYY-MM`. */
  month: string;
  /** Loss-of-pay days. Present days = days payable in the month − LOP. */
  lop: number;
  /** Units per production type id (`ot_hours` built in). */
  units?: Record<string, number>;
  updated_at?: string;
}

export interface PayslipAmount {
  pay_head_id: string;
  name: string;
  amount: number;
  account_id: string;
  statutory?: StatutoryKind;
  /** Additive (7P): one-off items shown in their own payslip section (arrears, loan EMI, leave encashment, F&F …). */
  tag?: PayslipTag;
  /** Additive (7P): the record behind a tagged item (loan / arrears / adjustment / settlement id). */
  ref_id?: string;
  /** Additive (7P), earnings: part taxable u/s 17 when it differs from `amount` (exempt gratuity, reimbursements …). */
  taxable?: number;
  /** Additive (7P), loan EMI: interest part of the amount (the rest is principal). */
  interest?: number;
}

/** Additive (7P): kinds of one-off payslip items. */
export type PayslipTag = 'arrear' | 'loan' | 'leave' | 'gratuity' | 'notice' | 'reimb' | 'bonus' | 'adjust';

/** One employee's computed salary for a month — a snapshot stored on the run. */
export interface PayslipLine {
  employee_id: string;
  code: string;
  name: string;
  designation?: string;
  cost_centre_id?: string;
  pan?: string;
  uan?: string;
  esi_no?: string;
  state?: string;
  bank_name?: string;
  bank_account?: string;
  bank_ifsc?: string;
  doj?: string;
  dol?: string;
  tax_regime: TaxRegime;
  days_in_month: number;
  /** Days the employee was on the rolls this month (DOJ / DOL). */
  days_employed: number;
  lop: number;
  payable_days: number;
  units: Record<string, number>;
  earnings: PayslipAmount[];
  deductions: PayslipAmount[];
  employer: PayslipAmount[];
  gross: number;
  total_deductions: number;
  net: number;
  taxable_gross: number;
  pf_wages: number;
  eps_wages: number;
  edli_wages: number;
  pf_ee: number;
  eps: number;
  epf_er: number;
  edli: number;
  pf_admin: number;
  esi_wages: number;
  esi_covered: boolean;
  esi_ee: number;
  esi_er: number;
  pt: number;
  tds: number;
  /** Annual tax projection behind the TDS figure (working). */
  tds_working?: {
    annual_income: number;
    annual_tax: number;
    deducted_before: number;
    months_left: number;
    /** Additive (7T): relief u/s 89 allowed in the projection (Form 10E furnished, s. 192(2A)). */
    relief89?: number;
    /** Additive (7T): projected employer PF + NPS + superannuation for the FY, and the s. 17(2)(vii) excess taxed. */
    er_contrib_year?: number;
    s17_vii?: number;
  };
  /** Manual amounts typed in the review grid, by pay head id (they win over the computed value). */
  overrides?: Record<string, number>;
  warnings?: string[];
  /* ── Additive (7P) ── */
  /** Arrears of a back-dated revision paid with this month (also in earnings / deductions with tag `arrear`). */
  arrears?: ArrearsSummary;
  /** Taxable value of perquisites for the month (s. 17(2)) — in `taxable_gross`, never paid. */
  perquisites?: number;
  /** Employer NPS contribution of the month (in `taxable_gross`; deductible u/s 80CCD(2)). */
  nps_er?: number;
  /** Full & final settlement included in this payslip. */
  fnf_id?: string;
  /** Old-regime age band used for the TDS slabs. */
  age_band?: 'senior' | 'super_senior';
  /** Informational notes printed on the payslip (relief u/s 89, EPS stopped at 58, 206AA …). */
  notes?: string[];
  /* ── Additive (7T) ── */
  /** Employer contribution of the month to a superannuation fund (s. 17(2)(vii)). */
  super_er?: number;
  /** ESI employee share not deducted: average daily wage within the low-wage limit (employer still pays). */
  esi_low_wage?: boolean;
}

/** Additive (7P): arrears totals carried on a payslip. */
export interface ArrearsSummary {
  ids: string[];
  from: string;
  to: string;
  months: number;
  gross: number;
  taxable: number;
  pf_ee: number;
  eps: number;
  epf_er: number;
  edli: number;
  pf_admin: number;
  esi_ee: number;
  esi_er: number;
  /** Some arrears relate to an earlier FY — relief u/s 89 (Form 10E) may be available. */
  earlier_fy: boolean;
}

export interface PayrollCompany {
  companyName: string;
  companyAddress?: string;
  companyGstin?: string;
  pf_code?: string;
  esi_code?: string;
  tan?: string;
}

export type PayrollRunStatus = 'draft' | 'final';

export interface PayrollRun {
  id: string;
  /** `YYYY-MM`. */
  month: string;
  /** Payroll voucher number `PRL/FY25-26/0001` (given on finalize). */
  number: string;
  /** Voucher date (default: the month's last day). */
  date: string;
  status: PayrollRunStatus;
  lines: PayslipLine[];
  company?: PayrollCompany | null;
  narration?: string;
  created_at: string;
  updated_at?: string;
  finalized_at?: string;
}

/** `loan` (7P) = a loan / advance paid to an employee (Dr Loans & advances to employees). */
export type PayrollPaymentKind = 'salary' | 'pf' | 'esi' | 'pt' | 'tds' | 'loan';

export interface PayrollPayment {
  id: string;
  kind: PayrollPaymentKind;
  /** `SPV/FY25-26/0001`. */
  number: string;
  date: string;
  amount: number;
  /** Ledger account id of the cash / bank account paid from (`bank`, `cash`, or a user cash/bank account). */
  paid_from: string;
  run_id?: string;
  employee_id?: string;
  reference?: string;
  /** Challan period, `YYYY-MM` (statutory payments). */
  period?: string;
  /** Additive (7P), TDS payments: ITNS 281 challan details — shown in the /tds challan list as section 192. */
  bsr_code?: string;
  challan_no?: string;
  /** Additive (7P), kind `loan`: the loan disbursed. */
  loan_id?: string;
  created_at: string;
}

/* ════════════════════════════════════════════════════════════════
   7P — arrears, loans, leave, adjustments, perquisites, full & final
   Tables: payroll_arrears, employee_loans, leave_types, leave_entries,
   payroll_adjustments, perquisites, fnf_settlements.
   ════════════════════════════════════════════════════════════════ */

/** Arrears for one past month: recomputed − paid, per pay head and statutory figure. */
export interface ArrearsMonth {
  month: string;
  earnings: { pay_head_id: string; name: string; amount: number; account_id: string; taxable: boolean }[];
  gross: number;
  taxable: number;
  pf_wages: number;
  pf_ee: number;
  eps: number;
  epf_er: number;
  edli: number;
  pf_admin: number;
  esi_wages: number;
  esi_ee: number;
  esi_er: number;
  /** Additive (7T): EPS / EDLI wage differences (arrear ECR). Older records: derived from PF wages. */
  eps_wages?: number;
  edli_wages?: number;
}

/** A back-dated revision's arrears, paid with the run of `pay_month`. */
export interface ArrearsRecord {
  id: string;
  employee_id: string;
  /** First month of the revision (`YYYY-MM`). */
  from_month: string;
  /** Month the arrears are paid in. */
  pay_month: string;
  months: ArrearsMonth[];
  gross: number;
  note?: string;
  created_at: string;
}

export type LoanKind = 'loan' | 'advance';

export interface EmployeeLoan {
  id: string;
  /** `LOAN/FY25-26/0001`. */
  number: string;
  employee_id: string;
  kind: LoanKind;
  /** Day paid out (local `YYYY-MM-DD`). */
  date: string;
  amount: number;
  /** Interest charged, % p.a. on the reducing balance (0 = interest-free). */
  interest_rate: number;
  /** Monthly instalment (interest first, then principal). */
  emi: number;
  /** First month an instalment is recovered. */
  start_month: string;
  /** Cash / bank ledger it was paid from. */
  paid_from: string;
  /** Medical-treatment loans (Rule 3(7)(i)) are not a perquisite. */
  purpose?: 'general' | 'medical';
  /** SBI rate for the perquisite (% p.a.) — overrides the placeholder in payroll-rules.ts. */
  sbi_rate?: number;
  /** The `payroll_payments` row (kind `loan`) that books the disbursement. */
  payment_id?: string;
  notes?: string;
  created_at: string;
}

export interface LeaveType {
  id: string;
  /** Short code shown in grids (CL, SL, EL). */
  code: string;
  name: string;
  /** Paid leave; unpaid days taken count as loss of pay. */
  paid: boolean;
  /** Days credited for every month on the rolls (0 = no accrual). */
  accrual: number;
  /** Can be encashed (during service and on leaving). */
  encashable: boolean;
  /** Balance carried into a new FY is capped here (0 / absent = no cap). */
  carry_cap?: number;
  created_at: string;
}

export type LeaveEntryKind = 'opening' | 'taken' | 'encash' | 'adjust';

export interface LeaveEntry {
  id: string;
  employee_id: string;
  type_id: string;
  kind: LeaveEntryKind;
  /** Local `YYYY-MM-DD` (opening: the as-of day). */
  date: string;
  /** Days (adjust may be negative). */
  days: number;
  /** encash: pay month (`YYYY-MM`) the encashment is paid in. */
  month?: string;
  /** encash: amount typed instead of days × daily rate. */
  amount?: number;
  notes?: string;
  created_at: string;
}

export type AdjustmentTag = 'reimb' | 'bonus' | 'adjust';

/** A one-off earning / deduction for one employee's payslip of `month` (reimbursement, bonus, other). */
export interface PayrollAdjustment {
  id: string;
  employee_id: string;
  month: string;
  kind: 'earning' | 'deduction';
  tag: AdjustmentTag;
  name: string;
  amount: number;
  /** Reimbursement head key (REIMBURSEMENT_HEADS) — decides the exempt part. */
  head?: string;
  /** Earnings: taxable part; absent = by head / fully taxable. */
  taxable_amount?: number;
  account_id?: string;
  /** Bill / voucher reference. */
  reference?: string;
  created_at: string;
}

/** `accretion` (7.149): s. 17(2)(viia) annual accretion (Rule 3B), one-off in its month. */
export type PerquisiteKind = 'accommodation' | 'car' | 'other' | 'meals' | 'gift' | 'accretion';

/** A perquisite's taxable value per month (s. 17(2)), from `from_month` to `to_month` (open-ended if absent). */
export interface Perquisite {
  id: string;
  employee_id: string;
  kind: PerquisiteKind;
  description: string;
  from_month: string;
  to_month?: string;
  monthly_value: number;
  /** Additive (7T): how the value was worked (Rule 3 valuation summary). */
  basis?: string;
  created_at: string;
}

export type FnfReason = 'resignation' | 'retirement' | 'termination' | 'death';

export interface FnfSettlement {
  id: string;
  /** `FNF/FY25-26/0001`, given when saved. */
  number: string;
  employee_id: string;
  reason: FnfReason;
  /** Month the settlement is paid in (its payroll run carries the items). */
  pay_month: string;
  /** Notice: days short (recover) or days paid in lieu (pay). */
  notice_mode: 'none' | 'recover' | 'pay';
  notice_days: number;
  /** Amount typed instead of days × monthly gross ÷ 30. */
  notice_amount?: number;
  leave_days: number;
  leave_amount?: number;
  /** Gratuity: computed unless typed. */
  gratuity_amount?: number;
  /** Recover every outstanding loan / advance from the settlement. */
  recover_loans: boolean;
  other: { name: string; kind: 'earning' | 'deduction'; amount: number; taxable?: boolean }[];
  note?: string;
  created_at: string;
  updated_at?: string;
}

/* ════════════════════════════════════════════════════════════════
   7T — relief u/s 89 (Form 10E) and actuarial valuations.
   Tables: payroll_relief89, actuarial_valuations.
   ════════════════════════════════════════════════════════════════ */

/** One earlier FY an arrear relates to (Form 10E Annexure I, Table A). */
export interface Relief89Year {
  /** FY start year (2023 = FY 2023-24). */
  fy: number;
  regime: TaxRegime;
  /** Total income of that year as assessed / returned (before this arrear). */
  income: number;
  /** Arrear relating to that year. */
  arrears: number;
}

/** Relief u/s 89(1) working for arrears received in FY `fy` (Form 10E). */
export interface Relief89Record {
  id: string;
  employee_id: string;
  /** FY of receipt (start year). */
  fy: number;
  regime: TaxRegime;
  /** Total income of the year of receipt INCLUDING the arrears. */
  income_with: number;
  years: Relief89Year[];
  /** Relief worked when saved (recomputed on display). */
  relief: number;
  /** Allow the relief in the TDS projection (s. 192(2A): Form 10E furnished to the employer). */
  apply_tds: boolean;
  note?: string;
  created_at: string;
  updated_at?: string;
}

export type ActuarialKind = 'gratuity' | 'leave';
export type ActuarialStandard = 'as15' | 'indas19';

/** The actuary's figures for one valuation date (AS-15 / Ind AS 19), and the journal posted from them. */
export interface ActuarialValuation {
  id: string;
  /** `ACT/FY25-26/0001`. */
  number: string;
  kind: ActuarialKind;
  standard: ActuarialStandard;
  /** Valuation (balance sheet) date — the journal date. */
  date: string;
  actuary: string;
  report_ref?: string;
  discount_rate?: number;
  salary_escalation?: number;
  opening: number;
  current_service_cost: number;
  interest_cost: number;
  past_service_cost: number;
  benefits_paid: number;
  /** Actuarial loss (+) / gain (−) on the obligation. */
  actuarial_loss: number;
  closing: number;
  /** Fair value of plan assets at the date (funded plans); the provision is the net liability. */
  plan_assets?: number;
  /** Provision for this benefit already in the books before this entry. */
  book_balance: number;
  voucher_id?: string;
  voucher_number?: string;
  note?: string;
  created_at: string;
  updated_at?: string;
}
