import { useMemo, useState } from 'react';
import { Truck } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { NumberInput } from '../ui/NumberInput';
import { buildDispatchLines, liveTracking, loadRequestDocs, remainingToDispatch, requestProgress, transferRequestsDb } from '../../lib/retail/transfer-requests';
import { num } from '../../lib/invoice-calc';
import { cn, todayInput } from '../../lib/utils';
import type { TransferRequest } from '../../types/stores-r4';
import type { StockTransfer } from '../../types/stock';
import { useT } from '../../i18n';
import { sT } from '../../i18n/areas/stores-r4';
import { nameOfGodown, type TransferCtx } from './transfer-context';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import css from './retail-r4.module.css';

/**
 * Dispatch against a transfer request (R4-B4): a stock transfer from the supplying godown into the receiving store's
 * in-transit godown. Quantities are in base units; batch items go first-expiry-first, serial items by serial.
 */
export default function DispatchDialog({ ctx, request, onClose, onDone }: { ctx: TransferCtx; request: TransferRequest; onClose: () => void; onDone: (t: StockTransfer) => void }) {
  useT();
  const [date, setDate] = useState(todayInput());
  const [from, setFrom] = useState(request.from_godown);
  const remaining = useMemo(() => remainingToDispatch(requestProgress(request, loadRequestDocs())), [request]);
  const [want, setWant] = useState<Record<string, number>>(() => Object.fromEntries(remaining));
  const [error, setError] = useState('');
  const tracking = useMemo(() => liveTracking(ctx.inputs, date || undefined), [ctx.inputs, date]);
  const lines = useMemo(() => buildDispatchLines(new Map(Object.entries(want).map(([k, v]) => [k, num(v)])), ctx.items, tracking, date, from), [want, ctx.items, tracking, date, from]);
  const itemName = (id: string) => ctx.items.find((i) => i.id === id)?.name ?? sT('item');
  const sources = ctx.godowns.filter((g) => g.kind !== 'transit' && g.id !== request.to_godown);

  const submit = () => {
    try {
      const { transfer } = transferRequestsDb.dispatch(request.id, { date, from, lines }, ctx.inputs);
      onDone(transfer);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Modal open onClose={onClose} size="lg" title={`${sT('dispatch')} · ${request.number}`} subtitle={sT('dispatchSub', { to: nameOfGodown(ctx, request.to_godown) })}
      footer={<><button type="button" className={controls.btnOutline} onClick={onClose}>{sT('cancel')}</button><button type="button" className={controls.btnPrimary} disabled={!lines.length} onClick={submit} data-trq-dispatch-save><Truck size={16} aria-hidden="true" /> {sT('dispatch')}</button></>}>
      <div className={css.stack}>
        <div className={controls.row}>
          <label className={controls.field}><span className={controls.label}>{sT('date')}</span><input type="date" className={controls.input} value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label className={controls.field}><span className={controls.label}>{sT('fromGodown')}</span>
            <select className={controls.select} value={from} onChange={(e) => setFrom(e.target.value)}>{sources.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
          </label>
        </div>
        <div className={css.wrap}>
          <table className={surface.table}>
            <thead><tr><th>{sT('item')}</th><th className={css.num}>{sT('stillToSend')}</th><th className={css.num}>{sT('sendNow')}</th></tr></thead>
            <tbody>
              {[...remaining].map(([id, q]) => (
                <tr key={id}>
                  <td>{itemName(id)}</td>
                  <td className={css.num}>{q}</td>
                  <td className={css.num}><NumberInput className={cn(controls.input, controls.inputNumeric, css.gridInput)} value={want[id] ?? 0} onChange={(v) => setWant((w) => ({ ...w, [id]: v }))} aria-label={sT('sendNowFor', { item: itemName(id) })} data-trq-send /></td>
                </tr>
              ))}
              {!remaining.size && <tr><td colSpan={3} className={css.muted}>{sT('allSent')}</td></tr>}
            </tbody>
          </table>
        </div>
        {lines.some((l) => l.batch_no || l.serials?.length) && (
          <p className={css.note}>{lines.filter((l) => l.batch_no || l.serials?.length).map((l) => `${itemName(l.item_id)} ${l.batch_no ? `${sT('batch')} ${l.batch_no}` : (l.serials ?? []).join(', ')} × ${l.qty}`).join(' · ')}</p>
        )}
        <p className={css.note}>{sT('dispatchHint')}</p>
        {error && <p className={controls.error} role="alert">{error}</p>}
      </div>
    </Modal>
  );
}
