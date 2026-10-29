/**
 * CN-B1 / B5: Works → Contracts — the register (value, billed, received, retention held, days left / delay, LD
 * exposure), the contract form with its extensions of time, and the closure checklist.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2 } from 'lucide-react';
import { cbT } from '../../i18n/areas/construction-r11b';
import { twT } from '../../i18n/areas/packs-transport-works-r5';
import type { Payment } from '../../types/invoice';
import type { CnClosureKey, CnEot, WorksContract } from '../../types/construction-r11';
import type { SecurityDeposit } from '../../types/institutions-r5';
import { localDb } from '../../lib/localDb';
import { peekTable } from '../../lib/storage';
import { contractSummary, deleteContract, loadContracts, saveContract } from '../../lib/construction/cn-contracts';
import { closeContract, closureChecklist, HAND_TICKS, setClosure, setClosureFiles } from '../../lib/construction/cn-closure';
import { AttachmentsPanel } from '../attachments/AttachmentsPanel';
import { loadGuarantees } from '../../lib/construction/cn-guarantees';
import { B, fmtMoney, today, type PanelProps } from '../transport/shared';
import { Fields, type Spec, type Vals } from './cn-fin-ui';
import { n, runner } from './cn-fin-run';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from '../transport/transport.module.css';

const NUMS = ['contract_value', 'deviation_pct', 'dlp_months', 'retention_pct', 'sd_pct', 'water_pct', 'power_pct'] as const;
const EOT_KEYS = ['eot1', 'eot2', 'eot3'];

const toVals = (c?: WorksContract): Vals => {
  const v: Vals = { ...(c as unknown as Vals), site_address: c?.site?.address, site_state: c?.site?.state_code, ld_pct: c?.ld?.pct_per_week?.toString(), ld_cap: c?.ld?.cap_pct?.toString(), jv_name: c?.jv?.name, jv_share: c?.jv?.share_pct?.toString() };
  for (const k of NUMS) v[k] = c?.[k]?.toString();
  // Extensions as "date ref" (+ " LD" when granted with LD), one field each.
  EOT_KEYS.forEach((k, i) => {
    const e = c?.eots?.[i];
    v[k] = e ? `${e.upto} ${e.ref ?? ''}${e.with_ld ? ' LD' : ''}`.trim() : '';
  });
  return v;
};
const toEot = (s: unknown): CnEot | null => {
  const m = /^(\d{4}-\d{2}-\d{2})\s*(.*?)(\s+LD)?$/i.exec(String(s ?? '').trim());
  return m ? { upto: m[1], ref: m[2] || undefined, with_ld: !!m[3] } : null;
};

export default function ContractsView({ notify, refresh, tick }: PanelProps) {
  const contracts = useMemo(() => loadContracts(), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const invoices = useMemo(() => localDb.invoices.getAll(), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const payments = peekTable<Payment>('transactions');
  const clients = localDb.clients.getAll().filter((c) => c.id && c.name?.trim());
  const [v, setV] = useState<Vals | null>(null);
  const [sel, setSel] = useState('');
  const [why, setWhy] = useState<Vals>({ why: '', noclaim: '' });
  const run = runner(notify, refresh);
  const day = today();
  const spec: Spec[] = [
    ['client_id', twT('client'), [['', '-'], ...clients.map((c) => [c.id ?? '', c.name] as const)]], ['boq_id', twT('boq'), [['', '-'], ...invoices.filter((b) => (b.doc_type === 'SALES_ORDER' || b.doc_type === 'QUOTATION') && b.status !== 'Cancelled').map((b) => [b.id, `${b.invoice_number} · ${b.client?.name}`] as const)]],
    ['name_of_work', cbT('nameOfWork')], ['agreement_no', cbT('agreementNo')], ['agreement_date', cbT('agreementDate'), 'date'], ['work_order_no', twT('workOrder')], ['work_order_date', `${twT('workOrder')}: ${twT('date')}`, 'date'],
    ['tender_ref', cbT('tenderRef')], ['client_office', cbT('clientOffice')], ['engineer', cbT('engineer')], ['site_address', cbT('siteAddress')], ['site_state', cbT('siteState')],
    ['contract_value', twT('contractValue'), 'number'], ['stipulated_start', cbT('start'), 'date'], ['stipulated_completion', cbT('completion'), 'date'], ['completed_on', twT('completedOn'), 'date'],
    ['deviation_pct', cbT('deviationPct'), 'number'], ['dlp_months', twT('dlpMonths'), 'number'], ['retention_pct', cbT('retentionPct'), 'number'], ['sd_pct', cbT('sdPct'), 'number'],
    ['water_pct', cbT('waterPct'), 'number'], ['power_pct', cbT('powerPct'), 'number'], ['ld_pct', cbT('ldPct'), 'number'], ['ld_cap', cbT('ldCap'), 'number'],
    ['jv_name', cbT('jvName')], ['jv_share', cbT('jvShare'), 'number'], ...EOT_KEYS.map((k) => [k, `${cbT('eots')} (2027-03-31 ref LD)`] as const), ['government', twT('govtWorks'), 'check'],
  ];
  const save = () => {
    if (!v) return;
    const old = contracts.find((c) => c.id === v.id);
    const out: Partial<WorksContract> = {
      ...old, ...(v as Partial<WorksContract>), client_name: clients.find((c) => c.id === v.client_id)?.name ?? old?.client_name,
      site: { address: String(v.site_address ?? ''), state_code: String(v.site_state ?? '') }, ld: { pct_per_week: n(v.ld_pct), cap_pct: n(v.ld_cap) },
      jv: { name: String(v.jv_name ?? ''), share_pct: n(v.jv_share) }, government: !!v.government, eots: EOT_KEYS.map((k) => toEot(v[k])).filter((e): e is CnEot => !!e),
    };
    for (const k of NUMS) (out as Record<string, unknown>)[k] = n(v[k]);
    if (run(() => saveContract(out))) setV(null);
  };
  const c = contracts.find((x) => x.id === sel);
  const data = { invoices, payments, guarantees: loadGuarantees(), deposits: peekTable<SecurityDeposit>('security_deposits'), today: day };
  return (
    <div className={styles.stack} data-cn-contracts>
      <div className={surface.tableWrap}>
        <table className={surface.table}>
          <thead><tr><th>{cbT('contract')}</th><th className={surface.numeric}>{twT('contractValue')}</th><th className={surface.numeric}>{cbT('billed')}</th><th className={surface.numeric}>{twT('received')}</th><th className={surface.numeric}>{twT('view.retention')}</th><th /><th className={surface.numeric}>{cbT('ldExposure')}</th><th /></tr></thead>
          <tbody>
            {contracts.map((k) => {
              const s = contractSummary(k, invoices, payments, day);
              return (
                <tr key={k.id} data-cn-row={k.agreement_no || k.name_of_work}>
                  <td>{k.agreement_no} {k.name_of_work}<br /><span className={controls.hint}>{k.client_name} · {k.status}{k.jv_note ? ` · ${k.jv_note}` : ''}</span></td>
                  <td className={surface.numeric}>{fmtMoney(k.contract_value)}</td>
                  <td className={surface.numeric}>{fmtMoney(s.billed)} ({s.pct}%)</td>
                  <td className={surface.numeric}>{fmtMoney(s.received)}</td>
                  <td className={surface.numeric}>{fmtMoney(s.retention)}</td>
                  <td className={s.delay ? styles.bad : ''}>{s.delay ? cbT('delayDays', { n: s.delay }) : cbT('daysLeft', { n: s.daysLeft })}</td>
                  <td className={surface.numeric}>{s.ld ? fmtMoney(s.ld) : '-'}</td>
                  <td><button type="button" className={B.gs} onClick={() => setV(toVals(k))}>{twT('edit')}</button><button type="button" className={B.gs} onClick={() => setSel(k.id)} data-cn-closure-open>{cbT('closure')}</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className={styles.toolbar}>
        <button type="button" className={B.o} onClick={() => setV(toVals())} data-cn-new-contract><Building2 size={14} aria-hidden="true" /> {cbT('newContract')}</button>
        <Link className={B.g} to="/time?tab=works&view=boq">{twT('importBoq')}</Link>
      </div>
      {v && (
        <section className={styles.box} data-cn-contract-form>
          <Fields spec={spec} v={v} set={setV as never} />
          <div className={styles.toolbar}>
            <button type="button" className={B.p} onClick={save} data-cn-save-contract>{twT('save')}</button>
            {v.id && <button type="button" className={B.g} onClick={() => run(() => { deleteContract(String(v.id), invoices); setV(null); })}>{twT('remove')}</button>}
          </div>
        </section>
      )}
      {c && (
        <section className={styles.box} data-cn-closure>
          <h4>{cbT('closure')}: {c.name_of_work}</h4>
          {closureChecklist(c, data).map((it) => (
            <div key={it.key} className={styles.toolbar} data-cn-check={it.key} data-state={it.state}>
              {it.state === 'open' ? '○' : '✓'} {cbT(`cl.${it.key}` as `cl.${CnClosureKey}`)}{it.due ? ` (${it.due})` : ''}{it.state === 'waived' ? `: ${c.closure?.waived?.[it.key]}` : ''}
              {it.state === 'open' && HAND_TICKS.includes(it.key) && <button type="button" className={B.gs} onClick={() => run(() => setClosure(c.id, { ticks: { [it.key]: true } }))}>{cbT('tick')}</button>}
              {it.state === 'open' && <button type="button" className={B.gs} onClick={() => run(() => setClosure(c.id, { waived: { [it.key]: String(why.why) } }))}>{cbT('waive')}</button>}
            </div>
          ))}
          <Fields spec={[['why', twT('reason')], ['noclaim', cbT('cl.no_claim')]]} v={why} set={setWhy} />
          <div className={styles.toolbar}>
            <button type="button" className={B.o} disabled={!why.noclaim} onClick={() => run(() => setClosure(c.id, { no_claim_ref: String(why.noclaim), no_claim_date: day }))} data-cn-noclaim>{twT('save')}</button>
            <button type="button" className={B.p} disabled={c.status === 'closed'} onClick={() => run(() => closeContract(c.id, data))} data-cn-close>{cbT('closeContract')}</button>
          </div>
          {/* PENDING 14: closure documents through the shared attachments panel. */}
          <AttachmentsPanel value={c.attachments} onChange={(next) => run(() => setClosureFiles(c.id, next))} label={cbT('closureFiles')} />
          <p className={styles.note}>{cbT('closureHint')}</p>
        </section>
      )}
    </div>
  );
}
