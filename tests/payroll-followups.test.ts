/**
 * Payroll follow-ups (7T): EPFO arrear ECR, relief u/s 89 (Form 10E) feeding TDS, Rule 3 perquisite
 * valuation, s. 17(2)(vii), ESI low daily-wage exemption, TDS 201(1A), PT on arrears (option),
 * actuarial valuation journal, per-user payroll grant, tables / backup / roles.
 */
import './helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { computePayslip, DEFAULT_PAY_HEADS } from '../src/lib/payroll/compute.ts';
import { autoFillRun, finalizeRun, loadEmployees, saveEmployee, saveStructure, type EmployeeInput } from '../src/lib/payroll/store.ts';
import { loadArrears, saveArrears } from '../src/lib/payroll/depth-store.ts';
import {
  accommodationPerquisite,
  actuarialCheck,
  actuarialJournal,
  arrearEcrLines,
  arrearEcrText,
  carPerquisite,
  giftPerquisite,
  mealsPerquisite,
  monthsOrPart,
  relief89,
  relief89Suggest,
  tds201Interest,
  tds201Rows,
  tdsDepositDue,
} from '../src/lib/payroll/followups.ts';
import { deleteActuarial, loadActuarial, postActuarialJournal, saveActuarial, saveRelief89, savePtExtraStates, type ActuarialInput } from '../src/lib/payroll/followups-store.ts';
import { payrollGrantees, setPayrollGrant } from '../src/lib/payroll/grants.ts';
import { tdsSalaryRuleAnyYear } from '../src/lib/payroll-rules.ts';
import { A, buildLedger, closingBalances, loadLedgerInput } from '../src/lib/ledger/index.ts';
import { actorCan, can, requireAccess, setActorProvider, type Actor, type Role } from '../src/lib/access.ts';
import { writeUsers, type StoredUser } from '../src/lib/auth.ts';
import { audit } from '../src/lib/audit.ts';
import { collectAppData, getTable, setTable } from '../src/lib/storage.ts';
import { validateBackupData } from '../src/lib/backup.ts';
import type { Employee, PayHead, PayrollPayment, PayrollRun, SalaryStructure } from '../src/types/payroll.ts';

const as = (role: Role | null, grants?: string[]) => setActorProvider(role ? () => ({ id: 'u', name: 'U', role, ...(grants ? { grants } : {}) }) : null);
beforeEach(() => resetStorage());
afterEach(() => as(null));

const heads = DEFAULT_PAY_HEADS as PayHead[];
const toP = (r: number) => Math.round(r * 100);
const emp = (over: Partial<Employee> = {}): Employee => ({ id: 'e1', code: 'E001', name: 'Asha', tax_regime: 'new', pf: false, esi: false, pt: false, active: true, created_at: '', pan: 'ABCDE1234F', ...over });
const struct = (amounts: Record<string, number>): SalaryStructure => ({
  id: 's1', employee_id: 'e1', effective_from: '2020-04-01', created_at: '', lines: Object.entries(amounts).map(([pay_head_id, amount]) => ({ pay_head_id, amount })),
});
const input = (over: Partial<EmployeeInput> = {}): EmployeeInput => ({
  code: 'E001', name: 'Ravi Kumar', tax_regime: 'new', pf: true, esi: true, pt: true, active: true, state: '27', uan: '100200300400', esi_no: '1234567890', pan: 'ABCDE1234F', doj: '2025-04-01', ...over,
});

/* ── Relief u/s 89 — Form 10E ─────────────────────────────── */

test('Form 10E: arrears of FY 2023-24 received in FY 2025-26 — tax with / without, relief', () => {
  // Year of receipt FY 2025-26 (new regime): total income ₹15 lakh incl. ₹3 lakh arrears of FY 2023-24.
  // Tax on 15 lakh = 20,000 + 40,000 + 45,000 = 1,05,000 + 4% cess = 1,09,200; on 12 lakh = nil (87A).
  // FY 2023-24 (new regime): income ₹8 lakh → 35,000 + cess = 36,400; with arrears ₹11 lakh → 75,000 + cess = 78,000.
  const r = relief89({ fy: 2025, regime: 'new', income_with: 1500000, years: [{ fy: 2023, regime: 'new', income: 800000, arrears: 300000 }] });
  assert.equal(r.receipt.tax_with, 109200);
  assert.equal(r.receipt.tax_without, 0);
  assert.equal(r.difference_receipt, 109200);
  assert.equal(r.earlier[0].tax_without, 36400);
  assert.equal(r.earlier[0].tax_with, 78000);
  assert.equal(r.difference_earlier, 41600);
  assert.equal(r.relief, 67600);
  // Spreading back costs more → nil relief, never negative.
  const nil = relief89({ fy: 2025, regime: 'new', income_with: 500000, years: [{ fy: 2023, regime: 'new', income: 1500000, arrears: 100000 }] });
  assert.equal(nil.relief, 0);
  assert.ok(nil.notes.some((n) => /No relief/.test(n)));
});

test('earlier-year slabs reach back for Form 10E (FY 2019-20 old regime, cess 4%)', () => {
  const r = tdsSalaryRuleAnyYear('old', '2019-04-01');
  assert.equal(r.standard_deduction, 50000);
  assert.equal(tdsSalaryRuleAnyYear('old', '2017-04-01').cess_pct, 3);
  assert.equal(tdsSalaryRuleAnyYear('new', '2021-04-01').slabs.length, 7);
  assert.equal(tdsSalaryRuleAnyYear('new', '2025-04-01').rebate_limit, 1200000, 'current years unchanged');
});

test('relief u/s 89 saved with "allow in TDS" reduces the year projection on the next auto fill', () => {
  const e = saveEmployee(input({ pf: false, esi: false, pt: false }));
  saveStructure({ employee_id: e.id, effective_from: '2025-04-01', lines: [{ pay_head_id: 'ph_basic', amount: 150000 }] });
  const beforeLine = autoFillRun('2025-05').run.lines[0];
  const before = beforeLine.tds_working!;
  assert.ok(before.annual_tax > 0);
  const saved = saveRelief89({ employee_id: e.id, fy: 2025, regime: 'new', income_with: 1500000, years: [{ fy: 2023, regime: 'new', income: 800000, arrears: 300000 }], apply_tds: true });
  assert.equal(saved.relief, 67600);
  const after = autoFillRun('2025-05').run.lines[0];
  assert.equal(after.tds_working?.relief89, 67600);
  assert.equal(after.tds_working?.annual_tax, before.annual_tax - 67600);
  assert.ok(after.notes?.some((n) => /89\(1\)/.test(n)));
  assert.ok(after.tds < beforeLine.tds, 'the month\'s TDS falls');
  // Not allowed in TDS → no effect.
  saveRelief89({ employee_id: e.id, fy: 2025, regime: 'new', income_with: 1500000, years: [{ fy: 2023, regime: 'new', income: 800000, arrears: 300000 }], apply_tds: false });
  assert.equal(autoFillRun('2025-05').run.lines[0].tds_working?.relief89, undefined);
  assert.throws(() => saveRelief89({ employee_id: e.id, fy: 2025, regime: 'new', income_with: 100, years: [{ fy: 2025, regime: 'new', income: 1, arrears: 1 }], apply_tds: false }), /before the year of receipt/);
});

test('Form 10E suggestion: earlier-FY arrears grouped by the year they relate to', () => {
  const e = emp();
  const runs: PayrollRun[] = [
    { id: 'r', month: '2025-03', number: 'PRL/1', date: '2025-03-31', status: 'final', company: null, created_at: '', lines: [{ employee_id: 'e1', tds_working: { annual_income: 900000, annual_tax: 0, deducted_before: 0, months_left: 1 } } as never] },
  ];
  const s = relief89Suggest(e, 2025, runs, [
    { id: 'a', employee_id: 'e1', from_month: '2025-02', pay_month: '2025-05', gross: 4000, created_at: '', months: [
      { month: '2025-02', taxable: 2000 } as never, { month: '2025-03', taxable: 2000 } as never, { month: '2025-04', taxable: 2000 } as never,
    ] },
  ]);
  assert.deepEqual(s.years, [{ fy: 2024, regime: 'new', income: 900000, arrears: 4000 }]);
});

/* ── s. 17(2)(vii) ────────────────────────────────────────── */

test('s. 17(2)(vii): employer PF + NPS above ₹7.5 lakh a year is taxed as a perquisite', () => {
  const nps: PayHead = { id: 'ph_nps', name: 'Employer NPS', kind: 'employer', calc: 'percent', base_heads: ['ph_basic'], percent: 10, nps: true, order: 43, active: true, created_at: '' };
  const e = emp({ pf: true, pf_on_actual: true });
  const l = computePayslip({ month: '2025-04', employee: e, structure: struct({ ph_basic: 300000, ph_nps: 0 }), heads: [...heads, nps] })!;
  // Employer PF 12% on actual 3,00,000 = 36,000 (EPS 1,250 + EPF 34,750); NPS 30,000 → 66,000 × 12 = 7,92,000.
  assert.equal(l.eps + l.epf_er, 36000);
  assert.equal(l.nps_er, 30000);
  assert.equal(l.tds_working?.er_contrib_year, 792000);
  assert.equal(l.tds_working?.s17_vii, 42000);
  assert.ok(l.notes?.some((n) => /17\(2\)\(vii\)/.test(n)));
  // Within the limit (PF on the ceiling only) → nothing.
  const small = computePayslip({ month: '2025-04', employee: emp({ pf: true }), structure: struct({ ph_basic: 300000 }), heads })!;
  assert.equal(small.tds_working?.s17_vii, undefined);
  // The excess raises the year's income by exactly 42,000.
  const noNps = computePayslip({ month: '2025-04', employee: e, structure: struct({ ph_basic: 300000 }), heads })!;
  assert.equal(noNps.tds_working?.s17_vii, undefined, 'PF alone 4,32,000 is within the limit');
});

/* ── ESI low wage, PT on arrears ──────────────────────────── */

test('ESI: no employee share at or below the daily-wage limit; employer still pays', () => {
  const l = computePayslip({ month: '2025-04', employee: emp({ esi: true, esi_no: '1' }), structure: struct({ ph_basic: 4000 }), heads })!;
  assert.equal(l.esi_covered, true);
  assert.equal(l.esi_ee, 0, '4,000 ÷ 30 = ₹133 a day ≤ ₹176');
  assert.equal(l.esi_er, 130);
  assert.equal(l.esi_low_wage, true);
  const above = computePayslip({ month: '2025-04', employee: emp({ esi: true, esi_no: '1' }), structure: struct({ ph_basic: 12000 }), heads })!;
  assert.equal(above.esi_ee, 90);
  assert.equal(above.esi_low_wage, undefined);
});

test('PT on arrears / one-off items only when the state rule is chosen', () => {
  const e = emp({ pt: true, state: '27', gender: 'M' });
  const extras = { items: [{ key: 'adj:b', name: 'Bonus', kind: 'earning' as const, amount: 2000, account_id: A.bonus, tag: 'bonus' as const }] };
  const off = computePayslip({ month: '2025-05', employee: e, structure: struct({ ph_basic: 9000 }), heads, extras })!;
  assert.equal(off.pt, 175, 'regular gross 9,000');
  const on = computePayslip({ month: '2025-05', employee: e, structure: struct({ ph_basic: 9000 }), heads, extras, ptOnExtras: true })!;
  assert.equal(on.pt, 200, '9,000 + 2,000 bonus');
  // Reimbursements never count.
  const reimb = computePayslip({ month: '2025-05', employee: e, structure: struct({ ph_basic: 9000 }), heads, ptOnExtras: true, extras: { items: [{ ...extras.items[0], tag: 'reimb' as const }] } })!;
  assert.equal(reimb.pt, 175);
});

test('PT option is stored per state and reaches the run', () => {
  const e = saveEmployee(input({ pf: false, esi: false }));
  saveStructure({ employee_id: e.id, effective_from: '2025-03-01', lines: [{ pay_head_id: 'ph_basic', amount: 9000 }] });
  finalizeRun(autoFillRun('2025-04').run.id);
  saveStructure({ employee_id: e.id, effective_from: '2025-04-01', lines: [{ pay_head_id: 'ph_basic', amount: 11000 }] });
  saveArrears({ employee_id: e.id, from_month: '2025-04', pay_month: '2025-05' });
  saveStructure({ employee_id: e.id, effective_from: '2025-05-01', lines: [{ pay_head_id: 'ph_basic', amount: 9500 }] });
  assert.equal(autoFillRun('2025-05').run.lines[0].pt, 175);
  savePtExtraStates(['27', '99']);
  assert.equal(autoFillRun('2025-05').run.lines[0].pt, 200, '9,500 + 2,000 arrears');
});

/* ── EPFO arrear ECR ──────────────────────────────────────── */

test('arrear ECR: arrear wages and PF shares per UAN, 8 fields', () => {
  const e = saveEmployee(input());
  saveStructure({ employee_id: e.id, effective_from: '2025-03-01', lines: [{ pay_head_id: 'ph_basic', amount: 12000 }, { pay_head_id: 'ph_hra', amount: 4000 }] });
  for (const m of ['2025-04', '2025-05']) finalizeRun(autoFillRun(m).run.id);
  saveStructure({ employee_id: e.id, effective_from: '2025-04-01', lines: [{ pay_head_id: 'ph_basic', amount: 14000 }, { pay_head_id: 'ph_hra', amount: 4000 }] });
  const rec = saveArrears({ employee_id: e.id, from_month: '2025-04', pay_month: '2025-06' });
  assert.equal(rec.months[0].eps_wages, 2000);
  const lines = arrearEcrLines(loadArrears(), loadEmployees(), '2025-06');
  assert.equal(lines.length, 1);
  assert.equal(lines[0].epf_wages, 4000);
  assert.equal(lines[0].ee, 480);
  assert.equal(lines[0].eps, 332, 'EPS (1,166 − 1,000) × 2');
  const txt = arrearEcrText(lines);
  assert.equal(txt.split('#~#').length, 8);
  assert.match(txt, /^100200300400#~#RAVI KUMAR#~#4000#~#4000#~#4000#~#480#~#332#~#148$/);
  assert.equal(arrearEcrLines(loadArrears(), loadEmployees(), '2025-07').length, 0);
});

/* ── Rule 3 perquisites ───────────────────────────────────── */

test('Rule 3 valuation: car by cc and use, accommodation by population, meals ₹50, gifts ₹5,000', () => {
  assert.equal(carPerquisite({ date: '2024-06-30', cc: 1500, use: 'mixed', running_by: 'employer', chauffeur: true }).monthly, 2700);
  assert.equal(carPerquisite({ date: '2024-06-30', cc: 2000, use: 'mixed', running_by: 'employee', chauffeur: false }).monthly, 900);
  assert.equal(carPerquisite({ date: '2024-06-30', cc: 2000, use: 'official', running_by: 'employer', chauffeur: true }).monthly, 0);
  assert.equal(carPerquisite({ date: '2024-06-30', cc: 2000, use: 'private', running_by: 'employer', chauffeur: false, private_cost: 20000, recovered: 5000 }).monthly, 15000);
  const v2025 = carPerquisite({ date: '2025-06-30', cc: 1500, use: 'mixed', running_by: 'employer', chauffeur: true });
  assert.equal(v2025.monthly, 11000);
  assert.match(v2025.source, /UNVERIFIED/);
  const acc = accommodationPerquisite({ date: '2024-06-30', salary: 100000, ownership: 'owned', population: 5000000, furniture_cost: 120000, recovered: 2000 });
  assert.equal(acc.monthly, 9000, '10% of 1,00,000 + 1,000 furniture − 2,000');
  assert.equal(accommodationPerquisite({ date: '2023-06-30', salary: 100000, ownership: 'owned', population: 5000000 }).monthly, 15000, 'before Sep 2023: 15%');
  assert.equal(accommodationPerquisite({ date: '2024-06-30', salary: 100000, ownership: 'owned', population: 2000000 }).monthly, 7500);
  assert.equal(accommodationPerquisite({ date: '2024-06-30', salary: 100000, ownership: 'leased', population: 0, rent: 20000 }).monthly, 15000, 'lower of rent and 15%');
  assert.equal(mealsPerquisite({ date: '2024-06-30', meals: 22, cost_per_meal: 120 }).monthly, 1540);
  assert.equal(mealsPerquisite({ date: '2024-06-30', meals: 22, cost_per_meal: 45 }).monthly, 0);
  assert.equal(giftPerquisite({ date: '2024-06-30', value: 1500, earlier_this_year: 3000 }).monthly, 0);
  assert.equal(giftPerquisite({ date: '2024-06-30', value: 2500, earlier_this_year: 3000 }).monthly, 5500);
  assert.equal(giftPerquisite({ date: '2024-06-30', value: 1000, earlier_this_year: 6000 }).monthly, 1000);
});

/* ── TDS 201(1A) ──────────────────────────────────────────── */

test('201(1A): 1.5% a month or part from deduction to deposit when late; March due 30 April', () => {
  assert.equal(tdsDepositDue('2025-04-30'), '2025-05-07');
  assert.equal(tdsDepositDue('2026-03-31'), '2026-04-30');
  assert.equal(monthsOrPart('2025-04-30', '2025-06-10'), 3);
  const late = tds201Interest({ amount: 10050, deductedOn: '2025-04-30', paidOn: '2025-06-10' });
  assert.equal(late.deposit_months, 3);
  assert.equal(late.deposit_interest, 450, '10,000 (rounded down to ₹100) × 1.5% × 3');
  assert.equal(tds201Interest({ amount: 10050, deductedOn: '2025-04-30', paidOn: '2025-05-07' }).deposit_interest, 0);
  assert.equal(tds201Interest({ amount: 10000, deductedOn: '2025-06-30', paidOn: '2025-07-31', deductibleOn: '2025-04-30' }).deduction_interest, 300, '1% × 3 months');
  const run = { id: 'r', month: '2025-04', number: 'PRL', date: '2025-04-30', status: 'final', company: null, created_at: '', lines: [{ tds: 10000 }] } as unknown as PayrollRun;
  const pays = [{ id: 'p', kind: 'tds', number: 'PYP', date: '2025-06-10', amount: 10000, paid_from: 'bank', period: '2025-04', created_at: '' }] as PayrollPayment[];
  const rows = tds201Rows([run], pays, 2025, '2026-03-31');
  assert.equal(rows[1][7], 450);
});

/* ── Actuarial valuation ──────────────────────────────────── */

const val = (over: Partial<ActuarialInput> = {}): ActuarialInput => ({
  kind: 'gratuity', standard: 'as15', date: '2026-03-31', actuary: 'K. Iyer, FIAI', opening: 500000, current_service_cost: 80000, interest_cost: 35000, past_service_cost: 0, benefits_paid: 60000, actuarial_loss: 15000, closing: 570000, book_balance: 500000, ...over,
});

test('actuarial valuation (AS-15): roll-forward checked, provision journal from the actuary\'s figures', () => {
  assert.equal(actuarialCheck(val()).ok, true);
  assert.equal(actuarialCheck(val({ closing: 600000 })).difference, 30000);
  const v = saveActuarial(val());
  assert.match(v.number, /^ACT\/FY25-26\/0001$/);
  const j = postActuarialJournal(v.id);
  assert.equal(j.type, 'JOURNAL');
  const bal = closingBalances(buildLedger(loadLedgerInput()), '2026-03-31');
  assert.equal(bal.get(A.gratuity), toP(70000), 'closing 5,70,000 − book 5,00,000 (benefits paid already expensed)');
  assert.equal(bal.get(A.provisions), -toP(70000));
  assert.throws(() => postActuarialJournal(v.id), /Already posted/);
  assert.throws(() => deleteActuarial(v.id), /posted/);
  assert.throws(() => saveActuarial({ ...val(), id: v.id }), /posted/);
  assert.equal(loadActuarial()[0].voucher_number, j.number);
});

test('actuarial valuation (Ind AS 19): gratuity remeasurement to OCI, leave stays in P&L; mismatch refused', () => {
  const g = actuarialJournal({ kind: 'gratuity', standard: 'indas19', closing: 570000, book_balance: 500000, actuarial_loss: 15000 });
  assert.deepEqual(g.lines, [{ account_id: A.gratuity, amount: 55000 }, { account_id: A.reserves, amount: 15000 }, { account_id: A.provisions, amount: -70000 }]);
  const leave = actuarialJournal({ kind: 'leave', standard: 'indas19', closing: 570000, book_balance: 500000, actuarial_loss: 15000 });
  assert.equal(leave.oci, 0);
  assert.equal(leave.pnl, 70000);
  const funded = actuarialJournal({ kind: 'gratuity', standard: 'as15', closing: 570000, plan_assets: 400000, book_balance: 200000, actuarial_loss: 0 });
  assert.equal(funded.movement, -30000, 'net liability 1,70,000 below the book 2,00,000 → release');
  const bad = saveActuarial(val({ closing: 600000 }));
  assert.throws(() => postActuarialJournal(bad.id), /do not add up/);
  assert.throws(() => saveActuarial(val({ actuary: '' })), /actuary/);
});

/* ── Per-user payroll grant ───────────────────────────────── */

const fakeUser = (id: string, role: 'clerk' | 'viewer'): StoredUser => ({ id, name: `User ${id}`, role, createdAt: '', v: 2, kdf: 'PBKDF2-SHA256', iter: 1, salt: 'c2FsdA==', hash: 'aGFzaA==' } as StoredUser);

test('payroll grant: owner grants payroll.view to a named clerk; only grantable actions count; audited', () => {
  const clerk: Actor = { id: 'c1', name: 'C', role: 'clerk', grants: ['payroll.view', 'settings.manage'] };
  assert.equal(actorCan(clerk, 'clerk', 'payroll.view'), true);
  assert.equal(actorCan(clerk, 'clerk', 'settings.manage'), false, 'non-grantable actions are ignored');
  assert.equal(actorCan({ ...clerk, grants: [] }, 'clerk', 'payroll.view'), false);
  assert.equal(actorCan(null, 'viewer', 'payroll.view'), false);

  writeUsers([fakeUser('c1', 'clerk'), fakeUser('v1', 'viewer')]);
  assert.deepEqual(payrollGrantees().map((u) => u.granted), [false, false]);
  setPayrollGrant('c1', true);
  assert.deepEqual(payrollGrantees().map((u) => u.granted), [true, false]);
  assert.ok(audit.all().some((r) => /Payroll access granted to User c1/.test(r.summary)));
  setPayrollGrant('c1', false);
  assert.ok(audit.all().some((r) => /Payroll access withdrawn from User c1/.test(r.summary)));
  assert.equal(payrollGrantees()[0].granted, false);

  as('clerk');
  assert.throws(() => setPayrollGrant('v1', true), /cannot/);
  assert.equal(can('payroll.view'), false, 'owner-only by default');
  assert.throws(() => setTable('payroll_runs', []), /cannot/);
  as('clerk', ['payroll.view']);
  assert.equal(can('payroll.view'), true);
  requireAccess('payroll.view');
  setTable('payroll_runs', []);
  as('viewer', ['payroll.view']);
  assert.equal(can('payroll.view'), true);
  assert.throws(() => saveEmployee(input()), /cannot/, 'a viewer with the grant still cannot write (books.edit)');
});

/* ── Tables ───────────────────────────────────────────────── */

test('7T tables: backed up, validated, owner-only', () => {
  const e = saveEmployee(input());
  saveRelief89({ employee_id: e.id, fy: 2025, regime: 'new', income_with: 1500000, years: [{ fy: 2023, regime: 'new', income: 800000, arrears: 300000 }], apply_tds: false });
  saveActuarial(val());
  const data = collectAppData();
  for (const t of ['payroll_relief89', 'actuarial_valuations']) assert.ok(data[`mrchartist_inv_${t}`], t);
  validateBackupData(data);
  assert.equal(getTable<{ number: string }>('actuarial_valuations')[0].number, 'ACT/FY25-26/0001');
  as('clerk');
  for (const t of ['payroll_relief89', 'actuarial_valuations']) assert.throws(() => setTable(t, [{ id: 'x' }]), /cannot/, t);
  assert.throws(() => saveActuarial(val()), /cannot/);
});
