/**
 * CN-B1 / B5: Works → Contracts — the contract register (value, billed, % billed, received, retention held, days to
 * completion / delay, LD exposure), the contract form with its extensions of time, and the closure checklist.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, CalendarDays } from 'lucide-react';
import { cbT } from '../../i18n/areas/construction-r11b';
import type { Payment } from '../../types/invoice';
import type { CnClosureKey, CnEot, WorksContract } from '../../types/construction-r11';
import type { SecurityDeposit } from '../../types/institutions-r5';
import { localDb } from '../../lib/localDb';
import { peekTable } from '../../lib/storage';
import { listBoqs } from '../../lib/works/boq';
import { contractSummary, deleteContract, loadContracts, saveContract } from '../../lib/construction/cn-contracts';
import { closeContract, closureChecklist, HAND_TICKS, setClosure } from '../../lib/construction/cn-closure';
import { loadGuarantees } from '../../lib/construction/cn-guarantees';
import { B, fmtMoney, today, type PanelProps } from '../transport/shared';
import { F } from '../transport/Field';
import { Fields, type Spec, type Vals } from './cn-fin-ui';
import { n, runner } from './cn-fin-run';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from '../transport/transport.module.css';

const SPEC: readonly Spec[] = [
  ['name_of_work', 'nameOfWork'], ['agreement_no', 'agreementNo'], ['agreement_date', 'agreementDate', 'date'], ['work_order_no', 'workOrderNo'], ['work_order_date', 'workOrderDate', 'date'],
  ['tender_ref', 'tenderRef'], ['client_office', 'clientOffice'], ['engineer', 'engineer'], ['site_address', 'siteAddress'], ['site_state', 'siteState'],
  ['contract_value', 'contractValue', 'number'], ['stipulated_start', 'start', 'date'], ['stipulated_completion', 'completion', 'date'], ['completed_on', 'completedOn', 'date'],
  ['deviation_pct', 'deviationPct', 'number'], ['dlp_months', 'dlpMonths', 'number'], ['retention_pct', 'retentionPct', 'number'], ['sd_pct', 'sdPct', 'number'],
  ['water_pct', 'waterPct', 'number'], ['power_pct', 'powerPct', 'number'], ['ld_pct', 'ldPct', 'number'], ['ld_cap', 'ldCap', 'number'],
  ['jv_name', 'jvName'], ['jv_share', 'jvShare', 'number'], ['government', 'government', 'check'],
];

const toVals = (c?: WorksContract): Vals => (c ? {
  ...(c as unknown as Vals), site_address: c.site?.address, site_state: c.site?.state_code, contract_value: String(c.contract_value), deviation_pct: c.deviation_pct?.toString(), dlp_months: c.dlp_months?.toString(),
  retention_pct: c.retention_pct?.toString(), sd_pct: c.sd_pct?.toString(), water_pct: c.water_pct?.toString(), power_pct: c.power_pct?.toString(), ld_pct: c.ld?.pct_per_week?.toString(), ld_cap: c.ld?.cap_pct?.toString(), jv_name: c.jv?.name, jv_share: c.jv?.share_pct?.toString(),
} : { boq_id: '', client_id: '' });

export default function ContractsView({ notify, refresh, tick }: PanelProps) {
  const contracts = useMemo(() => loadContracts(), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const invoices = useMemo(() => localDb.invoices.getAll(), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const payments = peekTable<Payment>('transactions');
  const clients = useMemo(() => localDb.clients.getAll().filter((c) => c.id && c.name?.trim()), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const [edit, setEdit] = useState<{ v: Vals; eots: CnEot[]; id?: string } | null>(null);
  const [sel, setSel] = useState('');
  const [why, setWhy] = useState('');
  const run = runner(notify, refresh);
  const day = today();
  const open = (c?: WorksContract) => setEdit({ v: toVals(c), eots: c?.eots ?? [], id: c?.id });
  const save = () => {
    if (!edit) return;
    const v = edit.v;
    const old = contracts.find((c) => c.id === edit.id);
    const client = clients.find((c) => c.id === v.client_id);
    const s = (k: string) => (typeof v[k] === 'string' ? (v[k] as string) : undefined);
    const ok = run(() => saveContract({
      ...old, ...(v as Partial<WorksContract>), id: edit.id, client_id: s('client_id'), client_name: client?.name ?? old?.client_name, boq_id: s('boq_id') || undefined,
      site: { address: s('site_address'), state_code: s('site_state') }, contract_value: n(v.contract_value) ?? 0, deviation_pct: n(v.deviation_pct), dlp_months: n(v.dlp_months),
      retention_pct: n(v.retention_pct), sd_pct: n(v.sd_pct), water_pct: n(v.water_pct), power_pct: n(v.power_pct), ld: { pct_per_week: n(v.ld_pct), cap_pct: n(v.ld_cap) },
      jv: { name: s('jv_name') ?? '', share_pct: n(v.jv_share) }, government: !!v.government, eots: edit.eots,
    }));
    if (ok) setEdit(null);
  };
  const c = contracts.find((x) => x.id === sel);
  const data = { invoices, payments, guarantees: loadGuarantees(), deposits: peekTable<SecurityDeposit>('security_deposits'), today: day };
  return (
    <div className={styles.stack} data-cn-contracts>
      <div className={surface.tableWrap}>
        <table className={surface.table}>
          <thead><tr><th>{cbT('contract')}</th><th className={surface.numeric}>{cbT('contractValue')}</th><th className={surface.numeric}>{cbT('billed')}</th><th className={surface.numeric}>{cbT('received')}</th><th className={surface.numeric}>{cbT('retentionHeld')}</th><th>{cbT('time')}</th><th className={surface.numeric}>{cbT('ldExposure')}</th><th /></tr></thead>
          <tbody>
            {contracts.map((k) => {
              const s = contractSummary(k, invoices, payments, day);
              return (
                <tr key={k.id} data-cn-row={k.agreement_no || k.name_of_work}>
                  <td>{k.agreement_no ? `${k.agreement_no} · ` : ''}{k.name_of_work}<br /><span className={controls.hint}>{k.client_name} · {cbT(`st.${k.status}`)}{k.jv_note ? ` · ${k.jv_note}` : ''}</span></td>
                  <td className={surface.numeric}>{fmtMoney(k.contract_value)}</td>
                  <td className={surface.numeric}>{fmtMoney(s.billed)} ({s.pct}%)</td>
                  <td className={surface.numeric}>{fmtMoney(s.received)}</td>
                  <td className={surface.numeric}>{fmtMoney(s.retention)}</td>
                  <td className={s.delay ? styles.bad : ''}>{s.delay ? cbT('delayDays', { n: s.delay }) : cbT('daysLeft', { n: s.daysLeft })}</td>
                  <td className={surface.numeric}>{s.ld ? fmtMoney(s.ld) : '—'}</td>
                  <td><button type="button" className={B.gs} onClick={() => open(k)}>{cbT('edit')}</button><button type="button" className={B.gs} onClick={() => setSel(k.id)} data-cn-closure-open>{cbT('closure')}</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className={styles.toolbar}><button type="button" className={B.o} onClick={() => open()} data-cn-new-contract><Building2 size={14} aria-hidden="true" /> {cbT('newContract')}</button></div>
      {edit && (
        <section className={styles.box} data-cn-contract-form>
          <div className={styles.grid}>
            <F l={cbT('client')}><select className={controls.select} value={String(edit.v.client_id ?? '')} onChange={(e) => setEdit({ ...edit, v: { ...edit.v, client_id: e.target.value } })}><option value="">—</option>{clients.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></F>
            <F l={cbT('boq')}><select className={controls.select} value={String(edit.v.boq_id ?? '')} onChange={(e) => setEdit({ ...edit, v: { ...edit.v, boq_id: e.target.value } })} data-cn-boq><option value="">—</option>{listBoqs(invoices).map((b) => <option key={b.id} value={b.id}>{b.invoice_number} · {b.client?.name}</option>)}</select></F>
          </div>
          <Fields spec={SPEC} v={edit.v} on={(k, val) => setEdit({ ...edit, v: { ...edit.v, [k]: val } })} />
          <h4 className={styles.toolbar}><CalendarDays size={16} aria-hidden="true" /> {cbT('eots')}</h4>
          {edit.eots.map((e, i) => (
            <div key={i} className={styles.toolbar}>
              <F l={cbT('eotUpto')}><input className={controls.input} type="date" value={e.upto} onChange={(x) => setEdit({ ...edit, eots: edit.eots.map((y, j) => (j === i ? { ...y, upto: x.target.value } : y)) })} /></F>
              <F l={cbT('ref')}><input className={controls.input} value={e.ref ?? ''} onChange={(x) => setEdit({ ...edit, eots: edit.eots.map((y, j) => (j === i ? { ...y, ref: x.target.value } : y)) })} /></F>
              <label className={controls.check}><input type="checkbox" checked={!!e.with_ld} onChange={(x) => setEdit({ ...edit, eots: edit.eots.map((y, j) => (j === i ? { ...y, with_ld: x.target.checked } : y)) })} /> {cbT('withLd')}</label>
            </div>
          ))}
          <div className={styles.toolbar}>
            <button type="button" className={B.gs} onClick={() => setEdit({ ...edit, eots: [...edit.eots, { upto: '' }] })}>{cbT('addEot')}</button>
            <button type="button" className={B.p} onClick={save} data-cn-save-contract>{cbT('save')}</button>
            {edit.id && <button type="button" className={B.g} onClick={() => run(() => { deleteContract(edit.id!, invoices); setEdit(null); })}>{cbT('delete')}</button>}
            <Link className={B.g} to="/time?tab=works&view=boq">{cbT('openBoq')}</Link>
          </div>
        </section>
      )}
      {c && (
        <section className={styles.box} data-cn-closure>
          <h4>{cbT('closure')}: {c.name_of_work}</h4>
          <ul>
            {closureChecklist(c, data).map((it) => (
              <li key={it.key} data-cn-check={it.key} data-state={it.state}>
                {it.state === 'open' ? '○' : '✓'} {cbT(`cl.${it.key}` as `cl.${CnClosureKey}`)}{it.due ? ` (${it.due})` : ''}{it.state === 'waived' ? ` — ${cbT('waived')}: ${c.closure?.waived?.[it.key]}` : ''}
                {it.state === 'open' && HAND_TICKS.includes(it.key) && <button type="button" className={B.gs} onClick={() => run(() => setClosure(c.id, { ticks: { [it.key]: true } }))}>{cbT('tick')}</button>}
                {it.state === 'open' && <button type="button" className={B.gs} onClick={() => run(() => setClosure(c.id, { waived: { [it.key]: why } }))}>{cbT('waive')}</button>}
              </li>
            ))}
          </ul>
          <div className={styles.toolbar}>
            <F l={cbT('waiveReason')}><input className={controls.input} value={why} onChange={(e) => setWhy(e.target.value)} /></F>
            <F l={cbT('noClaimRef')}><input className={controls.input} defaultValue={c.closure?.no_claim_ref ?? ''} onBlur={(e) => e.target.value !== (c.closure?.no_claim_ref ?? '') && run(() => setClosure(c.id, { no_claim_ref: e.target.value, no_claim_date: day }))} data-cn-noclaim /></F>
            <button type="button" className={B.p} disabled={c.status === 'closed'} onClick={() => run(() => closeContract(c.id, data))} data-cn-close>{cbT('closeContract')}</button>
          </div>
          <p className={styles.note}>{cbT('closureHint')}</p>
        </section>
      )}
    </div>
  );
}
