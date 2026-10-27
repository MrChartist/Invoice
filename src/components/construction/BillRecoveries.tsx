/**
 * CN-B2 / B4: "Recoveries on this bill" in the measurement form (lazy): secured advance used, material issued by the
 * client (with the wastage-band helper), hire of client plant, withheld amount (reason, expected release) and LD.
 * The contract's advance recovery / interest and water + electricity are added by the bill itself.
 */
import { useState } from 'react';
import { cbT } from '../../i18n/areas/construction-r11b';
import type { CnRecoveryInput } from '../../types/construction-r11';
import { contractOfBoq } from '../../lib/construction/cn-snapshot-io';
import { loadSecured } from '../../lib/construction/cn-secured';
import { wastageRecovery } from '../../lib/construction/cn-recoveries';
import { B, fmtMoney } from '../transport/shared';
import { F } from '../transport/Field';
import controls from '../../styles/controls.module.css';
import styles from '../transport/transport.module.css';

const KINDS: readonly CnRecoveryInput['kind'][] = ['secured_advance', 'material_recovery', 'hire_charges', 'withheld', 'ld', 'other'];
type Row = Record<'kind' | 'amount' | 'qty' | 'rate' | 'ref_id' | 'reason' | 'release_on', string>;
const blank: Row = { kind: 'material_recovery', amount: '', qty: '', rate: '', ref_id: '', reason: '', release_on: '' };

export default function BillRecoveries({ boqId, onChange }: { boqId: string; onChange: (r: CnRecoveryInput[]) => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [w, setW] = useState({ issued: '', theory: '', rate: '' });
  const contract = contractOfBoq(boqId);
  const secured = loadSecured().filter((s) => s.contract_id === contract?.id && s.status === 'open');
  const put = (next: Row[]) => {
    setRows(next);
    onChange(next.map((r) => ({ kind: r.kind as CnRecoveryInput['kind'], amount: Number(r.amount) || undefined, qty: Number(r.qty) || undefined, rate: Number(r.rate) || undefined, ref_id: r.ref_id || undefined, reason: r.reason || undefined, release_on: r.release_on || undefined })));
  };
  const set = (i: number, k: keyof Row, v: string) => put(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const wr = w.issued && w.theory && w.rate ? wastageRecovery(Number(w.issued), Number(w.theory), Number(w.rate)) : null;
  const inp = (i: number, k: keyof Row, type = 'number') => <F l={cbT(`r.${k}` as 'r.amount')}><input className={controls.input} type={type} value={rows[i][k]} onChange={(e) => set(i, k, e.target.value)} data-cn-rec={k} /></F>;
  return (
    <details className={styles.box} data-cn-recoveries>
      <summary>{cbT('recoveries')}</summary>
      {rows.map((r, i) => (
        <div key={i} className={styles.toolbar}>
          <F l={cbT('kind')}><select className={controls.select} value={r.kind} onChange={(e) => set(i, 'kind', e.target.value)} data-cn-rec="kind">{KINDS.map((k) => <option key={k} value={k}>{cbT(`rk.${k}`)}</option>)}</select></F>
          {r.kind === 'secured_advance' && <F l={cbT('secured')}><select className={controls.select} value={r.ref_id} onChange={(e) => set(i, 'ref_id', e.target.value)} data-cn-rec="ref"><option value="">—</option>{secured.map((s) => <option key={s.id} value={s.id}>{s.date} · {fmtMoney(s.amount)}</option>)}</select></F>}
          {inp(i, 'amount')}
          {(r.kind === 'material_recovery' || r.kind === 'secured_advance') && inp(i, 'qty')}
          {r.kind === 'material_recovery' && inp(i, 'rate')}
          {(r.kind === 'withheld' || r.kind === 'ld') && inp(i, 'reason', 'text')}
          {r.kind === 'withheld' && inp(i, 'release_on', 'date')}
          <button type="button" className={B.gs} onClick={() => put(rows.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <div className={styles.toolbar}>
        <button type="button" className={B.gs} onClick={() => put([...rows, blank])} data-cn-rec-add>{cbT('addRecovery')}</button>
        <F l={cbT('w.issued')}><input className={controls.input} type="number" value={w.issued} onChange={(e) => setW({ ...w, issued: e.target.value })} /></F>
        <F l={cbT('w.theory')}><input className={controls.input} type="number" value={w.theory} onChange={(e) => setW({ ...w, theory: e.target.value })} /></F>
        <F l={cbT('r.rate')}><input className={controls.input} type="number" value={w.rate} onChange={(e) => setW({ ...w, rate: e.target.value })} /></F>
        {wr && <button type="button" className={B.gs} disabled={!wr.amount} onClick={() => put([...rows, { ...blank, amount: String(wr.amount), reason: '' }])}>{cbT('w.add', { amt: fmtMoney(wr.amount), ex: wr.excess, sh: wr.shortfall })}</button>}
      </div>
      <p className={styles.note}>{cbT('recoveriesHint')}</p>
    </details>
  );
}
