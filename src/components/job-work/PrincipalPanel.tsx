import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Pencil, Plus, Trash2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { cn, formatDate, todayInput } from '../../lib/utils';
import { num } from '../../lib/invoice-calc';
import { generateId } from '../../lib/storage';
import { jobChargesLine, principalBalances, principalDb } from '../../lib/job-work';
import { useInvoiceStore } from '../../store/useInvoiceStore';
import type { JobWorkOrder, PrincipalMovement } from '../../types/job-work';
import { jwT } from '../../i18n/areas/job-work';
import { s7T } from '../../i18n/areas/inventory-7s';
import { principalStock } from '../../lib/job-work-principal';
import { godownName } from '../../lib/godowns';
import { chargesClassRate, JW_CHARGE_CLASSES, orderChargesClass, type JwChargeClass } from '../../lib/mfg/mf-jw-class';
import { PartyField } from './shared';
import { qtyText, type JwData, type PartyValue } from './lines';
import surface from '../../styles/surface.module.css';
import controls from '../../styles/controls.module.css';
import styles from './job-work.module.css';

type Line = PrincipalMovement['lines'][number];
const blank = (): Line => ({ id: generateId(), name: '', qty: 1 });

/** Job Work In: the principal's material received and sent back (not our stock), and our job charges invoice. */
export function PrincipalPanel({ data }: { data: JwData }) {
  const { ctx } = data;
  const [editing, setEditing] = useState<PrincipalMovement | 'receipt' | 'return' | null>(null);
  const [deleting, setDeleting] = useState<PrincipalMovement | null>(null);
  const [billing, setBilling] = useState<JobWorkOrder | null>(null);
  const rows = [...data.principal].sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number, undefined, { numeric: true }));
  const balances = principalBalances(data.principal);
  // 7S: the principal's goods by godown / batch (shown once any line records a godown or batch).
  const byGodown = data.principal.some((r) => r.lines.some((l) => l.godown_id || l.batch_no)) ? principalStock(data.principal) : [];
  const inOrders = data.orders.filter((o) => o.direction === 'in');

  return (
    <>
      <p className={cn(styles.notice, styles.info)}>{jwT('notOurStock')}</p>
      <div className={styles.bar} style={{ marginTop: '0.75rem' }}>
        <span className={styles.muted}>{jwT('secPrincipal')}</span>
        {ctx.canBooks && (
          <span style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button type="button" className={cn(controls.btnPrimary, controls.btnSm)} onClick={() => setEditing('receipt')}><Plus size={14} aria-hidden="true" /> {jwT('newReceipt')}</button>
            <button type="button" className={cn(controls.btnOutline, controls.btnSm)} onClick={() => setEditing('return')}><Plus size={14} aria-hidden="true" /> {jwT('newReturn')}</button>
          </span>
        )}
      </div>
      <div className={surface.tableWrap}>
        <table className={surface.table}>
          <thead>
            <tr><th>{jwT('number')}</th><th>{jwT('date')}</th><th>{jwT('type')}</th><th>{jwT('principal')}</th><th>{jwT('items')}</th><th><span className={surface.srOnly}>{jwT('actions')}</span></th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className={styles.mono}>{r.number}</td>
                <td>{formatDate(r.date)}</td>
                <td><span className={styles.badge}>{r.kind === 'receipt' ? jwT('kindReceipt') : jwT('kindReturn')}</span></td>
                <td>{r.party_name}{r.challan_no ? <div className={styles.muted}>{r.challan_no}</div> : null}</td>
                <td>{r.lines.map((l) => `${l.name} × ${qtyText(l.qty)}${l.unit ? ` ${l.unit}` : ''}`).join(', ')}</td>
                <td className={surface.rowActions}>
                  {ctx.canBooks && (
                    <>
                      <button type="button" className={controls.btnIcon} aria-label={`${jwT('edit')} ${r.number}`} onClick={() => setEditing(r)}><Pencil size={15} /></button>
                      <button type="button" className={controls.btnDanger} aria-label={`${jwT('delete')} ${r.number}`} onClick={() => setDeleting(r)}><Trash2 size={15} /></button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={6} className={styles.muted}>{jwT('empty')}</td></tr>}
          </tbody>
        </table>
      </div>
      <h3 className={styles.heading}>{jwT('balances')}</h3>
      <div className={surface.tableWrap}>
        <table className={surface.table}>
          <thead><tr><th>{jwT('principal')}</th><th>{jwT('item')}</th><th className={styles.num}>{jwT('receivedQty')}</th><th className={styles.num}>{jwT('returnedQty')}</th><th className={styles.num}>{jwT('pendingQty')}</th></tr></thead>
          <tbody>
            {balances.map((b) => (
              <tr key={`${b.party}|${b.order_id ?? ''}|${b.name}`}>
                <td>{b.party}</td><td>{b.name}</td>
                <td className={styles.num}>{qtyText(b.received)} {b.unit ?? ''}</td>
                <td className={styles.num}>{qtyText(b.returned)}</td>
                <td className={styles.num}><strong>{qtyText(b.pending)}</strong></td>
              </tr>
            ))}
            {balances.length === 0 && <tr><td colSpan={5} className={styles.muted}>{jwT('empty')}</td></tr>}
          </tbody>
        </table>
      </div>
      {byGodown.length > 0 && (
        <>
          <h3 className={styles.heading}>{s7T('byGodown')}</h3>
          <p className={styles.muted}>{s7T('byGodownNote')}</p>
          <div className={surface.tableWrap}>
            <table className={surface.table} data-testid="jw-principal-godown">
              <thead><tr><th>{s7T('principal')}</th><th>{s7T('item')}</th><th>{s7T('godown')}</th><th>{s7T('batch')}</th><th className={styles.num}>{s7T('received')}</th><th className={styles.num}>{s7T('returned')}</th><th className={styles.num}>{s7T('withUs')}</th></tr></thead>
              <tbody>
                {byGodown.map((b) => (
                  <tr key={`${b.party}|${b.name}|${b.godown}|${b.batch}`}>
                    <td>{b.party}</td><td>{b.name}</td>
                    <td>{b.godown ? godownName(ctx.godowns, b.godown) : <span className={styles.muted}>{s7T('notRecorded')}</span>}</td>
                    <td>{b.batch || '-'}</td>
                    <td className={styles.num}>{qtyText(b.received)} {b.unit ?? ''}</td>
                    <td className={styles.num}>{qtyText(b.returned)}</td>
                    <td className={styles.num}><strong>{qtyText(b.pending)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {inOrders.length > 0 && ctx.canBooks && (
        <>
          <h3 className={styles.heading}>{jwT('chargesInvoice')}</h3>
          <p className={styles.muted}>{jwT('chargesInvoiceHint')}</p>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
            {inOrders.map((o) => (
              <button key={o.id} type="button" className={cn(controls.btnOutline, controls.btnSm)} onClick={() => setBilling(o)}>
                <FileText size={14} aria-hidden="true" /> {o.number} · {o.party_name}
              </button>
            ))}
          </div>
        </>
      )}
      {editing && <PrincipalModal data={data} doc={typeof editing === 'string' ? null : editing} kind={typeof editing === 'string' ? editing : editing.kind} onClose={() => setEditing(null)} />}
      {billing && <ChargesModal data={data} order={billing} onClose={() => setBilling(null)} />}
      <ConfirmDialog
        open={!!deleting} destructive title={jwT('delete')} message={jwT('confirmDelete', { number: deleting?.number ?? '' })} confirmLabel={jwT('delete')}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (!deleting) return;
          try {
            principalDb.remove(deleting.id);
            ctx.changed(jwT('deleted', { number: deleting.number }));
          } catch (e) {
            ctx.error((e as Error).message);
          }
        }}
      />
    </>
  );
}

function PrincipalModal({ data, doc, kind, onClose }: { data: JwData; doc: PrincipalMovement | null; kind: 'receipt' | 'return'; onClose: () => void }) {
  const { ctx } = data;
  const [date, setDate] = useState(doc?.date ?? todayInput());
  const [party, setParty] = useState<PartyValue>({ party_name: doc?.party_name ?? '', client_id: doc?.client_id, party_gstin: doc?.party_gstin });
  const [orderId, setOrderId] = useState(doc?.order_id ?? '');
  const [challanNo, setChallanNo] = useState(doc?.challan_no ?? '');
  const [challanDate, setChallanDate] = useState(doc?.challan_date ?? '');
  const [lines, setLines] = useState<Line[]>(() => doc?.lines.map((l) => ({ ...l })) ?? [blank()]);
  const [narration, setNarration] = useState(doc?.narration ?? '');
  const [error, setError] = useState('');
  const orders = data.orders.filter((o) => o.direction === 'in');
  const patch = (id: string, change: Partial<Line>) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...change } : l)));
  const label = kind === 'receipt' ? jwT('kindReceipt') : jwT('kindReturn');

  const pickOrder = (id: string) => {
    setOrderId(id);
    const o = data.orders.find((x) => x.id === id);
    if (o) setParty({ party_name: o.party_name, client_id: o.client_id, party_gstin: o.party_gstin });
  };
  const submit = () => {
    try {
      const saved = principalDb.save({
        id: doc?.id, number: doc?.number, date, kind, ...party, party_name: party.party_name, order_id: orderId || undefined,
        challan_no: challanNo.trim() || undefined, challan_date: challanDate || undefined, lines, narration: narration.trim() || undefined,
      });
      onClose();
      ctx.changed(jwT('saved', { number: saved.number }));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Modal open onClose={onClose} size="lg" title={doc ? `${label} ${doc.number}` : kind === 'receipt' ? jwT('newReceipt') : jwT('newReturn')}
      subtitle={doc ? undefined : jwT('nextNumber', { number: principalDb.nextNumber(date) })}
      footer={<><button type="button" className={controls.btnOutline} onClick={onClose}>{jwT('cancel')}</button><button type="button" className={controls.btnPrimary} onClick={submit}>{jwT('save')}</button></>}>
      <form className={styles.form} noValidate onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <div className={controls.row3}>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="jwp-date">{jwT('date')}</label>
            <input id="jwp-date" type="date" className={controls.input} value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="jwp-order">{jwT('order')}</label>
            <select id="jwp-order" className={controls.select} value={orderId} onChange={(e) => pickOrder(e.target.value)}>
              <option value="">{jwT('noOrder')}</option>
              {orders.map((o) => <option key={o.id} value={o.id}>{o.number} · {o.party_name}</option>)}
            </select>
          </div>
        </div>
        <div className={controls.row3}>
          <PartyField label={jwT('principal')} value={party} onChange={setParty} parties={data.clients} kind="client" />
        </div>
        <div className={controls.row3}>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="jwp-ch">{jwT('principalChallan')}</label>
            <input id="jwp-ch" className={controls.input} value={challanNo} onChange={(e) => setChallanNo(e.target.value)} />
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="jwp-cd">{jwT('principalChallanDate')}</label>
            <input id="jwp-cd" type="date" className={controls.input} value={challanDate} onChange={(e) => setChallanDate(e.target.value)} />
          </div>
        </div>
        <div className={styles.wrap}>
          <table className={styles.grid}>
            <thead><tr><th>{jwT('description')}</th><th className={styles.num}>{jwT('qty')}</th><th>{jwT('unit')}</th><th>{jwT('hsn')}</th><th className={styles.num}>{jwT('value')}</th><th>{s7T('godown')}</th><th>{s7T('batch')}</th><th><span className={surface.srOnly}>{jwT('actions')}</span></th></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.id}>
                  <td><input className={controls.input} aria-label={jwT('lineName', { label, n: i + 1 })} value={l.name} onChange={(e) => patch(l.id, { name: e.target.value })} /></td>
                  <td><input className={cn(controls.input, controls.inputNumeric)} inputMode="decimal" aria-label={jwT('lineQty', { label, n: i + 1 })} value={String(l.qty ?? '')} onChange={(e) => patch(l.id, { qty: num(e.target.value) })} /></td>
                  <td><input className={controls.input} aria-label={jwT('lineUnit', { label, n: i + 1 })} value={l.unit ?? ''} onChange={(e) => patch(l.id, { unit: e.target.value.toUpperCase() || undefined })} /></td>
                  <td><input className={controls.input} aria-label={`${label} ${i + 1} ${jwT('hsn')}`} value={l.hsn ?? ''} onChange={(e) => patch(l.id, { hsn: e.target.value || undefined })} /></td>
                  <td><input className={cn(controls.input, controls.inputNumeric)} inputMode="decimal" aria-label={jwT('lineValue', { label, n: i + 1 })} value={l.value ? String(l.value) : ''} onChange={(e) => patch(l.id, { value: num(e.target.value) || undefined })} /></td>
                  <td>
                    <select className={controls.select} aria-label={`${label} ${i + 1} ${s7T('godown')}`} value={l.godown_id ?? ''} onChange={(e) => patch(l.id, { godown_id: e.target.value || undefined })}>
                      <option value="">-</option>
                      {data.ownGodowns.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                    </select>
                  </td>
                  <td><input className={controls.input} aria-label={`${label} ${i + 1} ${s7T('batch')}`} value={l.batch_no ?? ''} onChange={(e) => patch(l.id, { batch_no: e.target.value || undefined })} /></td>
                  <td><button type="button" className={controls.btnIcon} aria-label={`${label} ${jwT('removeLine', { n: i + 1 })}`} onClick={() => setLines((ls) => ls.filter((x) => x.id !== l.id))}><Trash2 size={15} aria-hidden="true" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={() => setLines((ls) => [...ls, blank()])}><Plus size={14} aria-hidden="true" /> {jwT('addLine')}</button>
        </div>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="jwp-narr">{jwT('narration')}</label>
          <input id="jwp-narr" className={controls.input} value={narration} onChange={(e) => setNarration(e.target.value)} />
        </div>
        {error && <p className={cn(styles.notice, styles.danger)} role="alert">{error}</p>}
      </form>
    </Modal>
  );
}

const CLASS_LABEL = { jw_textile: 'clsJwTextile', jw_print_ch48_49: 'clsJwPrint', jw_other: 'clsJwOther' } as const;

/** Opens a new tax invoice in the editor with our job charges as a SAC 9988 service line. */
function ChargesModal({ data, order, onClose }: { data: JwData; order: JobWorkOrder; onClose: () => void }) {
  const navigate = useNavigate();
  const returned = data.principal.filter((r) => r.order_id === order.id && r.kind === 'return').reduce((s, r) => s + r.lines.filter((l) => l.processed !== false).reduce((t, l) => t + num(l.qty), 0), 0);
  const [qty, setQty] = useState(String(returned || num(order.finished_qty) || 1));
  // MF-C3-4: the class suggested from the principal's goods (HSN chapter) sets the rate; a typed rate wins.
  const [cls, setCls] = useState<JwChargeClass>(() => orderChargesClass(data.principal, order.id));
  const suggested = chargesClassRate(cls, todayInput());
  const [gst, setGst] = useState(() => String(suggested.rate));
  const pickClass = (c: JwChargeClass) => { setCls(c); setGst(String(chargesClassRate(c, todayInput()).rate)); };
  const create = () => {
    const store = useInvoiceStore.getState();
    store.newDraft('TAX_INVOICE');
    const client = data.clients.find((c) => c.id === order.client_id);
    store.setClient({ ...(client ? { id: client.id } : {}), name: order.party_name, gstin: order.party_gstin ?? client?.gstin ?? '' });
    store.patch({ items: [jobChargesLine(order, num(qty), num(gst))], notes: `Job work charges against ${order.number}${order.process ? ` (${order.process})` : ''}. Goods belong to the principal.` });
    store.recalculate();
    onClose();
    navigate('/invoice');
  };
  return (
    <Modal open onClose={onClose} size="sm" title={jwT('chargesInvoice')} subtitle={`${order.number} · ${order.party_name}`}
      footer={<><button type="button" className={controls.btnOutline} onClick={onClose}>{jwT('cancel')}</button><button type="button" className={controls.btnPrimary} onClick={create}>{jwT('createInvoice')}</button></>}>
      <div className={styles.form}>
        <p className={styles.muted}>{jwT('chargesInvoiceHint')}</p>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="jwi-c">{jwT('chargesClass')}</label>
          <select id="jwi-c" className={controls.select} value={cls} onChange={(e) => pickClass(e.target.value as JwChargeClass)}>
            {JW_CHARGE_CLASSES.map((c) => <option key={c} value={c}>{jwT(CLASS_LABEL[c])}</option>)}
          </select>
          <span className={styles.muted}>{jwT('chargesClassHint', { rate: String(suggested.rate), ca: suggested.ca })}</span>
        </div>
        <div className={controls.row}>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="jwi-q">{jwT('invoiceQty')}</label>
            <input id="jwi-q" className={cn(controls.input, controls.inputNumeric)} inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="jwi-g">{jwT('gstOnCharges')}</label>
            <input id="jwi-g" className={cn(controls.input, controls.inputNumeric)} inputMode="decimal" value={gst} onChange={(e) => setGst(e.target.value)} />
          </div>
        </div>
      </div>
    </Modal>
  );
}
