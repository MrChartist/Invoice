import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ClipboardCheck, Factory, Pencil, Plus, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { Modal } from '../ui/Modal';
import { cn, formatDate, todayInput } from '../../lib/utils';
import { getTable, peekTable } from '../../lib/storage';
import { bomsDb } from '../../lib/manufacturing';
import { godownName } from '../../lib/godowns';
import {
  cancelIssue, closeIssue, deleteIssue, loadOrderDocs, materialRows, orderProgress, orderStatus, ordersFromSo, productionOrdersDb,
} from '../../lib/production/orders';
import { orderFulfilment } from '../../lib/sales-orders';
import type { InvoiceRecord } from '../../types/invoice';
import type { ProductionOrder } from '../../types/production-r4';
import { useT } from '../../i18n';
import { pT } from '../../i18n/areas/production-r4';
import { qtyText, type MfgContext } from '../manufacturing/context';
import { OrderForm } from './OrderForm';
import { IssueDialog } from './IssueDialog';
import { OutputDialog } from './OutputDialog';
import { StatusBadge } from './StatusBadge';
import surface from '../../styles/surface.module.css';
import controls from '../../styles/controls.module.css';
import mfg from '../manufacturing/manufacturing.module.css';
import styles from './production.module.css';

type Dialog = { kind: 'form'; order: ProductionOrder | null } | { kind: 'issue' | 'output' | 'close' | 'return'; order: ProductionOrder } | null;

/** /manufacturing?tab=orders — production orders (R4-A1): release, issue to the shop floor, report output, close. */
export function OrdersTab({ ctx }: { ctx: MfgContext }) {
  useT();
  const [params, setParams] = useSearchParams();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [confirm, setConfirm] = useState<{ kind: 'delete' | 'cancel'; order: ProductionOrder } | null>(null);
  const [mto, setMto] = useState(false);
  const [soId, setSoId] = useState('');
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  /* eslint-disable react-hooks/exhaustive-deps */
  const orders = useMemo(() => productionOrdersDb.all(), [ctx.version]);
  const docs = useMemo(() => loadOrderDocs(), [ctx.version]);
  const boms = useMemo(() => bomsDb.all(), [ctx.version]);
  const salesOrders = useMemo(() => getTable<InvoiceRecord>('invoices').filter((d) => d.doc_type === 'SALES_ORDER' && d.status !== 'Cancelled' && d.status !== 'Draft' && !d.order_closed_on), [ctx.version]);
  /* eslint-enable react-hooks/exhaustive-deps */
  const name = (id: string) => ctx.items.find((i) => i.id === id)?.name ?? '?';
  const unit = (id: string) => ctx.items.find((i) => i.id === id)?.unit ?? '';
  const rows = useMemo(() => orders.map((o) => {
    const p = orderProgress(o, docs);
    return { o, p, status: orderStatus(o, p) };
  }).filter((r) => filter === 'all' || (r.status !== 'closed' && r.status !== 'cancelled'))
    .sort((a, b) => b.o.date.localeCompare(a.o.date) || b.o.number.localeCompare(a.o.number, undefined, { numeric: true })), [orders, docs, filter]);
  const selectedId = params.get('order') ?? '';
  const selected = rows.find((r) => r.o.id === selectedId) ?? (selectedId ? (() => {
    const o = orders.find((x) => x.id === selectedId);
    if (!o) return undefined;
    const p = orderProgress(o, docs);
    return { o, p, status: orderStatus(o, p) };
  })() : undefined);
  const open = (id: string | null) => setParams((p) => { if (id) p.set('order', id); else p.delete('order'); return p; }, { replace: true });
  const soNumbers = useMemo(() => new Map(peekTable<InvoiceRecord>('invoices').filter((d) => d.doc_type === 'SALES_ORDER').map((d) => [d.id, d.invoice_number])), [orders]);
  const soNumber = (id?: string) => (id ? soNumbers.get(id) ?? '—' : '');

  const mtoDrafts = useMemo(() => {
    const so = salesOrders.find((d) => d.id === soId);
    if (!so) return [];
    const invoices = getTable<InvoiceRecord>('invoices');
    return ordersFromSo(so, orderFulfilment(so, invoices, getTable('doc_links')), ctx.items, boms, orders);
  }, [soId, salesOrders, ctx.items, boms, orders]);

  const run = (fn: () => string) => {
    try {
      ctx.changed(fn());
    } catch (e) {
      ctx.error((e as Error).message);
    }
  };
  const createMto = () => run(() => {
    const so = salesOrders.find((d) => d.id === soId);
    const made = mtoDrafts.map((d) => productionOrdersDb.save({ date: todayInput(), ...d }, ctx.items, boms));
    setMto(false);
    setSoId('');
    if (made[0]) open(made[0].id);
    return pT('mtoCreated', { n: made.length, so: so?.invoice_number ?? '' });
  });

  const s = selected;
  return (
    <>
      <div className={mfg.bar}>
        <span className={mfg.muted}>{pT('ordersIntro')}</span>
        <span className={styles.actions}>
          <div className={controls.segment} role="group" aria-label={pT('show')}>
            {(['open', 'all'] as const).map((k) => (
              <button key={k} type="button" aria-pressed={filter === k} className={filter === k ? controls.segmentBtnActive : controls.segmentBtn} onClick={() => setFilter(k)}>{pT(k === 'open' ? 'showOpen' : 'showAll')}</button>
            ))}
          </div>
          {ctx.canBooks && (
            <>
              <button type="button" className={cn(controls.btnOutline, controls.btnSm)} onClick={() => setMto((v) => !v)} aria-expanded={mto}><ClipboardCheck size={14} aria-hidden="true" /> {pT('makeToOrder')}</button>
              <button type="button" className={cn(controls.btnPrimary, controls.btnSm)} onClick={() => setDialog({ kind: 'form', order: null })}><Plus size={14} aria-hidden="true" /> {pT('newOrder')}</button>
            </>
          )}
        </span>
      </div>

      {mto && (
        <section className={styles.panel} aria-label={pT('makeToOrder')}>
          <div className={styles.inline}>
            <div className={controls.field}>
              <label className={controls.label} htmlFor="mto-so">{pT('salesOrder')}</label>
              <select id="mto-so" className={controls.select} value={soId} onChange={(e) => setSoId(e.target.value)}>
                <option value="">{pT('choose')}</option>
                {salesOrders.map((d) => <option key={d.id} value={d.id}>{d.invoice_number} · {d.client?.name ?? ''}</option>)}
              </select>
            </div>
            <button type="button" className={cn(controls.btnPrimary, controls.btnSm)} disabled={!mtoDrafts.length} onClick={createMto} data-testid="mto-create">
              <Factory size={14} aria-hidden="true" /> {pT('createOrders', { n: mtoDrafts.length })}
            </button>
          </div>
          {soId && (mtoDrafts.length ? (
            <ul className={styles.log}>{mtoDrafts.map((d) => <li key={`${d.so_line_id}`}>{name(d.item_id)} × {qtyText(d.planned_qty)} {unit(d.item_id)}</li>)}</ul>
          ) : <p className={mfg.muted}>{pT('mtoNone')}</p>)}
        </section>
      )}

      <div className={surface.tableWrap} style={{ marginTop: '0.75rem' }}>
        <table className={surface.table} data-testid="wo-table">
          <thead>
            <tr>
              <th>{pT('number')}</th><th>{pT('date')}</th><th>{pT('item')}</th><th className={mfg.num}>{pT('planned')}</th><th className={mfg.num}>{pT('output')}</th>
              <th>{pT('status')}</th><th>{pT('due')}</th><th>{pT('salesOrder')}</th><th><span className={surface.srOnly}>{pT('open')}</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ o, p, status }) => (
              <tr key={o.id} aria-selected={o.id === selectedId}>
                <td className={surface.mono}>{o.number}</td>
                <td>{formatDate(o.date)}</td>
                <td>{name(o.item_id)}</td>
                <td className={mfg.num}>{qtyText(o.planned_qty)} {unit(o.item_id)}</td>
                <td className={mfg.num}>{qtyText(p.output)}</td>
                <td><StatusBadge status={status} /></td>
                <td>{o.due_date ? formatDate(o.due_date) : '—'}</td>
                <td className={surface.mono}>{soNumber(o.so_id) || '—'}</td>
                <td className={surface.rowActions}><button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={() => open(o.id)}>{pT('open')} <span className={surface.srOnly}>{o.number}</span></button></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={9} className={mfg.muted}>{pT('noOrders')}</td></tr>}
          </tbody>
        </table>
      </div>

      {s && (
        <section className={styles.detail} aria-label={`${pT('order')} ${s.o.number}`} data-testid="wo-detail">
          <div className={styles.detailHead}>
            <h3 className={styles.detailTitle}>{s.o.number} · {name(s.o.item_id)} × {qtyText(s.o.planned_qty)} {unit(s.o.item_id)} <StatusBadge status={s.status} /></h3>
            <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={() => open(null)}>{pT('closePanel')}</button>
          </div>
          <p className={mfg.muted}>
            {pT('outputOf', { done: qtyText(s.p.output), planned: qtyText(s.o.planned_qty) })}
            {s.o.wip_godown_id ? ` · ${pT('shopFloor')}: ${godownName(ctx.godowns, s.o.wip_godown_id)}` : ''}
            {s.o.so_id ? ` · ${pT('salesOrder')}: ${soNumber(s.o.so_id)}` : ''}
            {s.o.due_date ? ` · ${pT('due')}: ${formatDate(s.o.due_date)}` : ''}
          </p>
          {ctx.canBooks && (
            <div className={styles.actions}>
              {s.status === 'planned' && (
                <>
                  <button type="button" className={cn(controls.btnPrimary, controls.btnSm)} onClick={() => run(() => pT('released', { number: productionOrdersDb.release(s.o.id, boms).number }))}>{pT('release')}</button>
                  <button type="button" className={cn(controls.btnOutline, controls.btnSm)} onClick={() => setDialog({ kind: 'form', order: s.o })}><Pencil size={14} aria-hidden="true" /> {pT('edit')}</button>
                </>
              )}
              {(s.status === 'released' || s.status === 'in_progress' || s.status === 'completed') && (
                <>
                  <button type="button" className={cn(controls.btnPrimary, controls.btnSm)} onClick={() => setDialog({ kind: 'issue', order: s.o })}>{pT('issue')}</button>
                  <button type="button" className={cn(controls.btnPrimary, controls.btnSm)} onClick={() => setDialog({ kind: 'output', order: s.o })}>{pT('reportOutput')}</button>
                  <button type="button" className={cn(controls.btnOutline, controls.btnSm)} disabled={![...s.p.held.values()].some((q) => q > 0)} onClick={() => setDialog({ kind: 'return', order: s.o })}>{pT('returnUnused')}</button>
                  {s.status !== 'completed' && <button type="button" className={cn(controls.btnOutline, controls.btnSm)} onClick={() => run(() => pT('markedCompleted', { number: productionOrdersDb.markCompleted(s.o.id).number }))}>{pT('markCompleted')}</button>}
                  <button type="button" className={cn(controls.btnOutline, controls.btnSm)} onClick={() => setDialog({ kind: 'close', order: s.o })}>{pT('closeOrder')}</button>
                </>
              )}
              {s.status === 'closed' && <button type="button" className={cn(controls.btnOutline, controls.btnSm)} onClick={() => run(() => pT('reopened', { number: productionOrdersDb.reopen(s.o.id).number }))}>{pT('reopen')}</button>}
              {s.status !== 'closed' && s.status !== 'cancelled' && !cancelIssue(s.o, s.p) && <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={() => setConfirm({ kind: 'cancel', order: s.o })}>{pT('cancelOrder')}</button>}
              {!deleteIssue(s.p) && <button type="button" className={controls.btnDanger} aria-label={`${pT('delete')} ${s.o.number}`} onClick={() => setConfirm({ kind: 'delete', order: s.o })}><Trash2 size={15} /></button>}
            </div>
          )}
          {s.o.materials?.length ? (
            <div className={mfg.wrap}>
              <table className={mfg.grid} data-testid="wo-materials">
                <thead><tr><th>{pT('material')}</th><th className={mfg.num}>{pT('required')}</th><th className={mfg.num}>{pT('issued')}</th><th className={mfg.num}>{pT('balance')}</th><th className={mfg.num}>{pT('consumed')}</th><th className={mfg.num}>{pT('onFloor')}</th></tr></thead>
                <tbody>
                  {materialRows(s.o, s.p).map((r) => (
                    <tr key={r.item_id}>
                      <td>{name(r.item_id)}{r.extra ? ` (${pT('notOnBom')})` : ''}</td>
                      <td className={mfg.num}>{qtyText(r.required)} {unit(r.item_id)}</td>
                      <td className={cn(mfg.num, r.over && styles.over)}>{qtyText(r.issued)}</td>
                      <td className={mfg.num}>{qtyText(r.balance)}</td>
                      <td className={mfg.num}>{qtyText(r.consumed + r.writtenOff)}</td>
                      <td className={mfg.num}>{qtyText(r.held)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className={mfg.muted}>{pT('releaseHint')}</p>}
          {(s.p.issues.length + s.p.returns.length + s.p.outputs.length + s.p.writeOffs.length) > 0 && (
            <p className={mfg.muted}>
              {pT('vouchers')}: {[...s.p.issues.map((t) => t.transfer_number), ...s.p.returns.map((t) => t.transfer_number), ...s.p.outputs.map((v) => v.number), ...s.p.writeOffs.map((j) => j.number)].join(', ')}
            </p>
          )}
          <details>
            <summary>{pT('history')}</summary>
            <ul className={styles.log}>{[...(s.o.log ?? [])].reverse().map((l, i) => <li key={i}>{formatDate(l.at.slice(0, 10))} · {pT(`log_${l.action}` as 'log_create')}{l.note ? ` — ${l.note}` : ''}{l.by ? ` (${l.by})` : ''}</li>)}</ul>
          </details>
        </section>
      )}

      {dialog?.kind === 'form' && <OrderForm ctx={ctx} order={dialog.order} boms={boms} salesOrders={salesOrders} onClose={() => setDialog(null)} onSaved={(o) => { setDialog(null); open(o.id); }} />}
      {dialog?.kind === 'issue' && <IssueDialog ctx={ctx} order={dialog.order} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'output' && <OutputDialog ctx={ctx} order={dialog.order} boms={boms} onClose={() => setDialog(null)} />}
      {(dialog?.kind === 'close' || dialog?.kind === 'return') && <CloseDialog ctx={ctx} order={dialog.order} mode={dialog.kind} onClose={() => setDialog(null)} />}
      <ConfirmDialog
        open={!!confirm} destructive title={confirm?.kind === 'delete' ? pT('delete') : pT('cancelOrder')}
        message={confirm ? pT(confirm.kind === 'delete' ? 'confirmDelete' : 'confirmCancel', { number: confirm.order.number }) : ''}
        confirmLabel={confirm?.kind === 'delete' ? pT('delete') : pT('cancelOrder')}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (!confirm) return;
          run(() => {
            if (confirm.kind === 'delete') {
              productionOrdersDb.remove(confirm.order.id);
              open(null);
              return pT('deleted', { number: confirm.order.number });
            }
            return pT('cancelled', { number: productionOrdersDb.cancel(confirm.order.id).number });
          });
        }}
      />
    </>
  );
}

/** Close (with an optional write-off of the shop-floor balance) or Return unused. */
function CloseDialog({ ctx, order, mode, onClose }: { ctx: MfgContext; order: ProductionOrder; mode: 'close' | 'return'; onClose: () => void }) {
  const [date, setDate] = useState(todayInput());
  const [writeOff, setWriteOff] = useState(false);
  const [to, setTo] = useState(order.store_godown_id ?? 'main');
  const [error, setError] = useState('');
  const p = useMemo(() => orderProgress(order, loadOrderDocs()), [order]);
  const held = [...p.held.entries()].filter(([, q]) => q > 0);
  const issue = mode === 'close' ? closeIssue(order, p, writeOff) : '';
  const submit = () => {
    try {
      if (mode === 'close') {
        const o = productionOrdersDb.close(order.id, { date, writeOff }, ctx.items, ctx.inputs);
        onClose();
        ctx.changed(pT('closed', { number: o.number }));
      } else {
        const t = productionOrdersDb.returnUnused(order.id, { date, to }, ctx.inputs);
        onClose();
        ctx.changed(pT('returned', { number: t.transfer_number }));
      }
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Modal open onClose={onClose} size="md" title={`${mode === 'close' ? pT('closeOrder') : pT('returnUnused')} · ${order.number}`}
      footer={<><button type="button" className={controls.btnOutline} onClick={onClose}>{pT('cancel')}</button><button type="button" className={controls.btnPrimary} disabled={!!issue} onClick={submit}>{mode === 'close' ? pT('closeOrder') : pT('returnUnused')}</button></>}>
      <div className={mfg.form}>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="wo-close-date">{pT('date')}</label>
          <input id="wo-close-date" type="date" className={controls.input} value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        {mode === 'return' && (
          <div className={controls.field}>
            <label className={controls.label} htmlFor="wo-ret-to">{pT('returnTo')}</label>
            <select id="wo-ret-to" className={controls.select} value={to} onChange={(e) => setTo(e.target.value)}>
              {ctx.godowns.filter((g) => g.id !== order.wip_godown_id).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
        )}
        {held.length > 0 ? (
          <>
            <p className={mfg.muted}>{pT('onFloorNow')}: {held.map(([id, q]) => `${ctx.items.find((i) => i.id === id)?.name ?? '?'} ${qtyText(q)}`).join(', ')}</p>
            {mode === 'close' && <label className={controls.check}><input type="checkbox" checked={writeOff} onChange={(e) => setWriteOff(e.target.checked)} /> {pT('writeOff')}</label>}
          </>
        ) : mode === 'close' && <p className={mfg.muted}>{pT('floorEmpty')}</p>}
        {issue && <p className={mfg.notice} role="status">{issue}</p>}
        {error && <p className={cn(mfg.notice, mfg.danger)} role="alert">{error}</p>}
      </div>
    </Modal>
  );
}
