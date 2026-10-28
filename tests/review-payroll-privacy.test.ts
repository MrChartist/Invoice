/**
 * Review findings 2026-10 (payroll privacy and atomic saves): H1 (payroll rows in the activity log),
 * M1 (loan edit on a locked date), L1 (payroll table writes need books.edit too), L8 (payroll rows
 * in /tds and the Books cash book are aggregated for roles without payroll.view).
 */
import './helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { setActorProvider, requireTableWrite, type Role } from '../src/lib/access.ts';
import { audit } from '../src/lib/audit.ts';
import { auditToCsv, filterAudit, visibleAudit } from '../src/lib/audit-query.ts';
import { finalizeRun, autoFillRun, loadPayrollPayments, recordPayrollPayment, saveEmployee, saveStructure, type EmployeeInput } from '../src/lib/payroll/store.ts';
import { addAdjustment, loadLoans, saveLoan } from '../src/lib/payroll/depth-store.ts';
import { payrollBooksVouchers } from '../src/lib/payroll/books-link.ts';
import { payrollTdsChallans } from '../src/lib/payroll/tds-link.ts';
import { getTable, setJson, SINGLETON_KEYS } from '../src/lib/storage.ts';
import type { AuditEntry } from '../src/types/audit.ts';

const as = (role: Role | null, grants?: string[]) => setActorProvider(role ? () => ({ id: 'u', name: 'U', role, ...(grants ? { grants } : {}) }) : null);
beforeEach(() => resetStorage());
afterEach(() => as(null));

const input = (over: Partial<EmployeeInput> = {}): EmployeeInput => ({
  code: 'E001', name: 'Ravi Kumar', tax_regime: 'new', pf: false, esi: false, pt: false, active: true, state: '27', pan: 'ABCDE1234F', doj: '2025-04-01', ...over,
});

function seedPayroll() {
  const e = saveEmployee(input());
  saveStructure({ employee_id: e.id, effective_from: '2025-04-01', lines: [{ pay_head_id: 'ph_basic', amount: 12000 }] });
  const loan = saveLoan({ employee_id: e.id, kind: 'loan', date: '2025-04-10', amount: 60000, interest_rate: 0, emi: 5000, start_month: '2025-05', paid_from: 'bank' });
  addAdjustment({ employee_id: e.id, month: '2025-05', kind: 'earning', tag: 'bonus', name: 'Festival bonus', amount: 2000 });
  return { e, loan };
}

/* ── H1 ─────────────────────────────────────────────────────────── */

test('H1: a viewer / clerk never sees payroll or employee rows in the activity log, its CSV or an edit log', () => {
  const { loan } = seedPayroll();
  audit.record({ entity: 'invoice', entity_id: 'i1', action: 'create', summary: 'Created INV/1' });
  const all = audit.all();
  assert.ok(all.some((r) => r.entity === 'payroll'));
  assert.ok(all.some((r) => r.entity === 'employee'));

  for (const role of ['viewer', 'clerk'] as const) {
    as(role);
    const rows = filterAudit(all, {});
    assert.ok(rows.length > 0, 'other rows still show');
    assert.ok(!rows.some((r) => r.entity === 'payroll' || r.entity === 'employee'), role);
    assert.equal(filterAudit(all, { entity: 'payroll' }).length, 0);
    const csv = auditToCsv(all);
    assert.ok(!/Ravi Kumar|LOAN\//.test(csv), `${role}: CSV has no payroll rows`);
    assert.deepEqual(visibleAudit(audit.forRecord(loan.id)), [], `${role}: a loan's edit log is empty`);
  }
  as('clerk', ['payroll.view']);
  assert.ok(filterAudit(all, {}).some((r) => r.entity === 'payroll'), 'a clerk granted payroll.view sees them');
  as('owner');
  assert.ok(auditToCsv(all).includes('LOAN/'), 'the owner still exports them');
});

test('H1: payroll audit summaries name the record but carry no individual amounts', () => {
  seedPayroll();
  const rows = audit.all().filter((r: AuditEntry) => r.entity === 'payroll' || r.entity === 'employee');
  const loanRow = rows.find((r) => r.summary.includes('LOAN/'));
  assert.ok(loanRow);
  for (const r of rows.filter((x) => /Loan|Festival bonus/.test(x.summary))) {
    assert.ok(!/₹|60,000|2,000/.test(r.summary), r.summary);
  }
  // The amounts stay in the payroll module's own records.
  assert.equal(loadLoans()[0].amount, 60000);
});

/* ── M1 ─────────────────────────────────────────────────────────── */

test('M1: a loan edit to a locked date leaves the loan, its payment and the counters as they were', () => {
  const { loan } = seedPayroll();
  const paymentsBefore = loadPayrollPayments();
  const countersBefore = JSON.stringify(getTable('series_counters'));
  lockUntil('2025-04-30');
  // the old date (10 Apr) is locked too, so the edit must be refused without touching anything
  assert.throws(() => saveLoan({ ...loan, id: loan.id, date: '2025-04-12' }));
  assert.equal(loadLoans()[0].payment_id, loan.payment_id);
  assert.deepEqual(loadPayrollPayments(), paymentsBefore);
  assert.equal(JSON.stringify(getTable('series_counters')), countersBefore);
});

test('M1: old date open, new date locked: the old payment is not deleted', () => {
  const e = saveEmployee(input());
  const loan = saveLoan({ employee_id: e.id, kind: 'loan', date: '2025-06-10', amount: 60000, interest_rate: 0, emi: 5000, start_month: '2025-07', paid_from: 'bank' });
  lockUntil('2025-04-30');
  const paymentsBefore = loadPayrollPayments();
  assert.throws(() => saveLoan({ ...loan, id: loan.id, date: '2025-04-20', start_month: '2025-07' }));
  const after = loadLoans()[0];
  assert.equal(after.payment_id, loan.payment_id);
  assert.ok(loadPayrollPayments().some((p) => p.id === after.payment_id), 'the loan still points at a live payment');
  assert.deepEqual(loadPayrollPayments(), paymentsBefore);
});

/* ── L1 ─────────────────────────────────────────────────────────── */

test('L1: a payroll table write needs books.edit as well as payroll.view', () => {
  as('viewer', ['payroll.view']);
  assert.throws(() => requireTableWrite('employee_loans'), /cannot/);
  assert.throws(() => requireTableWrite('payroll_payments'), /cannot/);
  as('clerk', ['payroll.view']);
  assert.doesNotThrow(() => requireTableWrite('employee_loans'));
  as('clerk');
  assert.throws(() => requireTableWrite('employee_loans'), /cannot/);
});

/* ── L8 ─────────────────────────────────────────────────────────── */

test('L8: Books cash book and /tds show payroll rows only with payroll.view; others get one aggregated line with the total', () => {
  const e = saveEmployee(input());
  saveStructure({ employee_id: e.id, effective_from: '2025-04-01', lines: [{ pay_head_id: 'ph_basic', amount: 12000 }] });
  saveLoan({ employee_id: e.id, kind: 'loan', date: '2025-04-10', amount: 60000, interest_rate: 0, emi: 5000, start_month: '2025-05', paid_from: 'bank' });
  saveLoan({ employee_id: e.id, kind: 'advance', date: '2025-04-10', amount: 5000, interest_rate: 0, emi: 1000, start_month: '2025-05', paid_from: 'bank' });
  finalizeRun(autoFillRun('2025-04').run.id);
  recordPayrollPayment({ kind: 'tds', date: '2025-05-07', amount: 1200, paid_from: 'bank', period: '2025-04', bsr_code: '0510001', challan_no: '12345' });
  const raw = getTable<unknown>('payroll_payments');

  as('owner');
  const full = payrollBooksVouchers(raw);
  assert.equal(full.filter((v) => v.date === '2025-04-10').length, 2);
  assert.equal(payrollTdsChallans(raw)[0].bsr_code, '0510001');

  as('viewer');
  const agg = payrollBooksVouchers(raw);
  const apr10 = agg.filter((v) => v.date === '2025-04-10');
  assert.equal(apr10.length, 1, 'one line for the day');
  assert.equal(apr10[0].debit, 65000);
  assert.match(apr10[0].party, /Payroll \(2 entries\)/);
  assert.ok(!agg.some((v) => /loan|advance/i.test(`${v.party} ${v.narration}`)));
  const sum = (vs: { debit: number }[]) => vs.reduce((s, v) => s + v.debit, 0);
  assert.equal(sum(agg), sum(full), 'the books still reconcile');
  const ch = payrollTdsChallans(raw);
  assert.equal(ch.length, 1);
  assert.equal(ch[0].amount, 1200);
  assert.equal(ch[0].bsr_code, '');
  assert.match(ch[0].notes ?? '', /Payroll \(1 entr/);
});

function lockUntil(day: string) {
  setJson(SINGLETON_KEYS.settings, { lock_until: day });
}
