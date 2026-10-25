import { useMemo, useState } from 'react';
import { Pencil, Plus, Trash2, Undo2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import type { MfgContext } from '../manufacturing/context';
import { cn, formatDate, todayInput } from '../../lib/utils';
import { num } from '../../lib/invoice-calc';
import { getTable } from '../../lib/storage';
import { loadSettings } from '../../lib/inventory';
import { unitsDb, roundTypedQty } from '../../lib/units';
import { challanBalance, openChallans, rejectionsInDb } from '../../lib/rejections-in';
import type { InvoiceRecord } from '../../types/invoice';
import type { RejectionIn } from '../../types/job-work';
import { jwT } from '../../i18n/areas/job-work';
import { qtyText } from './lines';
import surface from '../../styles/surface.module.css';
import controls from '../../styles/controls.module.css';
import styles from './job-work.module.css';

type Link = { from_id: string; to_id: string; relation: string };

/** /manufacturing?tab=rejections — Rejections In: goods a customer rejected from a delivery challan before invoicing. */
export function RejectionsInTab({ ctx }: { ctx: MfgContext }) {
  const [editing, setEditing] = useState<RejectionIn | 'new' | null>(null);
  const [deleting, setDeleting] = useState<RejectionIn | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rows = useMemo(() => [...rejectionsInDb.all()].sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number, undefined, { numeric: true })), [ctx.version]);
  const movesStock = useMemo(() => loadSettings().includeChallans, []);

  return (
    <>
      <p className={styles.muted} style={{ margin: '0 0 0.75rem' }}>{jwT('rejIntro')}</p>
      {!movesStock && <p className={styles.notice}>{jwT('rejNoStock')}</p>}
      <div className={styles.bar} style={{ marginTop: '0.75rem' }}>
        <span className={styles.muted}>{jwT('rejTitle')}</span>
        {ctx.canBooks && (
          <button type="button" className={cn(controls.btnPrimary, controls.btnSm)} onClick={() => setEditing('new')}>
            <Plus size={14} aria-hidden="true" /> {jwT('newRejection')}
          </button>
        )}
      </div>
      <div className={surface.tableWrap}>
        <table className={surface.table}>
          <thead><tr><th>{jwT('number')}</th><th>{jwT('date')}</th><th>{jwT('challan')}</th><th>{jwT('client')}</th><th>{jwT('items')}</th><th>{jwT('reason')}</th><th><span className={surface.srOnly}>{jwT('actions')}</span></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className={styles.mono}>{r.number}</td>
                <td>{formatDate(r.date)}</td>
                <td className={styles.mono}>{r.challan_number ?? ''}</td>
                <td>{r.client_name ?? ''}</td>
                <td>{r.lines.map((l) => `${l.name} × ${qtyText(l.quantity)}${l.unit ? ` ${l.unit}` : ''}`).join(', ')}</td>
                <td>{r.reason ?? ''}</td>
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
            {rows.length === 0 && <tr><td colSpan={7} className={styles.muted}>{jwT('empty')}</td></tr>}
          </tbody>
        </table>
      </div>
      {editing && <RejectionModal ctx={ctx} doc={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={!!deleting} destructive title={jwT('delete')} message={jwT('confirmDelete', { number: deleting?.number ?? '' })} confirmLabel={jwT('delete')}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (!deleting) return;
          try {
            rejectionsInDb.remove(deleting.id);
            ctx.changed(jwT('deleted', { number: deleting.number }));
          } catch (e) {
            ctx.error((e as Error).message);
          }
        }}
      />
    </>
  );
}

function RejectionModal({ ctx, doc, onClose }: { ctx: MfgContext; doc: RejectionIn | null; onClose: () => void }) {
  const invoices = useMemo(() => getTable<InvoiceRecord>('invoices'), []);
  const links = useMemo(() => getTable<Link>('doc_links'), []);
  const all = useMemo(() => rejectionsInDb.all(), []);
  const units = useMemo(() => unitsDb.stored(), []);
  const challans = useMemo(() => {
    const open = openChallans(invoices, links);
    const current = doc ? invoices.find((d) => d.id === doc.challan_id) : undefined;
    return current && !open.includes(current) ? [current, ...open] : open;
  }, [invoices, links, doc]);
  const [challanId, setChallanId] = useState(doc?.challan_id ?? challans[0]?.id ?? '');
  const [date, setDate] = useState(doc?.date ?? todayInput());
  const [reason, setReason] = useState(doc?.reason ?? '');
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries((doc?.lines ?? []).map((l) => [l.challan_line_id, String(l.quantity)])));
  const [error, setError] = useState('');
  const challan = challans.find((d) => d.id === challanId);
  const balance = challan ? challanBalance(challan, all, doc?.id) : [];

  const submit = () => {
    if (!challan) return setError(jwT('noChallans'));
    try {
      const lines = balance.filter((b) => num(qty[b.lineId]) > 0).map((b) => {
        const src = challan.items.find((l) => l.id === b.lineId);
        return {
          id: doc?.lines.find((l) => l.challan_line_id === b.lineId)?.id ?? `${b.lineId}-r`, challan_line_id: b.lineId, name: b.name, hsn: src?.hsn,
          quantity: num(qty[b.lineId]), unit: src?.unit, unit_factor: src?.unit_factor, godown_id: src?.godown_id, batch_no: src?.batch_no,
        };
      });
      const saved = rejectionsInDb.save({ id: doc?.id, number: doc?.number, date, challan_id: challan.id, lines, reason: reason.trim() || undefined });
      onClose();
      ctx.changed(jwT('saved', { number: saved.number }));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Modal open onClose={onClose} size="lg" title={doc ? `${jwT('rejTitle')} ${doc.number}` : jwT('newRejection')}
      subtitle={doc ? undefined : jwT('nextNumber', { number: rejectionsInDb.nextNumber(date) })}
      footer={<><button type="button" className={controls.btnOutline} onClick={onClose}>{jwT('cancel')}</button><button type="button" className={controls.btnPrimary} onClick={submit} disabled={!challan}><Undo2 size={16} aria-hidden="true" /> {jwT('save')}</button></>}>
      <form className={styles.form} noValidate onSubmit={(e) => { e.preventDefault(); submit(); }}>
        {challans.length === 0 ? <p className={styles.notice}>{jwT('noChallans')}</p> : (
          <>
            <div className={controls.row3}>
              <div className={controls.field}>
                <label className={controls.label} htmlFor="rji-ch">{jwT('challan')}</label>
                <select id="rji-ch" className={controls.select} value={challanId} onChange={(e) => { setChallanId(e.target.value); setQty({}); }} disabled={!!doc}>
                  {challans.map((d) => <option key={d.id} value={d.id}>{d.invoice_number} · {d.client?.name ?? ''} · {formatDate(d.issue_date)}</option>)}
                </select>
              </div>
              <div className={controls.field}>
                <label className={controls.label} htmlFor="rji-date">{jwT('date')}</label>
                <input id="rji-date" type="date" className={controls.input} value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div className={controls.field}>
                <label className={controls.label} htmlFor="rji-why">{jwT('reason')}</label>
                <input id="rji-why" className={controls.input} value={reason} onChange={(e) => setReason(e.target.value)} />
              </div>
            </div>
            <div className={styles.wrap}>
              <table className={styles.grid}>
                <thead><tr><th>{jwT('item')}</th><th className={styles.num}>{jwT('sentQty')}</th><th className={styles.num}>{jwT('rejectedBefore')}</th><th className={styles.num}>{jwT('balance')}</th><th className={styles.num}>{jwT('rejectQty')}</th></tr></thead>
                <tbody>
                  {balance.map((b) => (
                    <tr key={b.lineId}>
                      <td>{b.name}</td>
                      <td className={styles.num}>{qtyText(b.sent)} {b.unit ?? ''}</td>
                      <td className={styles.num}>{qtyText(b.rejected)}</td>
                      <td className={styles.num}>{qtyText(b.balance)}</td>
                      <td>
                        <input className={cn(controls.input, controls.inputNumeric)} inputMode="decimal" aria-label={jwT('rejectLine', { name: b.name })}
                          value={qty[b.lineId] ?? ''} onChange={(e) => setQty({ ...qty, [b.lineId]: e.target.value })}
                          onBlur={() => qty[b.lineId] && setQty({ ...qty, [b.lineId]: String(roundTypedQty(qty[b.lineId], b.unit, units)) })} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {error && <p className={cn(styles.notice, styles.danger)} role="alert">{error}</p>}
      </form>
    </Modal>
  );
}
