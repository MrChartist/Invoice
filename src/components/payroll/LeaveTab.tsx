import { useMemo, useState } from 'react';
import { CalendarDays, Plus, Trash2 } from 'lucide-react';
import { loadEmployees } from '../../lib/payroll/store';
import { addLeaveEntry, deleteLeaveEntry, deleteLeaveType, loadLeaveEntries, loadLeaveTypes, saveLeaveType } from '../../lib/payroll/depth-store';
import { leaveBalance } from '../../lib/payroll/depth';
import { leaveBalanceRows } from '../../lib/payroll/depth-reports';
import { monthLabel } from '../../lib/payroll/reports';
import { formatDate, todayInput } from '../../lib/utils';
import type { LeaveEntryKind } from '../../types/payroll';
import { EmptyState } from '../ui/EmptyState';
import { payrollT as pT } from '../../i18n/areas/payroll';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './Payroll.module.css';
import { Out } from './Out';
import { parseAmount, runAction, type TabProps } from './shared';
import { SelectField } from '../ui/SelectField';
import { DateField } from '../ui/DateField';

const KINDS: LeaveEntryKind[] = ['opening', 'taken', 'encash', 'adjust'];
const KIND_KEY = { opening: 'leave.k.opening', taken: 'leave.k.taken', encash: 'leave.k.encash', adjust: 'leave.k.adjust' } as const;

/** Leave (7P): types with monthly accrual, opening balances, leave taken, encashment; balances as of the month. */
export function LeaveTab({ month, version, refresh, notify }: TabProps) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const employees = useMemo(() => loadEmployees().filter((e) => e.active || (e.dol && e.dol >= `${month}-01`)), [version, month]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const types = useMemo(() => loadLeaveTypes(), [version]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const entries = useMemo(() => loadLeaveEntries(), [version]);
  const [t, setT] = useState({ code: '', name: '', paid: true, accrual: '', encashable: false, carry: '' });
  const [empId, setEmpId] = useState('');
  const [typeId, setTypeId] = useState('');
  const [kind, setKind] = useState<LeaveEntryKind>('taken');
  const [date, setDate] = useState(todayInput());
  const [days, setDays] = useState('');
  const [payMonth, setPayMonth] = useState(month);
  const [amount, setAmount] = useState('');
  const employee = empId || employees[0]?.id || '';
  const type = typeId || types[0]?.id || '';
  const name = new Map(employees.map((e) => [e.id, `${e.code} · ${e.name}`]));
  const typeCode = new Map(types.map((x) => [x.id, x.code]));
  const recent = [...entries].sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at)).slice(0, 50);

  return (
    <div className={styles.stack}>
      <section className={surface.card}>
        <div className={surface.cardBody}>
          <h2 className={styles.h2}>{pT('leave.types')}</h2>
          {types.length > 0 && (
            <ul className={styles.chips}>
              {types.map((x) => (
                <li key={x.id} className={styles.chip}>
                  <strong>{x.code}</strong> {x.name} · {x.paid ? pT('leave.paid') : pT('leave.unpaid')} · {pT('leave.perMonth', { days: x.accrual })}{x.encashable ? ` · ${pT('leave.encashable')}` : ''}{x.carry_cap ? ` · ${pT('leave.carryCap')} ${x.carry_cap}` : ''}
                  <button type="button" className={controls.btnIcon} aria-label={pT('leave.deleteType', { code: x.code })} onClick={() => runAction(() => deleteLeaveType(x.id), refresh, notify)}><Trash2 size={13} /></button>
                </li>
              ))}
            </ul>
          )}
          <div className={styles.formGrid}>
            <label className={controls.field}><span className={controls.label}>{pT('leave.code')}</span><input className={controls.input} maxLength={6} value={t.code} onChange={(e) => setT({ ...t, code: e.target.value })} /></label>
            <label className={controls.field}><span className={controls.label}>{pT('leave.name')}</span><input className={controls.input} value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} /></label>
            <label className={controls.field}><span className={controls.label}>{pT('leave.accrual')}</span><input className={controls.inputNumeric} type="number" min="0" step="0.25" value={t.accrual} onChange={(e) => setT({ ...t, accrual: e.target.value })} /></label>
            <label className={controls.field}><span className={controls.label}>{pT('leave.carryCap')}</span><input className={controls.inputNumeric} type="number" min="0" step="1" value={t.carry} onChange={(e) => setT({ ...t, carry: e.target.value })} /></label>
          </div>
          <div className={styles.checks}>
            <label className={controls.check}><input type="checkbox" checked={t.paid} onChange={(e) => setT({ ...t, paid: e.target.checked })} /> {pT('leave.paid')}</label>
            <label className={controls.check}><input type="checkbox" checked={t.encashable} onChange={(e) => setT({ ...t, encashable: e.target.checked })} /> {pT('leave.encashable')}</label>
          </div>
          <button
            type="button"
            className={controls.btnOutline}
            onClick={() =>
              runAction(
                () => {
                  saveLeaveType({ code: t.code, name: t.name, paid: t.paid, accrual: parseAmount(t.accrual) ?? 0, encashable: t.encashable, ...(parseAmount(t.carry) ? { carry_cap: parseAmount(t.carry)! } : {}) });
                  setT({ code: '', name: '', paid: true, accrual: '', encashable: false, carry: '' });
                },
                refresh,
                notify,
                pT('leave.typeSaved'),
              )
            }
          >
            <Plus size={15} /> {pT('leave.addType')}
          </button>
          <p className={styles.note}>{pT('leave.hint')}</p>
        </div>
      </section>

      {types.length === 0 ? (
        <section className={surface.card}><EmptyState icon={CalendarDays} title={pT('leave.noTypes')} text={pT('leave.noTypesText')} /></section>
      ) : (
        <>
          <section className={surface.card}>
            <div className={styles.toolbar}>
              <h2 className={styles.h2}>{pT('leave.balances', { month: monthLabel(month) })}</h2>
              <Out base={`leave-balances-${month}`} rows={() => leaveBalanceRows(employees, types, entries, month)} sheet="Leave" />
            </div>
            <div className={surface.tableWrap}>
              <table className={surface.table}>
                <caption className={surface.srOnly}>{pT('leave.balances', { month: monthLabel(month) })}</caption>
                <thead><tr><th>{pT('rep.employee')}</th>{types.map((x) => <th key={x.id} className={styles.num}>{x.code}</th>)}</tr></thead>
                <tbody>
                  {employees.map((e) => {
                    const mine = entries.filter((x) => x.employee_id === e.id);
                    return (
                      <tr key={e.id}>
                        <td>{e.code} · {e.name}</td>
                        {types.map((x) => <td key={x.id} className={styles.num}>{leaveBalance(x, e, mine, month).balance}</td>)}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className={surface.card}>
            <div className={surface.cardBody}>
              <h2 className={styles.h2}>{pT('leave.entry')}</h2>
              <div className={styles.formGrid}>
                <label className={controls.field}>
                  <span className={controls.label}>{pT('rep.employee')}</span>
                  <SelectField className={controls.select} value={employee} onChange={(e) => setEmpId(e.target.value)}>
                    {employees.map((e) => <option key={e.id} value={e.id}>{e.code} · {e.name}</option>)}
                  </SelectField>
                </label>
                <label className={controls.field}>
                  <span className={controls.label}>{pT('leave.type')}</span>
                  <SelectField className={controls.select} value={type} onChange={(e) => setTypeId(e.target.value)}>
                    {types.map((x) => <option key={x.id} value={x.id}>{x.code} · {x.name}</option>)}
                  </SelectField>
                </label>
                <label className={controls.field}>
                  <span className={controls.label}>{pT('leave.kind')}</span>
                  <SelectField className={controls.select} value={kind} onChange={(e) => setKind(e.target.value as LeaveEntryKind)}>
                    {KINDS.map((k) => <option key={k} value={k}>{pT(KIND_KEY[k])}</option>)}
                  </SelectField>
                </label>
                <label className={controls.field}><span className={controls.label}>{pT('ppay.date')}</span><DateField className={controls.input} value={date} onChange={(e) => setDate(e.target.value)} /></label>
                <label className={controls.field}><span className={controls.label}>{pT('leave.days')}</span><input className={controls.inputNumeric} type="number" step="0.5" value={days} onChange={(e) => setDays(e.target.value)} /></label>
                {kind === 'encash' && (
                  <>
                    <label className={controls.field}><span className={controls.label}>{pT('leave.payMonth')}</span><DateField className={controls.input} mode="month" value={payMonth} onChange={(e) => setPayMonth(e.target.value)} /></label>
                    <label className={controls.field}><span className={controls.label}>{pT('leave.amount')}</span><input className={controls.inputNumeric} type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /><span className={controls.hint}>{pT('leave.amountHint')}</span></label>
                  </>
                )}
              </div>
              <button
                type="button"
                className={controls.btnPrimary}
                disabled={!employee || !type}
                onClick={() =>
                  runAction(
                    () => {
                      addLeaveEntry({ employee_id: employee, type_id: type, kind, date, days: parseAmount(days) ?? 0, ...(kind === 'encash' ? { month: payMonth, ...(parseAmount(amount) ? { amount: parseAmount(amount)! } : {}) } : {}) });
                      setDays('');
                      setAmount('');
                    },
                    refresh,
                    notify,
                    pT('leave.added'),
                  )
                }
              >
                <Plus size={15} /> {pT('leave.add')}
              </button>
            </div>
            {recent.length > 0 && (
              <div className={surface.tableWrap}>
                <table className={surface.table}>
                  <caption className={surface.srOnly}>{pT('leave.entries')}</caption>
                  <thead><tr><th>{pT('ppay.date')}</th><th>{pT('rep.employee')}</th><th>{pT('leave.type')}</th><th>{pT('leave.kind')}</th><th className={styles.num}>{pT('leave.days')}</th><th /></tr></thead>
                  <tbody>
                    {recent.map((x) => (
                      <tr key={x.id}>
                        <td>{formatDate(x.date)}</td>
                        <td>{name.get(x.employee_id) ?? ''}</td>
                        <td>{typeCode.get(x.type_id) ?? ''}</td>
                        <td>{pT(KIND_KEY[x.kind])}{x.month ? ` · ${monthLabel(x.month)}` : ''}</td>
                        <td className={styles.num}>{x.days}</td>
                        <td className={styles.num}>
                          <button type="button" className={controls.btnDanger} aria-label={pT('leave.deleteEntry')} title={pT('leave.deleteEntry')} onClick={() => runAction(() => deleteLeaveEntry(x.id), refresh, notify, pT('leave.deleted'))}><Trash2 size={15} /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
