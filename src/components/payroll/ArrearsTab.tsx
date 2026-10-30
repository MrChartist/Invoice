import { useMemo, useState } from 'react';
import { Calculator, Save, Trash2 } from 'lucide-react';
import { loadEmployees } from '../../lib/payroll/store';
import { deleteArrears, loadArrears, previewArrears, saveArrears } from '../../lib/payroll/depth-store';
import { arrearsEarlierFy } from '../../lib/payroll/depth';
import { arrearsRegisterRows } from '../../lib/payroll/depth-reports';
import { monthLabel } from '../../lib/payroll/reports';
import type { ArrearsMonth } from '../../types/payroll';
import { EmptyState } from '../ui/EmptyState';
import { payrollT as pT } from '../../i18n/areas/payroll';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './Payroll.module.css';
import { Out } from './Out';
import { inr, runAction, type TabProps } from './shared';
import { SelectField } from '../ui/SelectField';
import { DateField } from '../ui/DateField';

/** Arrears of a back-dated salary revision (7P): difference per finalized month, paid in a chosen month. */
export function ArrearsTab({ month, version, refresh, notify }: TabProps) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const employees = useMemo(() => loadEmployees(), [version]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const records = useMemo(() => loadArrears().sort((a, b) => b.pay_month.localeCompare(a.pay_month)), [version]);
  const [empId, setEmpId] = useState('');
  const [from, setFrom] = useState('');
  const [payIn, setPayIn] = useState(month);
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState<ArrearsMonth[] | null>(null);
  const name = new Map(employees.map((e) => [e.id, `${e.code} · ${e.name}`]));
  const employee = empId || employees[0]?.id || '';
  const input = { employee_id: employee, from_month: from, pay_month: payIn, note };

  const doPreview = () => {
    try {
      setPreview(previewArrears(input));
    } catch (err) {
      setPreview(null);
      notify((err as Error).message, 'error');
    }
  };

  return (
    <div className={styles.stack}>
      <section className={surface.card}>
        <div className={surface.cardBody}>
          <h2 className={styles.h2}>{pT('arr.title')}</h2>
          <p className={styles.note}>{pT('arr.hint')}</p>
          <div className={styles.formGrid}>
            <label className={controls.field}>
              <span className={controls.label}>{pT('rep.employee')}</span>
              <SelectField className={controls.select} value={employee} onChange={(e) => { setEmpId(e.target.value); setPreview(null); }}>
                {employees.map((e) => <option key={e.id} value={e.id}>{e.code} · {e.name}</option>)}
              </SelectField>
            </label>
            <label className={controls.field}>
              <span className={controls.label}>{pT('arr.from')}</span>
              <DateField className={controls.input} mode="month" value={from} onChange={(e) => { setFrom(e.target.value); setPreview(null); }} />
            </label>
            <label className={controls.field}>
              <span className={controls.label}>{pT('arr.payIn')}</span>
              <DateField className={controls.input} mode="month" value={payIn} onChange={(e) => { setPayIn(e.target.value); setPreview(null); }} />
            </label>
            <label className={controls.field}>
              <span className={controls.label}>{pT('arr.note')}</span>
              <input className={controls.input} value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
          </div>
          <div className={styles.inline}>
            <button type="button" className={controls.btnOutline} onClick={doPreview} disabled={!employee}><Calculator size={15} /> {pT('arr.preview')}</button>
            <button
              type="button"
              className={controls.btnPrimary}
              disabled={!employee}
              onClick={() => runAction(() => { saveArrears(input); setPreview(null); }, refresh, notify, pT('arr.saved', { month: monthLabel(payIn) }))}
            >
              <Save size={15} /> {pT('arr.save')}
            </button>
          </div>
          {preview && (
            preview.length === 0 ? <p className={styles.note}>{pT('arr.none')}</p> : (
              <div className={surface.tableWrap}>
                <table className={surface.table}>
                  <caption className={surface.srOnly}>{pT('arr.preview')}</caption>
                  <thead><tr><th>{pT('arr.month')}</th><th>{pT('arr.heads')}</th><th className={styles.num}>{pT('arr.gross')}</th><th className={styles.num}>{pT('arr.pf')}</th><th className={styles.num}>{pT('arr.esi')}</th></tr></thead>
                  <tbody>
                    {preview.map((m) => (
                      <tr key={m.month}>
                        <td>{monthLabel(m.month)}</td>
                        <td>{m.earnings.map((x) => `${x.name} ${inr(x.amount)}`).join(' · ')}</td>
                        <td className={styles.num}>{inr(m.gross)}</td>
                        <td className={styles.num}>{inr(m.pf_ee)}</td>
                        <td className={styles.num}>{inr(m.esi_ee)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr><td colSpan={2}>{pT('total')}</td><td className={styles.num}>{inr(preview.reduce((s, m) => s + m.gross, 0))}</td><td className={styles.num}>{inr(preview.reduce((s, m) => s + m.pf_ee, 0))}</td><td className={styles.num}>{inr(preview.reduce((s, m) => s + m.esi_ee, 0))}</td></tr></tfoot>
                </table>
              </div>
            )
          )}
        </div>
      </section>

      <section className={surface.card}>
        {records.length === 0 ? (
          <EmptyState icon={Calculator} title={pT('arr.emptyTitle')} text={pT('arr.emptyText')} />
        ) : (
          <>
            <div className={styles.toolbar}>
              <h2 className={styles.h2}>{pT('arr.list')}</h2>
              <Out base="arrears-register" rows={() => arrearsRegisterRows(records, employees)} sheet="Arrears" />
            </div>
            <div className={surface.tableWrap}>
              <table className={surface.table}>
                <caption className={surface.srOnly}>{pT('arr.list')}</caption>
                <thead><tr><th>{pT('rep.employee')}</th><th>{pT('arr.from')}</th><th>{pT('arr.payIn')}</th><th className={styles.num}>{pT('arr.months')}</th><th className={styles.num}>{pT('arr.gross')}</th><th /></tr></thead>
                <tbody>
                  {records.map((r) => (
                    <tr key={r.id}>
                      <td>{name.get(r.employee_id) ?? r.employee_id}{arrearsEarlierFy(r) && <span className={styles.sub}>{pT('arr.relief')}</span>}</td>
                      <td>{monthLabel(r.from_month)}</td>
                      <td>{monthLabel(r.pay_month)}</td>
                      <td className={styles.num}>{r.months.length}</td>
                      <td className={styles.num}>{inr(r.gross)}</td>
                      <td className={styles.num}>
                        <button type="button" className={controls.btnDanger} aria-label={pT('arr.delete')} title={pT('arr.delete')} onClick={() => runAction(() => deleteArrears(r.id), refresh, notify, pT('arr.deleted'))}>
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
