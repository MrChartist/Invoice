/**
 * CN-B3: Works → Escalation — the contract's price-variation clause (components, shares, base indices, M), a new
 * statement for a period with the current indices (typed or from the user's own index sheet), and the statements
 * register: bill (supplementary invoice or credit note) or cancel. The working prints as the invoice's following page.
 */
import { useMemo, useState } from 'react';
import { Percent } from 'lucide-react';
import { cbT } from '../../i18n/areas/construction-r11b';
import type { CnEscalation, WorksContract } from '../../types/construction-r11';
import { localDb } from '../../lib/localDb';
import { loadContracts, saveContract } from '../../lib/construction/cn-contracts';
import { billPv, cancelPv, loadPvs, pvWorking, readIndexSheet, savePv } from '../../lib/construction/cn-escalation';
import { B, errText, fmtMoney, readFirstTable, today, type PanelProps } from '../transport/shared';
import { F } from '../transport/Field';
import { ContractPick, Fields, type Vals } from './cn-fin-ui';
import { n, runner } from './cn-fin-run';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from '../transport/transport.module.css';

type Comp = { key: string; share: string; base: string };
const STARTER: Comp[] = ['cement', 'steel', 'labour', 'pol', 'materials'].map((key) => ({ key, share: '', base: '' }));

export default function EscalationView({ notify, refresh, tick, boqId }: PanelProps & { boqId?: string }) {
  const contracts = useMemo(() => loadContracts(), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const [id, setId] = useState(() => contracts.find((c) => c.boq_id === boqId)?.id ?? contracts[0]?.id ?? '');
  const c = contracts.find((x) => x.id === id);
  return (
    <div className={styles.stack} data-cn-escalation>
      <ContractPick contracts={contracts} value={id} onChange={setId} />
      {c && <Esc key={c.id} c={c} notify={notify} refresh={refresh} />}
    </div>
  );
}

function Esc({ c, notify, refresh }: Pick<PanelProps, 'notify' | 'refresh'> & { c: WorksContract }) {
  const esc = c.escalation;
  const [clause, setClause] = useState<Vals>({ clause: esc?.clause ?? '10CC', base_month: esc?.base_month ?? '', m: String(esc?.m_factor ?? '0.85'), extras: !!esc?.exclusions?.includes('extra_items') });
  const [comps, setComps] = useState<Comp[]>(esc?.components.map((x) => ({ key: x.key, share: String(x.share_pct), base: String(x.base_index) })) ?? STARTER);
  const [st, setSt] = useState<Vals>({ date: today(), period_from: '', period_to: '', work_value: '' });
  const [cur, setCur] = useState<Record<string, string>>({});
  const run = runner(notify, refresh);
  const saveClause = () => run(() => saveContract({ ...c, escalation: {
    formula: 'cpwd_10cc', clause: String(clause.clause), base_month: String(clause.base_month), m_factor: n(clause.m), ...(clause.extras ? { exclusions: ['extra_items'] } : {}),
    components: comps.filter((x) => x.key.trim() && Number(x.share) > 0).map((x) => ({ key: x.key.trim().toLowerCase(), share_pct: Number(x.share), base_index: Number(x.base) })),
  } as CnEscalation }));
  const input = () => ({ contract: c, date: String(st.date), period_from: String(st.period_from), period_to: String(st.period_to), work_value: n(st.work_value), indices: (esc?.components ?? []).map((x) => ({ key: x.key, current_index: Number(cur[x.key]) })) });
  let preview = '';
  try {
    if (esc && st.period_from && st.period_to) preview = fmtMoney(pvWorking(input(), localDb.invoices.getAll()).amount ?? 0);
  } catch (e) {
    preview = errText(e);
  }
  const onFile = async (file?: File) => {
    if (!file) return;
    try {
      const got = readIndexSheet(await readFirstTable(file));
      setCur((v) => ({ ...v, ...Object.fromEntries(Object.entries(got).map(([k, x]) => [k, String(x)])) }));
    } catch (e) {
      notify(errText(e), 'error');
    }
  };
  const bill = (pvId: string) => {
    const r = run(() => billPv(pvId, today()), cbT('pvBilled'));
    if (r?.late) notify(cbT('sec34', { date: r.late }), 'error');
  };
  return (
    <>
      <section className={styles.box}>
        <h4 className={styles.toolbar}><Percent size={16} aria-hidden="true" /> {cbT('pvClause')}</h4>
        <Fields spec={[['clause', 'clause'], ['base_month', 'baseMonth'], ['m', 'mFactor', 'number'], ['extras', 'excludeExtras', 'check']]} v={clause} on={(k, v) => setClause({ ...clause, [k]: v })} />
        {comps.map((x, i) => (
          <div key={i} className={styles.toolbar}>
            {(['key', 'share', 'base'] as const).map((k) => <F key={k} l={cbT(`pv.${k}`)}><input className={controls.input} type={k === 'key' ? 'text' : 'number'} value={x[k]} onChange={(e) => setComps(comps.map((y, j) => (j === i ? { ...y, [k]: e.target.value } : y)))} data-cn-comp={`${x.key}:${k}`} /></F>)}
          </div>
        ))}
        <div className={styles.toolbar}>
          <button type="button" className={B.gs} onClick={() => setComps([...comps, { key: '', share: '', base: '' }])}>{cbT('addLine')}</button>
          <button type="button" className={B.o} onClick={saveClause} data-cn-pv-clause>{cbT('save')}</button>
        </div>
      </section>
      {esc && (
        <section className={styles.box}>
          <Fields spec={[['period_from', 'periodFrom', 'date'], ['period_to', 'periodTo', 'date'], ['date', 'date', 'date'], ['work_value', 'workValue', 'number']]} v={st} on={(k, v) => setSt({ ...st, [k]: v })} />
          <div className={styles.toolbar}>
            {esc.components.map((x) => <F key={x.key} l={`${x.key} (${cbT('pv.current')})`}><input className={controls.input} type="number" value={cur[x.key] ?? ''} onChange={(e) => setCur({ ...cur, [x.key]: e.target.value })} data-cn-index={x.key} /></F>)}
            <F l={cbT('indexSheet')}><input type="file" accept=".csv,.xlsx,.xlsm,text/csv" onChange={(e) => void onFile(e.target.files?.[0])} /></F>
          </div>
          <p className={styles.note} data-cn-pv-preview>{cbT('pvAmount')}: {preview || '—'}</p>
          <div className={styles.toolbar}><button type="button" className={B.p} onClick={() => run(() => savePv(input()))} data-cn-pv-save>{cbT('saveStatement')}</button></div>
        </section>
      )}
      <div className={surface.tableWrap}>
        <table className={surface.table}>
          <tbody>
            {loadPvs().filter((p) => p.contract_id === c.id).map((p) => (
              <tr key={p.id} data-cn-pv={p.number}>
                <td className={surface.mono}>{p.number}</td><td>{p.period_from} – {p.period_to}</td><td className={surface.numeric}>{fmtMoney(p.work_value)}</td><td className={surface.numeric}>{fmtMoney(p.amount)}</td>
                <td>{cbT(`pvs.${p.status}`)}{p.invoice_id ? ` · ${localDb.invoices.getById(p.invoice_id)?.invoice_number ?? ''}` : ''}</td>
                <td>{p.status === 'draft' && <button type="button" className={B.gs} onClick={() => bill(p.id)} data-cn-pv-bill>{p.amount < 0 ? cbT('creditNote') : cbT('billPv')}</button>}
                  {p.status !== 'cancelled' && <button type="button" className={B.gs} onClick={() => run(() => cancelPv(p.id))}>{cbT('cancel')}</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.note}>{cbT('pvHint')}</p>
    </>
  );
}
