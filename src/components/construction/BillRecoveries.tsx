/**
 * CN-B2 / B4: "Recoveries on this bill" in the measurement form (lazy): secured advance used, client material (with
 * the wastage-band helper), hire of client plant, withheld amount (reason, expected release) and LD. The contract's
 * advance recovery / interest and water + electricity are added by the bill itself.
 */
import { useState } from 'react';
import { cbT } from '../../i18n/areas/construction-r11b';
import { twT } from '../../i18n/areas/packs-transport-works-r5';
import type { CnRecoveryInput } from '../../types/construction-r11';
import { loadContracts } from '../../lib/construction/cn-contracts';
import { loadSecured } from '../../lib/construction/cn-secured';
import { wastageRecovery } from '../../lib/construction/cn-recoveries';
import { B, fmtMoney } from '../transport/shared';
import { Fields, type Spec, type Vals } from './cn-fin-ui';
import styles from '../transport/transport.module.css';

const KINDS: readonly CnRecoveryInput['kind'][] = ['material_recovery', 'secured_advance', 'hire_charges', 'withheld', 'ld', 'other'];
const F = ['amount', 'qty', 'rate', 'reason'] as const;

export default function BillRecoveries({ boqId, onChange }: { boqId: string; onChange: (r: CnRecoveryInput[]) => void }) {
  const [rows, setRows] = useState(1);
  const [v, setV] = useState<Vals>({});
  const c = loadContracts().find((x) => x.boq_id === boqId);
  const secured = loadSecured().filter((s) => s.contract_id === c?.id && s.status === 'open');
  const set = (next: Vals | ((o: Vals) => Vals)) => {
    const val = typeof next === 'function' ? next(v) : next;
    setV(val);
    onChange([...Array(rows).keys()].map((i) => ({
      kind: (val[`kind${i}`] || 'material_recovery') as CnRecoveryInput['kind'], ref_id: (val[`ref${i}`] as string) || undefined, reason: (val[`reason${i}`] as string) || undefined, release_on: (val[`rel${i}`] as string) || undefined,
      amount: Number(val[`amount${i}`]) || undefined, qty: Number(val[`qty${i}`]) || undefined, rate: Number(val[`rate${i}`]) || undefined,
    })));
  };
  const w = v.wi && v.wt && v.wr ? wastageRecovery(Number(v.wi), Number(v.wt), Number(v.wr)) : null;
  const spec: Spec[] = [...Array(rows).keys()].flatMap((i) => [
    [`kind${i}`, twT('kind'), KINDS.map((k) => [k, cbT(`rk.${k}`)] as const)], [`ref${i}`, cbT('rk.secured_advance'), [['', '-'], ...secured.map((s) => [s.id, `${s.date} · ${fmtMoney(s.amount)}`] as const)]],
    ...F.map((k) => [`${k}${i}`, twT(k), k === 'reason' ? undefined : 'number'] as const), [`rel${i}`, twT('releaseOn'), 'date'],
  ] as Spec[]);
  return (
    <details className={styles.box} data-cn-recoveries>
      <summary>{cbT('recoveries')}</summary>
      <Fields spec={[...spec, ['wi', cbT('w.issued'), 'number'], ['wt', cbT('w.theory'), 'number'], ['wr', twT('rate'), 'number']]} v={v} set={set as never} />
      <div className={styles.toolbar}>
        <button type="button" className={B.gs} onClick={() => setRows(rows + 1)} data-cn-rec-add>{twT('addLine')}</button>
        {w && w.amount > 0 && <button type="button" className={B.gs} onClick={() => set((o) => ({ ...o, [`amount${rows - 1}`]: String(w.amount), [`kind${rows - 1}`]: 'material_recovery' }))}>{cbT('w.add', { amt: fmtMoney(w.amount) })}</button>}
      </div>
      <p className={styles.note}>{cbT('recoveriesHint')}</p>
    </details>
  );
}
