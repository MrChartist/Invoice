/**
 * Payroll depth outputs (7P): full & final settlement statement (script-free printable HTML),
 * arrears register, loan register / EMI schedule, leave balances, gratuity provision working,
 * bonus working, reimbursement register and the PF 7Q / 14B late-payment estimate.
 * Rows are plain arrays for `toCsv` / `downloadXlsx`. Every output is a WORKING PAPER — verify with your CA.
 */

import { amountInWords } from '../amount-in-words';
import { round2 } from '../invoice-calc';
import { formatCurrency, formatDate } from '../utils';
import type {
  ArrearsRecord,
  Employee,
  EmployeeLoan,
  FnfSettlement,
  LeaveEntry,
  LeaveType,
  PayHead,
  PayrollAdjustment,
  PayrollCompany,
  PayrollPayment,
  PayrollRun,
  PayslipLine,
  SalaryStructure,
} from '../../types/payroll';
import { WORKING_PAPER, escapeHtml, monthLabel } from './reports';
import {
  REIMBURSEMENT_HEADS,
  bonusWorking,
  gratuityFor,
  lastDrawn,
  leaveBalance,
  loanOutstanding,
  loanRecoveries,
  loanSchedule,
  pfLateEstimate,
  type FnfWorking,
} from './depth';

type Row = (string | number)[];

/* ── Full & final statement ───────────────────────────────────── */

const REASON: Record<FnfSettlement['reason'], string> = { resignation: 'Resignation', retirement: 'Retirement / superannuation', termination: 'Termination', death: 'Death (paid to the legal heirs)' };

/**
 * F&F statement: the final month's payslip (salary for days worked + settlement items) with the
 * working behind gratuity, leave encashment, notice pay and loans. `line` is the employee's payslip
 * in the run of `fnf.pay_month` (draft or final); without it only the working is shown.
 */
export function fnfStatementHtml(fnf: FnfSettlement, employee: Employee, w: FnfWorking, line: PayslipLine | null, run: Pick<PayrollRun, 'status' | 'number'> | null, company?: PayrollCompany | null): string {
  const m = (n: number) => escapeHtml(formatCurrency(n, 'INR'));
  const row = (k: string, v: string) => `<tr><td>${escapeHtml(k)}</td><td class="n">${v}</td></tr>`;
  const earn = line?.earnings ?? [];
  const ded = line?.deductions ?? [];
  const body: string[] = [];
  for (let i = 0; i < Math.max(earn.length, ded.length); i++) {
    const e = earn[i];
    const d = ded[i];
    body.push(`<tr><td>${e ? escapeHtml(e.name) : ''}</td><td class="n">${e ? m(e.amount) : ''}</td><td>${d ? escapeHtml(d.name) : ''}</td><td class="n">${d ? m(d.amount) : ''}</td></tr>`);
  }
  const g = w.gratuity;
  const net = line?.net ?? 0;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Full and final settlement ${escapeHtml(fnf.number)} ${escapeHtml(employee.code)}</title>
<style>
  body { font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; color: #111; margin: 0; padding: 28px; }
  .sheet { max-width: 780px; margin: 0 auto; border: 1px solid #bbb; padding: 24px 28px; }
  h1 { font-size: 18px; margin: 0 0 4px; text-transform: uppercase; letter-spacing: 0.05em; }
  h2 { font-size: 14px; margin: 18px 0 6px; }
  .muted { color: #555; font-size: 12px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 24px; font-size: 13px; margin: 12px 0; }
  .grid div span { color: #555; display: inline-block; min-width: 140px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { border: 1px solid #ccc; padding: 5px 8px; text-align: left; vertical-align: top; }
  td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; }
  tfoot td { font-weight: 700; }
  .net { margin-top: 14px; font-size: 16px; font-weight: 700; }
  .sign { margin-top: 40px; display: flex; justify-content: space-between; font-size: 12px; }
  .note { margin-top: 18px; font-size: 11px; color: #777; }
  @media print { body { padding: 0; } .sheet { border: 0; } }
</style></head>
<body><div class="sheet">
  <div class="muted">${escapeHtml(company?.companyName ?? '')}</div>
  <h1>Full &amp; final settlement</h1>
  <div class="muted">${escapeHtml(fnf.number)} · paid with payroll of ${escapeHtml(monthLabel(fnf.pay_month))}${run?.status === 'final' ? ` (${escapeHtml(run.number)})` : ' — draft, not finalized'}</div>
  <div class="grid">
    <div><span>Employee</span>${escapeHtml(`${employee.name} (${employee.code})`)}</div>
    <div><span>PAN</span>${escapeHtml(employee.pan ?? 'not available')}</div>
    <div><span>Date of joining</span>${escapeHtml(employee.doj ? formatDate(employee.doj) : '—')}</div>
    <div><span>Date of leaving</span>${escapeHtml(formatDate(w.dol))}</div>
    <div><span>Reason</span>${escapeHtml(REASON[fnf.reason])}</div>
    <div><span>Service</span>${escapeHtml(`${g.service.years} years ${g.service.months} months ${g.service.days} days`)}</div>
    <div><span>Last drawn Basic + DA</span>${m(w.basic_da)}</div>
    <div><span>Monthly gross</span>${m(w.monthly_gross)}</div>
  </div>
  <h2>Settlement</h2>
  ${line ? `<table>
    <thead><tr><th>Earnings</th><th class="n">Amount</th><th>Deductions</th><th class="n">Amount</th></tr></thead>
    <tbody>${body.join('')}</tbody>
    <tfoot><tr><td>Total earnings</td><td class="n">${m(line.gross)}</td><td>Total deductions</td><td class="n">${m(line.total_deductions)}</td></tr></tfoot>
  </table>
  <div class="net">${net >= 0 ? `Net payable to the employee: ${m(net)}` : `Recoverable from the employee: ${m(-net)}`}</div>
  <div class="muted">${escapeHtml(amountInWords(Math.abs(net), 'INR'))}</div>` : '<p class="muted">Run the payroll of the settlement month (Auto fill) to see the final figures.</p>'}
  <h2>Working</h2>
  <table><tbody>
    ${row(`Gratuity: 15/26 × ${formatCurrency(w.basic_da, 'INR')} × ${g.service.gratuity_years} years (ceiling ${formatCurrency(g.ceiling, 'INR')})`, m(g.formula))}
    ${row(`Gratuity ${g.eligible ? 'payable' : 'not payable — less than five years of service'}${g.borderline ? ' (4 years 240 days or more: ask your CA)' : ''}`, m(g.paid))}
    ${row('Gratuity exempt u/s 10(10)(ii) / taxable', `${m(g.exempt)} / ${m(round2(g.paid - g.exempt))}`)}
    ${row(`Leave encashment: ${w.leave.days} days × ${formatCurrency(w.leave.rate, 'INR')} (balance ${w.leave.balance} days)`, m(w.leave.amount))}
    ${row('Leave encashment exempt u/s 10(10AA) / taxable', `${m(w.leave.exempt)} / ${m(round2(w.leave.amount - w.leave.exempt))}`)}
    ${w.notice.mode !== 'none' ? row(`Notice pay ${w.notice.mode === 'recover' ? 'recovered' : 'paid in lieu'} (${w.notice.days} days)`, m(w.notice.amount)) : ''}
    ${w.loans.map((l) => row(`Loan ${l.number}: balance + interest recovered`, m(round2(l.outstanding + l.interest)))).join('')}
    ${line ? row('TDS u/s 192 on the final salary (balance of the year)', m(line.tds)) : ''}
  </tbody></table>
  ${fnf.note ? `<p class="muted">${escapeHtml(fnf.note)}</p>` : ''}
  <div class="sign"><span>Received in full and final settlement — employee</span><span>For ${escapeHtml(company?.companyName ?? '')} — authorised signatory</span></div>
  <div class="note">${escapeHtml(WORKING_PAPER)} Gratuity per the Payment of Gratuity Act 1972; exemptions u/s 10(10) and 10(10AA) as worked above; Form 16 for the year follows the final payroll.</div>
</div></body></html>`;
}

/* ── Registers ────────────────────────────────────────────────── */

export function arrearsRegisterRows(records: readonly ArrearsRecord[], employees: readonly Employee[]): Row[] {
  const name = new Map(employees.map((e) => [e.id, `${e.code} ${e.name}`]));
  const out: Row[] = [['Employee', 'Paid in', 'Arrear month', 'Pay heads', 'Arrear gross', 'Taxable', 'PF (employee)', 'EPS', 'EPF (employer)', 'ESI (employee)', 'ESI (employer)']];
  for (const r of records) {
    for (const m of r.months) {
      out.push([name.get(r.employee_id) ?? r.employee_id, r.pay_month, m.month, m.earnings.map((x) => `${x.name} ${x.amount}`).join('; '), m.gross, m.taxable, m.pf_ee, m.eps, m.epf_er, m.esi_ee, m.esi_er]);
    }
  }
  out.push(['PF on arrears belongs in an arrear ECR on the EPFO portal; relief u/s 89 (Form 10E) for arrears of earlier years is claimed by the employee.']);
  out.push([WORKING_PAPER]);
  return out;
}

export function loanRegisterRows(loans: readonly EmployeeLoan[], employees: readonly Employee[], runs: readonly PayrollRun[]): Row[] {
  const name = new Map(employees.map((e) => [e.id, `${e.code} ${e.name}`]));
  const out: Row[] = [['Number', 'Employee', 'Kind', 'Date', 'Amount', 'Interest % p.a.', 'EMI', 'From', 'Principal recovered', 'Interest recovered', 'Outstanding', 'Purpose']];
  for (const l of loans) {
    const rec = loanRecoveries(l, runs);
    out.push([l.number, name.get(l.employee_id) ?? '', l.kind, formatDate(l.date), l.amount, l.interest_rate, l.emi, l.start_month, round2(rec.reduce((s, r) => s + r.principal, 0)), round2(rec.reduce((s, r) => s + r.interest, 0)), loanOutstanding(l, runs), l.purpose === 'medical' ? 'Medical treatment' : 'General']);
  }
  out.push(['Interest-free / concessional loans above the small-loan limit are a perquisite u/s 17(2) (Rule 3(7)(i)) at the SBI rate — included in the TDS projection.']);
  out.push([WORKING_PAPER]);
  return out;
}

export function loanScheduleRows(loan: EmployeeLoan, runs: readonly PayrollRun[]): Row[] {
  return [
    ['Month', 'Opening', 'Interest', 'Principal', 'Instalment', 'Closing', 'Status'],
    ...loanSchedule(loan, runs).map((r) => [r.month, r.opening, r.interest, r.principal, r.emi, r.closing, r.actual ? 'Recovered' : 'Projected']),
  ];
}

export function leaveBalanceRows(employees: readonly Employee[], types: readonly LeaveType[], entries: readonly LeaveEntry[], month: string): Row[] {
  const out: Row[] = [['Employee', 'Leave', 'Opening', 'Accrued', 'Taken', 'Encashed', 'Adjusted', 'Lapsed', 'Balance']];
  for (const e of employees) {
    const mine = entries.filter((x) => x.employee_id === e.id);
    for (const t of types) {
      const b = leaveBalance(t, e, mine, month);
      if (!b.opening && !b.accrued && !b.taken && !b.encashed && !b.adjusted) continue;
      out.push([`${e.code} ${e.name}`, t.code, b.opening, b.accrued, b.taken, b.encashed, b.adjusted, b.lapsed, b.balance]);
    }
  }
  return out;
}

/** Gratuity liability as at a date for everyone on the rolls (provision working, not actuarial). */
export function gratuityProvisionRows(employees: readonly Employee[], structures: readonly SalaryStructure[], heads: readonly PayHead[], asOf: string): { rows: Row[]; total: number } {
  const out: Row[] = [['Employee', 'Date of joining', 'Service (years)', 'Years counted', 'Last drawn Basic + DA', 'Accrued gratuity', 'Eligible (5 years)']];
  let total = 0;
  for (const e of employees) {
    if (!e.doj || e.doj > asOf || (e.dol && e.dol < asOf)) continue;
    const ld = lastDrawn(e, asOf.slice(0, 7), structures, heads).basicDa;
    const g = gratuityFor({ doj: e.doj, asOf, lastDrawn: ld });
    total += g.accrued;
    out.push([`${e.code} ${e.name}`, formatDate(e.doj), `${g.service.years}y ${g.service.months}m`, g.service.gratuity_years, ld, g.accrued, g.eligible ? 'Yes' : g.borderline ? 'Borderline' : 'No']);
  }
  out.push(['Total', '', '', '', '', round2(total), '']);
  out.push(['15/26 × last drawn Basic + DA × completed years (part above six months counts), within the ceiling. An actuarial valuation (AS 15 / Ind AS 19) may be required — verify with your CA.']);
  out.push([WORKING_PAPER]);
  return { rows: out, total: round2(total) };
}

export function bonusRows(runs: readonly PayrollRun[], employees: readonly Employee[], heads: readonly PayHead[], fyStartYear: number, ratePct: number, minWage = 0): { rows: Row[]; total: number; items: ReturnType<typeof bonusWorking> } {
  const items = bonusWorking(runs, employees, heads, fyStartYear, ratePct, minWage);
  const out: Row[] = [['Employee', 'Eligible months', 'Days worked', 'Salary (Basic + DA)', 'Bonus wages (capped)', 'Bonus', 'Note']];
  for (const r of items) out.push([`${r.code} ${r.name}`, r.months, r.days_worked, r.salary, r.bonus_wages, r.bonus, r.reason ?? '']);
  const total = round2(items.reduce((s, r) => s + r.bonus, 0));
  out.push(['Total', '', '', '', '', total, '']);
  out.push([`Payment of Bonus Act 1965 at ${ratePct}% (8.33%–20% by allocable surplus). Payable within 8 months of the year end — verify with your CA.`]);
  out.push([WORKING_PAPER]);
  return { rows: out, total, items };
}

export function reimbursementRows(adjustments: readonly PayrollAdjustment[], employees: readonly Employee[], fyStartYear: number): Row[] {
  const emp = new Map(employees.map((e) => [e.id, e]));
  const out: Row[] = [['Month', 'Employee', 'Head', 'Description', 'Amount', 'Taxable', 'Reference']];
  for (const a of adjustments.filter((x) => x.tag === 'reimb' && x.month >= `${fyStartYear}-04` && x.month <= `${fyStartYear + 1}-03`).sort((a, b) => a.month.localeCompare(b.month))) {
    const e = emp.get(a.employee_id);
    const h = REIMBURSEMENT_HEADS.find((x) => x.key === a.head);
    const taxable = a.taxable_amount ?? (!h || h.exempt === 'none' || (h.exempt === 'old' && e?.tax_regime !== 'old') ? a.amount : 0);
    out.push([a.month, e ? `${e.code} ${e.name}` : '', h?.name ?? a.head ?? '', a.name, a.amount, taxable, a.reference ?? '']);
  }
  out.push(['Exempt reimbursements need bills / proof of official use; LTA only in the old regime. Verify with your CA.']);
  return out;
}

/** PF 7Q interest / 14B damages estimate for each final month of the FY (payments by challan period). */
export function pfLateRows(runs: readonly PayrollRun[], payments: readonly PayrollPayment[], fyStartYear: number, today: string): Row[] {
  const out: Row[] = [['Month', 'PF due', 'Due date', 'Paid', 'Paid on', 'Days late', 'Interest 7Q (est.)', 'Damages 14B (est.)']];
  for (const r of runs.filter((x) => x.status === 'final' && x.month >= `${fyStartYear}-04` && x.month <= `${fyStartYear + 1}-03`).sort((a, b) => a.month.localeCompare(b.month))) {
    const due = round2(r.lines.reduce((s, l) => s + l.deductions.concat(l.employer).reduce((t, x) => t + (x.statutory === 'pf' || x.statutory === 'pf_er' || x.statutory === 'pf_admin' ? x.amount : 0), 0), 0));
    if (!due) continue;
    const pays = payments.filter((p) => p.kind === 'pf' && p.period === r.month).sort((a, b) => a.date.localeCompare(b.date));
    const paid = round2(pays.reduce((s, p) => s + p.amount, 0));
    const paidOn = paid >= due - 0.5 && pays.length ? pays[pays.length - 1].date : today;
    const est = pfLateEstimate(r.month, due, paidOn);
    out.push([r.month, due, formatDate(est.due_date), paid, paid >= due - 0.5 ? formatDate(paidOn) : `not fully paid (to ${formatDate(today)})`, est.days_late, est.interest, est.damages]);
  }
  out.push(['Estimate only: EPFO levies interest (s. 7Q) and damages (s. 14B / para 32A) by order. Verify with your CA.']);
  return out;
}
