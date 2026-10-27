/**
 * CN-B2: Works → Advances — per contract, each mobilisation / plant advance (amount, recovered, balance, interest to
 * date, % of work done, "behind schedule") with its contract terms, and the secured advances on materials at site.
 * The advance receipt itself is recorded in Receivables → Advances (GST at receipt).
 */
import { useMemo, useState } from 'react';
import { HandCoins } from 'lucide-react';
import { cbT } from '../../i18n/areas/construction-r11b';
import type { CnAdvanceTerm } from '../../types/construction-r11';
import { localDb } from '../../lib/localDb';
import { loadAdvances, samePartyAs } from '../../lib/advances';
import { contractBills, loadContracts, saveContract } from '../../lib/construction/cn-contracts';
import { advanceStatus } from '../../lib/construction/cn-advances';
import { deleteSecured, loadSecured, recordSecured, securedRecovered } from '../../lib/construction/cn-secured';
import { B, fmtMoney, today, type PanelProps } from '../transport/shared';
import { F } from '../transport/Field';
import { ContractPick, Fields, type Vals } from './cn-fin-ui';
import { n, runner } from './cn-fin-run';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from '../transport/transport.module.css';

type Mat = { description: string; qty: string; unit: string; rate: string };

export default function AdvancesView({ notify, refresh, tick, boqId }: PanelProps & { boqId?: string }) {
  const contracts = useMemo(() => loadContracts(), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const invoices = useMemo(() => localDb.invoices.getAll(), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const [id, setId] = useState(() => contracts.find((c) => c.boq_id === boqId)?.id ?? contracts[0]?.id ?? '');
  const [t, setT] = useState<Vals>({ advance_id: '', kind: 'mobilisation', interest_pct: '10', recover_from_pct: '10', recover_by_pct: '80' });
  const [mats, setMats] = useState<Mat[]>([{ description: '', qty: '', unit: '', rate: '' }]);
  const [sa, setSa] = useState<Vals>({ date: today(), pct: '75', mode: 'bank' });
  const run = runner(notify, refresh);
  const c = contracts.find((x) => x.id === id);
  if (!c) return <ContractPick contracts={contracts} value={id} onChange={setId} />;
  const bills = contractBills(c, invoices);
  const advances = loadAdvances();
  const mine = advances.filter((a) => samePartyAs(a.client, { id: c.client_id, name: c.client_name }));
  const boqAdvance = localDb.invoices.getById(c.boq_id ?? '')?.boq_terms?.advance_id;
  const link = () => run(() => saveContract({ ...c, advance_terms: [...(c.advance_terms ?? []), { advance_id: String(t.advance_id), kind: t.kind as CnAdvanceTerm['kind'], interest_pct: n(t.interest_pct), recover_from_pct: n(t.recover_from_pct), recover_by_pct: n(t.recover_by_pct) }] }));
  const secured = loadSecured().filter((s) => s.contract_id === c.id);
  return (
    <div className={styles.stack} data-cn-advances>
      <ContractPick contracts={contracts} value={id} onChange={setId} />
      <div className={surface.tableWrap}>
        <table className={surface.table}>
          <thead><tr><th>{cbT('advance')}</th><th className={surface.numeric}>{cbT('amount')}</th><th className={surface.numeric}>{cbT('recovered')}</th><th className={surface.numeric}>{cbT('balance')}</th><th className={surface.numeric}>{cbT('interestToDate')}</th><th>{cbT('workDone')}</th><th /></tr></thead>
          <tbody>
            {advanceStatus(c, bills, advances, today(), boqAdvance).map((s) => (
              <tr key={s.term.advance_id} data-cn-adv={s.term.kind}>
                <td>{s.advance?.number} · {cbT(`k.${s.term.kind}`)} · {s.term.interest_pct ?? 0}% · {s.term.recover_from_pct}%→{s.term.recover_by_pct}%</td>
                <td className={surface.numeric}>{fmtMoney(s.amount)}</td>
                <td className={surface.numeric}>{fmtMoney(s.recovered)}</td>
                <td className={surface.numeric} data-cn-adv-balance>{fmtMoney(s.balance)}</td>
                <td className={surface.numeric}>{fmtMoney(s.interest)}</td>
                <td className={s.behind ? styles.bad : ''}>{s.workPct}%{s.behind ? ` · ${cbT('behind', { amt: fmtMoney(s.target - s.recovered) })}` : ''}</td>
                <td><button type="button" className={B.gs} onClick={() => run(() => saveContract({ ...c, advance_terms: c.advance_terms?.filter((x) => x.advance_id !== s.term.advance_id) }))}>{cbT('unlink')}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <section className={styles.box}>
        <div className={styles.grid}>
          <F l={cbT('advance')}><select className={controls.select} value={String(t.advance_id)} onChange={(e) => setT({ ...t, advance_id: e.target.value })} data-cn-adv-pick><option value="">—</option>{mine.map((a) => <option key={a.id} value={a.id}>{a.number} · {fmtMoney(a.amount)}</option>)}</select></F>
          <F l={cbT('kind')}><select className={controls.select} value={String(t.kind)} onChange={(e) => setT({ ...t, kind: e.target.value })}><option value="mobilisation">{cbT('k.mobilisation')}</option><option value="plant">{cbT('k.plant')}</option></select></F>
        </div>
        <Fields spec={[['interest_pct', 'interestPct', 'number'], ['recover_from_pct', 'recoverFrom', 'number'], ['recover_by_pct', 'recoverBy', 'number']]} v={t} on={(k, v) => setT({ ...t, [k]: v })} />
        <div className={styles.toolbar}><button type="button" className={B.o} disabled={!t.advance_id} onClick={link} data-cn-adv-link>{cbT('linkAdvance')}</button></div>
        <p className={styles.note}>{cbT('advanceHint')}</p>
      </section>
      <section className={styles.box} data-cn-secured>
        <h4 className={styles.toolbar}><HandCoins size={16} aria-hidden="true" /> {cbT('secured')}</h4>
        {secured.map((s) => {
          const rec = securedRecovered(s.id, invoices);
          return (
            <div key={s.id} className={styles.toolbar} data-cn-sa>
              <span>{s.date} · {s.materials.map((m) => `${m.description} ${m.qty}${m.unit ? ` ${m.unit}` : ''}`).join(', ')} · {fmtMoney(s.amount)} ({s.pct}%) · {cbT('recovered')} {fmtMoney(rec)} · {cbT('balance')} <strong data-cn-sa-balance>{fmtMoney(s.amount - rec)}</strong></span>
              {rec === 0 && <button type="button" className={B.gs} onClick={() => run(() => deleteSecured(s.id, invoices))}>{cbT('delete')}</button>}
            </div>
          );
        })}
        {mats.map((m, i) => (
          <div key={i} className={styles.toolbar}>
            {(['description', 'qty', 'unit', 'rate'] as const).map((k) => <F key={k} l={cbT(`m.${k}`)}><input className={controls.input} type={k === 'qty' || k === 'rate' ? 'number' : 'text'} value={m[k]} onChange={(e) => setMats(mats.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)))} data-cn-mat={k} /></F>)}
          </div>
        ))}
        <Fields spec={[['date', 'date', 'date'], ['pct', 'securedPct', 'number'], ['mode', 'mode']]} v={sa} on={(k, v) => setSa({ ...sa, [k]: v })} />
        <div className={styles.toolbar}>
          <button type="button" className={B.gs} onClick={() => setMats([...mats, { description: '', qty: '', unit: '', rate: '' }])}>{cbT('addLine')}</button>
          <button type="button" className={B.p} onClick={() => run(() => recordSecured({ contract_id: c.id, party: c.client_name ?? '', date: String(sa.date), pct: n(sa.pct), mode: String(sa.mode), materials: mats.map((m) => ({ description: m.description, qty: Number(m.qty), unit: m.unit, rate: Number(m.rate) })) }))} data-cn-sa-save>{cbT('recordSecured')}</button>
        </div>
        <p className={styles.note}>{cbT('securedHint')}</p>
      </section>
    </div>
  );
}
