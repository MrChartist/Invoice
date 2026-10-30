/**
 * CN-B2: Works → Advances — per contract, each mobilisation / plant advance (amount, recovered, balance, interest to
 * date, % of work, behind schedule) with its terms, and the secured advances on materials at site. The advance receipt
 * itself is recorded in Receivables → Advances (GST at receipt).
 */
import { useMemo, useState } from 'react';
import { HandCoins } from 'lucide-react';
import { cbT } from '../../i18n/areas/construction-r11b';
import { twT } from '../../i18n/areas/packs-transport-works-r5';
import type { CnAdvanceTerm } from '../../types/construction-r11';
import { localDb } from '../../lib/localDb';
import { loadAdvances, samePartyAs } from '../../lib/advances';
import { contractBills, loadContracts, saveContract } from '../../lib/construction/cn-contracts';
import { advanceStatus } from '../../lib/construction/cn-advances';
import { deleteSecured, loadSecured, recordSecured, securedRecovered } from '../../lib/construction/cn-secured';
import { B, fmtMoney, today, type PanelProps } from '../transport/shared';
import { ContractPick, Fields, type Vals } from './cn-fin-ui';
import { n, runner } from './cn-fin-run';
import surface from '../../styles/surface.module.css';
import styles from '../transport/transport.module.css';

const MAT = ['description', 'qty', 'unit', 'rate'] as const;

export default function AdvancesView({ notify, refresh, tick, boqId }: PanelProps & { boqId?: string }) {
  const contracts = useMemo(() => loadContracts(), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const invoices = useMemo(() => localDb.invoices.getAll(), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const [id, setId] = useState(() => contracts.find((c) => c.boq_id === boqId)?.id ?? contracts[0]?.id ?? '');
  const [t, setT] = useState<Vals>({ advance_id: '', kind: 'mobilisation', interest_pct: '10', recover_from_pct: '10', recover_by_pct: '80' });
  const [sa, setSa] = useState<Vals>({ date: today(), pct: '75', mode: 'bank' });
  const run = runner(notify, refresh);
  const c = contracts.find((x) => x.id === id);
  const pick = <ContractPick contracts={contracts} value={id} onChange={setId} />;
  if (!c) return pick;
  const advances = loadAdvances();
  const kinds = [['mobilisation', cbT('k.mobilisation')], ['plant', cbT('k.plant')]] as const;
  const mats = [0, 1, 2].map((i) => MAT.map((k) => String(sa[`${k}${i}`] ?? '')));
  return (
    <div className={styles.stack} data-cn-advances>
      {pick}
      <div className={surface.tableWrap}>
        <table className={surface.table}>
          <thead><tr><th>{cbT('advance')}</th><th className={surface.numeric}>{twT('amount')}</th><th className={surface.numeric}>{cbT('recovered')}</th><th className={surface.numeric}>{twT('balance')}</th><th className={surface.numeric}>{cbT('interest')}</th><th>{cbT('workDone')}</th><th /></tr></thead>
          <tbody>
            {advanceStatus(c, contractBills(c, invoices), advances, today(), localDb.invoices.getById(c.boq_id ?? '')?.boq_terms?.advance_id).map((s) => (
              <tr key={s.term.advance_id} data-cn-adv={s.term.kind}>
                <td>{s.advance?.number} · {s.term.kind} · {s.term.interest_pct}% · {s.term.recover_from_pct}→{s.term.recover_by_pct}%</td>
                <td className={surface.numeric}>{fmtMoney(s.amount)}</td><td className={surface.numeric}>{fmtMoney(s.recovered)}</td><td className={surface.numeric} data-cn-adv-balance>{fmtMoney(s.balance)}</td>
                <td className={surface.numeric}>{fmtMoney(s.interest)}</td><td className={s.behind ? styles.bad : ''}>{s.workPct}%{s.behind ? ` · ${cbT('behind', { amt: fmtMoney(s.target - s.recovered) })}` : ''}</td>
                <td><button type="button" className={B.gs} onClick={() => run(() => saveContract({ ...c, advance_terms: c.advance_terms?.filter((x) => x.advance_id !== s.term.advance_id) }))}>{cbT('unlink')}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <section className={styles.box}>
        <Fields spec={[
          ['advance_id', cbT('advance'), [['', '-'], ...advances.filter((a) => samePartyAs(a.client, { id: c.client_id, name: c.client_name })).map((a) => [a.id, `${a.number} · ${fmtMoney(a.amount)}`] as const)]],
          ['kind', twT('kind'), kinds], ['interest_pct', cbT('interestPct'), 'number'], ['recover_from_pct', cbT('recoverFrom'), 'number'], ['recover_by_pct', cbT('recoverBy'), 'number'],
        ]} v={t} set={setT} />
        <div className={styles.toolbar}>
          <button type="button" className={B.o} disabled={!t.advance_id} data-cn-adv-link onClick={() => run(() => saveContract({ ...c, advance_terms: [...(c.advance_terms ?? []), { advance_id: String(t.advance_id), kind: t.kind as CnAdvanceTerm['kind'], interest_pct: n(t.interest_pct), recover_from_pct: n(t.recover_from_pct), recover_by_pct: n(t.recover_by_pct) }] }))}>{cbT('linkAdvance')}</button>
        </div>
        <p className={styles.note}>{cbT('advanceHint')}</p>
      </section>
      <section className={styles.box} data-cn-secured>
        <h4 className={styles.toolbar}><HandCoins size={16} aria-hidden="true" /> {cbT('secured')}</h4>
        {loadSecured().filter((s) => s.contract_id === c.id).map((s) => {
          const rec = securedRecovered(s.id, invoices);
          return (
            <div key={s.id} className={styles.toolbar} data-cn-sa>
              {s.date} · {s.materials.map((m) => `${m.description} ${m.qty} ${m.unit ?? ''}`).join(', ')} · {fmtMoney(s.amount)} ({s.pct}%) · {cbT('recovered')} {fmtMoney(rec)} · {twT('balance')} <strong data-cn-sa-balance>{fmtMoney(s.amount - rec)}</strong>
              {!rec && <button type="button" className={B.gs} onClick={() => run(() => deleteSecured(s.id, invoices))}>{twT('remove')}</button>}
            </div>
          );
        })}
        <Fields spec={[0, 1, 2].flatMap((i) => MAT.map((k) => [`${k}${i}`, twT(k), k === 'qty' || k === 'rate' ? 'number' : undefined] as const)).concat([['date', twT('date'), 'date'], ['pct', cbT('securedPct'), 'number'], ['mode', twT('method'), [['bank', 'Bank'], ['cash', 'Cash']]]] as never)} v={sa} set={setSa} />
        <div className={styles.toolbar}>
          <button type="button" className={B.p} data-cn-sa-save onClick={() => run(() => recordSecured({ contract_id: c.id, party: c.client_name ?? '', date: String(sa.date), pct: n(sa.pct), mode: String(sa.mode), materials: mats.map(([description, qty, unit, rate]) => ({ description, qty: Number(qty), unit, rate: Number(rate) })) }))}>{cbT('recordSecured')}</button>
        </div>
        <p className={styles.note}>{cbT('securedHint')}</p>
      </section>
    </div>
  );
}
