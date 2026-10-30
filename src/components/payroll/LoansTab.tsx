import { useMemo, useState } from 'react';
import { HandCoins, ListOrdered, Plus, Trash2 } from 'lucide-react';
import { loadEmployees, loadRuns } from '../../lib/payroll/store';
import { deleteLoan, loadLoans, saveLoan } from '../../lib/payroll/depth-store';
import { loanOutstanding, loanSchedule } from '../../lib/payroll/depth';
import { loanRegisterRows, loanScheduleRows } from '../../lib/payroll/depth-reports';
import { monthLabel } from '../../lib/payroll/reports';
import { chartOf, loadUserAccounts } from '../../lib/ledger/accounts';
import { formatDate, todayInput } from '../../lib/utils';
import type { EmployeeLoan, LoanKind } from '../../types/payroll';
import { EmptyState } from '../ui/EmptyState';
import { Modal } from '../ui/Modal';
import { payrollT as pT } from '../../i18n/areas/payroll';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './Payroll.module.css';
import { Out } from './Out';
import { inr, parseAmount, runAction, type TabProps } from './shared';
import { SelectField } from '../ui/SelectField';
import { DateField } from '../ui/DateField';

/** Loans & salary advances to employees (7P): EMI schedules recovered in the payroll runs. */
export function LoansTab({ month, version, refresh, notify }: TabProps) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const employees = useMemo(() => loadEmployees(), [version]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const loans = useMemo(() => loadLoans().sort((a, b) => b.date.localeCompare(a.date)), [version]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const runs = useMemo(() => loadRuns(), [version]);
  const cashBank = useMemo(() => chartOf(loadUserAccounts()).filter((a) => a.group === 'CASH_BANK'), []);
  const [empId, setEmpId] = useState('');
  const [kind, setKind] = useState<LoanKind>('loan');
  const [date, setDate] = useState(todayInput());
  const [amount, setAmount] = useState('');
  const [rate, setRate] = useState('0');
  const [emi, setEmi] = useState('');
  const [start, setStart] = useState(month);
  const [paidFrom, setPaidFrom] = useState('bank');
  const [medical, setMedical] = useState(false);
  const [sbi, setSbi] = useState('');
  const [notes, setNotes] = useState('');
  const [schedule, setSchedule] = useState<EmployeeLoan | null>(null);
  const name = new Map(employees.map((e) => [e.id, `${e.code} · ${e.name}`]));
  const employee = empId || employees[0]?.id || '';

  const submit = () =>
    runAction(
      () => {
        const l = saveLoan({
          employee_id: employee,
          kind,
          date,
          amount: parseAmount(amount) ?? 0,
          interest_rate: parseAmount(rate) ?? 0,
          emi: parseAmount(emi) ?? 0,
          start_month: start,
          paid_from: paidFrom,
          ...(medical ? { purpose: 'medical' as const } : {}),
          ...(parseAmount(sbi) ? { sbi_rate: parseAmount(sbi)! } : {}),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        });
        setAmount('');
        setEmi('');
        setNotes('');
        notify(pT('loan.saved', { number: l.number }));
      },
      refresh,
      notify,
    );

  return (
    <div className={styles.stack}>
      <section className={surface.card}>
        <div className={surface.cardBody}>
          <h2 className={styles.h2}>{pT('loan.title')}</h2>
          <div className={styles.formGrid}>
            <label className={controls.field}>
              <span className={controls.label}>{pT('rep.employee')}</span>
              <SelectField className={controls.select} value={employee} onChange={(e) => setEmpId(e.target.value)}>
                {employees.map((e) => <option key={e.id} value={e.id}>{e.code} · {e.name}</option>)}
              </SelectField>
            </label>
            <label className={controls.field}>
              <span className={controls.label}>{pT('loan.kind')}</span>
              <SelectField className={controls.select} value={kind} onChange={(e) => setKind(e.target.value as LoanKind)}>
                <option value="loan">{pT('loan.kindLoan')}</option>
                <option value="advance">{pT('loan.kindAdvance')}</option>
              </SelectField>
            </label>
            <label className={controls.field}>
              <span className={controls.label}>{pT('loan.date')}</span>
              <DateField className={controls.input} value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label className={controls.field}>
              <span className={controls.label}>{pT('loan.amount')}</span>
              <input className={controls.inputNumeric} type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </label>
            <label className={controls.field}>
              <span className={controls.label}>{pT('loan.rate')}</span>
              <input className={controls.inputNumeric} type="number" min="0" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} />
            </label>
            <label className={controls.field}>
              <span className={controls.label}>{pT('loan.emi')}</span>
              <input className={controls.inputNumeric} type="number" min="0" step="0.01" value={emi} onChange={(e) => setEmi(e.target.value)} />
            </label>
            <label className={controls.field}>
              <span className={controls.label}>{pT('loan.start')}</span>
              <DateField className={controls.input} mode="month" value={start} onChange={(e) => setStart(e.target.value)} />
            </label>
            <label className={controls.field}>
              <span className={controls.label}>{pT('ppay.from')}</span>
              <SelectField className={controls.select} value={paidFrom} onChange={(e) => setPaidFrom(e.target.value)}>
                {cashBank.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </SelectField>
            </label>
            <label className={controls.field}>
              <span className={controls.label}>{pT('loan.sbi')}</span>
              <input className={controls.inputNumeric} type="number" min="0" step="0.01" value={sbi} onChange={(e) => setSbi(e.target.value)} />
              <span className={controls.hint}>{pT('loan.sbiHint')}</span>
            </label>
            <label className={controls.field}>
              <span className={controls.label}>{pT('loan.notes')}</span>
              <input className={controls.input} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
          </div>
          <div className={styles.checks}>
            <label className={controls.check}><input type="checkbox" checked={medical} onChange={(e) => setMedical(e.target.checked)} /> {pT('loan.medical')}</label>
          </div>
          <button type="button" className={controls.btnPrimary} onClick={submit} disabled={!employee}><Plus size={15} /> {pT('loan.save')}</button>
          <p className={styles.note}>{pT('loan.hint')}</p>
        </div>
      </section>

      <section className={surface.card}>
        {loans.length === 0 ? (
          <EmptyState icon={HandCoins} title={pT('loan.emptyTitle')} text={pT('loan.emptyText')} />
        ) : (
          <>
            <div className={styles.toolbar}>
              <h2 className={styles.h2}>{pT('loan.list')}</h2>
              <Out base="employee-loans" rows={() => loanRegisterRows(loans, employees, runs)} sheet="Loans" />
            </div>
            <div className={surface.tableWrap}>
              <table className={surface.table}>
                <caption className={surface.srOnly}>{pT('loan.list')}</caption>
                <thead><tr><th>{pT('ppay.number')}</th><th>{pT('rep.employee')}</th><th>{pT('loan.date')}</th><th className={styles.num}>{pT('loan.amount')}</th><th className={styles.num}>{pT('loan.emi')}</th><th className={styles.num}>{pT('loan.rate')}</th><th className={styles.num}>{pT('loan.outstanding')}</th><th /></tr></thead>
                <tbody>
                  {loans.map((l) => (
                    <tr key={l.id}>
                      <td className={surface.mono}>{l.number}<span className={styles.sub}>{l.kind === 'advance' ? pT('loan.kindAdvance') : pT('loan.kindLoan')}{l.purpose === 'medical' ? ` · ${pT('loan.medical')}` : ''}</span></td>
                      <td>{name.get(l.employee_id) ?? ''}</td>
                      <td>{formatDate(l.date)}</td>
                      <td className={styles.num}>{inr(l.amount)}</td>
                      <td className={styles.num}>{inr(l.emi)}</td>
                      <td className={styles.num}>{l.interest_rate ? `${l.interest_rate}%` : pT('loan.free')}</td>
                      <td className={`${styles.num} ${styles.strong}`}>{inr(loanOutstanding(l, runs))}</td>
                      <td>
                        <span className={styles.rowActions}>
                          <button type="button" className={controls.btnIcon} aria-label={pT('loan.schedule', { number: l.number })} title={pT('loan.schedule', { number: l.number })} onClick={() => setSchedule(l)}><ListOrdered size={15} /></button>
                          <button type="button" className={controls.btnDanger} aria-label={pT('loan.delete', { number: l.number })} title={pT('loan.delete', { number: l.number })} onClick={() => runAction(() => deleteLoan(l.id), refresh, notify, pT('loan.deleted'))}><Trash2 size={15} /></button>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {schedule && (
        <Modal open size="md" onClose={() => setSchedule(null)} title={pT('loan.schedule', { number: schedule.number })} footer={<Out base={`loan-schedule-${schedule.number.replace(/\//g, '-')}`} rows={() => loanScheduleRows(schedule, runs)} sheet="Schedule" />}>
          <div className={surface.tableWrap}>
            <table className={surface.table}>
              <caption className={surface.srOnly}>{pT('loan.schedule', { number: schedule.number })}</caption>
              <thead><tr><th>{pT('arr.month')}</th><th className={styles.num}>{pT('loan.opening')}</th><th className={styles.num}>{pT('loan.interest')}</th><th className={styles.num}>{pT('loan.principal')}</th><th className={styles.num}>{pT('loan.closing')}</th><th>{pT('f.status')}</th></tr></thead>
              <tbody>
                {loanSchedule(schedule, runs).map((r) => (
                  <tr key={r.month}>
                    <td>{monthLabel(r.month)}</td>
                    <td className={styles.num}>{inr(r.opening)}</td>
                    <td className={styles.num}>{inr(r.interest)}</td>
                    <td className={styles.num}>{inr(r.principal)}</td>
                    <td className={styles.num}>{inr(r.closing)}</td>
                    <td>{r.actual ? pT('loan.recovered') : pT('loan.projected')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Modal>
      )}
    </div>
  );
}
