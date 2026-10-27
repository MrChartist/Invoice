/**
 * CN-B5: Works → Guarantees — bank guarantees with expiry (red within 30 days), extend / release / invoked and the
 * bank's commission; EMD / security deposits paid to the client (R5-C6 deposits, linked to the contract).
 */
import { useMemo, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { cbT } from '../../i18n/areas/construction-r11b';
import { twT } from '../../i18n/areas/packs-transport-works-r5';
import type { BankGuarantee, BgKind } from '../../types/construction-r11';
import { shiftDay } from '../../lib/dates';
import { loadContracts } from '../../lib/construction/cn-contracts';
import { bgCommission, closeGuarantee, contractDeposits, deleteGuarantee, extendGuarantee, isLiveBg, linkDeposit, loadGuarantees, saveGuarantee } from '../../lib/construction/cn-guarantees';
import { B, fmtMoney, today, type PanelProps } from '../transport/shared';
import { Fields, type Vals } from './cn-fin-ui';
import { n, runner } from './cn-fin-run';
import surface from '../../styles/surface.module.css';
import styles from '../transport/transport.module.css';

const KINDS: readonly BgKind[] = ['performance', 'mobilisation', 'secured', 'retention_release', 'emd', 'other'];

export default function GuaranteesView({ notify, refresh, tick }: PanelProps) {
  const contracts = useMemo(() => loadContracts(), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const [f, setF] = useState<Vals>({ contract_id: contracts[0]?.id ?? '', kind: 'performance', issued_on: today(), ext: '' });
  const run = runner(notify, refresh);
  const day = today();
  const name = (id?: string) => contracts.find((c) => c.id === id)?.name_of_work ?? '';
  const c = contracts.find((x) => x.id === f.contract_id);
  const act = (_b: BankGuarantee, label: string, fn: () => unknown) => <button type="button" className={B.gs} onClick={() => run(fn)}>{label}</button>;
  return (
    <div className={styles.stack} data-cn-guarantees>
      <div className={surface.tableWrap}>
        <table className={surface.table}>
          <thead><tr><th>{cbT('bgNo')}</th><th>{cbT('contract')}</th><th className={surface.numeric}>{twT('amount')}</th><th>{twT('expires')}</th><th className={surface.numeric}>{cbT('commission')}</th><th /></tr></thead>
          <tbody>
            {loadGuarantees().map((b) => (
              <tr key={b.id} data-cn-bg-row={b.bg_no}>
                <td>{b.bg_no} · {b.bank} · {cbT(`bg.${b.kind}`)}</td><td>{name(b.contract_id)}</td><td className={surface.numeric}>{fmtMoney(b.amount)}</td>
                <td className={isLiveBg(b) && b.expires_on <= shiftDay(day, 30) ? styles.bad : ''}>{b.expires_on} · {cbT(`bgs.${b.status}`)}</td>
                <td className={surface.numeric}>{fmtMoney(bgCommission(b))}</td>
                <td>{isLiveBg(b) && <>{act(b, cbT('extend'), () => extendGuarantee(b.id, String(f.ext), day))}{act(b, twT('release'), () => closeGuarantee(b.id, 'released', day))}{act(b, cbT('invoked'), () => closeGuarantee(b.id, 'invoked', day))}</>}
                  {act(b, twT('remove'), () => deleteGuarantee(b.id))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <section className={styles.box}>
        <h4 className={styles.toolbar}><ShieldCheck size={16} aria-hidden="true" /> {cbT('bgNo')}</h4>
        <Fields spec={[
          ['contract_id', cbT('contract'), [['', '—'], ...contracts.map((x) => [x.id, x.name_of_work] as const)]], ['kind', twT('kind'), KINDS.map((k) => [k, cbT(`bg.${k}`)] as const)],
          ['bank', cbT('bank')], ['bg_no', cbT('bgNo')], ['amount', twT('amount'), 'number'], ['issued_on', cbT('issuedOn'), 'date'], ['expires_on', twT('expires'), 'date'], ['claim_until', cbT('claimUntil'), 'date'],
          ['fd_ref', cbT('fdRef')], ['fd_amount', cbT('fdAmount'), 'number'], ['commission_pct', cbT('commissionPct'), 'number'], ['ext', cbT('extendTo'), 'date'],
        ]} v={f} set={setF} />
        <div className={styles.toolbar}><button type="button" className={B.p} data-cn-bg-save onClick={() => run(() => saveGuarantee({ ...(f as Partial<BankGuarantee>), amount: n(f.amount), commission_pct: n(f.commission_pct), margin: { fd_ref: String(f.fd_ref ?? ''), amount: n(f.fd_amount) } }))}>{twT('save')}</button></div>
        <p className={styles.note}>{cbT('bgHint')}</p>
      </section>
      {c && (
        <section className={styles.box} data-cn-emd>
          <h4>{cbT('emdSd')} · {c.name_of_work}</h4>
          {contractDeposits(c.id, c.client_id).map((x) => (
            <div key={x.id} className={styles.toolbar} data-cn-emd-row>{x.date} · {fmtMoney(x.amount)} · {x.status}
              {!x.contract_id && <button type="button" className={B.gs} onClick={() => run(() => linkDeposit(x.id, c.id))}>{cbT('linkDeposit')}</button>}</div>
          ))}
          <p className={styles.note}>{cbT('emdHint')}</p>
        </section>
      )}
    </div>
  );
}
