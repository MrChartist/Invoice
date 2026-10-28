/** R4-C: payroll tables (salaries are confidential): bin rows listed and open-export tables written only with `payroll.view`. */
export const PAYROLL_TABLES: ReadonlySet<string> = new Set([
  'employees', 'employee_groups', 'pay_heads', 'salary_structures', 'attendance_types', 'attendance', 'payroll_runs', 'payroll_payments',
  'payroll_arrears', 'employee_loans', 'leave_types', 'leave_entries', 'payroll_adjustments', 'perquisites', 'fnf_settlements',
  'payroll_relief89', 'actuarial_valuations',
]);
