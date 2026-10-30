import { useMemo, useState } from 'react';
import { BookCheck, Plus, Trash2 } from 'lucide-react';
import { loadEmployees, loadPayHeads, loadRuns } from '../../lib/payroll/store';
import { addAdjustment, deleteAdjustment, deletePerquisite, loadAdjustments, loadPerquisites, postProvisionJournal, savePerquisite } from '../../lib/payroll/depth-store';
import { REIMBURSEMENT_HEADS } from '../../lib/payroll/depth';
import { bonusRows, reimbursementRows } from '../../lib/payroll/depth-reports';
import { monthLabel } from '../../lib/payroll/reports';
import { fyStartOfMonth, lastDayOfMonth } from '../../lib/payroll/statutory';
import type { AdjustmentTag, PerquisiteKind } from '../../types/payroll';
import { payrollT as pT } from '../../i18n/areas/payroll';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './Payroll.module.css';
import { Out } from './Out';
import { inr, parseAmount, runAction, type TabProps } from './shared';

const TAG_KEY = { reimb: 'ext.tag.reimb', bonus: 'ext.tag.bonus', adjust: 'ext.tag.adjust' } as const;
const PERQ_KEY = { accommodation: 'ext.perq.accommodation', car: 'ext.perq.car', meals: 'ext.perq.meals', gift: 'ext.perq.gift', accretion: 'ext.perq.accretion', other: 'ext.perq.other' } as const;

/** Reimbursements & one-off items, perquisites (s. 17(2)) and the statutory bonus working (7P). */
export function ExtrasTab({ month, version, refresh, notify }: TabProps) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const employees = useMemo(() => loadEmployees(), [version]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const adjustments = useMemo(() => loadAdjustments(), [version]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const perqs = useMemo(() => loadPerquisites(), [version]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const runs = useMemo(() => loadRuns(), [version]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const heads = useMemo(() => loadPayHeads(), [version]);
  const name = new Map(employees.map((e) => [e.id, `${e.code} · ${e.name}`]));
  const fyStart = Number(fyStartOfMonth(month).slice(0, 4));
  const fyLabel = `${fyStart}-${String((fyStart + 1) % 100).padStart(2, '0')}`;

  // One-off item form
  const [empId, setEmpId] = useState('');
  const [tag, setTag] = useState<AdjustmentTag>('reimb');
  const [kind, setKind] = useState<'earning' | 'deduction'>('earning');
  const [head, setHead] = useState(REIMBURSEMENT_HEADS[0].key);
  const [desc, setDesc] = useState('');
  const [amount, setAmount] = useState('');
  const [taxable, setTaxable] = useState('');
  const [ref, setRef] = useState('');
  const employee = empId || employees[0]?.id || '';
  const monthItems = adjustments.filter((a) => a.month === month);

  // Perquisite form
  const [pEmp, setPEmp] = useState('');
  const [pKind, setPKind] = useState<PerquisiteKind>('accommodation');
  const [pDesc, setPDesc] = useState('');
  const [pFrom, setPFrom] = useState(month);
  const [pTo, setPTo] = useState('');
  const [pValue, setPValue] = useState('');

  // Bonus working
  const [rate, setRate] = useState('8.33');
  const [minWage, setMinWage] = useState('');
  const bonus = bonusRows(runs, employees, heads, fyStart, parseAmount(rate) ?? 8.33, parseAmount(minWage) ?? 0);

  return (
    <div className={styles.stack}>
      <section className={surface.card}>
        <div className={surface.cardBody}>
          <h2 className={styles.h2}>{pT('ext.items', { month: monthLabel(month) })}</h2>
          <div className={styles.formGrid}>
            <label className={controls.field}>
              <span className={controls.label}>{pT('rep.employee')}</span>
              <select className={controls.select} value={employee} onChange={(e) => setEmpId(e.target.value)}>
                {employees.map((e) => <option key={e.id} value={e.id}>{e.code} · {e.name}</option>)}
              </select>
            </label>
            <label className={controls.field}>
              <span className={controls.label}>{pT('ext.tag')}</span>
              <select className={controls.select} value={tag} onChange={(e) => { const v = e.target.value as AdjustmentTag; setTag(v); if (v !== 'adjust') setKind('earning'); }}>
                {(Object.keys(TAG_KEY) as AdjustmentTag[]).map((k) => <option key={k} value={k}>{pT(TAG_KEY[k])}</option>)}
              </select>
            </label>
            {tag === 'adjust' && (
              <label className={controls.field}>
                <span className={controls.label}>{pT('ext.kind')}</span>
                <select className={controls.select} value={kind} onChange={(e) => setKind(e.target.value as 'earning' | 'deduction')}>
                  <option value="earning">{pT('ext.earning')}</option>
                  <option value="deduction">{pT('ext.deduction')}</option>
                </select>
              </label>
            )}
            {tag === 'reimb' && (
              <label className={controls.field}>
                <span className={controls.label}>{pT('ext.head')}</span>
                <select className={controls.select} value={head} onChange={(e) => setHead(e.target.value)}>
                  {REIMBURSEMENT_HEADS.map((h) => <option key={h.key} value={h.key}>{h.name}</option>)}
                </select>
              </label>
            )}
            <label className={controls.field}><span className={controls.label}>{pT('ext.desc')}</span><input className={controls.input} value={desc} onChange={(e) => setDesc(e.target.value)} /></label>
            <label className={controls.field}><span className={controls.label}>{pT('loan.amount')}</span><input className={controls.inputNumeric} type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
            {kind === 'earning' && (
              <label className={controls.field}>
                <span className={controls.label}>{pT('ext.taxable')}</span>
                <input className={controls.inputNumeric} type="number" min="0" step="0.01" value={taxable} onChange={(e) => setTaxable(e.target.value)} />
                <span className={controls.hint}>{pT('ext.taxableHint')}</span>
              </label>
            )}
            <label className={controls.field}><span className={controls.label}>{pT('ppay.reference')}</span><input className={controls.input} value={ref} onChange={(e) => setRef(e.target.value)} /></label>
          </div>
          <button
            type="button"
            className={controls.btnPrimary}
            disabled={!employee}
            onClick={() =>
              runAction(
                () => {
                  const h = REIMBURSEMENT_HEADS.find((x) => x.key === head);
                  addAdjustment({
                    employee_id: employee,
                    month,
                    kind,
                    tag,
                    name: desc.trim() || (tag === 'reimb' ? h?.name ?? '' : tag === 'bonus' ? pT('ext.tag.bonus') : ''),
                    amount: parseAmount(amount) ?? 0,
                    ...(tag === 'reimb' ? { head } : {}),
                    ...(kind === 'earning' && parseAmount(taxable) !== null ? { taxable_amount: parseAmount(taxable)! } : {}),
                    ...(ref.trim() ? { reference: ref.trim() } : {}),
                  });
                  setDesc('');
                  setAmount('');
                  setTaxable('');
                  setRef('');
                },
                refresh,
                notify,
                pT('ext.added'),
              )
            }
          >
            <Plus size={15} /> {pT('ext.add')}
          </button>
          <p className={styles.note}>{pT('ext.hint')}</p>
        </div>
        {monthItems.length > 0 && (
          <div className={surface.tableWrap}>
            <table className={surface.table}>
              <caption className={surface.srOnly}>{pT('ext.items', { month: monthLabel(month) })}</caption>
              <thead><tr><th>{pT('rep.employee')}</th><th>{pT('ext.tag')}</th><th>{pT('ext.desc')}</th><th className={styles.num}>{pT('loan.amount')}</th><th /></tr></thead>
              <tbody>
                {monthItems.map((a) => (
                  <tr key={a.id}>
                    <td>{name.get(a.employee_id) ?? ''}</td>
                    <td>{pT(TAG_KEY[a.tag])}{a.kind === 'deduction' ? ` · ${pT('ext.deduction')}` : ''}</td>
                    <td>{a.name}{a.reference ? <span className={styles.sub}>{a.reference}</span> : null}</td>
                    <td className={styles.num}>{inr(a.amount)}</td>
                    <td className={styles.num}><button type="button" className={controls.btnDanger} aria-label={pT('ext.delete', { name: a.name })} onClick={() => runAction(() => deleteAdjustment(a.id), refresh, notify, pT('ext.deleted'))}><Trash2 size={15} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className={styles.toolbar}>
          <span className={styles.sub}>{pT('ext.reimbRegister', { fy: fyLabel })}</span>
          <Out base={`reimbursements-FY${fyLabel}`} rows={() => reimbursementRows(adjustments, employees, fyStart)} sheet="Reimbursements" />
        </div>
      </section>

      <section className={surface.card}>
        <div className={surface.cardBody}>
          <h2 className={styles.h2}>{pT('ext.perqs')}</h2>
          <div className={styles.formGrid}>
            <label className={controls.field}>
              <span className={controls.label}>{pT('rep.employee')}</span>
              <select className={controls.select} value={pEmp || employee} onChange={(e) => setPEmp(e.target.value)}>
                {employees.map((e) => <option key={e.id} value={e.id}>{e.code} · {e.name}</option>)}
              </select>
            </label>
            <label className={controls.field}>
              <span className={controls.label}>{pT('ext.perqKind')}</span>
              <select className={controls.select} value={pKind} onChange={(e) => setPKind(e.target.value as PerquisiteKind)}>
                {(Object.keys(PERQ_KEY) as PerquisiteKind[]).map((k) => <option key={k} value={k}>{pT(PERQ_KEY[k])}</option>)}
              </select>
            </label>
            <label className={controls.field}><span className={controls.label}>{pT('ext.desc')}</span><input className={controls.input} value={pDesc} onChange={(e) => setPDesc(e.target.value)} /></label>
            <label className={controls.field}><span className={controls.label}>{pT('ext.perqFrom')}</span><input className={controls.input} type="month" value={pFrom} onChange={(e) => setPFrom(e.target.value)} /></label>
            <label className={controls.field}><span className={controls.label}>{pT('ext.perqTo')}</span><input className={controls.input} type="month" value={pTo} onChange={(e) => setPTo(e.target.value)} /></label>
            <label className={controls.field}><span className={controls.label}>{pT('ext.perqValue')}</span><input className={controls.inputNumeric} type="number" min="0" step="0.01" value={pValue} onChange={(e) => setPValue(e.target.value)} /></label>
          </div>
          <button
            type="button"
            className={controls.btnOutline}
            onClick={() =>
              runAction(
                () => {
                  savePerquisite({ employee_id: pEmp || employee, kind: pKind, description: pDesc.trim(), from_month: pFrom, ...(pTo ? { to_month: pTo } : {}), monthly_value: parseAmount(pValue) ?? 0 });
                  setPDesc('');
                  setPValue('');
                },
                refresh,
                notify,
                pT('ext.perqSaved'),
              )
            }
          >
            <Plus size={15} /> {pT('ext.perqAdd')}
          </button>
          <p className={styles.note}>{pT('ext.perqHint')}</p>
        </div>
        {perqs.length > 0 && (
          <div className={surface.tableWrap}>
            <table className={surface.table}>
              <caption className={surface.srOnly}>{pT('ext.perqs')}</caption>
              <thead><tr><th>{pT('rep.employee')}</th><th>{pT('ext.perqKind')}</th><th>{pT('ext.perqFrom')}</th><th>{pT('ext.perqTo')}</th><th className={styles.num}>{pT('ext.perqValue')}</th><th /></tr></thead>
              <tbody>
                {perqs.map((p) => (
                  <tr key={p.id}>
                    <td>{name.get(p.employee_id) ?? ''}</td>
                    <td>{pT(PERQ_KEY[p.kind])}{p.description ? <span className={styles.sub}>{p.description}</span> : null}{p.basis ? <span className={styles.sub}>{p.basis}</span> : null}</td>
                    <td>{monthLabel(p.from_month)}</td>
                    <td>{p.to_month ? monthLabel(p.to_month) : '-'}</td>
                    <td className={styles.num}>{inr(p.monthly_value)}</td>
                    <td className={styles.num}><button type="button" className={controls.btnDanger} aria-label={pT('ext.delete', { name: pT(PERQ_KEY[p.kind]) })} onClick={() => runAction(() => deletePerquisite(p.id), refresh, notify, pT('ext.deleted'))}><Trash2 size={15} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={surface.card}>
        <div className={surface.cardBody}>
          <h2 className={styles.h2}>{pT('ext.bonus', { fy: fyLabel })}</h2>
          <div className={styles.formGrid}>
            <label className={controls.field}><span className={controls.label}>{pT('ext.bonusRate')}</span><input className={controls.inputNumeric} type="number" min="8.33" max="20" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} /></label>
            <label className={controls.field}><span className={controls.label}>{pT('ext.minWage')}</span><input className={controls.inputNumeric} type="number" min="0" step="1" value={minWage} onChange={(e) => setMinWage(e.target.value)} /></label>
          </div>
          <div className={surface.tableWrap}>
            <table className={surface.table}>
              <caption className={surface.srOnly}>{pT('ext.bonus', { fy: fyLabel })}</caption>
              <thead><tr><th>{pT('rep.employee')}</th><th className={styles.num}>{pT('ext.b.months')}</th><th className={styles.num}>{pT('ext.b.days')}</th><th className={styles.num}>{pT('ext.b.salary')}</th><th className={styles.num}>{pT('ext.b.wages')}</th><th className={styles.num}>{pT('ext.b.bonus')}</th><th>{pT('ext.b.note')}</th></tr></thead>
              <tbody>
                {bonus.items.map((r) => (
                  <tr key={r.employee_id}>
                    <td>{r.code} · {r.name}</td>
                    <td className={styles.num}>{r.months}</td>
                    <td className={styles.num}>{r.days_worked}</td>
                    <td className={styles.num}>{inr(r.salary)}</td>
                    <td className={styles.num}>{inr(r.bonus_wages)}</td>
                    <td className={`${styles.num} ${styles.strong}`}>{inr(r.bonus)}</td>
                    <td className={styles.sub}>{r.reason ?? ''}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={5}>{pT('total')}</td><td className={styles.num}>{inr(bonus.total)}</td><td /></tr></tfoot>
            </table>
          </div>
          <div className={styles.inline}>
            <button
              type="button"
              className={controls.btnOutline}
              disabled={!bonus.total}
              onClick={() =>
                runAction(
                  () => {
                    for (const r of bonus.items.filter((x) => x.bonus > 0)) addAdjustment({ employee_id: r.employee_id, month, kind: 'earning', tag: 'bonus', name: `Statutory bonus FY ${fyLabel} @ ${parseAmount(rate) ?? 8.33}%`, amount: r.bonus });
                  },
                  refresh,
                  notify,
                  pT('ext.bonusAdded', { n: bonus.items.filter((x) => x.bonus > 0).length, month: monthLabel(month) }),
                )
              }
            >
              <Plus size={15} /> {pT('ext.bonusAdd', { month: monthLabel(month) })}
            </button>
            <button
              type="button"
              className={controls.btnOutline}
              disabled={!bonus.total}
              onClick={() => runAction(() => { const v = postProvisionJournal('bonus', lastDayOfMonth(month), bonus.total, `FY ${fyLabel}`); notify(pT('ext.provisionDone', { number: v.number })); }, refresh, notify)}
            >
              <BookCheck size={15} /> {pT('ext.bonusProvision')}
            </button>
            <Out base={`bonus-FY${fyLabel}`} rows={() => bonus.rows} sheet="Bonus" />
          </div>
          <p className={styles.note}>{pT('ext.bonusHint')}</p>
        </div>
      </section>
    </div>
  );
}
