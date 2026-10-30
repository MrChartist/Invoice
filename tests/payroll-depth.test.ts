/**
 * Payroll depth (7P): arrears of a back-dated revision, loans & EMIs (+ perquisite), leave,
 * gratuity, bonus, full & final settlement, reimbursements, senior slabs, 80CCD(2), 206AA,
 * EPS at 58, ESI by contribution period, PF late estimate, and the Books / Tally / TDS links.
 */
import './helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { computePayslip, DEFAULT_PAY_HEADS, epsLastMonth } from '../src/lib/payroll/compute.ts';
import {
  autoFillRun,
  computeRun,
  finalizeRun,
  loadPayrollData,
  loadRuns,
  payableBalances,
  recordPayrollPayment,
  saveEmployee,
  saveStructure,
  type EmployeeInput,
} from '../src/lib/payroll/store.ts';
import {
  addAdjustment,
  addLeaveEntry,
  deleteLoan,
  loadDepth,
  loadLoans,
  postProvisionJournal,
  saveArrears,
  saveFnf,
  saveLeaveType,
  saveLoan,
} from '../src/lib/payroll/depth-store.ts';
import {
  arrearsEarlierFy,
  bonusWorking,
  gratuityFor,
  leaveBalance,
  loanOutstanding,
  loanPerquisite,
  loanSchedule,
  pfLateEstimate,
  reimbursementTaxable,
  serviceLength,
} from '../src/lib/payroll/depth.ts';
import { fnfStatementHtml } from '../src/lib/payroll/depth-reports.ts';
import { fnfWorking } from '../src/lib/payroll/depth.ts';
import { payslipHtml } from '../src/lib/payroll/reports.ts';
import { payrollVoucher } from '../src/lib/payroll/postings.ts';
import { ageBand, tdsSalaryRuleFor } from '../src/lib/payroll-rules.ts';
import { buildLedger, loadLedgerInput, trialBalance, voucherDiff, A, closingBalances } from '../src/lib/ledger/index.ts';
import { setActorProvider, type Role } from '../src/lib/access.ts';
import { collectAppData, getTable, setTable } from '../src/lib/storage.ts';
import { validateBackupData } from '../src/lib/backup.ts';
import { buildVouchers, loadBooksData, profitAndLoss } from '../src/lib/books.ts';
import { payrollTallyVouchers } from '../src/lib/tally-payroll.ts';
import { payrollTdsChallans, isPayrollChallan } from '../src/lib/payroll/tds-link.ts';
import type { Employee, EmployeeLoan, LeaveType, PayHead, PayrollRun, SalaryStructure } from '../src/types/payroll.ts';

const as = (role: Role | null) => setActorProvider(role ? () => ({ id: 'u', name: 'U', role }) : null);
beforeEach(() => resetStorage());
afterEach(() => as(null));

const heads = DEFAULT_PAY_HEADS as PayHead[];
const toP = (r: number) => Math.round(r * 100);
const emp = (over: Partial<Employee> = {}): Employee => ({ id: 'e1', code: 'E001', name: 'Asha', tax_regime: 'new', pf: false, esi: false, pt: false, active: true, created_at: '', pan: 'ABCDE1234F', ...over });
const struct = (amounts: Record<string, number>, over: Partial<SalaryStructure> = {}): SalaryStructure => ({
  id: 's1', employee_id: 'e1', effective_from: '2025-04-01', created_at: '', lines: Object.entries(amounts).map(([pay_head_id, amount]) => ({ pay_head_id, amount })), ...over,
});
const input = (over: Partial<EmployeeInput> = {}): EmployeeInput => ({
  code: 'E001', name: 'Ravi Kumar', tax_regime: 'new', pf: true, esi: true, pt: true, active: true, state: '27', uan: '100200300400', esi_no: '1234567890', pan: 'ABCDE1234F', doj: '2025-04-01', ...over,
});

/* ── Arrears ──────────────────────────────────────────────── */

test('arrears: back-dated revision recomputed per month, PF / ESI on the difference, shown separately, posted', () => {
  const e = saveEmployee(input());
  saveStructure({ employee_id: e.id, effective_from: '2025-04-01', lines: [{ pay_head_id: 'ph_basic', amount: 12000 }, { pay_head_id: 'ph_hra', amount: 4000 }, { pay_head_id: 'ph_special', amount: 2000 }] });
  for (const m of ['2025-04', '2025-05', '2025-06']) finalizeRun(autoFillRun(m).run.id);
  // Revision from May: Basic 15,000, decided in July.
  saveStructure({ employee_id: e.id, effective_from: '2025-05-01', lines: [{ pay_head_id: 'ph_basic', amount: 15000 }, { pay_head_id: 'ph_hra', amount: 4000 }, { pay_head_id: 'ph_special', amount: 2000 }] });
  const rec = saveArrears({ employee_id: e.id, from_month: '2025-05', pay_month: '2025-07' });
  assert.deepEqual(rec.months.map((m) => m.month), ['2025-05', '2025-06']);
  const may = rec.months[0];
  assert.equal(may.gross, 3000);
  assert.equal(may.pf_ee, 360, 'PF 12% on the extra ₹3,000 (still within the ₹15,000 ceiling)');
  assert.equal(may.eps, 250, 'EPS 1,250 − 1,000');
  assert.equal(may.esi_ee, 23, 'ESI 0.75% of 3,000, rounded up');
  assert.equal(rec.gross, 6000);
  assert.equal(arrearsEarlierFy(rec), false);

  const { run } = autoFillRun('2025-07');
  const l = run.lines[0];
  assert.equal(l.arrears?.gross, 6000);
  assert.equal(l.arrears?.months, 2);
  assert.ok(l.earnings.some((x) => x.pay_head_id === 'arr:ph_basic' && x.amount === 6000 && x.tag === 'arrear'));
  assert.ok(l.deductions.some((x) => x.pay_head_id === 'arr:pf' && x.amount === 720 && x.statutory === 'pf'));
  assert.ok(l.deductions.some((x) => x.pay_head_id === 'arr:esi' && x.amount === 46));
  assert.equal(l.gross, 21000 + 6000, 'July salary at the revised rate + arrears');
  assert.equal(l.pt, 200, 'PT on the regular gross only');
  assert.ok(l.taxable_gross >= 27000);
  const html = payslipHtml(run, l);
  assert.match(html, /Arrears: revision from May 2025 to June 2025 \(2 months\)/);
  const final = finalizeRun(run.id);
  assert.equal(voucherDiff(payrollVoucher(final)!), 0);
  const pf = payableBalances(loadRuns(), []).find((b) => b.kind === 'pf')!;
  const julyPf = final.lines[0].deductions.concat(final.lines[0].employer).filter((x) => x.statutory === 'pf' || x.statutory === 'pf_er' || x.statutory === 'pf_admin').reduce((s, x) => s + x.amount, 0);
  assert.ok(pf.due >= julyPf, 'arrear PF is in the PF payable');
  const tb = trialBalance(buildLedger(loadLedgerInput()), { start: '2025-04-01', end: '2026-03-31' });
  assert.equal(tb.totals.debit, tb.totals.credit);
  assert.throws(() => saveArrears({ employee_id: e.id, from_month: '2025-05', pay_month: '2025-07' }), /finalized/);
});

test('arrears of an earlier FY carry the relief u/s 89 note', () => {
  assert.equal(arrearsEarlierFy({ pay_month: '2025-04', months: [{ month: '2025-03' } as never] }), true);
  const l = computePayslip({
    month: '2025-04', employee: emp(), structure: struct({ ph_basic: 30000 }), heads,
    extras: { arrears: [{ id: 'a', employee_id: 'e1', from_month: '2025-02', pay_month: '2025-04', gross: 2000, created_at: '', months: [{ month: '2025-03', earnings: [{ pay_head_id: 'ph_basic', name: 'Basic', amount: 2000, account_id: A.salaries, taxable: true }], gross: 2000, taxable: 2000, pf_wages: 0, pf_ee: 0, eps: 0, epf_er: 0, edli: 0, pf_admin: 0, esi_wages: 0, esi_ee: 0, esi_er: 0 }] }] },
  })!;
  assert.equal(l.arrears?.earlier_fy, true);
  assert.ok(l.notes?.some((n) => /relief u\/s 89/.test(n)));
  assert.equal(l.gross, 32000);
});

/* ── Statutory additions ──────────────────────────────────── */

test('EPS stops after the month of the 58th birthday', () => {
  assert.equal(epsLastMonth('1967-06-20'), '2025-06');
  assert.equal(epsLastMonth('1967-07-01'), '2025-06', 'born on the 1st: attains 58 on the last day of the previous month');
  const e = emp({ pf: true, dob: '1967-06-20' });
  const s = struct({ ph_basic: 20000 });
  const june = computePayslip({ month: '2025-06', employee: e, structure: s, heads })!;
  assert.equal(june.eps, 1250);
  const july = computePayslip({ month: '2025-07', employee: e, structure: s, heads })!;
  assert.equal(july.eps, 0);
  assert.equal(july.epf_er, 1800, 'whole employer share to EPF');
  assert.ok(july.notes?.some((n) => /EPS stopped/.test(n)));
});

test('ESI coverage is decided for the contribution period, not month by month', () => {
  const e = saveEmployee(input({ doj: '2025-01-01', pt: false }));
  saveStructure({ employee_id: e.id, effective_from: '2025-01-01', lines: [{ pay_head_id: 'ph_basic', amount: 20000 }] });
  saveStructure({ employee_id: e.id, effective_from: '2025-06-01', lines: [{ pay_head_id: 'ph_basic', amount: 25000 }] });
  const data = loadPayrollData();
  // No final run in April: coverage still decided on April's rate (₹20,000 ≤ ₹21,000).
  assert.equal(computeRun('2025-07', data).lines[0].esi_covered, true);
  assert.equal(computeRun('2025-10', data).lines[0].esi_covered, false, 'new period from October at ₹25,000');
  // Above the ceiling at the start of the period: not covered even after a cut mid-period.
  const f = saveEmployee(input({ code: 'E002', doj: '2025-01-01', pt: false, uan: undefined }));
  saveStructure({ employee_id: f.id, effective_from: '2025-01-01', lines: [{ pay_head_id: 'ph_basic', amount: 25000 }] });
  saveStructure({ employee_id: f.id, effective_from: '2025-06-01', lines: [{ pay_head_id: 'ph_basic', amount: 18000 }] });
  assert.equal(computeRun('2025-07', loadPayrollData()).lines.find((l) => l.employee_id === f.id)!.esi_covered, false);
});

test('old regime: senior / super-senior slabs from the date of birth', () => {
  assert.equal(ageBand('1966-04-01', '2025-04-01'), 'senior', 'born 1 April turns 60 on 31 March');
  assert.equal(ageBand('1966-04-02', '2025-04-01'), 'normal');
  assert.equal(ageBand('1945-04-01', '2025-04-01'), 'super_senior');
  assert.equal(tdsSalaryRuleFor('old', '2025-04-01', '1960-01-01').slabs[0].up_to, 300000);
  assert.equal(tdsSalaryRuleFor('old', '2025-04-01', '1940-01-01').slabs[0].up_to, 500000);
  assert.equal(tdsSalaryRuleFor('new', '2025-04-01', '1940-01-01').slabs[0].up_to, 400000, 'new regime: one table for all ages');
  const normal = computePayslip({ month: '2025-04', employee: emp({ tax_regime: 'old' }), structure: struct({ ph_basic: 80000 }), heads })!;
  const senior = computePayslip({ month: '2025-04', employee: emp({ tax_regime: 'old', dob: '1960-01-01' }), structure: struct({ ph_basic: 80000 }), heads })!;
  assert.equal(senior.age_band, 'senior');
  assert.ok(senior.tds < normal.tds);
});

test('s. 206AA: no PAN → 20% of income when that is higher; 80CCD(2) employer NPS deducted', () => {
  const noPan = computePayslip({ month: '2025-04', employee: emp({ pan: undefined }), structure: struct({ ph_basic: 150000 }), heads })!;
  assert.equal(noPan.tds, Math.round(345000 / 12), '20% of ₹17,25,000');
  assert.ok(noPan.notes?.some((n) => /206AA/.test(n)));
  const nps: PayHead = { id: 'ph_nps', name: 'Employer NPS', kind: 'employer', calc: 'flat', nps: true, active: true, created_at: '', account_id: A.pfEmployer };
  const l = computePayslip({ month: '2025-04', employee: emp(), structure: struct({ ph_basic: 100000, ph_nps: 10000 }), heads: [...heads, nps] })!;
  assert.equal(l.nps_er, 10000);
  assert.equal(l.taxable_gross, 110000);
  assert.equal(l.tds_working?.annual_income, 1320000 - 75000 - 120000, 'NPS included then deducted u/s 80CCD(2) (within 14% of Basic)');
  assert.equal(l.tds, 0);
});

/* ── Loans ────────────────────────────────────────────────── */

const loan = (over: Partial<EmployeeLoan> = {}): EmployeeLoan => ({ id: 'L1', number: 'LOAN/FY25-26/0001', employee_id: 'e1', kind: 'loan', date: '2025-04-05', amount: 120000, interest_rate: 0, emi: 10000, start_month: '2025-05', paid_from: 'bank', created_at: '', ...over });

test('loans: EMI schedule (reducing balance), interest-free perquisite at the SBI rate, medical loans exempt', () => {
  const sched = loanSchedule(loan({ interest_rate: 12 }), []);
  assert.equal(sched[0].interest, 1200);
  assert.equal(sched[0].principal, 8800);
  assert.equal(sched.at(-1)!.closing, 0);
  assert.equal(loanSchedule(loan(), []).length, 12);
  assert.equal(loanPerquisite([loan()], '2025-05', []), 1200, '12% placeholder SBI rate × 1,20,000 ÷ 12');
  assert.equal(loanPerquisite([loan({ amount: 20000 })], '2025-05', []), 0, 'within the ₹20,000 small-loan limit');
  assert.equal(loanPerquisite([loan({ purpose: 'medical' })], '2025-05', []), 0);
  assert.equal(loanPerquisite([loan({ interest_rate: 8, sbi_rate: 10 })], '2025-05', []), 200);
});

test('loans: paid out through payroll, recovered in the run (interest to income), outstanding falls', () => {
  const e = saveEmployee(input({ esi: false, pt: false }));
  saveStructure({ employee_id: e.id, effective_from: '2025-04-01', lines: [{ pay_head_id: 'ph_basic', amount: 30000 }] });
  const l = saveLoan({ employee_id: e.id, kind: 'loan', date: '2025-04-10', amount: 60000, interest_rate: 6, emi: 5300, start_month: '2025-05', paid_from: 'bank' });
  assert.match(l.number, /^LOAN\/FY25-26\/0001$/);
  let bal = closingBalances(buildLedger(loadLedgerInput()), '2026-03-31');
  assert.equal(bal.get(A.staffAdvances), toP(60000));
  const { run } = autoFillRun('2025-05');
  const d = run.lines[0].deductions.find((x) => x.tag === 'loan')!;
  assert.equal(d.amount, 5300);
  assert.equal(d.interest, 300);
  finalizeRun(run.id);
  assert.equal(loanOutstanding(loadLoans()[0], loadRuns()), 55000);
  bal = closingBalances(buildLedger(loadLedgerInput()), '2026-03-31');
  assert.equal(bal.get(A.staffAdvances), toP(55000));
  assert.equal(bal.get(A.interestIncome), -toP(300));
  assert.throws(() => deleteLoan(l.id), /recovered/);
  assert.ok(run.lines[0].perquisites === undefined || run.lines[0].perquisites >= 0);
});

/* ── Leave, gratuity, bonus, reimbursements ───────────────── */

test('leave: opening + monthly accrual − taken − encashed; carry-forward cap at 1 April', () => {
  const t: LeaveType = { id: 'el', code: 'EL', name: 'Earned', paid: true, accrual: 1.5, encashable: true, carry_cap: 30, created_at: '2025-01-01' };
  const entries = [
    { id: 'o', employee_id: 'e1', type_id: 'el', kind: 'opening' as const, date: '2025-03-31', days: 28, created_at: '' },
    { id: 't', employee_id: 'e1', type_id: 'el', kind: 'taken' as const, date: '2025-06-10', days: 2, created_at: '' },
    { id: 'x', employee_id: 'e1', type_id: 'el', kind: 'encash' as const, date: '2025-09-01', month: '2025-09', days: 5, created_at: '' },
  ];
  const b = leaveBalance(t, { doj: '2020-01-01' }, entries, '2025-12');
  assert.equal(b.opening, 28);
  assert.equal(b.accrued, 13.5, 'April–December');
  assert.equal(b.balance, 28 + 13.5 - 2 - 5);
  const next = leaveBalance(t, { doj: '2020-01-01' }, entries, '2026-04');
  assert.equal(next.lapsed, round(28 + 18 - 7 - 30));
  assert.equal(next.balance, 30 + 1.5);
});
const round = (n: number) => Math.round(n * 100) / 100;

test('gratuity: 15/26 × last drawn × years (part above six months), 5-year rule, ceiling by date', () => {
  assert.deepEqual(serviceLength('2019-04-01', '2025-06-15'), { years: 6, months: 2, days: 15, gratuity_years: 6 });
  assert.equal(serviceLength('2019-04-01', '2025-10-15').gratuity_years, 7);
  const g = gratuityFor({ doj: '2015-04-01', asOf: '2025-03-31', lastDrawn: 26000 });
  assert.equal(g.formula, 150000);
  assert.equal(g.amount, 150000);
  assert.equal(gratuityFor({ doj: '2021-04-01', asOf: '2025-03-31', lastDrawn: 26000 }).amount, 0, 'four years: not yet eligible');
  assert.equal(gratuityFor({ doj: '2021-04-01', asOf: '2025-03-31', lastDrawn: 26000, reason: 'death' }).amount, 60000);
  assert.equal(gratuityFor({ doj: '1980-01-01', asOf: '2025-03-31', lastDrawn: 300000 }).amount, 2000000, '₹20 lakh ceiling');
  assert.equal(gratuityFor({ doj: '1980-01-01', asOf: '2017-03-31', lastDrawn: 300000 }).amount, 1000000, '₹10 lakh before 29 Mar 2018');
});

test('bonus: Payment of Bonus Act, ₹21,000 eligibility, ₹7,000 calculation ceiling, 8.33% minimum', () => {
  const line = (month: string, basic: number) => ({ employee_id: 'e1', code: 'E001', name: 'A', tax_regime: 'new', days_in_month: 30, days_employed: 30, lop: 0, payable_days: 30, units: {}, earnings: [{ pay_head_id: 'ph_basic', name: 'Basic', amount: basic, account_id: A.salaries }], deductions: [], employer: [], gross: basic, total_deductions: 0, net: basic, taxable_gross: basic, pf_wages: 0, eps_wages: 0, edli_wages: 0, pf_ee: 0, eps: 0, epf_er: 0, edli: 0, pf_admin: 0, esi_wages: 0, esi_covered: false, esi_ee: 0, esi_er: 0, pt: 0, tds: 0 });
  const runs = [line('2025-04', 12000), line('2025-05', 12000)].map((l, i) => ({ id: `r${i}`, month: i ? '2025-05' : '2025-04', number: '', date: '2025-05-31', status: 'final', lines: [l], created_at: '' })) as PayrollRun[];
  const [r] = bonusWorking(runs, [emp()], heads, 2025, 8.33);
  assert.equal(r.bonus_wages, 14000);
  assert.equal(r.bonus, 1166);
  assert.equal(bonusWorking(runs, [emp()], heads, 2025, 20)[0].bonus, 2800);
  const high = runs.map((x) => ({ ...x, lines: [{ ...x.lines[0], earnings: [{ ...x.lines[0].earnings[0], amount: 25000 }] }] }));
  assert.equal(bonusWorking(high, [emp()], heads, 2025, 8.33)[0].eligible, false);
});

test('reimbursements: exempt by head and regime; typed taxable part wins', () => {
  assert.equal(reimbursementTaxable({ amount: 5000, head: 'telephone' }, 'new'), 0);
  assert.equal(reimbursementTaxable({ amount: 5000, head: 'lta' }, 'new'), 5000, 'LTA only in the old regime');
  assert.equal(reimbursementTaxable({ amount: 5000, head: 'lta' }, 'old'), 0);
  assert.equal(reimbursementTaxable({ amount: 5000, head: 'medical' }, 'old'), 5000);
  assert.equal(reimbursementTaxable({ amount: 5000, head: 'telephone', taxable_amount: 1000 }, 'new'), 1000);
});

test('PF 7Q / 14B estimate', () => {
  const est = pfLateEstimate('2025-06', 36500, '2025-08-14');
  assert.equal(est.due_date, '2025-07-15');
  assert.equal(est.days_late, 30);
  assert.equal(est.interest, 360, '12% p.a. simple');
  assert.equal(est.damages, 150, '5% p.a. up to two months');
  assert.equal(pfLateEstimate('2025-06', 1000, '2025-07-10').interest, 0);
});

/* ── Full & final ─────────────────────────────────────────── */

test('full & final: notice recovery, leave encashment, gratuity, loan recovery, final TDS, one run, one statement', () => {
  const e = saveEmployee(input({ code: 'E009', name: 'Meena', doj: '2019-04-01', esi: false, pt: false }));
  saveStructure({ employee_id: e.id, effective_from: '2019-04-01', lines: [{ pay_head_id: 'ph_basic', amount: 30000 }] });
  const el = saveLeaveType({ code: 'EL', name: 'Earned leave', paid: true, accrual: 1.25, encashable: true });
  addLeaveEntry({ employee_id: e.id, type_id: el.id, kind: 'opening', date: '2025-03-31', days: 10 });
  saveLoan({ employee_id: e.id, kind: 'advance', date: '2025-04-02', amount: 50000, interest_rate: 0, emi: 5000, start_month: '2025-04', paid_from: 'bank' });
  for (const m of ['2025-04', '2025-05']) finalizeRun(autoFillRun(m).run.id);
  assert.equal(loanOutstanding(loadLoans()[0], loadRuns()), 40000);

  // Leaves on 15 June after short notice of 15 days.
  saveEmployee({ ...e, dol: '2025-06-15' });
  const fnf = saveFnf({ employee_id: e.id, reason: 'resignation', pay_month: '2025-06', notice_mode: 'recover', notice_days: 15, leave_days: 13.75, recover_loans: true, other: [] });
  assert.match(fnf.number, /^FNF\/FY25-26\/0001$/);

  const { run } = autoFillRun('2025-06');
  const l = run.lines.find((x) => x.employee_id === e.id)!;
  assert.equal(l.fnf_id, fnf.id);
  const item = (key: string) => l.earnings.concat(l.deductions).find((x) => x.pay_head_id === key)?.amount;
  assert.equal(item('ph_basic'), 15000, 'salary for 15 days');
  assert.equal(item('fnf:leave'), 13750, '13.75 days × 30,000 ÷ 30');
  assert.equal(item('fnf:gratuity'), 103846, '15/26 × 30,000 × 6 years');
  assert.equal(item('fnf:notice'), 15000, '15 days × 30,000 ÷ 30 recovered');
  assert.equal(item(`loan:${loadLoans()[0].id}`), 40000, 'advance balance recovered (no separate EMI)');
  assert.equal(l.deductions.filter((x) => x.tag === 'loan').length, 1);
  assert.equal(l.gross, 15000 + 13750 + 103846);
  assert.equal(l.perquisites, 400, 'interest-free advance above ₹20,000: 12% placeholder SBI rate on 40,000 for the month');
  assert.equal(l.taxable_gross, 15000 + 400, 'gratuity and leave encashment exempt u/s 10(10) / 10(10AA)');
  assert.equal(l.tds_working?.months_left, 1, 'final TDS takes the balance of the year');
  assert.equal(l.net, l.gross - l.pf_ee - 40000 - 15000 - l.tds);

  const w = fnfWorking(fnf, saveEmployee({ ...e, dol: '2025-06-15' }), { ...loadPayrollData(), ...loadDepth() });
  assert.equal(w.gratuity.exempt, 103846);
  assert.equal(w.leave.balance, 13.75, 'opening 10 + 1.25 × 3 months');
  const html = fnfStatementHtml(fnf, e, w, l, run, null);
  assert.match(html, /Full &amp; final settlement/);
  assert.match(html, /Net payable to the employee/);
  assert.ok(!/<script/i.test(html));

  const final = finalizeRun(run.id);
  assert.equal(voucherDiff(payrollVoucher(final)!), 0);
  const bal = closingBalances(buildLedger(loadLedgerInput()), '2026-03-31');
  assert.equal(bal.get(A.staffAdvances) ?? 0, 0, 'advance fully recovered');
  assert.equal(bal.get(A.gratuity), toP(103846));
  assert.equal(bal.get(A.leaveEncashment), toP(13750));
  assert.equal(bal.get(A.otherIncome), -toP(15000), 'notice pay recovered is other income');
  assert.equal(loanOutstanding(loadLoans()[0], loadRuns()), 0);
  // A leaver is not on later runs.
  assert.throws(() => autoFillRun('2025-07'), /No employee/);
});

/* ── Integration: Books, Tally, TDS challans, provisions, backup, roles ── */

test('Books: payroll payments in the cash / bank book; salary cost in the P&L (accrual and cash)', () => {
  const e = saveEmployee(input({ esi: false, pt: false }));
  saveStructure({ employee_id: e.id, effective_from: '2025-04-01', lines: [{ pay_head_id: 'ph_basic', amount: 30000 }] });
  const run = finalizeRun(autoFillRun('2025-04').run.id);
  recordPayrollPayment({ kind: 'salary', date: '2025-05-01', amount: run.lines[0].net, paid_from: 'bank', run_id: run.id });
  recordPayrollPayment({ kind: 'tds', date: '2025-05-07', amount: 100, paid_from: 'cash', period: '2025-04', bsr_code: '0510308', challan_no: '00012' });
  const data = loadBooksData();
  const v = buildVouchers(data).filter((x) => x.id.startsWith('prp:'));
  assert.equal(v.length, 2);
  assert.equal(v.find((x) => x.account === 'bank')!.debit, run.lines[0].net);
  assert.equal(v.find((x) => x.account === 'cash')!.debit, 100);
  const pnl = profitAndLoss(data, { start: '2025-04-01', end: '2026-03-31' }, 'accrual');
  assert.equal(pnl.expenses.find((x) => x.category === 'Salaries & wages')!.amount, 30000);
  assert.ok(pnl.expenses.some((x) => x.category === "Employer's contribution to PF"));
  const cash = profitAndLoss(data, { start: '2025-04-01', end: '2026-03-31' }, 'cash');
  assert.equal(cash.expenses.find((x) => x.category === 'Salaries & wages (paid)')!.amount, run.lines[0].net + 100);
  assert.throws(() => recordPayrollPayment({ kind: 'tds', date: '2025-05-07', amount: 1, paid_from: 'bank', bsr_code: '12', challan_no: '1' }), /BSR/);
});

test('TDS 192 payments appear in the /tds challan list, read-only, section 192', () => {
  const rows = [{ id: 'p1', kind: 'tds', number: 'PYP/FY25-26/0001', date: '2025-05-07', amount: 1500, paid_from: 'bank', period: '2025-04', bsr_code: '0510308', challan_no: '00012', created_at: '' }, { id: 'p2', kind: 'pf', number: 'x', date: '2025-05-07', amount: 10, paid_from: 'bank', created_at: '' }];
  const ch = payrollTdsChallans(rows);
  assert.equal(ch.length, 1);
  assert.equal(ch[0].kind, 'TDS');
  assert.equal(ch[0].bsr_code, '0510308');
  assert.deepEqual(ch[0].deduction_keys, []);
  assert.match(ch[0].notes ?? '', /Section 192/);
  assert.equal(isPayrollChallan(ch[0]), true);
});

test('Tally: payroll journal (employee ledgers, TDS 192) and payments, balanced', () => {
  const e = saveEmployee(input({ esi: false, pt: false }));
  saveStructure({ employee_id: e.id, effective_from: '2025-04-01', lines: [{ pay_head_id: 'ph_basic', amount: 100000 }] });
  const run = finalizeRun(autoFillRun('2025-04').run.id);
  recordPayrollPayment({ kind: 'salary', date: '2025-05-01', amount: run.lines[0].net, paid_from: 'bank', run_id: run.id });
  const ledgers: { name: string; parent: string }[] = [];
  const vs = payrollTallyVouchers({ payrollRuns: getTable('payroll_runs'), payrollPayments: getTable('payroll_payments') }, {
    range: {}, salesLedger: 'Sales', purchaseLedger: 'Purchases', bankLedger: 'Bank Account', cashLedger: 'Cash', roundOffLedger: 'Round Off', otherChargesLedger: 'Freight', outputCgst: 'Output CGST', outputSgst: 'Output SGST', outputIgst: 'Output IGST', outputGst: 'Output GST', outputCess: 'Output Cess', tcsLedger: 'TCS Payable', tdsLedger: 'TDS Receivable', inputCgst: 'Input CGST', inputSgst: 'Input SGST', inputIgst: 'Input IGST', rcmPayableLedger: 'RCM', customsIgstLedger: 'Customs',
  }, (d) => ledgers.push(d));
  assert.equal(vs.length, 2);
  for (const v of vs) assert.equal(v.entries.reduce((s, x) => s + (x.side === 'Cr' ? x.paise : -x.paise), 0), 0, v.type);
  const j = vs.find((v) => v.type === 'Journal')!;
  assert.ok(j.entries.some((x) => x.ledger === 'Ravi Kumar (E001)' && x.side === 'Cr'));
  if (run.lines[0].tds > 0) assert.ok(j.entries.some((x) => x.ledger === 'TDS Payable 192'));
  const p = vs.find((v) => v.type === 'Payment')!;
  assert.ok(p.entries.some((x) => x.ledger === 'Ravi Kumar (E001)' && x.side === 'Dr'));
  assert.ok(ledgers.some((l) => l.name === 'Ravi Kumar (E001)' && l.parent === 'Current Liabilities'));
});

test('provision journal: Dr Gratuity | Cr Provisions through saveVoucher', () => {
  const v = postProvisionJournal('gratuity', '2026-03-31', 150000);
  assert.equal(v.type, 'JOURNAL');
  const bal = closingBalances(buildLedger(loadLedgerInput()), '2026-03-31');
  assert.equal(bal.get(A.gratuity), toP(150000));
  assert.equal(bal.get(A.provisions), -toP(150000));
});

test('7P tables: backed up, validated, owner-only', () => {
  const e = saveEmployee(input());
  saveStructure({ employee_id: e.id, effective_from: '2025-04-01', lines: [{ pay_head_id: 'ph_basic', amount: 12000 }] });
  saveLoan({ employee_id: e.id, kind: 'loan', date: '2025-04-10', amount: 6000, interest_rate: 0, emi: 1000, start_month: '2025-05', paid_from: 'bank' });
  saveLeaveType({ code: 'CL', name: 'Casual', paid: true, accrual: 1, encashable: false });
  addAdjustment({ employee_id: e.id, month: '2025-05', kind: 'earning', tag: 'reimb', head: 'telephone', name: 'Phone', amount: 800 });
  const data = collectAppData();
  for (const t of ['employee_loans', 'leave_types', 'payroll_adjustments']) assert.ok(data[`mrchartist_inv_${t}`], t);
  validateBackupData(data);
  as('clerk');
  for (const t of ['payroll_arrears', 'employee_loans', 'leave_types', 'leave_entries', 'payroll_adjustments', 'perquisites', 'fnf_settlements']) {
    assert.throws(() => setTable(t, [{ id: 'x' }]), /cannot/, t);
  }
  assert.throws(() => saveLeaveType({ code: 'SL', name: 'Sick', paid: true, accrual: 1, encashable: false }), /cannot/);
});

test('reimbursement in the run: not PF / ESI wages, exempt part out of taxable salary', () => {
  const e = saveEmployee(input({ pt: false }));
  saveStructure({ employee_id: e.id, effective_from: '2025-04-01', lines: [{ pay_head_id: 'ph_basic', amount: 12000 }] });
  addAdjustment({ employee_id: e.id, month: '2025-05', kind: 'earning', tag: 'reimb', head: 'telephone', name: 'Phone bill', amount: 800 });
  addAdjustment({ employee_id: e.id, month: '2025-05', kind: 'earning', tag: 'bonus', name: 'Festival bonus', amount: 2000 });
  const l = autoFillRun('2025-05').run.lines[0];
  assert.equal(l.gross, 14800);
  assert.equal(l.pf_ee, 1440, 'PF on Basic only');
  assert.equal(l.esi_ee, 90, 'ESI on 12,000 (reimbursement / bonus excluded)');
  assert.equal(l.taxable_gross, 14000, 'phone reimbursement exempt; bonus taxable');
});
