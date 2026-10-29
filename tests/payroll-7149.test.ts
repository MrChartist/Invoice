/**
 * 7.149 payroll follow-ups: Form 16 / 24Q perquisite lines with the 17(2)(vii) excess, the statement of
 * perquisites (Form 12BA working), 17(2)(viia) accretion (Rule 3B), 201(1A) late deduction, hotel
 * accommodation (Rule 3(1)) and arrear ECR checks.
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { autoFillRun, finalizeRun, loadRuns, saveEmployee, saveStructure, setRunOverride, type EmployeeInput } from '../src/lib/payroll/store.ts';
import { normalizePerquisites } from '../src/lib/payroll/depth-records.ts';
import {
  arrearEcrChecks,
  hotelPerquisite,
  perqStatementRows,
  rule3bAccretion,
  rule3bSuggest,
  tds201Rows,
  tdsLateDeductions,
  type ArrearEcrLine,
} from '../src/lib/payroll/followups.ts';
import { annualSalary, form16PartBRows, form24QAnnexure2Rows } from '../src/lib/payroll/reports.ts';
import { HOTEL_PERQ_RULES, S17_2_VIIA_RULES } from '../src/lib/payroll-rules.ts';
import { formText } from '../src/lib/ita2025.ts';
import type { Employee, PayrollRun, Perquisite } from '../src/types/payroll.ts';

beforeEach(() => resetStorage());

const emp: Employee = { id: 'e1', code: 'E001', name: 'Asha', tax_regime: 'new', pf: true, esi: false, pt: false, active: true, created_at: '', pan: 'ABCDE1234F' };
const months = ['04', '05', '06', '07', '08', '09', '10', '11', '12', '01', '02', '03'].map((m) => `${m <= '03' ? 2026 : 2025}-${m}`);
const perq = (over: Partial<Perquisite>): Perquisite => ({ id: 'p', employee_id: 'e1', kind: 'other', description: '', from_month: '2025-04', monthly_value: 0, created_at: '', ...over });
const perqs = [perq({ id: 'acc', kind: 'accommodation', monthly_value: 3000, to_month: '2026-03' }), perq({ id: 'ac', kind: 'accretion', from_month: '2026-03', to_month: '2026-03', monthly_value: 1500 })];
// Each month: salary 3,25,000 + perquisites (accommodation 3,000 + loan 2,000; March + accretion 1,500); employer PF 36,000 + NPS 30,000.
const runs: PayrollRun[] = months.map((m) => {
  const p = m === '2026-03' ? 6500 : 5000;
  return {
    id: m, month: m, number: m, date: `${m}-28`, status: 'final', company: null, created_at: '',
    lines: [{ employee_id: 'e1', code: 'E001', name: 'Asha', taxable_gross: 325000 + p, perquisites: p, pt: 0, pf_ee: 36000, tds: 0, pf_wages: 300000, eps: 1250, epf_er: 34750, nps_er: 30000 } as never],
  };
});

test('Form 16 Part B 1(b) and 24Q Annexure II carry perquisites + the 17(2)(vii) excess, which joins the year\'s income', () => {
  const a = annualSalary(runs, emp, 2025)!;
  assert.equal(a.s17_vii, 42000, '66,000 × 12 − 7,50,000');
  assert.equal(a.perquisites, 60000 + 1500 + 42000);
  assert.equal(a.income.gross, 12 * 325000 + 61500 + 42000, 'the excess is in gross salary');
  const f16 = form16PartBRows(runs, emp, 2025);
  const row = (re: RegExp) => f16.find((r) => re.test(String(r[0])))?.[1];
  assert.equal(row(/^1\(a\)/), 12 * 325000);
  assert.equal(row(/^1\(b\) Value of perquisites u\/s 17\(2\) \(as per Form 12BA\)/), 103500);
  const ann = form24QAnnexure2Rows(runs, [emp], 2025);
  assert.equal(ann[0][7], 'Value of perquisites s. 17(2)');
  assert.equal(ann[1][6], 12 * 325000);
  assert.equal(ann[1][7], 103500);
});

test('statement of perquisites groups by nature and totals to Form 16 1(b)', () => {
  const rows = perqStatementRows(runs, perqs, emp, 2025);
  const v = (label: RegExp) => rows.find((r) => label.test(String(r[0])))?.[1];
  assert.equal(v(/^Accommodation/), 36000);
  assert.equal(v(/^Interest-free/), 24000, 'the rest of each payslip\'s perquisites is the loan perquisite');
  assert.equal(v(/17\(2\)\(vii\)$/), 42000);
  assert.equal(v(/17\(2\)\(viia\)$/), 1500);
  assert.equal(v(/^Total value/), 103500);
  assert.match(String(rows[0][0]), /Form 12BA working/);
  assert.match(formText('12BA', '2026-04-01'), /Form 123 \[old 12BA\]/);
});

test('Rule 3B accretion: TP = (PC/2 + PC1 + TP1) × I / Favg; PC1 + TP1 capped at the opening balance', () => {
  const t = rule3bAccretion({ date: '2026-03-31', pc: 100000, pc1: 200000, tp1: 10000, income: 80000, opening: 900000, closing: 1100000 });
  assert.equal(t.favg, 1000000);
  assert.equal(t.monthly, 20800, '50,000 × 8% + 2,10,000 × 8%');
  assert.equal(rule3bAccretion({ date: '2026-03-31', pc: 100000, pc1: 200000, tp1: 10000, income: 80000, opening: 100000, closing: 1900000 }).monthly, 12000, 'PC1 + TP1 above the opening balance ignored');
  assert.equal(rule3bAccretion({ date: '2026-03-31', pc: 100000, pc1: 0, tp1: 0, income: 0, opening: 0, closing: 0 }).monthly, 0);
  assert.match(t.source, /Income-tax Rules 1962, Rule 3B/);
  assert.match(rule3bAccretion({ date: '2027-03-31', pc: 1, pc1: 0, tp1: 0, income: 1, opening: 1, closing: 1 }).source, /Income-tax Rules 2026/);
  assert.ok(S17_2_VIIA_RULES.every((r) => r.verified === false));
  const w = (m: string, s17_vii: number): PayrollRun => ({ id: m, month: m, number: m, date: `${m}-28`, status: 'final', company: null, created_at: '', lines: [{ employee_id: 'e1', tds_working: { annual_income: 1, annual_tax: 0, deducted_before: 0, months_left: 1, s17_vii } } as never] });
  const s = rule3bSuggest('e1', 2025, [w('2020-03', 9999), w('2024-06', 30000), w('2025-03', 40000), w('2026-01', 42000)], [perq({ kind: 'accretion', from_month: '2025-03', monthly_value: 2500 }), perq({ kind: 'accretion', from_month: '2025-06', monthly_value: 700 })]);
  assert.deepEqual(s, { pc: 42000, pc1: 40000, tp1: 2500 }, 'FY 2019-20 before the rule; FY 2024-25 latest month wins; this year\'s accretion not in TP1');
  assert.equal(normalizePerquisites([{ id: 'x', employee_id: 'e1', kind: 'accretion', from_month: '2026-03', monthly_value: 10 }])[0].kind, 'accretion');
});

const input = (over: Partial<EmployeeInput> = {}): EmployeeInput => ({ code: 'E001', name: 'Ravi', tax_regime: 'new', pf: false, esi: false, pt: false, active: true, pan: 'ABCDE1234F', doj: '2025-04-01', ...over });

test('201(1A) late deduction: TDS typed below the projection is short until later months make it good', () => {
  const e = saveEmployee(input());
  saveStructure({ employee_id: e.id, effective_from: '2025-04-01', lines: [{ pay_head_id: 'ph_basic', amount: 200000 }] });
  const april = autoFillRun('2025-04').run;
  const due = april.lines[0].tds;
  assert.ok(due > 1000);
  setRunOverride(april.id, e.id, 'ph_tds', 0);
  finalizeRun(april.id);
  for (const m of months.slice(1)) finalizeRun(autoFillRun(m).run.id);
  const late = tdsLateDeductions(loadRuns(), 2025, '2026-06-30');
  assert.ok(late.length > 0 && late.every((x) => x.month === '2025-04' && x.made_good_on), 'all made good by March');
  assert.ok(Math.abs(late.reduce((s, x) => s + x.amount, 0) - due) <= 2, 'the whole April shortfall');
  assert.equal(late[0].made_good_on, '2025-05-31');
  assert.equal(late[0].months, 2, 'April 30 → May 31: two months or part');
  assert.equal(late[late.length - 1].made_good_on, '2026-03-31');
  assert.ok(late.reduce((s, x) => s + x.interest, 0) > 0);
  const rows = tds201Rows(loadRuns(), [], 2025, '2026-06-30');
  assert.ok(rows.some((r) => r[0] === 'Late deduction (1% a month or part)'));
  // Not typed over → nothing.
  resetStorage();
  const f = saveEmployee(input());
  saveStructure({ employee_id: f.id, effective_from: '2025-04-01', lines: [{ pay_head_id: 'ph_basic', amount: 200000 }] });
  for (const m of months.slice(0, 4)) finalizeRun(autoFillRun(m).run.id);
  assert.deepEqual(tdsLateDeductions(loadRuns(), 2025, '2026-06-30'), []);
});

test('201(1A) late deduction never made good runs to today', () => {
  const e = saveEmployee(input());
  saveStructure({ employee_id: e.id, effective_from: '2025-04-01', lines: [{ pay_head_id: 'ph_basic', amount: 200000 }] });
  const april = autoFillRun('2025-04').run;
  const due = april.lines[0].tds;
  finalizeRun(setRunOverride(april.id, e.id, 'ph_tds', 0).id);
  const late = tdsLateDeductions(loadRuns(), 2025, '2025-07-15');
  assert.equal(late.length, 1);
  assert.equal(late[0].made_good_on, '');
  assert.equal(late[0].amount, due);
  assert.equal(late[0].months, 4, 'April → July');
  assert.equal(late[0].interest, Math.round((Math.floor(due / 100) * 100 * 4) / 100));
});

test('hotel accommodation: lower of 24% of salary and charges; nil on transfer within 15 days', () => {
  assert.equal(hotelPerquisite({ date: '2025-06-30', salary: 100000, charges: 30000, days: 20, on_transfer: true }).monthly, 24000);
  assert.equal(hotelPerquisite({ date: '2025-06-30', salary: 100000, charges: 18000, days: 20, on_transfer: false, recovered: 3000 }).monthly, 15000);
  assert.equal(hotelPerquisite({ date: '2025-06-30', salary: 100000, charges: 30000, days: 15, on_transfer: true }).monthly, 0);
  assert.equal(hotelPerquisite({ date: '2025-06-30', salary: 100000, charges: 30000, days: 10, on_transfer: false }).monthly, 24000);
  assert.ok(HOTEL_PERQ_RULES.every((r) => r.verified === false));
});

test('arrear ECR checks: UAN, duplicates, shares against the PF rates', () => {
  const ok: ArrearEcrLine = { employee_id: 'e1', uan: '100200300400', name: 'RAVI', months: ['2025-04', '2025-05'], epf_wages: 4000, eps_wages: 4000, edli_wages: 4000, ee: 480, eps: 332, er: 148 };
  assert.deepEqual(arrearEcrChecks([ok], '2025-06'), []);
  const bad = arrearEcrChecks([ok, { ...ok, employee_id: 'e2' }, { ...ok, employee_id: 'e3', uan: '123', ee: 400, eps_wages: 5000 }], '2025-06');
  assert.ok(bad.some((c) => /appears twice/.test(c)));
  assert.ok(bad.some((c) => /12 digits/.test(c)));
  assert.ok(bad.some((c) => /EE share 400/.test(c)));
  assert.ok(bad.some((c) => /exceed EPF wages/.test(c)));
});
