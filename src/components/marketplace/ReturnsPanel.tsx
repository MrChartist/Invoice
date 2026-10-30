/** R5-A6: returns / RTO / claims desk — pending receipt → received → restocked / claimed → closed, with claim windows. */
import { useMemo, useState } from 'react';
import { PackageX } from 'lucide-react';
import { mT } from '../../i18n/areas/packs-marketplace-r5';
import { addReturns, claimDeadline, closeReturn, deskStatus, loadReturns, markReceived, raiseClaim, restockReturn, setClaimStatus } from '../../lib/marketplace/returns-desk';
import { godownsDb } from '../../lib/godowns';
import type { ClaimStatus, ReturnCondition, ReturnType } from '../../types/marketplace-r5';
import { ChannelPicker } from './ChannelsPanel';
import { errText, today, type PanelProps } from './file-read';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './marketplace.module.css';
import { SelectField } from '../ui/SelectField';
import { DateField } from '../ui/DateField';

const CONDITIONS: readonly ReturnCondition[] = ['good', 'damaged', 'wrong_item', 'missing'];
const TYPES: readonly ReturnType[] = ['customer_return', 'rto', 'courier_lost'];
const CLAIMS: readonly ClaimStatus[] = ['open', 'approved', 'rejected', 'reimbursed'];

export function ReturnsPanel(props: PanelProps) {
  const { channel, notify } = props;
  const [tick, setTick] = useState(0);
  const rows = useMemo(() => (channel ? loadReturns(channel.id) : []), [channel, tick]); // eslint-disable-line react-hooks/exhaustive-deps -- tick re-reads storage
  const godowns = useMemo(() => godownsDb.list(), []);
  const [cond, setCond] = useState<ReturnCondition>('good');
  const [godown, setGodown] = useState('');
  const [claim, setClaim] = useState({ id: '', amount: '' });
  const [hand, setHand] = useState<{ order: string; type: ReturnType; expected: string }>({ order: '', type: 'customer_return', expected: today() });
  if (!channel) return <ChannelPicker {...props} />;
  const act = (fn: () => unknown) => {
    try {
      fn();
      setTick((n) => n + 1);
      notify(mT('done'));
    } catch (err) {
      notify(errText(err), 'error');
    }
  };
  const restock = (id: string) => act(() => {
    const r = restockReturn(id, { day: today(), godownId: godown || undefined, channel });
    if (r.creditNote) notify(mT('rtRestocked', { no: r.creditNote.invoice_number }));
  });

  return (
    <div className={styles.stack}>
      <div className={styles.toolbar}>
        <ChannelPicker {...props} />
        <label className={controls.field}><span className={controls.label}>{mT('rtCondition')}</span>
          <SelectField className={controls.select} value={cond} onChange={(e) => setCond(e.target.value as ReturnCondition)}>
            {CONDITIONS.map((c) => <option key={c} value={c}>{mT(`cond.${c}`)}</option>)}
          </SelectField></label>
        <label className={controls.field}><span className={controls.label}>{mT('chGodown')}</span>
          <SelectField className={controls.select} value={godown} onChange={(e) => setGodown(e.target.value)}>
            <option value="">{mT('defaultGodown')}</option>
            {godowns.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </SelectField></label>
        <label className={controls.field}><span className={controls.label}>{mT('rtClaimId')}</span>
          <input className={controls.input} value={claim.id} onChange={(e) => setClaim({ ...claim, id: e.target.value })} /></label>
        <label className={controls.field}><span className={controls.label}>{mT('amount')}</span>
          <input className={controls.input} inputMode="decimal" value={claim.amount} onChange={(e) => setClaim({ ...claim, amount: e.target.value })} /></label>
      </div>
      <p className={styles.note}>{mT('rtRtoNote')}</p>
      {rows.length === 0 ? <p className={styles.note}>{mT('rtEmpty')}</p> : (
        <div className={surface.tableWrap}>
          <table className={surface.table}>
            <thead><tr><th>{mT('orderId')}</th><th>{mT('rtType')}</th><th>{mT('rtExpected')}</th><th>{mT('rtReceived')}</th><th>{mT('status')}</th><th>{mT('rtDeadline')}</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => {
                const st = deskStatus(r);
                return (
                  <tr key={r.id}>
                    <td className={surface.mono}><PackageX size={14} aria-hidden="true" /> {r.order_id}</td>
                    <td>{mT(`rt.${r.type}`)}</td>
                    <td>{r.expected_on ?? ''}</td>
                    <td>{r.received_on ? `${r.received_on} · ${r.condition ? mT(`cond.${r.condition}`) : ''}` : ''}</td>
                    <td>{mT(`ds.${st}`)}{r.claim ? ` · ${mT(`claim.${r.claim.status}`)}` : ''}</td>
                    <td>{claimDeadline(r, channel) || '-'}</td>
                    <td className={surface.rowActions}>
                      {st === 'pending' && <button type="button" className={`${controls.btn} ${controls.btnGhost} ${controls.btnSm}`} onClick={() => act(() => markReceived(r.id, today(), cond, godown || undefined))}>{mT('rtMarkReceived')}</button>}
                      {!r.credit_note_id && r.doc_id && st !== 'closed' && <button type="button" className={`${controls.btn} ${controls.btnGhost} ${controls.btnSm}`} onClick={() => restock(r.id)}>{mT('rtRestock')}</button>}
                      {!r.claim && st !== 'closed' && <button type="button" className={`${controls.btn} ${controls.btnGhost} ${controls.btnSm}`} onClick={() => act(() => raiseClaim(r.id, { id: claim.id || undefined, raised_on: today(), amount: Number(claim.amount) || undefined }))}>{mT('rtClaim')}</button>}
                      {r.claim && (
                        <SelectField className={controls.select} aria-label={mT('status')} value={r.claim.status} onChange={(e) => act(() => setClaimStatus(r.id, e.target.value as ClaimStatus))}>
                          {CLAIMS.map((c) => <option key={c} value={c}>{mT(`claim.${c}`)}</option>)}
                        </SelectField>
                      )}
                      {st !== 'closed' && <button type="button" className={`${controls.btn} ${controls.btnGhost} ${controls.btnSm}`} onClick={() => act(() => closeReturn(r.id, today()))}>{mT('rtClose')}</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <fieldset className={styles.toolbar}>
        <legend className={controls.label}>{mT('rtAddHand')}</legend>
        <input className={controls.input} placeholder={mT('orderId')} value={hand.order} onChange={(e) => setHand({ ...hand, order: e.target.value })} />
        <SelectField className={controls.select} value={hand.type} onChange={(e) => setHand({ ...hand, type: e.target.value as ReturnType })}>
          {TYPES.map((x) => <option key={x} value={x}>{mT(`rt.${x}`)}</option>)}
        </SelectField>
        <DateField className={controls.input} value={hand.expected} onChange={(e) => setHand({ ...hand, expected: e.target.value })} />
        <button type="button" className={`${controls.btn} ${controls.btnOutline}`} disabled={!hand.order.trim()} onClick={() => act(() => { addReturns([{ channel_id: channel.id, order_id: hand.order.trim(), type: hand.type, expected_on: hand.expected }]); setHand({ ...hand, order: '' }); })}>{mT('add')}</button>
      </fieldset>
    </div>
  );
}
