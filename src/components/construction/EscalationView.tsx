/**
 * CN-B3: Works → Escalation — the contract's price-variation clause (components, shares, base indices, M), a statement
 * for a period from the current indices (typed or read from the user's own index sheet), and the statements: bill
 * (supplementary invoice or credit note) or cancel. The working prints as the document's following page.
 */
import { useMemo, useState } from 'react';
import { Percent } from 'lucide-react';
import { cbT } from '../../i18n/areas/construction-r11b';
import { twT } from '../../i18n/areas/packs-transport-works-r5';
import type { WorksContract } from '../../types/construction-r11';
import { localDb } from '../../lib/localDb';
import { loadContracts, saveContract } from '../../lib/construction/cn-contracts';
import { billPv, cancelPv, loadPvs, pvWorking, readIndexSheet, savePv } from '../../lib/construction/cn-escalation';
import { B, errText, fmtMoney, readFirstTable, today, type PanelProps } from '../transport/shared';
import { F } from '../transport/Field';
import { ContractPick, Fields, type Vals } from './cn-fin-ui';
import { n, runner } from './cn-fin-run';
import surface from '../../styles/surface.module.css';
import styles from '../transport/transport.module.css';

const ROWS = [0, 1, 2, 3, 4, 5];
const STARTER = ['cement', 'steel', 'labour', 'pol', 'materials'];

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
  const [cl, setCl] = useState<Vals>(() => {
    const v: Vals = { clause: esc?.clause ?? '10CC', base_month: esc?.base_month ?? '', m: String(esc?.m_factor ?? 0.85), extras: !!esc?.exclusions?.length };
    ROWS.forEach((i) => {
      const x = esc?.components[i];
      Object.assign(v, { [`k${i}`]: x?.key ?? STARTER[i] ?? '', [`s${i}`]: x?.share_pct?.toString() ?? '', [`b${i}`]: x?.base_index?.toString() ?? '' });
    });
    return v;
  });
  const [st, setSt] = useState<Vals>({ date: today(), from: '', to: '', w: '' });
  const run = runner(notify, refresh);
  const saveClause = () => run(() => saveContract({ ...c, escalation: {
    formula: 'cpwd_10cc', clause: String(cl.clause), base_month: String(cl.base_month), m_factor: n(cl.m), ...(cl.extras ? { exclusions: ['extra_items'] } : {}),
    components: ROWS.filter((i) => String(cl[`k${i}`]).trim() && Number(cl[`s${i}`]) > 0).map((i) => ({ key: String(cl[`k${i}`]).trim().toLowerCase(), share_pct: Number(cl[`s${i}`]), base_index: Number(cl[`b${i}`]) })),
  } }));
  const input = () => ({ contract: c, date: String(st.date), period_from: String(st.from), period_to: String(st.to), work_value: n(st.w), indices: (esc?.components ?? []).map((x) => ({ key: x.key, current_index: Number(st[`i:${x.key}`]) })) });
  let preview = '-';
  try {
    if (esc && st.from && st.to) preview = fmtMoney(pvWorking(input(), localDb.invoices.getAll()).amount ?? 0);
  } catch (e) {
    preview = errText(e);
  }
  const onFile = async (file?: File) => {
    try {
      if (file) setSt({ ...st, ...Object.fromEntries(Object.entries(readIndexSheet(await readFirstTable(file))).map(([k, x]) => [`i:${k}`, String(x)])) });
    } catch (e) {
      notify(errText(e), 'error');
    }
  };
  return (
    <>
      <section className={styles.box}>
        <h4 className={styles.toolbar}><Percent size={16} aria-hidden="true" /> {cbT('pvClause')}</h4>
        <Fields spec={[['clause', cbT('clause')], ['base_month', cbT('baseMonth')], ['m', cbT('mFactor'), 'number'], ['extras', cbT('excludeExtras'), 'check'],
          ...ROWS.flatMap((i) => [[`k${i}`, cbT('component')], [`s${i}`, cbT('share'), 'number'], [`b${i}`, cbT('base'), 'number']] as const)]} v={cl} set={setCl} />
        <div className={styles.toolbar}><button type="button" className={B.o} onClick={saveClause} data-cn-pv-clause>{twT('save')}</button></div>
      </section>
      {esc && (
        <section className={styles.box}>
          <Fields spec={[['from', twT('from'), 'date'], ['to', twT('to'), 'date'], ['date', twT('date'), 'date'], ['w', cbT('workValue'), 'number'], ...esc.components.map((x) => [`i:${x.key}`, `${x.key}: ${cbT('current')}`, 'number'] as const)]} v={st} set={setSt} />
          <F l={cbT('indexSheet')}><input type="file" accept=".csv,.xlsx,text/csv" onChange={(e) => void onFile(e.target.files?.[0])} /></F>
          <p className={styles.note} data-cn-pv-preview>{cbT('pvAmount')}: {preview}</p>
          <div className={styles.toolbar}><button type="button" className={B.p} onClick={() => run(() => savePv(input()))} data-cn-pv-save>{cbT('saveStatement')}</button></div>
        </section>
      )}
      <div className={surface.tableWrap}>
        <table className={surface.table}>
          <tbody>
            {loadPvs().filter((p) => p.contract_id === c.id).map((p) => (
              <tr key={p.id} data-cn-pv={p.number}>
                <td className={surface.mono}>{p.number}</td><td>{p.period_from} – {p.period_to}</td><td className={surface.numeric}>{fmtMoney(p.work_value)}</td><td className={surface.numeric}>{fmtMoney(p.amount)}</td>
                <td>{cbT(`pvs.${p.status}`)} {p.invoice_id && localDb.invoices.getById(p.invoice_id)?.invoice_number}</td>
                <td>{p.status === 'draft' && <button type="button" className={B.gs} data-cn-pv-bill onClick={() => {
                  const r = run(() => billPv(p.id, today()));
                  if (r?.late) notify(cbT('sec34', { date: r.late }), 'error');
                }}>{cbT('billPv')}</button>}
                {p.status !== 'cancelled' && <button type="button" className={B.gs} onClick={() => run(() => cancelPv(p.id))}>{twT('cancel')}</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.note}>{cbT('pvHint')}</p>
    </>
  );
}
