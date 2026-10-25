import { useMemo, useState } from 'react';
import { BookCheck, Save, Trash2 } from 'lucide-react';
import { deleteActuarial, loadActuarial, postActuarialJournal, saveActuarial } from '../../lib/payroll/followups-store';
import { actuarialCheck, actuarialJournal } from '../../lib/payroll/followups';
import { todayInput } from '../../lib/utils';
import { loadVouchers } from '../../lib/ledger/vouchers';
import type { ActuarialKind, ActuarialStandard } from '../../types/payroll';
import { payrollMoreT as mT } from '../../i18n/areas/payroll-more';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './Payroll.module.css';
import { inr, parseAmount, runAction, type TabProps } from './shared';

const FIGURES = [
  ['opening', 'act.opening'],
  ['current_service_cost', 'act.csc'],
  ['interest_cost', 'act.interest'],
  ['past_service_cost', 'act.psc'],
  ['benefits_paid', 'act.paid'],
  ['actuarial_loss', 'act.loss'],
  ['closing', 'act.closing'],
  ['plan_assets', 'act.assets'],
  ['book_balance', 'act.book'],
] as const;
type Fig = (typeof FIGURES)[number][0];

/**
 * 7T: record an actuary's gratuity / leave valuation (AS-15 / Ind AS 19) and post the provision
 * journal from it. The valuation itself must come from a qualified actuary — nothing is computed here.
 */
export function ActuarialPanel({ version, refresh, notify }: TabProps) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const list = useMemo(() => loadActuarial(), [version]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const voucherIds = useMemo(() => new Set(loadVouchers().map((x) => x.id)), [version]);
  const [kind, setKind] = useState<ActuarialKind>('gratuity');
  const [standard, setStandard] = useState<ActuarialStandard>('as15');
  const [date, setDate] = useState(todayInput());
  const [actuary, setActuary] = useState('');
  const [report, setReport] = useState('');
  const [discount, setDiscount] = useState('');
  const [escalation, setEscalation] = useState('');
  const [fig, setFig] = useState<Record<Fig, string>>({ opening: '', current_service_cost: '', interest_cost: '', past_service_cost: '', benefits_paid: '', actuarial_loss: '', closing: '', plan_assets: '', book_balance: '' });
  const v = (k: Fig) => parseAmount(fig[k]) ?? 0;
  const figures = { opening: v('opening'), current_service_cost: v('current_service_cost'), interest_cost: v('interest_cost'), past_service_cost: v('past_service_cost'), benefits_paid: v('benefits_paid'), actuarial_loss: v('actuarial_loss'), closing: v('closing') };
  const chk = actuarialCheck(figures);
  const assets = parseAmount(fig.plan_assets);
  // The provision in the books defaults to the last valuation's net liability for this benefit, else the opening obligation.
  const last = list.filter((x) => x.kind === kind && x.date < date).sort((a, b) => b.date.localeCompare(a.date))[0];
  const book = parseAmount(fig.book_balance) ?? (last ? last.closing - (last.plan_assets ?? 0) : figures.opening);
  const j = actuarialJournal({ kind, standard, closing: figures.closing, plan_assets: assets ?? undefined, book_balance: book, actuarial_loss: figures.actuarial_loss });

  const save = () =>
    saveActuarial({
      kind,
      standard,
      date,
      actuary: actuary.trim(),
      ...(report.trim() ? { report_ref: report.trim() } : {}),
      ...(parseAmount(discount) !== null ? { discount_rate: parseAmount(discount)! } : {}),
      ...(parseAmount(escalation) !== null ? { salary_escalation: parseAmount(escalation)! } : {}),
      ...figures,
      ...(assets !== null ? { plan_assets: assets } : {}),
      book_balance: book,
    });

  return (
    <section className={surface.card}>
      <div className={surface.cardBody}>
        <h2 className={styles.h2}>{mT('act.title')}</h2>
        <p className={styles.note}>{mT('act.hint')}</p>
        <div className={styles.formGrid}>
          <label className={controls.field}>
            <span className={controls.label}>{mT('act.kind')}</span>
            <select className={controls.select} value={kind} onChange={(e) => setKind(e.target.value as ActuarialKind)}>
              <option value="gratuity">{mT('act.gratuity')}</option>
              <option value="leave">{mT('act.leave')}</option>
            </select>
          </label>
          <label className={controls.field}>
            <span className={controls.label}>{mT('act.standard')}</span>
            <select className={controls.select} value={standard} onChange={(e) => setStandard(e.target.value as ActuarialStandard)}>
              <option value="as15">{mT('act.as15')}</option>
              <option value="indas19">{mT('act.indas19')}</option>
            </select>
          </label>
          <label className={controls.field}><span className={controls.label}>{mT('act.date')}</span><input className={controls.input} type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label className={controls.field}><span className={controls.label}>{mT('act.actuary')}</span><input className={controls.input} value={actuary} onChange={(e) => setActuary(e.target.value)} /></label>
          <label className={controls.field}><span className={controls.label}>{mT('act.report')}</span><input className={controls.input} value={report} onChange={(e) => setReport(e.target.value)} /></label>
          <label className={controls.field}><span className={controls.label}>{mT('act.discount')}</span><input className={controls.inputNumeric} type="number" step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} /></label>
          <label className={controls.field}><span className={controls.label}>{mT('act.escalation')}</span><input className={controls.inputNumeric} type="number" step="0.01" value={escalation} onChange={(e) => setEscalation(e.target.value)} /></label>
        </div>
        <div className={styles.formGrid}>
          {FIGURES.map(([k, label]) => (
            <label key={k} className={controls.field}>
              <span className={controls.label}>{mT(label)}</span>
              <input className={controls.inputNumeric} type="number" step="0.01" placeholder={k === 'book_balance' ? String(book) : undefined} value={fig[k]} onChange={(e) => setFig({ ...fig, [k]: e.target.value })} />
            </label>
          ))}
        </div>
        <p className={chk.ok ? styles.sub : controls.error}>{chk.ok ? mT('act.ok') : mT('act.check', { expected: inr(chk.expected_closing), diff: inr(chk.difference) })}</p>
        <p className={styles.strong}>{mT('act.journal', { movement: inr(j.movement), pnl: inr(j.pnl), oci: inr(j.oci) })}</p>
        <button type="button" className={controls.btnOutline} onClick={() => runAction(() => void save(), refresh, notify, mT('act.saved'))}>
          <Save size={15} /> {mT('act.save')}
        </button>
        {list.length > 0 && (
          <div className={surface.tableWrap}>
            <table className={surface.table}>
              <caption className={surface.srOnly}>{mT('act.list')}</caption>
              <thead><tr><th>{mT('act.number')}</th><th>{mT('act.kind')}</th><th>{mT('act.date')}</th><th className={styles.num}>{mT('act.closing')}</th><th>{mT('act.status')}</th><th /></tr></thead>
              <tbody>
                {list.map((x) => (
                  <tr key={x.id}>
                    <td>{x.number}<span className={styles.sub}>{x.actuary}{x.standard === 'indas19' ? ' · Ind AS 19' : ' · AS-15'}</span></td>
                    <td>{x.kind === 'gratuity' ? mT('act.gratuity') : mT('act.leave')}</td>
                    <td>{x.date}</td>
                    <td className={styles.num}>{inr(x.closing)}</td>
                    <td>
                      {x.voucher_id && voucherIds.has(x.voucher_id) ? (
                        mT('act.postedAs', { number: x.voucher_number ?? '' })
                      ) : (
                        <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => runAction(() => void postActuarialJournal(x.id), refresh, notify, mT('act.posted'))}>
                          <BookCheck size={14} /> {mT('act.post')}
                        </button>
                      )}
                    </td>
                    <td className={styles.num}><button type="button" className={controls.btnDanger} aria-label={mT('act.delete', { number: x.number })} onClick={() => runAction(() => deleteActuarial(x.id), refresh, notify, mT('act.deleted'))}><Trash2 size={15} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
