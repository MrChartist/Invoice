/**
 * R19-A2 job form (a job's page): date, status, direction, mode (multimodal legs), incoterm, ports, destination
 * country, ETD / ETA, client, shipper / consignee, overseas agent, salesperson, branch; references by mode (HAWB /
 * MAWB / flight, or HBL / MBL / vessel / voyage), shipping bill or bill of entry, IGM; containers (FCL); packages, gross
 * kg, dimensions and CBM with the chargeable weight worked out live (`chargeableWeight`). Save shows the hints (check
 * digit, document dates); close / re-open and delete are on the saved job. B–D add the job's tabs below the form.
 */
import { useState } from 'react';
import { useT } from '../../i18n';
import { lgList, lgT } from '../../i18n/areas/logistics-r19a';
import type { Client } from '../../types/invoice';
import type { LgDims, LgJob, LgLeg, LgRefs } from '../../types/logistics-r19';
import { todayInput } from '../../lib/utils';
import { LG_DIRS, LG_MODES, LG_SIZES, LG_STATUSES } from '../../lib/logistics/lg-job';
import { chargeableWeight } from '../../lib/logistics/lg-weight';
import { deleteJob, saveJob, setJobStatus } from '../../lib/logistics/lg-save';
import { readLogisticsSettings } from '../../lib/logistics/lg-settings';
import controls from '../../styles/controls.module.css';
import { Field, In, Pick, numIn, row, type Notify } from './lg-ui';

export type JobDraft = Omit<LgJob, 'id' | 'number' | 'updated_at'>;
const LEGS: readonly LgLeg[] = ['road', 'rail', 'sea', 'air', 'inland_water'];
const DIM_KEYS = ['l', 'w', 'h', 'n'] as const;

export default function JobForm({ job, draft, clients, notify, onDone }: { job?: LgJob; draft?: JobDraft; clients: readonly Client[]; notify: Notify; onDone: () => void }) {
  useT();
  const [j, setJ] = useState<JobDraft>(() => job ?? draft ?? { date: todayInput(), status: 'booked', dir: 'export', mode: 'air', origin: '', destination: '', client_id: '', refs: {} });
  const set = (p: Partial<JobDraft>) => setJ((x) => ({ ...x, ...p }));
  const ref = (k: keyof LgRefs, type: 'text' | 'date' = 'text') => <In key={k} label={lgT(k === 'sb_no' ? 'sbNo' : k === 'sb_date' ? 'sbDate' : k === 'boe_no' ? 'boeNo' : k === 'boe_date' ? 'boeDate' : k)} type={type} value={j.refs[k]} onChange={(v) => set({ refs: { ...j.refs, [k]: v } })} attr={k} />;
  const ids = clients.map((c) => c.id ?? '').filter(Boolean);
  const name = (id: string) => clients.find((c) => c.id === id)?.name ?? id;
  const cw = chargeableWeight({ gross_kg: j.gross_kg, dims: j.dims, cbm: j.cbm, mode: j.mode, settings: readLogisticsSettings() });
  const run = (fn: () => string | void) => { try { notify(fn() || lgT('saved')); onDone(); } catch (e) { notify((e as Error).message, 'error'); } };
  const save = () => run(() => saveJob({ ...j, id: job?.id, ...(cw.unit === 'kg' ? { chargeable_kg: cw.value } : { chargeable_kg: undefined, cbm: cw.value }) }, readLogisticsSettings().job_prefix).hints.join(' '));
  const air = j.mode === 'air' || j.mode === 'courier';
  const dims = j.dims ?? [];
  return (
    <section data-lg-job-form>
      {job && <h3 data-lg-job-no>{job.number}</h3>}
      <div style={row}>
        <In label={lgT('date')} type="date" value={j.date} onChange={(v) => set({ date: v })} />
        <Pick label={lgT('status')} value={j.status} ids={LG_STATUSES} name={(x) => lgList('statuses', LG_STATUSES, x)} onChange={(v) => set({ status: v as LgJob['status'] })} />
        <Pick label={lgT('dir')} value={j.dir} ids={LG_DIRS} name={(x) => lgList('dirs', LG_DIRS, x)} onChange={(v) => set({ dir: v as LgJob['dir'] })} attr="dir" />
        <Pick label={lgT('mode')} value={j.mode} ids={LG_MODES} name={(x) => lgList('modes', LG_MODES, x)} onChange={(v) => set({ mode: v as LgJob['mode'] })} attr="mode" />
        <In label={lgT('incoterm')} value={j.incoterm} onChange={(v) => set({ incoterm: v.toUpperCase() })} />
        <Pick label={lgT('client')} value={j.client_id} ids={ids} name={name} blank="" onChange={(v) => set({ client_id: v })} attr="client" />
        <Pick label={lgT('agent')} value={j.agent_id ?? ''} ids={ids} name={name} blank="" onChange={(v) => set({ agent_id: v || undefined })} />
      </div>
      {j.mode === 'multimodal' && (
        <div style={row} aria-label={lgT('legs')}>
          {LEGS.map((l) => <label key={l} className={controls.check}><input type="checkbox" checked={!!j.legs?.includes(l)} onChange={() => set({ legs: j.legs?.includes(l) ? j.legs.filter((x) => x !== l) : [...(j.legs ?? []), l] })} /> {lgList('legList', LEGS, l)}</label>)}
        </div>
      )}
      <div style={row}>
        <In label={lgT('origin')} value={j.origin} onChange={(v) => set({ origin: v })} attr="origin" />
        <In label={lgT('destination')} value={j.destination} onChange={(v) => set({ destination: v })} attr="destination" />
        <In label={lgT('country')} value={j.dest_country} onChange={(v) => set({ dest_country: v.toUpperCase().slice(0, 2) })} attr="country" />
        <In label={lgT('etd')} type="date" value={j.etd} onChange={(v) => set({ etd: v || undefined })} />
        <In label={lgT('eta')} type="date" value={j.eta} onChange={(v) => set({ eta: v || undefined })} />
        <In label={lgT('shipper')} value={j.shipper} onChange={(v) => set({ shipper: v })} />
        <In label={lgT('consignee')} value={j.consignee} onChange={(v) => set({ consignee: v })} />
        <In label={lgT('salesperson')} value={j.salesperson} onChange={(v) => set({ salesperson: v })} />
        <In label={lgT('branch')} value={j.branch} onChange={(v) => set({ branch: v })} />
      </div>
      <div style={row}>
        {(air ? ['hawb', 'mawb', 'flight'] as const : ['hbl', 'mbl', 'vessel', 'voyage'] as const).map((k) => ref(k))}
        {j.dir === 'import' ? [ref('boe_no'), ref('boe_date', 'date'), ref('igm')] : [ref('sb_no'), ref('sb_date', 'date')]}
      </div>
      {j.mode === 'sea_fcl' && (
        <Field label={lgT('containers')}>
          {(j.containers ?? []).map((c, i) => (
            <div key={i} style={row}>
              <input className={controls.input} aria-label={lgT('container')} value={c.no} onChange={(e) => set({ containers: j.containers!.map((x, k) => (k === i ? { ...x, no: e.target.value } : x)) })} data-lg-container={i} />
              <select className={controls.select} aria-label={lgT('size')} value={c.size} onChange={(e) => set({ containers: j.containers!.map((x, k) => (k === i ? { ...x, size: e.target.value as typeof c.size } : x)) })}>{LG_SIZES.map((s) => <option key={s}>{s}</option>)}</select>
              <input className={controls.input} aria-label={lgT('seal')} placeholder={lgT('seal')} value={c.seal ?? ''} onChange={(e) => set({ containers: j.containers!.map((x, k) => (k === i ? { ...x, seal: e.target.value } : x)) })} />
            </div>
          ))}
          <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => set({ containers: [...(j.containers ?? []), { no: '', size: '40HC' }] })}>{lgT('addRow')}</button>
        </Field>
      )}
      <div style={row}>
        <In label={lgT('pkgs')} type="number" value={j.pkgs} onChange={(v) => set({ pkgs: numIn(v) })} />
        <In label={lgT('gross')} type="number" value={j.gross_kg} onChange={(v) => set({ gross_kg: numIn(v) })} attr="gross" />
        <In label={lgT('cbm')} type="number" value={j.cbm} onChange={(v) => set({ cbm: numIn(v) })} />
        <Field label={lgT('chargeable')}><output data-lg-chargeable>{cw.value} {cw.unit}{cw.basis === 'volumetric' ? ` (${lgT('volumetric')})` : ''}</output></Field>
      </div>
      <Field label={lgT('dims')}>
        {dims.map((d, i) => (
          <div key={i} style={row}>
            {DIM_KEYS.map((k) => <input key={k} type="number" min={0} className={controls.input} aria-label={k} value={d[k] || ''} onChange={(e) => set({ dims: dims.map((x, n): LgDims => (n === i ? { ...x, [k]: Number(e.target.value) || 0 } : x)) })} data-lg-dim={`${i}${k}`} />)}
          </div>
        ))}
        <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => set({ dims: [...dims, { l: 0, w: 0, h: 0, n: 1 }] })} data-lg-add-dim>{lgT('addRow')}</button>
      </Field>
      <In label={lgT('note')} value={j.note} onChange={(v) => set({ note: v })} />
      <div style={row}>
        <button type="button" className={controls.btnPrimary} onClick={save} data-lg-save-job>{lgT('save')}</button>
        {job && <button type="button" className={controls.btnOutline} onClick={() => run(() => void setJobStatus(job.id, job.status === 'closed' ? 'delivered' : 'closed', todayInput()))}>{lgT(job.status === 'closed' ? 'reopen' : 'close')}</button>}
        {job && <button type="button" className={controls.btnGhost} onClick={() => run(() => deleteJob(job.id))}>{lgT('del')}</button>}
        <button type="button" className={controls.btnGhost} onClick={onDone}>{lgT('cancel')}</button>
      </div>
      {/* R19-B / C / D: the job's charges, documents, costs, disbursements and deposits */}
    </section>
  );
}
