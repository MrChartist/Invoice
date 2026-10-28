import { useMemo, useState } from 'react';
import { PackageCheck } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { NumberInput } from '../ui/NumberInput';
import { ScanField } from '../scan/ScanField';
import { loadRequestDocs, requestProgress, transferRequestsDb, unaccounted, type ReceiveLine } from '../../lib/retail/transfer-requests';
import { findByCode } from '../../lib/scan';
import { num } from '../../lib/invoice-calc';
import { cn, todayInput } from '../../lib/utils';
import type { TransferRequest } from '../../types/stores-r4';
import { useT } from '../../i18n';
import { sT } from '../../i18n/areas/stores-r4';
import { nameOfGodown, type TransferCtx } from './transfer-context';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import css from './retail-r4.module.css';

/**
 * Receive against a transfer request (R4-B4): per item received / short / damaged. What arrived moves from transit to
 * the store; short and damaged stay in transit until written off, claimed or found. Scanning an item adds one received.
 */
export default function ReceiveDialog({ ctx, request, onClose, onDone }: { ctx: TransferCtx; request: TransferRequest; onClose: () => void; onDone: (msg: string) => void }) {
  useT();
  const [date, setDate] = useState(todayInput());
  const room = useMemo(() => unaccounted(requestProgress(request, loadRequestDocs()), request.exceptions ?? []), [request]);
  const [rows, setRows] = useState<ReceiveLine[]>(() => [...room].map(([item_id]) => ({ item_id, received: 0, short: 0, damaged: 0 })));
  const [scanned, setScanned] = useState(false);
  const [error, setError] = useState('');
  const itemName = (id: string) => ctx.items.find((i) => i.id === id)?.name ?? sT('item');
  const patch = (id: string, change: Partial<ReceiveLine>) => setRows((rs) => rs.map((r) => (r.item_id === id ? { ...r, ...change } : r)));
  const all = () => setRows((rs) => rs.map((r) => ({ ...r, received: room.get(r.item_id) ?? 0, short: 0, damaged: 0 })));

  const onCode = (code: string) => {
    const hit = findByCode(code, [], ctx.items);
    const id = hit && (hit.stock?.id ?? ctx.items.find((i) => i.name === hit.item.name)?.id);
    if (!id || !room.has(id)) return { ok: false, message: sT('scanNotHere', { code }) };
    setScanned(true);
    setRows((rs) => rs.map((r) => (r.item_id === id ? { ...r, received: num(r.received) + 1 } : r)));
    return { ok: true, message: sT('scanAdded', { item: itemName(id) }) };
  };

  const submit = () => {
    try {
      const r = transferRequestsDb.receive(request.id, { date, lines: rows }, ctx.items, ctx.inputs);
      const open = (r.request.exceptions ?? []).filter((e) => e.status === 'open').length;
      onDone([r.transfer ? sT('receivedMsg', { number: r.transfer.transfer_number }) : '', open ? sT('openShort', { n: open }) : ''].filter(Boolean).join(' '));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Modal open onClose={onClose} size="lg" title={`${sT('receive')} · ${request.number}`} subtitle={sT('receiveSub', { to: nameOfGodown(ctx, request.to_godown) })}
      footer={<><button type="button" className={controls.btnOutline} onClick={onClose}>{sT('cancel')}</button><button type="button" className={controls.btnPrimary} onClick={submit} data-trq-receive-save><PackageCheck size={16} aria-hidden="true" /> {sT('receive')}</button></>}>
      <div className={css.stack}>
        <div className={css.bar}>
          <label className={controls.field}><span className={controls.label}>{sT('date')}</span><input type="date" className={controls.input} value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={all} data-trq-receive-all>{sT('receiveAll')}</button>
        </div>
        <ScanField id="trq-scan" label={sT('scanToReceive')} onCode={onCode} placeholder={sT('scanPh')} />
        <div className={css.wrap}>
          <table className={surface.table}>
            <thead><tr><th>{sT('item')}</th><th className={css.num}>{sT('inTransit')}</th><th className={css.num}>{sT('received')}</th><th className={css.num}>{sT('short')}</th><th className={css.num}>{sT('damaged')}</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.item_id}>
                  <td>{itemName(r.item_id)}</td>
                  <td className={css.num}>{room.get(r.item_id) ?? 0}</td>
                  <td className={css.num}><NumberInput className={cn(controls.input, controls.inputNumeric, css.gridInput)} value={r.received} onChange={(v) => patch(r.item_id, { received: v })} aria-label={sT('receivedFor', { item: itemName(r.item_id) })} data-trq-received /></td>
                  <td className={css.num}><NumberInput className={cn(controls.input, controls.inputNumeric, css.gridInput)} value={r.short ?? 0} onChange={(v) => patch(r.item_id, { short: v })} aria-label={sT('shortFor', { item: itemName(r.item_id) })} data-trq-short /></td>
                  <td className={css.num}><NumberInput className={cn(controls.input, controls.inputNumeric, css.gridInput)} value={r.damaged ?? 0} onChange={(v) => patch(r.item_id, { damaged: v })} aria-label={sT('damagedFor', { item: itemName(r.item_id) })} /></td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={5} className={css.muted}>{sT('nothingInTransit')}</td></tr>}
            </tbody>
          </table>
        </div>
        {scanned && <p className={css.note}>{sT('scanHint')}</p>}
        <p className={css.note}>{sT('receiveHint')}</p>
        {error && <p className={controls.error} role="alert">{error}</p>}
      </div>
    </Modal>
  );
}
