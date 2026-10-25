import { useMemo, useState } from 'react';
import { Download, FilePlus2, PackageCheck, PackageX, Pencil, ReceiptText, RotateCcw, Trash2, Undo2, XCircle } from 'lucide-react';
import type { PurchaseOrder, PurchaseRecord, PurchaseReturn, ReceiptNote, Vendor } from '../../types/purchases';
import { notesToCsvRows, purchaseReturnsDb } from '../../lib/purchase-returns';
import { noteItc } from '../../lib/purchase-returns-gst';
import { billSeedFromGrn, goodsReceivedNotBilled, grnStatus, purchaseOrderOutstanding, receiptNotesDb, type GrnState } from '../../lib/receipt-notes';
import type { BillSeed } from '../../lib/purchase-orders';
import { can } from '../../lib/access';
import { downloadText, toCsv } from '../../lib/download';
import { formatCurrency, formatDate, todayInput } from '../../lib/utils';
import { EmptyState } from '../ui/EmptyState';
import { StatusBadge } from '../ui/StatusBadge';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { Modal } from '../ui/Modal';
import { ReturnModal } from './ReturnModal';
import { GrnModal, type GrnModalProps } from './GrnModal';
import { useT } from '../../i18n';
import { prT, prReason, grnStateLabel } from '../../i18n/areas/purchase-returns';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './purchases.module.css';
import local from './returns.module.css';

export interface ReturnsTabProps {
  purchases: PurchaseRecord[];
  vendors: Vendor[];
  orders: PurchaseOrder[];
  /** "Convert to bill" from a receipt note: open the bill form pre-filled. */
  onConvert: (seed: BillSeed) => void;
  onVendorCreated: () => void;
  onChanged: (message?: string, tone?: 'error') => void;
}

type Section = 'notes' | 'grn' | 'pending';

const GRN_TONE: Record<GrnState, string> = { Pending: 'sent', 'Partly billed': 'partial', Billed: 'paid', Closed: 'cancelled' };

/** Purchase returns / supplier notes, receipt notes (GRN) + rejections out, and pending reports (WP-3). */
export function ReturnsTab({ purchases, vendors, orders, onConvert, onVendorCreated, onChanged }: ReturnsTabProps) {
  useT();
  const [version, setVersion] = useState(0);
  const [section, setSection] = useState<Section>('notes');
  const [noteKind, setNoteKind] = useState<PurchaseReturn['kind'] | null>(null);
  const [grnMode, setGrnMode] = useState<GrnModalProps['mode']>(null);
  const [deleting, setDeleting] = useState<{ kind: 'note'; row: PurchaseReturn } | { kind: 'receipt'; row: ReceiptNote } | null>(null);
  const [supFor, setSupFor] = useState<PurchaseReturn | null>(null);
  const [asOf, setAsOf] = useState(todayInput());
  const editable = can('books.edit');

  /* eslint-disable react-hooks/exhaustive-deps */
  const notes = useMemo(() => purchaseReturnsDb.all(), [version, purchases]);
  const receipts = useMemo(() => receiptNotesDb.all(), [version, purchases]);
  /* eslint-enable react-hooks/exhaustive-deps */
  const grni = useMemo(() => goodsReceivedNotBilled(receipts, purchases, asOf), [receipts, purchases, asOf]);
  const poOut = useMemo(() => purchaseOrderOutstanding(orders, purchases, receipts, asOf), [orders, purchases, receipts, asOf]);

  const changed = (message?: string, tone?: 'error') => {
    setVersion((v) => v + 1);
    onChanged(message, tone);
  };
  const run = (fn: () => void, message: string) => {
    try {
      fn();
      changed(message);
    } catch (err) {
      onChanged((err as Error).message, 'error');
    }
  };
  const remove = () => {
    if (!deleting) return;
    if (deleting.kind === 'note') run(() => purchaseReturnsDb.remove(deleting.row.id), prT('deleted', { number: deleting.row.note_number }));
    else run(() => receiptNotesDb.remove(deleting.row.id, purchases), prT('deleted', { number: deleting.row.number }));
  };
  const convert = (g: ReceiptNote) => {
    try {
      onConvert(billSeedFromGrn(g, purchases, receipts));
    } catch (err) {
      onChanged((err as Error).message, 'error');
    }
  };
  const exportNotes = () => {
    downloadText(`purchase-returns-${todayInput()}.csv`, toCsv(notesToCsvRows(notes)), 'text/csv');
    onChanged(prT('exported', { n: notes.length }));
  };

  const sorted = [...notes].sort((a, b) => b.date.localeCompare(a.date) || b.note_number.localeCompare(a.note_number));
  const sortedReceipts = [...receipts].sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number));
  const grniTotal = grni.reduce((s, r) => s + r.value, 0);
  const poTotal = poOut.reduce((s, r) => s + r.value, 0);

  return (
    <section className={surface.card}>
      <div className={local.bar}>
        <div className={controls.segment} role="tablist" aria-label={prT('section')}>
          {(['notes', 'grn', 'pending'] as const).map((s) => (
            <button key={s} type="button" role="tab" aria-selected={section === s} className={section === s ? controls.segmentBtnActive : controls.segmentBtn} onClick={() => setSection(s)}>
              {s === 'notes' ? prT('secNotes') : s === 'grn' ? prT('secGrn') : prT('secPending')}
            </button>
          ))}
        </div>
        {editable && section === 'notes' && (
          <div className={local.barGroup}>
            <button type="button" className={controls.btnOutline} onClick={exportNotes} disabled={!notes.length}><Download size={16} /> {prT('exportCsv')}</button>
            <button type="button" className={controls.btnOutline} onClick={() => setNoteKind('SUPPLIER_CN')}><ReceiptText size={16} /> {prT('newCn')}</button>
            <button type="button" className={controls.btnPrimary} onClick={() => setNoteKind('DEBIT_NOTE')}><Undo2 size={16} /> {prT('newDn')}</button>
          </div>
        )}
        {editable && section === 'grn' && (
          <div className={local.barGroup}>
            <button type="button" className={controls.btnOutline} onClick={() => setGrnMode({ kind: 'REJECTION_OUT' })}><PackageX size={16} /> {prT('newRj')}</button>
            <button type="button" className={controls.btnPrimary} onClick={() => setGrnMode({ kind: 'GRN' })}><FilePlus2 size={16} /> {prT('newGrn')}</button>
          </div>
        )}
        {section === 'pending' && (
          <label className={local.barGroup}>
            {prT('asOf')}
            <input type="date" className={controls.input} value={asOf} onChange={(e) => setAsOf(e.target.value || todayInput())} />
          </label>
        )}
      </div>

      {section === 'notes' &&
        (notes.length === 0 ? (
          <EmptyState icon={Undo2} title={prT('notesEmpty')} text={prT('notesEmptyText')} />
        ) : (
          <div className={surface.tableWrap}>
            <table className={surface.table}>
              <thead>
                <tr>
                  <th>{prT('thNote')}</th>
                  <th>{prT('thSupplier')}</th>
                  <th>{prT('thDate')}</th>
                  <th>{prT('thAgainst')}</th>
                  <th>{prT('thReason')}</th>
                  <th className={surface.numeric}>{prT('thItc')}</th>
                  <th className={surface.numeric}>{prT('thTotal')}</th>
                  <th aria-label={prT('thActions')} />
                </tr>
              </thead>
              <tbody>
                {sorted.map((n) => (
                  <tr key={n.id}>
                    <td>
                      <div className={local.name}>{n.note_number}</div>
                      <div className={local.sub}>
                        {n.kind === 'SUPPLIER_CN' ? prT('kindCn') : prT('kindDn')}
                        {n.supplier_note_number ? ` · ${prT('supRef', { number: n.supplier_note_number })}` : ''}
                      </div>
                    </td>
                    <td>{n.vendor_name}</td>
                    <td className={local.nowrap}>{formatDate(n.date)}</td>
                    <td>
                      {n.bill_number ? <>{n.bill_number}<div className={local.sub}>{n.bill_date ? formatDate(n.bill_date) : ''}</div></> : <span className={local.sub}>{prT('onAccount')}</span>}
                    </td>
                    <td>
                      {prReason(n.reason)}
                      <div className={local.sub}>{n.goods_returned ? prT('goodsBack') : prT('valueOnly')}</div>
                    </td>
                    <td className={surface.numeric}>{formatCurrency(noteItc(n).total)}</td>
                    <td className={surface.numeric}>{formatCurrency(n.total)}</td>
                    <td>
                      {editable && (
                        <div className={surface.rowActions}>
                          <button type="button" className={controls.btnIcon} title={prT('setSup')} aria-label={prT('setSupNamed', { number: n.note_number })} onClick={() => setSupFor(n)}><Pencil size={16} /></button>
                          <button type="button" className={controls.btnDanger} title={prT('delete')} aria-label={prT('deleteNamed', { number: n.note_number })} onClick={() => setDeleting({ kind: 'note', row: n })}><Trash2 size={16} /></button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

      {section === 'grn' &&
        (receipts.length === 0 ? (
          <EmptyState icon={PackageCheck} title={prT('grnEmpty')} text={prT('grnEmptyText')} />
        ) : (
          <div className={surface.tableWrap}>
            <table className={surface.table}>
              <thead>
                <tr>
                  <th>{prT('thNumber')}</th>
                  <th>{prT('thSupplier')}</th>
                  <th>{prT('thDate')}</th>
                  <th>{prT('thStatus')}</th>
                  <th className={surface.numeric}>{prT('thPendingValue')}</th>
                  <th aria-label={prT('thActions')} />
                </tr>
              </thead>
              <tbody>
                {sortedReceipts.map((g) => {
                  const isGrn = g.kind === 'GRN';
                  const st = isGrn ? grnStatus(g, purchases, receipts) : null;
                  const from = !isGrn && g.grn_id ? receipts.find((r) => r.id === g.grn_id)?.number : undefined;
                  const open = !!st && (st.state === 'Pending' || st.state === 'Partly billed');
                  return (
                    <tr key={g.id}>
                      <td>
                        <div className={local.name}>{g.number}</div>
                        <div className={local.sub}>{isGrn ? prT('kindGrn') : prT('kindRj', { grn: from ?? '—' })}{g.challan_no ? ` · ${prT('challanRef', { number: g.challan_no })}` : ''}</div>
                      </td>
                      <td>{g.vendor_name}</td>
                      <td className={local.nowrap}>{formatDate(g.date)}</td>
                      <td>{st ? <StatusBadge status={grnStateLabel(st.state)} tone={GRN_TONE[st.state]} /> : <span className={local.sub}>{prT('lines', { n: g.lines.length })}</span>}</td>
                      <td className={surface.numeric}>{st ? formatCurrency(st.pendingValue) : '—'}</td>
                      <td>
                        {editable && (
                          <div className={surface.rowActions}>
                            {open && <button type="button" className={controls.btnIcon} title={prT('convert')} aria-label={prT('convertNamed', { number: g.number })} onClick={() => convert(g)}><ReceiptText size={16} /></button>}
                            {open && <button type="button" className={controls.btnIcon} title={prT('reject')} aria-label={prT('rejectNamed', { number: g.number })} onClick={() => setGrnMode({ kind: 'REJECTION_OUT', grnId: g.id })}><PackageX size={16} /></button>}
                            {open && <button type="button" className={controls.btnIcon} title={prT('close')} aria-label={prT('closeNamed', { number: g.number })} onClick={() => run(() => receiptNotesDb.setClosed(g.id, todayInput()), prT('closed', { number: g.number }))}><XCircle size={16} /></button>}
                            {st?.state === 'Closed' && <button type="button" className={controls.btnIcon} title={prT('reopen')} aria-label={prT('reopenNamed', { number: g.number })} onClick={() => run(() => receiptNotesDb.setClosed(g.id, undefined), prT('reopened', { number: g.number }))}><RotateCcw size={16} /></button>}
                            <button type="button" className={controls.btnDanger} title={prT('delete')} aria-label={prT('deleteNamed', { number: g.number })} onClick={() => setDeleting({ kind: 'receipt', row: g })}><Trash2 size={16} /></button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}

      {section === 'pending' && (
        <>
          <h3 className={local.sectionHead}>{prT('grniTitle', { amount: formatCurrency(grniTotal) })}</h3>
          {grni.length === 0 ? (
            <p className={local.foot}>{prT('grniNone')}</p>
          ) : (
            <div className={surface.tableWrap}>
              <table className={surface.table}>
                <thead>
                  <tr>
                    <th>{prT('thNumber')}</th>
                    <th>{prT('thSupplier')}</th>
                    <th>{prT('thItem')}</th>
                    <th className={surface.numeric}>{prT('thPendingQty')}</th>
                    <th className={surface.numeric}>{prT('thValue')}</th>
                    <th className={surface.numeric}>{prT('thAge')}</th>
                  </tr>
                </thead>
                <tbody>
                  {grni.map((r, i) => (
                    <tr key={`${r.grnId}-${i}`}>
                      <td>{r.number}<div className={local.sub}>{formatDate(r.date)}</div></td>
                      <td>{r.vendor}</td>
                      <td>{r.item}</td>
                      <td className={surface.numeric}>{r.pending} {r.unit}</td>
                      <td className={surface.numeric}>{formatCurrency(r.value)}</td>
                      <td className={surface.numeric}>{prT('days', { n: r.ageDays })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <h3 className={local.sectionHead}>{prT('poOutTitle', { amount: formatCurrency(poTotal) })}</h3>
          {poOut.length === 0 ? (
            <p className={local.foot}>{prT('poOutNone')}</p>
          ) : (
            <div className={surface.tableWrap}>
              <table className={surface.table}>
                <thead>
                  <tr>
                    <th>{prT('thPo')}</th>
                    <th>{prT('thSupplier')}</th>
                    <th>{prT('thItem')}</th>
                    <th className={surface.numeric}>{prT('thOrdered')}</th>
                    <th className={surface.numeric}>{prT('thReceivedQty')}</th>
                    <th className={surface.numeric}>{prT('thPendingQty')}</th>
                    <th className={surface.numeric}>{prT('thValue')}</th>
                    <th>{prT('thDue')}</th>
                  </tr>
                </thead>
                <tbody>
                  {poOut.map((r, i) => (
                    <tr key={`${r.poId}-${i}`}>
                      <td>{r.number}<div className={local.sub}>{formatDate(r.date)}</div></td>
                      <td>{r.vendor}</td>
                      <td>{r.item}</td>
                      <td className={surface.numeric}>{r.ordered}</td>
                      <td className={surface.numeric}>{r.received}</td>
                      <td className={surface.numeric}>{r.pending} {r.unit}</td>
                      <td className={surface.numeric}>{formatCurrency(r.value)}</td>
                      <td className={local.nowrap}>
                        {r.expected ? formatDate(r.expected) : '—'}
                        {r.overdueDays > 0 && <div className={local.sub}>{prT('overdue', { n: r.overdueDays })}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <p className={local.foot}>{section === 'notes' ? prT('notesFoot') : section === 'grn' ? prT('grnFoot') : prT('pendingFoot')}</p>

      <ReturnModal
        kind={noteKind}
        purchases={purchases}
        vendors={vendors}
        notes={notes}
        onClose={() => setNoteKind(null)}
        onSaved={(m) => {
          setNoteKind(null);
          changed(m);
        }}
      />
      <GrnModal
        mode={grnMode}
        vendors={vendors}
        orders={orders}
        purchases={purchases}
        notes={receipts}
        onVendorCreated={onVendorCreated}
        onClose={() => setGrnMode(null)}
        onSaved={(m) => {
          setGrnMode(null);
          changed(m);
        }}
      />
      <Modal open={!!supFor} onClose={() => setSupFor(null)} title={prT('setSupTitle', { number: supFor?.note_number ?? '' })} subtitle={prT('setSupSub')}>
        {supFor && <SupplierNoteForm note={supFor} onClose={() => setSupFor(null)} onSaved={(m) => { setSupFor(null); changed(m); }} onError={(m) => onChanged(m, 'error')} />}
      </Modal>
      <ConfirmDialog
        open={!!deleting}
        destructive
        title={prT('deleteTitle')}
        message={prT('deleteMessage', { number: deleting ? (deleting.kind === 'note' ? deleting.row.note_number : deleting.row.number) : '' })}
        confirmLabel={prT('delete')}
        onConfirm={remove}
        onClose={() => setDeleting(null)}
      />
    </section>
  );
}

function SupplierNoteForm({ note, onClose, onSaved, onError }: { note: PurchaseReturn; onClose: () => void; onSaved: (m: string) => void; onError: (m: string) => void }) {
  const [number, setNumber] = useState(note.supplier_note_number ?? '');
  const [date, setDate] = useState(note.supplier_note_date ?? '');
  return (
    <form
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        try {
          purchaseReturnsDb.setSupplierNote(note.id, number, date);
          onSaved(prT('supSaved', { number: note.note_number }));
        } catch (err) {
          onError((err as Error).message);
        }
      }}
    >
      <div className={local.inlineEdit}>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="sup-no">{prT('supNoOptional')}</label>
          <input id="sup-no" className={controls.input} value={number} onChange={(e) => setNumber(e.target.value)} />
        </div>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="sup-date">{prT('supDate')}</label>
          <input id="sup-date" type="date" className={controls.input} value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>
      <div className={styles.inlineActions}>
        <button type="button" className={controls.btnOutline} onClick={onClose}>{prT('cancel')}</button>
        <button type="submit" className={controls.btnPrimary}>{prT('save')}</button>
      </div>
    </form>
  );
}
