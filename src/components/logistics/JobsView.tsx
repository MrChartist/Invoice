/**
 * R19-A2 jobs view: one FY's job files with filters (status, mode, direction, client, agent; salesperson / branch
 * are on the job for D4's reports),
 * totals of jobs / chargeable kg / TEU, status chips, "New job", "Duplicate job" and a job's page (`JobForm`; B–D add
 * its charges, documents, costs, disbursements and deposits).
 */
import { useMemo, useState } from 'react';
import { useT } from '../../i18n';
import { lgList, lgT } from '../../i18n/areas/logistics-r19a';
import { localDb } from '../../lib/localDb';
import { getIndianFY } from '../../lib/invoice-number';
import { todayInput } from '../../lib/utils';
import { duplicateJob, filterJobs, jobTotals, LG_DIRS, LG_MODES, LG_STATUSES, type JobFilter } from '../../lib/logistics/lg-job';
import { loadJobs } from '../../lib/logistics/lg-save';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import JobForm, { type JobDraft } from './JobForm';
import { Pick, type LgViewProps } from './lg-ui';
import { row } from './lg-form';

const sm = (c: string) => `${c} ${controls.btnSm}`;

export default function JobsView({ notify }: LgViewProps) {
  useT();
  const [tick, setTick] = useState(0);
  const [open, setOpen] = useState<{ id?: string; draft?: JobDraft } | null>(null);
  const [f, setF] = useState<JobFilter>({ fy: getIndianFY(todayInput()).label });
  const data = useMemo(() => {
    void tick;
    const clients = localDb.clients.getAll();
    return { jobs: loadJobs(), clients, name: new Map(clients.map((c) => [c.id ?? '', c.name])) };
  }, [tick]);
  if (open) return <JobForm key={open.id ?? 'new'} job={data.jobs.find((j) => j.id === open.id)} draft={open.draft} clients={data.clients} notify={notify} onDone={() => { setTick((t) => t + 1); setOpen(null); }} />;
  const shown = filterJobs(data.jobs, f);
  const tot = jobTotals(shown);
  const who = (x: string) => data.name.get(x) ?? x;
  const uniq = (k: 'client_id' | 'agent_id') => [...new Set(data.jobs.map((j) => j[k] ?? '').filter(Boolean))];
  const fys = [...new Set([f.fy!, ...data.jobs.map((j) => getIndianFY(j.date).label)])].sort().reverse();
  const filters: [keyof JobFilter, readonly string[], (x: string) => string][] = [
    ['status', LG_STATUSES, (x) => lgList('statuses', LG_STATUSES, x)], ['mode', LG_MODES, (x) => lgList('modes', LG_MODES, x)], ['dir', LG_DIRS, (x) => lgList('dirs', LG_DIRS, x)],
    ['client', uniq('client_id'), who], ['agent', uniq('agent_id'), who],
  ];
  return (
    <>
      <div style={row}>
        <button type="button" className={controls.btnPrimary} onClick={() => setOpen({})} data-lg-new-job>{lgT('newJob')}</button>
        <Pick label={lgT('fy')} value={f.fy ?? ''} ids={fys} name={(x) => `FY ${x}`} onChange={(v) => setF({ ...f, fy: v })} />
        {filters.map(([k, ids, name]) => ids.length > 0 && <Pick key={k} label={lgT(k)} value={f[k] ?? ''} ids={ids} name={name} blank={lgT('all')} onChange={(v) => setF({ ...f, [k]: v || undefined })} />)}
      </div>
      {shown.length ? (
        <div className={surface.tableWrap}>
          <table className={surface.table}>
            <thead><tr>{(['job', 'date', 'client', 'shipment', 'route', 'status', 'chargeable'] as const).map((k) => <th key={k}>{lgT(k)}</th>)}<th /></tr></thead>
            <tbody>
              {shown.map((j) => (
                <tr key={j.id} data-lg-job={j.number}>
                  <td>{j.number}</td>
                  <td>{j.date.split('-').reverse().join('/')}</td>
                  <td>{who(j.client_id)}</td>
                  <td>{lgList('dirs', LG_DIRS, j.dir)} · {lgList('modes', LG_MODES, j.mode)}</td>
                  <td>{j.origin} → {j.destination}</td>
                  <td><span className={surface.badge}>{lgList('statuses', LG_STATUSES, j.status)}</span></td>
                  <td>{j.chargeable_kg ?? ''}</td>
                  <td>
                    <button type="button" className={sm(controls.btnOutline)} onClick={() => setOpen({ id: j.id })}>{lgT('open')}</button>
                    <button type="button" className={sm(controls.btnGhost)} onClick={() => setOpen({ draft: duplicateJob(j, todayInput()) })}>{lgT('dup')}</button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><th>{lgT('total')} ({tot.count})</th><td colSpan={5} /><td>{tot.kg} kg · {tot.teu} {lgT('teu')}</td><td /></tr></tfoot>
          </table>
        </div>
      ) : <p className={controls.hint}>{lgT('none')}</p>}
    </>
  );
}
