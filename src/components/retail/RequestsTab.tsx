import { Fragment, Suspense, lazy, useMemo, useState } from 'react';
import { ArrowLeftRight, Plus, Printer, Trash2, Truck } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { NumberInput } from '../ui/NumberInput';
import {
  TRANSFER_CA_NOTE, loadRequestDocs, requestProgress, requestStatus, transferRequestsDb, type RequestProgress,
} from '../../lib/retail/transfer-requests';
import { transferChallanHtml } from '../../lib/retail/transfer-challan';
import { TRANSFER_EWAY_CA_NOTE, buildEwayTransfer } from '../../lib/eway-transfer';
import { transferTaxPair } from '../../lib/branch-transfer';
import { loadBranches } from '../../lib/branch';
import { printHtmlDocument } from '../../lib/voucher-print';
import { downloadText } from '../../lib/download';
import { factorFor, unitChoices } from '../../lib/units';
import { generateId } from '../../lib/storage';
import { useCan } from '../../hooks/useCan';
import { cn, formatDate, todayInput } from '../../lib/utils';
import type { TransferRequest, TransferRequestLine } from '../../types/stores-r4';
import type { StockTransfer } from '../../types/stock';
import { useT } from '../../i18n';
import { sT } from '../../i18n/areas/stores-r4';
import { businessOf, costIndex, nameOfGodown, type TransferCtx } from './transfer-context';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import css from './retail-r4.module.css';
import { SelectField } from '../ui/SelectField';
import { DateField } from '../ui/DateField';

const DispatchDialog = lazy(() => import('./DispatchDialog'));
const ReceiveDialog = lazy(() => import('./ReceiveDialog'));

/** Transfer requests (R4-B4): raise, approve, dispatch into transit, receive with shortages, resolve, close. */
export default function RequestsTab({ ctx }: { ctx: TransferCtx }) {
  useT();
  const { can } = useCan();
  const [store, setStore] = useState('');
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [dispatching, setDispatching] = useState<TransferRequest | null>(null);
  const [receiving, setReceiving] = useState<TransferRequest | null>(null);
  const requests = useMemo(() => { void ctx.inputs; return transferRequestsDb.all(); }, [ctx.inputs]);
  const docs = useMemo(() => { void ctx.inputs; return loadRequestDocs(); }, [ctx.inputs]);
  const rows = useMemo(() => requests
    .filter((r) => !store || r.to_godown === store)
    .map((r) => { const p = requestProgress(r, docs); return { r, p, status: requestStatus(r, p) }; })
    .sort((a, b) => b.r.date.localeCompare(a.r.date) || b.r.number.localeCompare(a.r.number, undefined, { numeric: true })), [requests, docs, store]);
  const itemName = (id: string) => ctx.items.find((i) => i.id === id)?.name ?? sT('item');
  const stores = ctx.godowns.filter((g) => g.kind !== 'transit');

  const run = (fn: () => string) => {
    try {
      ctx.changed(fn());
    } catch (e) {
      ctx.error((e as Error).message);
    }
  };

  return (
    <div className={css.stack}>
      <div className={css.bar}>
        <label className={controls.field}><span className={controls.label}>{sT('store')}</span>
          <SelectField className={controls.select} value={store} onChange={(e) => setStore(e.target.value)}>
            <option value="">{sT('allStores')}</option>{stores.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </SelectField>
        </label>
        <span className={css.grow} />
        {can('doc.create') && (
          <button type="button" className={cn(controls.btnPrimary, controls.btnSm)} onClick={() => setCreating(true)} data-trq-new>
            <Plus size={14} aria-hidden="true" /> {sT('newRequest')}
          </button>
        )}
      </div>
      <div className={css.wrap}>
        <table className={surface.table} data-trq-list>
          <thead><tr><th>{sT('number')}</th><th>{sT('date')}</th><th>{sT('fromTo')}</th><th>{sT('items')}</th><th>{sT('neededBy')}</th><th>{sT('status')}</th><th><span className={surface.srOnly}>{sT('actions')}</span></th></tr></thead>
          <tbody>
            {rows.map(({ r, p, status }) => (
              <Fragment key={r.id}>
                <tr data-trq-row={r.number}>
                  <td className={css.mono}>{r.number}</td>
                  <td>{formatDate(r.date)}</td>
                  <td>{nameOfGodown(ctx, r.from_godown)} → {nameOfGodown(ctx, r.to_godown)}</td>
                  <td>{r.lines.map((l) => `${itemName(l.item_id)} × ${l.qty}${l.unit ? ` ${l.unit}` : ''}`).join(', ')}</td>
                  <td>{r.needed_by ? formatDate(r.needed_by) : '-'}</td>
                  <td><span className={cn(css.chip, css[status])} data-trq-status>{sT(`rs.${status}`)}</span></td>
                  <td className={css.actions}>
                    <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}>{sT('details')}</button>
                    {can('doc.approve') && status === 'requested' && <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={() => run(() => { transferRequestsDb.approve(r.id); return sT('approvedMsg', { number: r.number }); })}>{sT('approve')}</button>}
                    {can('books.edit') && status !== 'closed' && status !== 'rejected' && remaining(p) > 0 && <button type="button" className={cn(controls.btnOutline, controls.btnSm)} onClick={() => setDispatching(r)} data-trq-dispatch><Truck size={14} aria-hidden="true" /> {sT('dispatch')}</button>}
                    {can('books.edit') && p.inTransit.size > 0 && <button type="button" className={cn(controls.btnOutline, controls.btnSm)} onClick={() => setReceiving(r)} data-trq-receive>{sT('receive')}</button>}
                    {can('books.edit') && status !== 'closed' && status !== 'rejected' && p.dispatches.length > 0 && !p.inTransit.size && <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={() => run(() => { transferRequestsDb.close(r.id); return sT('closedMsg', { number: r.number }); })}>{sT('close')}</button>}
                    {can('doc.approve') && !p.dispatches.length && status !== 'rejected' && status !== 'closed' && <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={() => run(() => { transferRequestsDb.reject(r.id); return sT('rejectedMsg', { number: r.number }); })}>{sT('reject')}</button>}
                    {!p.dispatches.length && can('doc.create') && <button type="button" className={controls.btnDanger} aria-label={sT('deleteNamed', { number: r.number })} onClick={() => run(() => { transferRequestsDb.remove(r.id); return sT('deletedMsg', { number: r.number }); })}><Trash2 size={14} /></button>}
                  </td>
                </tr>
                {open === r.id && <tr><td colSpan={7}><RequestDetail ctx={ctx} request={r} progress={p} run={run} /></td></tr>}
              </Fragment>
            ))}
            {rows.length === 0 && <tr><td colSpan={7} className={css.muted}>{sT('noRequests')}</td></tr>}
          </tbody>
        </table>
      </div>
      <p className={css.note}>{TRANSFER_CA_NOTE}</p>
      {creating && <RequestForm ctx={ctx} onClose={() => setCreating(false)} />}
      <Suspense fallback={null}>
        {dispatching && <DispatchDialog ctx={ctx} request={dispatching} onClose={() => setDispatching(null)} onDone={(t) => { setDispatching(null); setOpen(dispatching.id); ctx.changed(sT('dispatchedMsg', { number: t.transfer_number })); }} />}
        {receiving && <ReceiveDialog ctx={ctx} request={receiving} onClose={() => setReceiving(null)} onDone={(m) => { setReceiving(null); ctx.changed(m || sT('saved')); }} />}
      </Suspense>
    </div>
  );
}

const remaining = (p: RequestProgress) => [...p.requested].reduce((s, [id, q]) => s + Math.max(q - (p.dispatched.get(id) ?? 0), 0), 0);

/** Dispatches with their challan / e-Way JSON, and the short / damaged goods with their resolution. */
function RequestDetail({ ctx, request: r, progress: p, run }: { ctx: TransferCtx; request: TransferRequest; progress: RequestProgress; run: (fn: () => string) => void }) {
  const { can } = useCan();
  const branches = useMemo(() => loadBranches(), []);
  const itemName = (id: string) => ctx.items.find((i) => i.id === id)?.name ?? sT('item');
  const [vehicle, setVehicle] = useState('');
  const [distance, setDistance] = useState(0);
  const premises = (id: string) => {
    const g = ctx.godowns.find((x) => x.id === id);
    return { name: g?.name ?? nameOfGodown(ctx, id), address: g?.address || businessOf().address };
  };
  const toGodown = r.to_godown;
  const challan = (t: StockTransfer) => {
    const b = businessOf();
    const html = transferChallanHtml(t, { company: b, from: premises(t.from_godown), to: premises(toGodown), items: ctx.items, costOf: costIndex(ctx.inputs), requestNumber: r.number, transport: { vehicle } });
    printHtmlDocument(html, (h) => downloadText(`challan-${t.transfer_number.replace(/[^\w-]+/g, '-')}.html`, h, 'text/html'));
  };
  const eway = (t: StockTransfer) => {
    const b = businessOf();
    const out = buildEwayTransfer(t, { sender: b, fromAddress: premises(t.from_godown).address, toAddress: premises(toGodown).address, items: ctx.items, costOf: costIndex(ctx.inputs), vehicle, distanceKm: distance });
    downloadText(`eway-${t.transfer_number.replace(/[^\w-]+/g, '-')}.json`, JSON.stringify(out.payload, null, 2), 'application/json');
    ctx.changed([sT('ewaySaved'), ...out.notes.slice(0, 2)].join(' '));
  };
  return (
    <div className={css.stack} data-trq-detail>
      <div className={css.stats}>
        {[...p.requested].map(([id, q]) => (
          <div key={id} className={css.stat}>
            <span className={css.statLabel}>{itemName(id)}</span>
            <span className={css.mono}>{sT('progressLine', { req: q, sent: p.dispatched.get(id) ?? 0, got: p.received.get(id) ?? 0, transit: p.inTransit.get(id) ?? 0 })}</span>
          </div>
        ))}
      </div>
      {p.dispatches.length > 0 && (
        <div className={css.box}>
          <div className={css.boxHead}><span><Truck size={14} aria-hidden="true" /> {sT('dispatches')}</span></div>
          <div className={controls.row}>
            <input className={controls.input} value={vehicle} onChange={(e) => setVehicle(e.target.value)} placeholder={sT('vehicle')} aria-label={sT('vehicle')} />
            <NumberInput className={cn(controls.input, controls.inputNumeric)} value={distance} onChange={setDistance} placeholder={sT('distance')} aria-label={sT('distance')} />
          </div>
          {p.dispatches.map((t) => {
            const pair = transferTaxPair({ from_godown: t.from_godown, to_godown: toGodown }, branches, ctx.godowns);
            return (
              <div key={t.id} className={css.applied}>
                <span className={css.mono}>{t.transfer_number} · {formatDate(t.date)}</span>
                {pair ? <span className={css.note}>{sT('sec254', { from: pair.from.name, to: pair.to.name })}</span> : (
                  <span className={css.actions}>
                    <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={() => challan(t)} data-trq-challan><Printer size={14} aria-hidden="true" /> {sT('challan')}</button>
                    <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={() => eway(t)} data-trq-eway>{sT('ewayJson')}</button>
                  </span>
                )}
              </div>
            );
          })}
          <p className={css.note}>{TRANSFER_EWAY_CA_NOTE}</p>
        </div>
      )}
      {(r.exceptions ?? []).length > 0 && (
        <div className={css.box}>
          <div className={css.boxHead}>{sT('exceptions')}</div>
          {(r.exceptions ?? []).map((e) => (
            <div key={e.id} className={css.applied} data-trq-exception={e.status}>
              <span>{itemName(e.item_id)} · {e.qty} {sT(e.kind)}{e.batch_no ? ` · ${e.batch_no}` : ''} · {sT(`ex.${e.status}`)}{e.ref ? ` (${e.ref})` : ''}</span>
              {can('books.edit') && (e.status === 'open' || e.status === 'claimed') && (
                <span className={css.actions}>
                  <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={() => run(() => { transferRequestsDb.writeOff(r.id, e.id, todayInput(), ctx.items, ctx.inputs); return sT('writtenOffMsg'); })} data-trq-writeoff>{sT('writeOff')}</button>
                  {e.status === 'open' && <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={() => { const note = window.prompt(sT('claimPrompt')) ?? ''; run(() => { transferRequestsDb.claim(r.id, e.id, note); return sT('claimedMsg'); }); }}>{sT('claim')}</button>}
                  <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={() => run(() => { transferRequestsDb.found(r.id, e.id, todayInput(), ctx.inputs); return sT('foundMsg'); })}>{sT('found')}</button>
                </span>
              )}
            </div>
          ))}
          <p className={css.note}>{sT('itcNote')}</p>
        </div>
      )}
      {(r.log ?? []).length > 0 && <p className={css.note}>{r.log.map((l) => `${formatDate(l.at.slice(0, 10))} ${sT(`log.${l.action}`)}${l.by ? ` (${l.by})` : ''}${l.note ? `: ${l.note}` : ''}`).join(' · ')}</p>}
    </div>
  );
}

function RequestForm({ ctx, onClose }: { ctx: TransferCtx; onClose: () => void }) {
  const stores = ctx.godowns.filter((g) => g.kind !== 'transit');
  const [date, setDate] = useState(todayInput());
  const [from, setFrom] = useState(stores[0]?.id ?? 'main');
  const [to, setTo] = useState(stores.find((g) => g.id !== stores[0]?.id)?.id ?? '');
  const [neededBy, setNeededBy] = useState('');
  const [lines, setLines] = useState<TransferRequestLine[]>([{ id: generateId(), item_id: '', qty: 0 }]);
  const [error, setError] = useState('');
  const items = useMemo(() => ctx.items.filter((i) => i.track_stock).sort((a, b) => a.name.localeCompare(b.name)), [ctx.items]);
  const patch = (id: string, c: Partial<TransferRequestLine>) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...c } : l)));
  const save = () => {
    try {
      const r = transferRequestsDb.save({ date, from_godown: from, to_godown: to, lines, needed_by: neededBy || undefined });
      onClose();
      ctx.changed(sT('requestSaved', { number: r.number }));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Modal open onClose={onClose} size="lg" title={sT('newRequest')} subtitle={transferRequestsDb.nextNumber(date)}
      footer={<><button type="button" className={controls.btnOutline} onClick={onClose}>{sT('cancel')}</button><button type="button" className={controls.btnPrimary} onClick={save} data-trq-save><ArrowLeftRight size={16} aria-hidden="true" /> {sT('raise')}</button></>}>
      <div className={css.stack}>
        <div className={controls.row}>
          <label className={controls.field}><span className={controls.label}>{sT('date')}</span><DateField className={controls.input} value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label className={controls.field}><span className={controls.label}>{sT('fromGodown')}</span>
            <SelectField className={controls.select} value={from} onChange={(e) => setFrom(e.target.value)} data-trq-from>{stores.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</SelectField>
          </label>
          <label className={controls.field}><span className={controls.label}>{sT('toGodown')}</span>
            <SelectField className={controls.select} value={to} onChange={(e) => setTo(e.target.value)} data-trq-to><option value="">-</option>{stores.filter((g) => g.id !== from).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</SelectField>
          </label>
          <label className={controls.field}><span className={controls.label}>{sT('neededBy')}</span><DateField className={controls.input} value={neededBy} onChange={(e) => setNeededBy(e.target.value)} /></label>
        </div>
        {lines.map((l, i) => {
          const item = items.find((x) => x.id === l.item_id);
          const units = item ? unitChoices(item) : [];
          return (
            <div key={l.id} className={controls.row}>
              <SelectField className={controls.select} value={l.item_id} aria-label={sT('itemN', { n: i + 1 })} onChange={(e) => patch(l.id, { item_id: e.target.value, unit: undefined, unit_factor: undefined })} data-trq-item>
                <option value="">{sT('chooseItem')}</option>{items.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </SelectField>
              <NumberInput className={cn(controls.input, controls.inputNumeric)} value={l.qty} onChange={(v) => patch(l.id, { qty: v })} aria-label={sT('qtyN', { n: i + 1 })} data-trq-qty />
              {item && units.length > 1 && (
                <SelectField className={controls.select} value={l.unit || item.unit} aria-label={sT('unitN', { n: i + 1 })} onChange={(e) => { const f = factorFor(item, e.target.value) ?? 1; patch(l.id, f === 1 ? { unit: undefined, unit_factor: undefined } : { unit: e.target.value, unit_factor: f }); }}>
                  {units.map((u) => <option key={u.unit} value={u.unit}>{u.unit}</option>)}
                </SelectField>
              )}
              <button type="button" className={controls.btnDanger} aria-label={sT('removeLine', { n: i + 1 })} disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((x) => x.id !== l.id))}><Trash2 size={14} /></button>
            </div>
          );
        })}
        <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={() => setLines((ls) => [...ls, { id: generateId(), item_id: '', qty: 0 }])}><Plus size={14} aria-hidden="true" /> {sT('addLine')}</button>
        {error && <p className={controls.error} role="alert">{error}</p>}
      </div>
    </Modal>
  );
}
