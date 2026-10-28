/**
 * R19-A2 jobs view: one FY's job files with filters (status, mode, direction, client, agent, salesperson, branch),
 * totals of jobs / chargeable kg / TEU, status chips, "New job", "Duplicate job" and a job's page (`JobForm`; B–D add
 * its charges, documents, costs, disbursements and deposits). `&quote=<id>` opens a new job from a quotation.
 */
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useT } from '../../i18n';
import { lgList, lgT } from '../../i18n/areas/logistics-r19a';
import { localDb } from '../../lib/localDb';
import { getIndianFY } from '../../lib/invoice-number';
import { todayInput } from '../../lib/utils';
import { duplicateJob, filterJobs, jobTotals, LG_DIRS, LG_MODES, LG_STATUSES, type JobFilter } from '../../lib/logistics/lg-job';
import { jobFromQuote } from '../../lib/logistics/lg-rates';
import { loadJobs } from '../../lib/logistics/lg-save';
import type { LgJob } from '../../types/logistics-r19';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import JobForm, { type JobDraft } from './JobForm';
import { Pick, row, type LgViewProps } from './lg-ui';

export default function JobsView({ notify }: LgViewProps) {
  useT();
  const [params, setParams] = useSearchParams();
  const [tick, setTick] = useState(0);
  const [open, setOpen] = useState<{ id?: string; draft?: JobDraft } | null>(() => {
    const q = params.get('quote') ? localDb.invoices.getAll().find((i) => i.id === params.get('quote')) : undefined;
    const c = q ? localDb.clients.getAll().find((x) => x.name === q.client?.name) : undefined;
    const d = q && c?.id ? jobFromQuote(q, c.id) : null;
    return d ? { draft: d } : null;
  });
  const [f, setF] = useState<JobFilter>({ fy: getIndianFY(todayInput()).label });
  const data = useMemo(() => {
    void tick;
    const clients = localDb.clients.getAll();
    return { jobs: loadJobs(), clients, name: new Map(clients.map((c) => [c.id ?? '', c.name])) };
  }, [tick]);
  const done = () => { setTick((t) => t + 1); setOpen(null); if (params.get('quote')) setParams({ tab: 'shipments', view: 'jobs' }, { replace: true }); };
  if (open) return <JobForm key={open.id ?? 'new'} job={data.jobs.find((j) => j.id === open.id)} draft={open.draft} clients={data.clients} notify={notify} onDone={done} />;
  const shown = filterJobs(data.jobs, f);
  const tot = jobTotals(shown);
  const uniq = (k: keyof LgJob) => [...new Set(data.jobs.map((j) => String(j[k] ?? '')).filter(Boolean))];
  const fys = [...new Set([f.fy!, ...data.jobs.map((j) => getIndianFY(j.date).label)])].sort().reverse();
  const pick = (k: keyof JobFilter, label: string, ids: readonly string[], name: (id: string) => string = (x) => x) => (ids.length > 0 && <Pick label={label} value={f[k] ?? ''} ids={ids} name={name} blank={lgT('all')} onChange={(v) => setF({ ...f, [k]: v || undefined })} />);
  return (
    <>
      <div style={row}>
        <button type="button" className={controls.btnPrimary} onClick={() => setOpen({})} data-lg-new-job>{lgT('newJob')}</button>
        <Pick label={lgT('fy')} value={f.fy ?? ''} ids={fys} name={(x) => `FY ${x}`} onChange={(v) => setF({ ...f, fy: v })} />
        {pick('status', lgT('status'), LG_STATUSES, (x) => lgList('statuses', LG_STATUSES, x))}
        {pick('mode', lgT('mode'), LG_MODES, (x) => lgList('modes', LG_MODES, x))}
        {pick('dir', lgT('dir'), LG_DIRS, (x) => lgList('dirs', LG_DIRS, x))}
        {pick('client', lgT('client'), uniq('client_id'), (x) => data.name.get(x) ?? x)}
        {pick('agent', lgT('agent'), uniq('agent_id'), (x) => data.name.get(x) ?? x)}
        {pick('salesperson', lgT('salesperson'), uniq('salesperson'))}
        {pick('branch', lgT('branch'), uniq('branch'))}
      </div>
      {shown.length ? (
        <div className={surface.tableWrap}>
          <table className={surface.table} data-lg-jobs>
            <thead><tr><th>{lgT('job')}</th><th>{lgT('date')}</th><th>{lgT('client')}</th><th>{lgT('shipment')}</th><th>{lgT('origin')} → {lgT('destination')}</th><th>{lgT('status')}</th><th className={surface.numeric}>{lgT('chargeable')}</th><th /></tr></thead>
            <tbody>
              {shown.map((j) => (
                <tr key={j.id} data-lg-job={j.number}>
                  <td>{j.number}</td>
                  <td>{j.date.split('-').reverse().join('/')}</td>
                  <td>{data.name.get(j.client_id) ?? ''}</td>
                  <td>{lgList('dirs', LG_DIRS, j.dir)} · {lgList('modes', LG_MODES, j.mode)}</td>
                  <td>{j.origin} → {j.destination}</td>
                  <td><span className={surface.badge}>{lgList('statuses', LG_STATUSES, j.status)}</span></td>
                  <td className={surface.numeric}>{j.chargeable_kg ?? ''}</td>
                  <td>
                    <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => setOpen({ id: j.id })} data-lg-open-job={j.number}>{lgT('open')}</button>
                    <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => setOpen({ draft: duplicateJob(j, todayInput()) })}>{lgT('dup')}</button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><th>{lgT('total')} ({tot.count})</th><td colSpan={5} /><td className={surface.numeric}>{tot.kg} kg · {tot.teu} {lgT('teu')}</td><td /></tr></tfoot>
          </table>
        </div>
      ) : <p className={controls.hint}>{lgT('none')}</p>}
    </>
  );
}
