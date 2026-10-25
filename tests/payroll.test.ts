/**
 * Payroll (Phase 7): statutory engines, payslip computation, ledger postings, payments, period
 * lock, roles, backup round-trip, printable escaping and outputs.
 */
import './helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { esiContribution, incomeTax, pfContribution, professionalTax, salaryIncome } from '../src/lib/payroll/statutory.ts';
import { computePayslip, DEFAULT_PAY_HEADS, daysEmployed, structureFor } from '../src/lib/payroll/compute.ts';
import {
  autoFillRun,
  deletePayrollPayment,
  finalizeRun,
  loadRuns,
  payableBalances,
  loadPayrollPayments,
  recordPayrollPayment,
  reopenRun,
  saveAttendance,
  saveEmployee,
  saveStructure,
  setRunOverride,
  type EmployeeInput,
} from '../src/lib/payroll/store.ts';
import { esiRows, form16PartBRows, form24QAnnexure2Rows, paySheetRows, payslipHtml, pfEcrText } from '../src/lib/payroll/reports.ts';
import { payrollVoucher } from '../src/lib/payroll/postings.ts';
import { tdsSalaryRule } from '../src/lib/payroll-rules.ts';
import { buildLedger, loadLedgerInput, trialBalance, voucherDiff, A, closingBalances } from '../src/lib/ledger/index.ts';
import { roleCan, setActorProvider, type Role } from '../src/lib/access.ts';
import { SINGLETON_KEYS, collectAppData, getTable, setJson, setTable } from '../src/lib/storage.ts';
import { validateBackupData } from '../src/lib/backup.ts';
import type { Employee, PayHead, SalaryStructure } from '../src/types/payroll.ts';

const as = (role: Role | null) => setActorProvider(role ? () => ({ id: 'u', name: 'U', role }) : null);

beforeEach(() => resetStorage());
afterEach(() => as(null));

/* ── PF ─────────────────────────────────────────────────────── */

test('PF: 12% employee; employer split EPS 8.33% (₹15,000 ceiling) / EPF 3.67%', () => {
  const p = pfContribution(20000, '2025-05-31');
  assert.deepEqual(
    { w: p.epf_wages, eps_w: p.eps_wages, ee: p.ee, eps: p.eps, epf: p.epf_er, edli: p.edli, admin: p.admin },
    { w: 15000, eps_w: 15000, ee: 1800, eps: 1250, epf: 550, edli: 75, admin: 75 },
  );
  const low = pfContribution(10000, '2025-05-31');
  assert.equal(low.ee, 1200);
  assert.equal(low.eps, 833);
  assert.equal(low.epf_er, 367);
  const actual = pfContribution(20000, '2025-05-31', { onActual: true });
  assert.equal(actual.ee, 2400);
  assert.equal(actual.eps, 1250, 'EPS stays on the ceiling');
  assert.equal(actual.epf_er, 1150);
  assert.equal(pfContribution(20000, '2025-05-31', { epsExcluded: true }).epf_er, 1800, 'non-EPS member: all to EPF');
  assert.equal(pfContribution(10000, '2014-08-31').epf_wages, 6500, 'old ₹6,500 ceiling before Sep 2014');
});

/* ── ESI ────────────────────────────────────────────────────── */

test('ESI: 0.75% / 3.25% up to ₹21,000, rounded up; coverage continues in the period', () => {
  assert.deepEqual(esiContribution(21000, 21000, '2025-05-31'), { covered: true, ee: 158, er: 683 });
  assert.deepEqual(esiContribution(21001, 21001, '2025-05-31'), { covered: false, ee: 0, er: 0 });
  assert.deepEqual(esiContribution(25000, 25000, '2025-05-31', true), { covered: true, ee: 188, er: 813 });
  assert.deepEqual(esiContribution(15000, 15000, '2019-06-30'), { covered: true, ee: 263, er: 713 }, '1.75% / 4.75% before July 2019');
});

/* ── Professional tax ───────────────────────────────────────── */

test('PT: state slabs incl. Maharashtra February ₹300, women, half-yearly TN, annual cap', () => {
  assert.equal(professionalTax('27', 12000, '2026-01'), 200);
  assert.equal(professionalTax('27', 12000, '2026-02'), 300);
  assert.equal(professionalTax('27', 9000, '2026-02'), 175);
  assert.equal(professionalTax('27', 7000, '2026-01'), 0);
  assert.equal(professionalTax('27', 20000, '2025-05', { gender: 'F' }), 0, 'women up to ₹25,000 exempt from Jul 2023');
  assert.equal(professionalTax('27', 20000, '2023-06', { gender: 'F' }), 200);
  assert.equal(professionalTax('27', 12000, '2026-02', { paidBefore: 2400 }), 100, '₹2,500 cap');
  assert.equal(professionalTax('29', 25000, '2026-02'), 300);
  assert.equal(professionalTax('29', 24000, '2026-01'), 0);
  assert.equal(professionalTax('19', 30000, '2025-05'), 150);
  assert.equal(professionalTax('33', 8000, '2025-04'), 930, 'TN: on half-year salary, in April / October');
  assert.equal(professionalTax('33', 8000, '2025-05'), 0);
  assert.equal(professionalTax('24', 12000, '2025-05'), 200);
  assert.equal(professionalTax('24', 11999, '2025-05'), 0);
  assert.equal(professionalTax('37', 18000, '2025-05'), 150);
  assert.equal(professionalTax('36', 25000, '2025-05'), 200);
  assert.equal(professionalTax('07', 50000, '2025-05'), 0, 'no slabs for Delhi');
});

/* ── Income tax / TDS 192 ──────────────────────────────────── */

test('income tax: FY 2025-26 new regime with 87A up to ₹12 lakh and marginal relief; old regime', () => {
  const nw = tdsSalaryRule('new', '2025-04-01');
  assert.equal(incomeTax(1200000, nw).total, 0);
  const marg = incomeTax(1210000, nw);
  assert.equal(marg.total, 10400, 'tax limited to the income above ₹12 lakh, plus cess');
  const old = tdsSalaryRule('old', '2025-04-01');
  assert.equal(incomeTax(500000, old).total, 0, '87A up to ₹5 lakh');
  assert.equal(incomeTax(1000000, old).total, 117000);
  assert.equal(salaryIncome({ gross: 1275000, pt: 2500 }, nw).total_income, 1200000, '₹75,000 standard deduction, no PT');
  const oi = salaryIncome({ gross: 1050000, pt: 2500, deductions: 150000 }, old);
  assert.equal(oi.total_income, 847500);
  assert.equal(incomeTax(oi.total_income, old).total, 85280);
  assert.equal(tdsSalaryRule('new', '2024-04-01').rebate_limit, 700000);
});

const emp = (over: Partial<Employee> = {}): Employee => ({
  id: 'e1', code: 'E001', name: 'Asha', tax_regime: 'new', pf: false, esi: false, pt: false, active: true, created_at: '', pan: 'ABCDE1234F', ...over,
});
const struct = (amounts: Record<string, number>, over: Partial<SalaryStructure> = {}): SalaryStructure => ({
  id: 's1', employee_id: 'e1', effective_from: '2025-04-01', created_at: '', lines: Object.entries(amounts).map(([pay_head_id, amount]) => ({ pay_head_id, amount })), ...over,
});
const heads = DEFAULT_PAY_HEADS as PayHead[];

test('TDS 192: monthly projection, both regimes', () => {
  const nw = computePayslip({ month: '2025-04', employee: emp(), structure: struct({ ph_basic: 150000 }), heads })!;
  assert.equal(nw.tds, 12567, 'new regime: ₹1,50,800 a year over 12 months');
  const old = computePayslip({ month: '2025-04', employee: emp({ tax_regime: 'old' }), structure: struct({ ph_basic: 150000 }), heads })!;
  assert.equal(old.tds, 29250);
  const rebate = computePayslip({ month: '2025-04', employee: emp(), structure: struct({ ph_basic: 100000 }), heads })!;
  assert.equal(rebate.tds, 0, '₹12 lakh salary: nil after the 87A rebate');
  // Later in the year: what was deducted earlier is taken off and the rest spread over the remaining months.
  const later = computePayslip({ month: '2026-03', employee: emp(), structure: struct({ ph_basic: 150000 }), heads, history: Array.from({ length: 11 }, (_, i) => ({ month: `2025-${String(i + 4).padStart(2, '0')}`, line: { ...nw } })) });
  assert.equal(later!.tds, 150800 - 12567 * 11);
});

test('LOP proration and joining mid-month', () => {
  const s = struct({ ph_basic: 30000 });
  const lop = computePayslip({ month: '2025-06', employee: emp(), structure: s, heads, attendance: { id: 'a', employee_id: 'e1', month: '2025-06', lop: 3 } })!;
  assert.equal(lop.gross, 27000);
  assert.equal(lop.payable_days, 27);
  assert.equal(daysEmployed({ doj: '2025-06-16' }, '2025-06'), 15);
  const joiner = computePayslip({ month: '2025-06', employee: emp({ doj: '2025-06-16' }), structure: s, heads })!;
  assert.equal(joiner.gross, 15000);
  assert.equal(computePayslip({ month: '2025-05', employee: emp({ doj: '2025-06-16' }), structure: s, heads }), null);
  const ot = computePayslip({ month: '2025-06', employee: emp(), structure: struct({ ph_basic: 30000, ph_ot: 200 }), heads, attendance: { id: 'a', employee_id: 'e1', month: '2025-06', lop: 0, units: { ot_hours: 10 } } })!;
  assert.equal(ot.gross, 32000, 'overtime on production units');
});

test('structures: employee’s own beats the group’s; latest effective date wins', () => {
  const e = emp({ group_id: 'g1' });
  const list = [struct({ ph_basic: 1 }, { id: 'g', employee_id: undefined, group_id: 'g1' }), struct({ ph_basic: 2 }, { id: 'a', effective_from: '2025-04-01' }), struct({ ph_basic: 3 }, { id: 'b', effective_from: '2025-07-01' })];
  assert.equal(structureFor(e, '2025-06', list)?.id, 'a');
  assert.equal(structureFor(e, '2025-07', list)?.id, 'b');
  assert.equal(structureFor({ ...e, id: 'other' }, '2025-07', list)?.id, 'g');
});

/* ── Store + ledger ────────────────────────────────────────── */

const input = (over: Partial<EmployeeInput> = {}): EmployeeInput => ({
  code: 'E001', name: 'Ravi Kumar', tax_regime: 'new', pf: true, esi: true, pt: true, active: true, state: '27', uan: '100200300400', esi_no: '1234567890', pan: 'ABCDE1234F', doj: '2025-04-01', ...over,
});

function setUp(): Employee {
  const e = saveEmployee(input());
  saveStructure({ employee_id: e.id, effective_from: '2025-04-01', lines: [{ pay_head_id: 'ph_basic', amount: 12000 }, { pay_head_id: 'ph_hra', amount: 4000 }, { pay_head_id: 'ph_special', amount: 2000 }] });
  return e;
}

test('payroll run: auto fill, finalize → balanced Payroll voucher; trial balance agrees', () => {
  setUp();
  saveAttendance('2025-06', [{ employee_id: loadRunsEmp(), lop: 0 }]);
  const { run } = autoFillRun('2025-06');
  const l = run.lines[0];
  assert.equal(l.gross, 18000);
  assert.equal(l.pf_ee, 1440, 'PF on basic 12,000');
  assert.equal(l.esi_ee, 135, 'ESI 0.75% of 18,000');
  assert.equal(l.esi_er, 585);
  assert.equal(l.pt, 200);
  assert.equal(l.net, 18000 - 1440 - 135 - 200 - l.tds);
  const final = finalizeRun(run.id);
  assert.match(final.number, /^PRL\/FY25-26\/0001$/);
  const v = payrollVoucher(final)!;
  assert.equal(voucherDiff(v), 0);
  const ledger = buildLedger(loadLedgerInput());
  assert.deepEqual(ledger.warnings, []);
  assert.ok(ledger.vouchers.some((x) => x.kind === 'Payroll'));
  const tb = trialBalance(ledger, { start: '2025-04-01', end: '2026-03-31' });
  assert.equal(tb.totals.debit, tb.totals.credit);
  assert.equal(tb.totals.closingDr, tb.totals.closingCr);
  const bal = closingBalances(ledger, '2026-03-31');
  assert.equal(bal.get(A.salaryPayable), -toP(l.net));
  assert.equal(bal.get(A.pfPayable), -toP(l.pf_ee + l.eps + l.epf_er + l.edli + l.pf_admin));
  assert.equal(bal.get(A.esiPayable), -toP(135 + 585));
  assert.equal(bal.get(A.ptPayable), -20000);
  assert.equal(bal.get(A.salaries), toP(12000));
  assert.equal(bal.get(A.allowances), toP(6000));
});

const toP = (r: number) => Math.round(r * 100);
function loadRunsEmp(): string {
  return (getTable<{ id: string }>('employees')[0]).id;
}

test('payments clear the payables in the ledger; reopen refused while paid', () => {
  setUp();
  const { run } = autoFillRun('2025-06');
  finalizeRun(run.id);
  const runs = loadRuns();
  const b = payableBalances(runs, []);
  const salary = b.find((x) => x.kind === 'salary')!.balance;
  const pf = b.find((x) => x.kind === 'pf')!.balance;
  recordPayrollPayment({ kind: 'salary', date: '2025-07-01', amount: salary, paid_from: 'bank', run_id: run.id });
  recordPayrollPayment({ kind: 'pf', date: '2025-07-10', amount: pf, paid_from: 'bank', period: '2025-06' });
  const bal = closingBalances(buildLedger(loadLedgerInput()), '2026-03-31');
  assert.equal(bal.get(A.salaryPayable) ?? 0, 0);
  assert.equal(bal.get(A.pfPayable) ?? 0, 0);
  assert.equal(bal.get(A.bank), -toP(salary + pf));
  assert.equal(payableBalances(loadRuns(), loadPayrollPayments()).find((x) => x.kind === 'salary')!.balance, 0);
  assert.throws(() => reopenRun(run.id), /paid against this run/);
  for (const p of loadPayrollPayments()) deletePayrollPayment(p.id);
  assert.equal(reopenRun(run.id).status, 'draft');
  assert.equal(buildLedger(loadLedgerInput()).vouchers.filter((x) => x.kind === 'Payroll').length, 0, 'a reopened run is out of the books');
});

test('review grid override recomputes statutory heads', () => {
  setUp();
  const { run } = autoFillRun('2025-06');
  const next = setRunOverride(run.id, run.lines[0].employee_id, 'ph_basic', 14000);
  assert.equal(next.lines[0].gross, 20000);
  assert.equal(next.lines[0].pf_ee, 1680);
  const again = autoFillRun('2025-06').run;
  assert.equal(again.lines[0].gross, 20000, 'auto fill keeps typed amounts');
});

test('period lock: cannot finalize or pay inside a locked period', () => {
  setUp();
  const { run } = autoFillRun('2025-06');
  setJson(SINGLETON_KEYS.settings, { lock_until: '2025-06-30' });
  assert.throws(() => finalizeRun(run.id), (e: Error & { code?: string }) => e.code === 'PERIOD_LOCKED');
  assert.throws(() => recordPayrollPayment({ kind: 'pt', date: '2025-06-30', amount: 200, paid_from: 'bank' }), (e: Error & { code?: string }) => e.code === 'PERIOD_LOCKED');
  setJson(SINGLETON_KEYS.settings, { lock_until: '' });
  assert.equal(finalizeRun(run.id).status, 'final');
});

test('roles: payroll is owner-only (clerks and viewers can neither run it nor write its tables)', () => {
  assert.equal(roleCan('owner', 'payroll.view'), true);
  assert.equal(roleCan('clerk', 'payroll.view'), false);
  assert.equal(roleCan('viewer', 'payroll.view'), false);
  as('clerk');
  assert.throws(() => saveEmployee(input()), /cannot view or run payroll/);
  for (const t of ['employees', 'pay_heads', 'salary_structures', 'attendance', 'payroll_runs', 'payroll_payments']) {
    assert.throws(() => setTable(t, [{ id: 'x' }]), /cannot/, t);
  }
  as('viewer');
  assert.throws(() => autoFillRun('2025-06'), /cannot/);
  as('owner');
  assert.equal(saveEmployee(input()).code, 'E001');
});

test('backup: payroll tables are validated and round-trip', () => {
  setUp();
  const { run } = autoFillRun('2025-06');
  finalizeRun(run.id);
  const data = collectAppData();
  for (const t of ['employees', 'salary_structures', 'payroll_runs']) assert.ok(data[`mrchartist_inv_${t}`], t);
  validateBackupData(data);
  resetStorage();
  for (const [k, v] of Object.entries(data)) localStorage.setItem(k, v);
  assert.equal(loadRuns()[0].status, 'final');
  assert.throws(() => validateBackupData({ ...data, mrchartist_inv_payroll_runs: JSON.stringify([{ month: '2025-06' }]) }), /payroll_runs/);
});

test('payslip HTML escapes everything; outputs carry the working-paper note', () => {
  const e = emp({ name: '<script>alert(1)</script>', designation: '"><img src=x onerror=alert(1)>', pf: true, uan: '100200300400' });
  const l = computePayslip({ month: '2025-06', employee: e, structure: struct({ ph_basic: 12000 }), heads })!;
  const html = payslipHtml({ month: '2025-06', number: 'PRL/FY25-26/0001', date: '2025-06-30', status: 'final', company: { companyName: 'A & B <Co>' } }, l);
  assert.ok(!html.includes('<script>alert'));
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('A &amp; B &lt;Co&gt;'));
  assert.ok(!/<script/i.test(html), 'script-free');
  assert.match(html, /Net pay/);
  assert.match(html, /Rupees/);
  const ecr = pfEcrText({ lines: [l] }).split('\n');
  assert.equal(ecr[0].split('#~#').length, 11);
  assert.equal(ecr[0].split('#~#')[6], '1440');
  const sheet = paySheetRows({ month: '2025-06', number: '', lines: [l] });
  assert.match(String(sheet[sheet.length - 1][0]), /verify with your CA/);
  assert.match(String(esiRows({ month: '2025-06', lines: [] }).at(-1)?.[0]), /verify with your CA/);
});

test('Form 24Q Annexure II / Form 16 Part B working from final runs', () => {
  setUp();
  for (const m of ['2025-04', '2025-05']) finalizeRun(autoFillRun(m).run.id);
  const e = saveEmployee({ ...input(), id: getTable<{ id: string }>('employees')[0].id });
  const rows = form24QAnnexure2Rows(loadRuns(), [e], 2025);
  assert.equal(rows[1][6], 36000, 'gross for two months');
  const f16 = form16PartBRows(loadRuns(), e, 2025);
  assert.ok(f16.some((r) => r[0] === '4(a) Standard deduction u/s 16(ia)' && r[1] === 36000), 'standard deduction capped at the salary');
});
