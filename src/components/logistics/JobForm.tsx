/**
 * R19-A2 job form (a job's page): date, status, direction, mode (multimodal legs), client, overseas agent, incoterm,
 * ports, destination country, shipper / consignee, salesperson, branch; references by mode (HAWB / MAWB / flight, or
 * HBL / MBL / vessel / voyage), shipping bill or bill of entry, IGM; containers (FCL; no seal, ETD / ETA inputs at the
 * R19-A cap — the fields stay on the record for imports and later packages); packages, gross kg,
 * dimensions and CBM with the chargeable weight worked out live (`chargeableWeight`). Save shows the hints (check
 * digit, document dates); close / re-open is on the saved job (a job is cancelled by its status; `deleteJob` is the
 * data-layer delete for later packages). B–D add the job's tabs below the form.
 */
import { useState } from 'react';
import { t, useT } from '../../i18n';
import { lgList, lgT } from '../../i18n/areas/logistics-r19a';
import type { Client } from '../../types/invoice';
import type { LgContainer, LgJob, LgLeg, LgRefs } from '../../types/logistics-r19';
import { todayInput } from '../../lib/utils';
import { LG_DIRS, LG_MODES, LG_SIZES, LG_STATUSES } from '../../lib/logistics/lg-job';
import { chargeableWeight } from '../../lib/logistics/lg-weight';
import { saveJob, setJobStatus } from '../../lib/logistics/lg-save';
import { readLogisticsSettings } from '../../lib/logistics/lg-settings';
import controls from '../../styles/controls.module.css';
import { Field, In, Pick, type Notify } from './lg-ui';
import { numIn, row } from './lg-form';

export type JobDraft = Omit<LgJob, 'id' | 'number' | 'updated_at'>;
const LEGS: readonly LgLeg[] = ['road', 'rail', 'sea', 'air', 'inland_water'];
type Text = 'incoterm' | 'origin' | 'destination' | 'dest_country' | 'shipper' | 'consignee' | 'salesperson' | 'branch' | 'note';
type Num = 'pkgs' | 'gross_kg' | 'cbm';
const sm = `${controls.btnGhost} ${controls.btnSm}`;

export default function JobForm({ job, draft, clients, notify, onDone }: { job?: LgJob; draft?: JobDraft; clients: readonly Client[]; notify: Notify; onDone: () => void }) {
  useT();
  const [j, setJ] = useState<JobDraft>(() => job ?? draft ?? { date: todayInput(), status: 'booked', dir: 'export', mode: 'air', origin: '', destination: '', client_id: '', refs: {} });
  const set = (p: Partial<JobDraft>) => setJ((x) => ({ ...x, ...p }));
  const txt = (k: Text) => <In key={k} label={lgT(k)} value={j[k]} onChange={(v) => set({ [k]: k === 'dest_country' ? v.toUpperCase().slice(0, 2) : v || undefined })} attr={k} />;
  const num = (k: Num) => <In key={k} label={lgT(k)} type="number" value={j[k]} onChange={(v) => set({ [k]: numIn(v) })} attr={k} />;
  const ref = (k: keyof LgRefs) => <In key={k} label={lgT(k)} type={k.endsWith('date') ? 'date' : 'text'} value={j.refs[k]} onChange={(v) => set({ refs: { ...j.refs, [k]: v } })} attr={k} />;
  const pick = (k: 'status' | 'dir' | 'mode', ids: readonly string[], list: 'statuses' | 'dirs' | 'modes') => <Pick label={lgT(k)} value={j[k]} ids={ids} name={(x) => lgList(list, ids, x)} onChange={(v) => set({ [k]: v })} attr={k} />;
  const ids = clients.map((c) => c.id ?? '').filter(Boolean);
  const name = (id: string) => clients.find((c) => c.id === id)?.name ?? id;
  const boxes = j.containers ?? [];
  const box = (i: number, p: Partial<LgContainer>) => set({ containers: boxes.map((x, k) => (k === i ? { ...x, ...p } : x)) });
  const dims = j.dims ?? [];
  const cw = chargeableWeight({ gross_kg: j.gross_kg, dims, cbm: j.cbm, mode: j.mode, settings: readLogisticsSettings() });
  const run = (fn: () => string | void) => { try { notify(fn() || lgT('saved')); onDone(); } catch (e) { notify((e as Error).message, 'error'); } };
  const save = () => run(() => saveJob({ ...j, id: job?.id, ...(cw.unit === 'kg' ? { chargeable_kg: cw.value } : { chargeable_kg: undefined, cbm: cw.value }) }, readLogisticsSettings().job_prefix).hints.join(' '));
  const air = j.mode === 'air' || j.mode === 'courier';
  return (
    <section>
      {job && <h3>{job.number}</h3>}
      <div style={row}>
        <In label={lgT('date')} type="date" value={j.date} onChange={(v) => set({ date: v })} />
        {pick('status', LG_STATUSES, 'statuses')}
        {pick('dir', LG_DIRS, 'dirs')}
        {pick('mode', LG_MODES, 'modes')}
        <Pick label={lgT('client')} value={j.client_id} ids={ids} name={name} blank="" onChange={(v) => set({ client_id: v })} attr="client" />
        <Pick label={lgT('agent')} value={j.agent_id ?? ''} ids={ids} name={name} blank="" onChange={(v) => set({ agent_id: v || undefined })} />
      </div>
      {j.mode === 'multimodal' && (
        <div style={row} aria-label={lgT('legs')}>
          {LEGS.map((l) => <label key={l} className={controls.check}><input type="checkbox" checked={!!j.legs?.includes(l)} onChange={() => set({ legs: j.legs?.includes(l) ? j.legs.filter((x) => x !== l) : [...(j.legs ?? []), l] })} /> {lgList('legList', LEGS, l)}</label>)}
        </div>
      )}
      <div style={row}>{(['origin', 'destination', 'dest_country', 'incoterm', 'shipper', 'consignee', 'salesperson', 'branch'] as const).map(txt)}</div>
      <div style={row}>{(air ? ['hawb', 'mawb', 'flight'] as const : ['hbl', 'mbl', 'vessel', 'voyage'] as const).map(ref)}{(j.dir === 'import' ? ['boe_no', 'boe_date', 'igm'] as const : ['sb_no', 'sb_date'] as const).map(ref)}</div>
      {j.mode === 'sea_fcl' && (
        <Field label={lgT('containers')}>
          {boxes.map((c, i) => (
            <div key={i} style={row}>
              <input className={controls.input} aria-label={lgT('container')} value={c.no} onChange={(e) => box(i, { no: e.target.value })} />
              <select className={controls.select} aria-label={lgT('size')} value={c.size} onChange={(e) => box(i, { size: e.target.value as LgContainer['size'] })}>{LG_SIZES.map((s) => <option key={s}>{s}</option>)}</select>
            </div>
          ))}
          <button type="button" className={sm} onClick={() => set({ containers: [...boxes, { no: '', size: '40HC' }] })}>{lgT('addRow')}</button>
        </Field>
      )}
      <div style={row}>
        {(['pkgs', 'gross_kg', 'cbm'] as const).map(num)}
        <Field label={lgT('chargeable')}><output data-lg-chargeable>{cw.value} {cw.unit}{cw.basis === 'volumetric' ? ` (${lgT('volumetric')})` : ''}</output></Field>
      </div>
      <Field label={lgT('dims')}>
        {dims.map((d, i) => (
          <div key={i} style={row}>
            {(['l', 'w', 'h', 'n'] as const).map((k) => <input key={k} type="number" min={0} className={controls.input} aria-label={k} value={d[k] || ''} onChange={(e) => set({ dims: dims.map((x, n) => (n === i ? { ...x, [k]: Number(e.target.value) || 0 } : x)) })} data-lg-dim={`${i}${k}`} />)}
          </div>
        ))}
        <button type="button" className={sm} onClick={() => set({ dims: [...dims, { l: 0, w: 0, h: 0, n: 1 }] })} data-lg-add-dim>{lgT('addRow')}</button>
      </Field>
      {txt('note')}
      <div style={row}>
        <button type="button" className={controls.btnPrimary} onClick={save} data-lg-save-job>{t('common.save')}</button>
        {job && <button type="button" className={controls.btnOutline} onClick={() => run(() => void setJobStatus(job.id, job.status === 'closed' ? 'delivered' : 'closed', todayInput()))}>{lgT(job.status === 'closed' ? 'reopen' : 'close')}</button>}
        <button type="button" className={controls.btnGhost} onClick={onDone}>{t('common.cancel')}</button>
      </div>
      {/* R19-B / C / D: the job's charges, documents, costs, disbursements and deposits */}
    </section>
  );
}
