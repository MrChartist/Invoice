/**
 * R19-D4 reports view (`&view=reports`): margin by lane / client / salesperson / month (one FY's jobs), agent balances
 * and disbursements ageing — each on screen and as CSV (the deposits position is C's customs view). The TDS-on-receipts view was cut (PRD §3
 * cut 3). Margin is this view's own reading of the jobs' bills and tagged costs (B's job costing owns the job P&L).
 */
import { useMemo, useState } from 'react';
import { useT } from '../../i18n';
import { lgT } from '../../i18n/areas/logistics-r19a';
import { lgdT } from '../../i18n/areas/logistics-r19d';
import { localDb } from '../../lib/localDb';
import { getTable } from '../../lib/storage';
import { getIndianFY } from '../../lib/invoice-number';
import { todayInput } from '../../lib/utils';
import { disbAgeing, jobPnl, MARGIN_BY, marginBy, type MarginBy } from '../../lib/logistics/lg-reports';
import { agentStatement, lgAgents } from '../../lib/logistics/lg-agents';
import { loadJobs } from '../../lib/logistics/lg-save';
import type { PurchaseRecord, Vendor } from '../../types/purchases';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import { Pick, type LgViewProps } from './lg-ui';
import { row } from './lg-form';
import { downloadCsv } from './lg-d-seam';

type Rows = (string | number)[][];
function Tbl({ id, rows }: { id: string; rows: Rows }) {
  return (
    <section data-lg-report={id}>
      <div style={row}><h3 style={{ margin: 0 }}>{lgdT(`r_${id}` as 'r_margin')}</h3><button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => downloadCsv(`${id}.csv`, rows)}>CSV</button></div>
      {rows.length > 1 ? (
        <div className={surface.tableWrap}><table className={surface.table}><thead><tr>{rows[0].map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
          <tbody>{rows.slice(1).map((r, i) => <tr key={i}>{r.map((c, k) => <td key={k}>{typeof c === 'number' && !Number.isInteger(c) ? c.toFixed(2) : c}</td>)}</tr>)}</tbody></table></div>
      ) : null}
    </section>
  );
}

export default function ReportsView(_: LgViewProps) {
  useT();
  const [by, setBy] = useState<MarginBy>('lane');
  const [fy, setFy] = useState(() => getIndianFY(todayInput()).label);
  const d = useMemo(() => {
    const clients = localDb.clients.getAll(), inv = localDb.invoices.getAll(), pur = getTable<PurchaseRecord>('purchases'), jobs = loadJobs();
    return { clients, inv, pur, jobs, pnl: jobPnl(inv, pur), agents: lgAgents(getTable<Vendor>('vendors'), clients) };
  }, []);
  const jobs = d.jobs.filter((j) => getIndianFY(j.date).label === fy);
  const fys = [...new Set([fy, ...d.jobs.map((j) => getIndianFY(j.date).label)])].sort().reverse();
  const name = (id: string) => d.clients.find((c) => c.id === id)?.name ?? id;
  const [h1, h2, h3] = [lgdT('hMargin'), lgdT('hAgents'), lgdT('hAgeing')].map((h) => h.split(','));
  const margin: Rows = [h1, ...marginBy(by, jobs, d.pnl, name).map((r) => [r.key, r.jobs, r.revenue, r.cost, r.margin, r.pct])];
  const agents: Rows = [h2, ...d.agents.map((a) => { const s = agentStatement(a, d.inv, d.pur); return [a.vendor.name, s.ours, s.theirs, s.net]; })];
  const ageing: Rows = [h3, ...disbAgeing(jobs, d.inv, d.pur, todayInput()).map((r) => [r.job, ...r.b, r.total])];
  return (
    <>
      <div style={row}>
        <Pick label={lgT('fy')} value={fy} ids={fys} name={(x) => `FY ${x}`} onChange={setFy} />
        <Pick label={lgdT('by')} value={by} ids={MARGIN_BY} name={(x) => lgdT('byList').split(',')[MARGIN_BY.indexOf(x as MarginBy)] ?? x} onChange={(v) => setBy(v as MarginBy)} attr="report-by" />
      </div>
      <Tbl id="margin" rows={margin} />
      <Tbl id="agents" rows={agents} />
      <Tbl id="ageing" rows={ageing} />
    </>
  );
}
