/**
 * R19-B3 costing view (`costing`): one FY's jobs with revenue (pure-agent recoveries left out), cost (bills tagged on
 * the purchase-bill form), margin and %, flags (unbilled, uncosted, below the margin alert), the margin alert setting
 * and margins grouped by client / lane / salesperson / month. The accrual journals were cut (PRD §3 cut 2).
 * Working papers — verify with your CA (LG34).
 */
import { useMemo, useState } from 'react';
import { t, useT } from '../../i18n';
import { lgT } from '../../i18n/areas/logistics-r19a';
import { lgbT } from '../../i18n/areas/logistics-r19b';
import { localDb } from '../../lib/localDb';
import { getIndianFY } from '../../lib/invoice-number';
import { formatCurrency, todayInput } from '../../lib/utils';
import { loadJobs } from '../../lib/logistics/lg-save';
import { readLogisticsSettings, saveLogisticsSettings } from '../../lib/logistics/lg-settings';
import { groupPnl, type PnlBy } from '../../lib/logistics/lg-costing';
import { jobPnls } from '../../lib/logistics/lg-books-io';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import { Field, Pick, type LgViewProps } from './lg-ui';
import { numIn, row } from './lg-form';

const BY: readonly PnlBy[] = ['client', 'lane', 'salesperson', 'month'];
const inr = (n: number) => formatCurrency(n, 'INR');
const pc = (p: number | null) => (p === null ? '-' : `${p} %`);

export default function CostingView({ notify }: LgViewProps) {
  useT();
  const [alert, setAlert] = useState(() => readLogisticsSettings().margin_alert_pct);
  const [by, setBy] = useState<PnlBy>('client');
  const d = useMemo(() => {
    const fy = getIndianFY(todayInput()).label;
    const rows = jobPnls(loadJobs().filter((j) => j.status !== 'cancelled' && getIndianFY(j.date).label === fy), alert);
    return { rows, name: new Map(localDb.clients.getAll().map((c) => [c.id ?? '', c.name])) };
  }, [alert]);
  const flags = (r: (typeof d.rows)[number]) => (['unbilled', 'uncosted', 'low'] as const).filter((k) => r[k]).map((k) => lgbT(k)).join(', ');
  const tot = d.rows.reduce((a, r) => ({ revenue: a.revenue + r.revenue, cost: a.cost + r.cost }), { revenue: 0, cost: 0 });
  return (
    <section data-lg-costing>
      <div style={row}>
        <Field label={lgbT('alert')}><input type="number" min={0} className={controls.input} style={{ width: '6rem' }} value={alert ?? ''} onChange={(e) => setAlert(numIn(e.target.value))} /></Field>
        <button type="button" className={controls.btnOutline} onClick={() => { try { saveLogisticsSettings({ margin_alert_pct: alert }); notify(lgT('saved')); } catch (e) { notify((e as Error).message, 'error'); } }}>{t('common.save')}</button>
        <Pick label={lgbT('groupBy')} value={by} ids={BY} name={(x) => lgbT('by').split(',')[BY.indexOf(x as PnlBy)]} onChange={(v) => setBy(v as PnlBy)} />
      </div>
      {d.rows.length ? (
        <div className={surface.tableWrap}>
          <table className={surface.table}>
            <thead><tr><th>{lgT('job')}</th><th>{lgT('client')}</th>{(['revenue', 'cost', 'margin', 'pct', 'flags'] as const).map((k) => <th key={k}>{lgbT(k)}</th>)}</tr></thead>
            <tbody>
              {d.rows.map((r) => (
                <tr key={r.job.id} data-lg-pnl={r.job.number}>
                  <td>{r.job.number}</td>
                  <td>{d.name.get(r.job.client_id) ?? r.job.client_id}</td>
                  <td data-lg-rev>{inr(r.revenue)}</td>
                  <td data-lg-cost>{inr(r.cost)}</td>
                  <td data-lg-margin>{inr(r.margin)}</td>
                  <td data-lg-pct>{pc(r.pct)}</td>
                  <td>{flags(r)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><th colSpan={2}>{lgT('total')}</th><td>{inr(tot.revenue)}</td><td>{inr(tot.cost)}</td><td>{inr(tot.revenue - tot.cost)}</td><td colSpan={2} /></tr></tfoot>
          </table>
        </div>
      ) : <p className={controls.hint}>{lgT('none')}</p>}
      <div className={surface.tableWrap}>
        <table className={surface.table}>
          <thead><tr><th>{lgbT('by').split(',')[BY.indexOf(by)]}</th><th>{lgT('jobs')}</th>{(['revenue', 'cost', 'margin', 'pct'] as const).map((k) => <th key={k}>{lgbT(k)}</th>)}</tr></thead>
          <tbody>{groupPnl(d.rows, by).map((g) => <tr key={g.key}><td>{by === 'client' ? d.name.get(g.key) ?? g.key : g.key || '-'}</td><td>{g.jobs}</td><td>{inr(g.revenue)}</td><td>{inr(g.cost)}</td><td>{inr(g.margin)}</td><td>{pc(g.pct)}</td></tr>)}</tbody>
        </table>
      </div>
    </section>
  );
}
