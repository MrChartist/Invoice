/**
 * CN-B5: Works → Guarantees — bank guarantees with expiry (red within 30 days), extend / release / invoked, the
 * bank's commission; and EMD / security deposits paid to clients (R5-C6 deposits with `contract_id`; adjust and refund
 * them in Recurring → Leases → Deposits).
 */
import { useMemo, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { cbT } from '../../i18n/areas/construction-r11b';
import type { BankGuarantee, BgKind } from '../../types/construction-r11';
import { shiftDay } from '../../lib/dates';
import { loadContracts } from '../../lib/construction/cn-contracts';
import { bgCommission, closeGuarantee, contractDeposits, deleteGuarantee, extendGuarantee, isLiveBg, loadGuarantees, saveGuarantee } from '../../lib/construction/cn-guarantees';
import { recordDeposit } from '../../lib/property/deposits';
import { B, fmtMoney, today, type PanelProps } from '../transport/shared';
import { F } from '../transport/Field';
import { Fields, type Vals } from './cn-fin-ui';
import { n, runner } from './cn-fin-run';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from '../transport/transport.module.css';

const KINDS: readonly BgKind[] = ['performance', 'mobilisation', 'secured', 'retention_release', 'emd', 'other'];

export default function GuaranteesView({ notify, refresh, tick }: PanelProps) {
  const contracts = useMemo(() => loadContracts(), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const list = useMemo(() => loadGuarantees(), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const [f, setF] = useState<Vals>({ contract_id: contracts[0]?.id ?? '', kind: 'performance', issued_on: today(), expires_on: '' });
  const [ext, setExt] = useState('');
  const [d, setD] = useState<Vals>({ amount: '', date: today(), mode: 'bank' });
  const run = runner(notify, refresh);
  const day = today();
  const name = (id?: string) => contracts.find((c) => c.id === id)?.agreement_no || contracts.find((c) => c.id === id)?.name_of_work || '';
  const pick = (k: string) => (
    <select className={controls.select} value={String(f[k] ?? '')} onChange={(e) => setF({ ...f, [k]: e.target.value })} data-cn-bg={k}>
      {k === 'kind' ? KINDS.map((x) => <option key={x} value={x}>{cbT(`bg.${x}`)}</option>) : [<option key="" value="">—</option>, ...contracts.map((c) => <option key={c.id} value={c.id}>{name(c.id)}</option>)]}
    </select>
  );
  const c = contracts.find((x) => x.id === f.contract_id);
  return (
    <div className={styles.stack} data-cn-guarantees>
      <div className={surface.tableWrap}>
        <table className={surface.table}>
          <thead><tr><th>{cbT('bgNo')}</th><th>{cbT('contract')}</th><th className={surface.numeric}>{cbT('amount')}</th><th>{cbT('expires')}</th><th className={surface.numeric}>{cbT('commission')}</th><th /></tr></thead>
          <tbody>
            {list.map((b: BankGuarantee) => (
              <tr key={b.id} data-cn-bg-row={b.bg_no}>
                <td>{b.bg_no} · {b.bank} · {cbT(`bg.${b.kind}`)}</td><td>{name(b.contract_id)}</td><td className={surface.numeric}>{fmtMoney(b.amount)}</td>
                <td className={isLiveBg(b) && b.expires_on <= shiftDay(day, 30) ? styles.bad : ''}>{b.expires_on} · {cbT(`bgs.${b.status}`)}</td>
                <td className={surface.numeric}>{fmtMoney(bgCommission(b))}</td>
                <td>{isLiveBg(b) && <>
                  <button type="button" className={B.gs} disabled={!ext} onClick={() => run(() => extendGuarantee(b.id, ext, day))}>{cbT('extend')}</button>
                  <button type="button" className={B.gs} onClick={() => run(() => closeGuarantee(b.id, 'released', day))}>{cbT('release')}</button>
                  <button type="button" className={B.gs} onClick={() => run(() => closeGuarantee(b.id, 'invoked', day))}>{cbT('invoked')}</button></>}
                  <button type="button" className={B.gs} onClick={() => run(() => deleteGuarantee(b.id))}>{cbT('delete')}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <F l={cbT('extendTo')}><input className={controls.input} type="date" value={ext} onChange={(e) => setExt(e.target.value)} /></F>
      <section className={styles.box}>
        <h4 className={styles.toolbar}><ShieldCheck size={16} aria-hidden="true" /> {cbT('newBg')}</h4>
        <div className={styles.grid}><F l={cbT('contract')}>{pick('contract_id')}</F><F l={cbT('kind')}>{pick('kind')}</F></div>
        <Fields spec={[['bank', 'bank'], ['bg_no', 'bgNo'], ['amount', 'amount', 'number'], ['issued_on', 'issuedOn', 'date'], ['expires_on', 'expires', 'date'], ['claim_until', 'claimUntil', 'date'], ['fd_ref', 'fdRef'], ['fd_amount', 'fdAmount', 'number'], ['commission_pct', 'commissionPct', 'number']]} v={f} on={(k, v) => setF({ ...f, [k]: v })} />
        <div className={styles.toolbar}><button type="button" className={B.p} onClick={() => run(() => saveGuarantee({ ...(f as Partial<BankGuarantee>), kind: f.kind as BgKind, amount: n(f.amount), commission_pct: n(f.commission_pct), margin: { fd_ref: String(f.fd_ref ?? ''), amount: n(f.fd_amount) } }))} data-cn-bg-save>{cbT('save')}</button></div>
        <p className={styles.note}>{cbT('bgHint')}</p>
      </section>
      {c && (
        <section className={styles.box} data-cn-emd>
          <h4>{cbT('emdSd')} · {name(c.id)}</h4>
          {contractDeposits(c.id).map((x) => <div key={x.id}>{x.date} · {fmtMoney(x.amount)} · {x.status}</div>)}
          <Fields spec={[['amount', 'amount', 'number'], ['date', 'date', 'date'], ['mode', 'mode']]} v={d} on={(k, v) => setD({ ...d, [k]: v })} />
          <div className={styles.toolbar}><button type="button" className={B.o} onClick={() => run(() => recordDeposit({ direction: 'paid', party_id: c.client_id ?? '', party_name: c.client_name || c.name_of_work, amount: n(d.amount) ?? 0, date: String(d.date), mode: String(d.mode), contract_id: c.id }))} data-cn-emd-save>{cbT('payDeposit')}</button></div>
        </section>
      )}
    </div>
  );
}
