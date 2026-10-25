import { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { cn, formatDate, formatMoney } from '../../lib/utils';
import { num } from '../../lib/invoice-calc';
import { localDb } from '../../lib/localDb';
import { downloadText } from '../../lib/download';
import { getIndianFY } from '../../lib/invoice-number';
import { buildItc04, itc04Csv, itc04Frequency, itc04Periods, type Itc04Frequency } from '../../lib/itc04';
import { jwT } from '../../i18n/areas/job-work';
import type { JwData } from './lines';
import surface from '../../styles/surface.module.css';
import controls from '../../styles/controls.module.css';
import styles from './job-work.module.css';

/** ITC-04 working paper: Table 4 (sent) and Table 5A / 5B / 5C (received back / supplied), per return period. */
export function Itc04Panel({ data }: { data: JwData }) {
  const { ctx } = data;
  const thisFy = getIndianFY(data.today).startYear;
  const [fy, setFy] = useState(thisFy);
  const [turnover, setTurnover] = useState('');
  const auto = itc04Frequency(num(turnover), `${fy}-04-01`);
  const [override, setOverride] = useState<Itc04Frequency | ''>('');
  const freq = override || auto;
  const periods = itc04Periods(fy, freq);
  const [periodKey, setPeriodKey] = useState('');
  const period = periods.find((p) => p.key === periodKey) ?? periods[0];
  const profile = localDb.settings.activeProfile();
  const [state, setState] = useState(profile?.stateCode || (profile?.companyGstin ?? '').slice(0, 2));
  const orderProcess = useMemo(() => Object.fromEntries(data.orders.filter((o) => o.process).map((o) => [o.id, o.process as string])), [data.orders]);
  // Cheap over a year of challans: rebuilt on each render, no memo.
  const report = buildItc04(data.outs, data.ins, period.from, period.to, { items: ctx.items, units: data.units, ourStateCode: state || undefined, orderProcess });
  const freqLabel = (f: Itc04Frequency) => (f === 'Q' ? jwT('freqQ') : f === 'H' ? jwT('freqH') : jwT('freqA'));

  return (
    <>
      <p className={cn(styles.notice, styles.info)}>{jwT('itcIntro')}</p>
      <div className={controls.row3} style={{ marginTop: '0.75rem' }}>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="itc-fy">{jwT('fy')}</label>
          <select id="itc-fy" className={controls.select} value={fy} onChange={(e) => { setFy(Number(e.target.value)); setPeriodKey(''); }}>
            {[0, 1, 2, 3, 4].map((d) => thisFy - d).map((y) => <option key={y} value={y}>FY {y}-{String(y + 1).slice(2)}</option>)}
          </select>
        </div>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="itc-to">{jwT('turnover')}</label>
          <input id="itc-to" className={cn(controls.input, controls.inputNumeric)} inputMode="decimal" value={turnover} onChange={(e) => { setTurnover(e.target.value); setPeriodKey(''); }} />
        </div>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="itc-freq">{jwT('frequency')}</label>
          <select id="itc-freq" className={controls.select} value={override} onChange={(e) => { setOverride(e.target.value as Itc04Frequency | ''); setPeriodKey(''); }}>
            <option value="">{freqLabel(auto)}</option>
            {(['Q', 'H', 'A'] as const).filter((f) => f !== auto).map((f) => <option key={f} value={f}>{freqLabel(f)}</option>)}
          </select>
        </div>
      </div>
      <p className={styles.muted}>{jwT('freqRule')}</p>
      <div className={controls.row3}>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="itc-per">{jwT('period')}</label>
          <select id="itc-per" className={controls.select} value={period.key} onChange={(e) => setPeriodKey(e.target.value)}>
            {periods.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
          <span className={styles.muted}>{formatDate(period.from)} – {formatDate(period.to)} · {jwT('dueOn', { date: formatDate(period.due) })}</span>
        </div>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="itc-st">{jwT('ourState')}</label>
          <input id="itc-st" className={controls.input} inputMode="numeric" maxLength={2} value={state} onChange={(e) => setState(e.target.value.replace(/\D/g, ''))} />
        </div>
        <div className={controls.field} style={{ justifyContent: 'flex-end' }}>
          <button type="button" className={cn(controls.btnOutline, controls.btnSm)} onClick={() => downloadText(`ITC-04-${period.key}.csv`, itc04Csv(report), 'text/csv')}>
            <Download size={14} aria-hidden="true" /> {jwT('downloadCsv')}
          </button>
        </div>
      </div>
      <h3 className={styles.heading}>{jwT('table4')}</h3>
      <div className={surface.tableWrap}>
        <table className={surface.table}>
          <thead>
            <tr>
              <th>{jwT('challanNo')}</th><th>{jwT('jobWorker')}</th><th>{jwT('item')}</th><th>{jwT('hsn')}</th><th>{jwT('uqc')}</th>
              <th className={styles.num}>{jwT('qty')}</th><th className={styles.num}>{jwT('taxable')}</th><th>{jwT('goodsKind')}</th>
              <th className={styles.num}>{jwT('igst')}</th><th className={styles.num}>{jwT('cgst')}</th><th className={styles.num}>{jwT('sgst')}</th>
            </tr>
          </thead>
          <tbody>
            {report.table4.map((r, i) => (
              <tr key={`${r.challan_no}-${i}`}>
                <td className={styles.mono}>{r.challan_no}<div className={styles.muted}>{formatDate(r.challan_date)}</div></td>
                <td>{r.jw_gstin || r.jw_state || '—'}</td>
                <td>{r.item}</td><td>{r.hsn}</td><td>{r.uqc}</td>
                <td className={styles.num}>{r.qty}</td><td className={styles.num}>{formatMoney(r.taxable_value)}</td><td>{r.goods_type}</td>
                <td className={styles.num}>{formatMoney(r.igst)}</td><td className={styles.num}>{formatMoney(r.cgst)}</td><td className={styles.num}>{formatMoney(r.sgst)}</td>
              </tr>
            ))}
            {report.table4.length === 0 && <tr><td colSpan={11} className={styles.muted}>{jwT('empty')}</td></tr>}
          </tbody>
        </table>
      </div>
      <h3 className={styles.heading}>{jwT('table5')}</h3>
      <div className={surface.tableWrap}>
        <table className={surface.table}>
          <thead>
            <tr>
              <th>{jwT('tableCol')}</th><th>{jwT('jobWorker')}</th><th>{jwT('jwChallan')}</th><th>{jwT('originalChallan')}</th><th>{jwT('item')}</th>
              <th>{jwT('uqc')}</th><th className={styles.num}>{jwT('qty')}</th><th>{jwT('process')}</th><th className={styles.num}>{jwT('lossQty')}</th>
            </tr>
          </thead>
          <tbody>
            {report.table5.map((r, i) => (
              <tr key={`${r.table}-${r.jw_challan_no}-${i}`}>
                <td><span className={styles.badge}>{r.table}</span></td>
                <td>{r.via ?? (r.jw_gstin || r.jw_state || '—')}</td>
                <td className={styles.mono}>{r.jw_challan_no}<div className={styles.muted}>{formatDate(r.jw_challan_date)}</div></td>
                <td className={styles.mono}>{r.original_challan_no}<div className={styles.muted}>{r.original_challan_date ? formatDate(r.original_challan_date) : ''}</div></td>
                <td>{r.item}</td><td>{r.uqc}</td><td className={styles.num}>{r.qty}</td><td>{r.nature}</td><td className={styles.num}>{r.loss_qty || '—'}</td>
              </tr>
            ))}
            {report.table5.length === 0 && <tr><td colSpan={9} className={styles.muted}>{jwT('empty')}</td></tr>}
          </tbody>
        </table>
      </div>
      {report.unmatched > 0 && <p className={styles.notice} role="status">{jwT('unmatchedNote', { n: report.unmatched })}</p>}
      <ul className={styles.muted}>{report.notes.map((n) => <li key={n}>{n}</li>)}</ul>
    </>
  );
}
