import { useState } from 'react';
import { ArrowLeft, ArrowRight, Pencil, Plus, Trash2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { cn, formatDate, todayInput } from '../../lib/utils';
import { num } from '../../lib/invoice-calc';
import { jobWorkOrdersDb } from '../../lib/job-work';
import { bomsDb } from '../../lib/manufacturing';
import type { JobWorkOrder } from '../../types/job-work';
import { jwT } from '../../i18n/areas/job-work';
import { PartyField } from './shared';
import type { JwData, PartyValue } from './lines';
import surface from '../../styles/surface.module.css';
import controls from '../../styles/controls.module.css';
import styles from './job-work.module.css';
import { DateField } from '../ui/DateField';
import { SelectField } from '../ui/SelectField';

/** Job Work Out / In orders: what a job worker is to process, or what a principal sent us to process. */
export function OrdersPanel({ data, goTo }: { data: JwData; goTo: (s: 'out' | 'in' | 'principal') => void }) {
  const { ctx } = data;
  const [editing, setEditing] = useState<JobWorkOrder | 'new' | null>(null);
  const [deleting, setDeleting] = useState<JobWorkOrder | null>(null);
  const rows = [...data.orders].sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number, undefined, { numeric: true }));
  const name = (id?: string) => (id ? ctx.items.find((i) => i.id === id)?.name ?? '?' : '');

  return (
    <>
      <div className={styles.bar}>
        <span className={styles.muted}>{jwT('secOrders')}</span>
        {ctx.canBooks && (
          <button type="button" className={cn(controls.btnPrimary, controls.btnSm)} onClick={() => setEditing('new')}>
            <Plus size={14} aria-hidden="true" /> {jwT('newOrder')}
          </button>
        )}
      </div>
      <div className={surface.tableWrap}>
        <table className={surface.table}>
          <thead>
            <tr><th>{jwT('number')}</th><th>{jwT('date')}</th><th>{jwT('direction')}</th><th>{jwT('party')}</th><th>{jwT('process')}</th><th>{jwT('finishedItem')}</th><th><span className={surface.srOnly}>{jwT('actions')}</span></th></tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.id}>
                <td className={styles.mono}>{o.number}</td>
                <td>{formatDate(o.date)}</td>
                <td><span className={styles.badge}>{o.direction === 'in' ? jwT('inShort') : jwT('outShort')}</span>{o.closed ? <> <span className={styles.badge}>{jwT('closed')}</span></> : null}</td>
                <td>{o.party_name}</td>
                <td>{o.process ?? ''}</td>
                <td>{o.finished_item_id ? `${name(o.finished_item_id)} × ${num(o.finished_qty)}` : ''}</td>
                <td className={surface.rowActions}>
                  {ctx.canBooks && (
                    <>
                      {o.direction === 'out' ? (
                        <>
                          <button type="button" className={controls.btnIcon} aria-label={`${jwT('sendMaterial')} ${o.number}`} title={jwT('sendMaterial')} onClick={() => goTo('out')}><ArrowRight size={15} /></button>
                          <button type="button" className={controls.btnIcon} aria-label={`${jwT('receiveMaterial')} ${o.number}`} title={jwT('receiveMaterial')} onClick={() => goTo('in')}><ArrowLeft size={15} /></button>
                        </>
                      ) : (
                        <button type="button" className={controls.btnIcon} aria-label={`${jwT('secPrincipal')} ${o.number}`} title={jwT('secPrincipal')} onClick={() => goTo('principal')}><ArrowLeft size={15} /></button>
                      )}
                      <button type="button" className={controls.btnIcon} aria-label={`${jwT('edit')} ${o.number}`} onClick={() => setEditing(o)}><Pencil size={15} /></button>
                      <button type="button" className={controls.btnDanger} aria-label={`${jwT('delete')} ${o.number}`} onClick={() => setDeleting(o)}><Trash2 size={15} /></button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={7} className={styles.muted}>{jwT('empty')}</td></tr>}
          </tbody>
        </table>
      </div>
      {editing && <OrderModal data={data} order={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={!!deleting} destructive title={jwT('delete')} message={jwT('confirmDelete', { number: deleting?.number ?? '' })} confirmLabel={jwT('delete')}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (!deleting) return;
          try {
            jobWorkOrdersDb.remove(deleting.id);
            ctx.changed(jwT('deleted', { number: deleting.number }));
          } catch (e) {
            ctx.error((e as Error).message);
          }
        }}
      />
    </>
  );
}

function OrderModal({ data, order, onClose }: { data: JwData; order: JobWorkOrder | null; onClose: () => void }) {
  const { ctx } = data;
  const [direction, setDirection] = useState<'out' | 'in'>(order?.direction ?? 'out');
  const [date, setDate] = useState(order?.date ?? todayInput());
  const [party, setParty] = useState<PartyValue>({ party_name: order?.party_name ?? '', vendor_id: order?.vendor_id, client_id: order?.client_id, party_gstin: order?.party_gstin, party_state_code: order?.party_state_code });
  const [process, setProcess] = useState(order?.process ?? '');
  const [finished, setFinished] = useState(order?.finished_item_id ?? '');
  const [qty, setQty] = useState(order?.finished_qty ? String(order.finished_qty) : '');
  const [bomId, setBomId] = useState(order?.bom_id ?? '');
  const [rate, setRate] = useState(order?.rate ? String(order.rate) : '');
  const [due, setDue] = useState(order?.due_date ?? '');
  const [closed, setClosed] = useState(!!order?.closed);
  const [notes, setNotes] = useState(order?.notes ?? '');
  const [error, setError] = useState('');
  const tracked = ctx.items.filter((i) => i.track_stock);
  const boms = finished ? bomsDb.forItem(finished) : [];

  const submit = () => {
    try {
      const saved = jobWorkOrdersDb.save({
        id: order?.id, number: order?.number, date, direction, ...party, party_name: party.party_name,
        process: process.trim() || undefined, finished_item_id: direction === 'out' && finished ? finished : undefined,
        finished_qty: direction === 'out' && finished ? num(qty) : undefined, bom_id: direction === 'out' && bomId ? bomId : undefined,
        rate: num(rate) > 0 ? num(rate) : undefined, due_date: due || undefined, closed: closed || undefined, notes: notes.trim() || undefined,
      });
      onClose();
      ctx.changed(jwT('saved', { number: saved.number }));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Modal open onClose={onClose} size="lg" title={order ? `${jwT('order')} ${order.number}` : jwT('newOrder')}
      subtitle={order ? undefined : jwT('nextNumber', { number: jobWorkOrdersDb.nextNumber(date) })}
      footer={<><button type="button" className={controls.btnOutline} onClick={onClose}>{jwT('cancel')}</button><button type="button" className={controls.btnPrimary} onClick={submit}>{jwT('save')}</button></>}>
      <form className={styles.form} noValidate onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <div className={controls.segment} role="group" aria-label={jwT('direction')}>
          {(['out', 'in'] as const).map((d) => (
            <button key={d} type="button" aria-pressed={direction === d} className={direction === d ? controls.segmentBtnActive : controls.segmentBtn} onClick={() => setDirection(d)}>
              {d === 'out' ? jwT('dirOut') : jwT('dirIn')}
            </button>
          ))}
        </div>
        <div className={controls.row3}>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="jwo-date">{jwT('date')}</label>
            <DateField id="jwo-date" className={controls.input} value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <PartyField label={direction === 'out' ? jwT('jobWorker') : jwT('principal')} value={party} onChange={setParty} parties={direction === 'out' ? data.parties : data.clients} kind={direction === 'out' ? 'vendor' : 'client'} />
        </div>
        <div className={controls.row3}>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="jwo-proc">{jwT('process')}</label>
            <input id="jwo-proc" className={controls.input} value={process} onChange={(e) => setProcess(e.target.value)} />
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="jwo-rate">{jwT('chargesRate')}</label>
            <input id="jwo-rate" className={cn(controls.input, controls.inputNumeric)} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="jwo-due">{jwT('dueDate')}</label>
            <DateField id="jwo-due" className={controls.input} value={due} onChange={(e) => setDue(e.target.value)} />
          </div>
        </div>
        {direction === 'out' && (
          <div className={controls.row3}>
            <div className={controls.field}>
              <label className={controls.label} htmlFor="jwo-item">{jwT('finishedItem')}</label>
              <SelectField id="jwo-item" className={controls.select} value={finished} onChange={(e) => { setFinished(e.target.value); setBomId(bomsDb.forItem(e.target.value)[0]?.id ?? ''); }}>
                <option value="">{jwT('none')}</option>
                {tracked.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </SelectField>
            </div>
            <div className={controls.field}>
              <label className={controls.label} htmlFor="jwo-qty">{jwT('finishedQty')}</label>
              <input id="jwo-qty" className={cn(controls.input, controls.inputNumeric)} inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} disabled={!finished} />
            </div>
            <div className={controls.field}>
              <label className={controls.label} htmlFor="jwo-bom">{jwT('bom')}</label>
              <SelectField id="jwo-bom" className={controls.select} value={bomId} onChange={(e) => setBomId(e.target.value)} disabled={!finished}>
                <option value="">{jwT('noBom')}</option>
                {boms.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </SelectField>
            </div>
          </div>
        )}
        <div className={controls.field}>
          <label className={controls.label} htmlFor="jwo-notes">{jwT('narration')}</label>
          <input id="jwo-notes" className={controls.input} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        {order && (
          <label className={controls.check}>
            <input type="checkbox" checked={closed} onChange={(e) => setClosed(e.target.checked)} /> {jwT('closed')}
          </label>
        )}
        {error && <p className={cn(styles.notice, styles.danger)} role="alert">{error}</p>}
      </form>
    </Modal>
  );
}
