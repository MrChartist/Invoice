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
}

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
  tds_working?: { annual_income: number; annual_tax: number; deducted_before: number; months_left: number };
  /** Manual amounts typed in the review grid, by pay head id (they win over the computed value). */
  overrides?: Record<string, number>;
  warnings?: string[];
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

export type PayrollPaymentKind = 'salary' | 'pf' | 'esi' | 'pt' | 'tds';

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
  created_at: string;
}
