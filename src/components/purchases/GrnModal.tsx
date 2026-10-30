import { useMemo, useState } from 'react';
import type { PurchaseLine, PurchaseOrder, PurchaseRecord, ReceiptNote, ReceiptNoteLine, Vendor } from '../../types/purchases';
import { grnStatus, receiptNotesDb, rejectionLinesFromGrn } from '../../lib/receipt-notes';
import { poFulfilment } from '../../lib/purchase-orders';
import { blankPurchaseLine } from '../../lib/purchases';
import { generateId } from '../../lib/storage';
import { num } from '../../lib/invoice-calc';
import { resolveStateCode } from '../../lib/india-states';
import { formatDate, todayInput } from '../../lib/utils';
import { Modal } from '../ui/Modal';
import { NumberInput } from '../ui/NumberInput';
import { VendorPicker } from './VendorPicker';
import { LineItemsEditor } from './LineItemsEditor';
import { SizeGridSlot } from './SizeGridSlot';
import { useT } from '../../i18n';
import { prT } from '../../i18n/areas/purchase-returns';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './purchases.module.css';
import local from './returns.module.css';
import { errText } from '../../i18n/lib-msg';
import { acceptForm, entryKeyDown, focusFormDate } from '../../lib/keys/entry-actions';
import { DateField } from '../ui/DateField';
import { SelectField } from '../ui/SelectField';

/** R20-B: Ctrl+A accepts, F2 goes to the date (Tally keys on; the dialog reads its own keys). */
const GRN_KEYS = entryKeyDown({ 'accept.bill': acceptForm, 'date.bill': focusFormDate });

export interface GrnModalProps {
  /** GRN to record, rejection out against a GRN, or closed. */
  mode: { kind: 'GRN' } | { kind: 'REJECTION_OUT'; grnId?: string } | null;
  vendors: Vendor[];
  orders: PurchaseOrder[];
  purchases: PurchaseRecord[];
  notes: ReceiptNote[];
  onVendorCreated: () => void;
  onClose: () => void;
  onSaved: (message: string) => void;
}

/** Receipt Note (GRN: goods in before the bill) and Rejections Out (goods sent back before billing). */
export function GrnModal({ mode, onClose, ...rest }: GrnModalProps) {
  useT();
  return (
    <Modal
      open={mode !== null}
      onClose={onClose}
      size="xl"
      title={mode?.kind === 'REJECTION_OUT' ? prT('rjTitle') : prT('grnTitle')}
      subtitle={mode?.kind === 'REJECTION_OUT' ? prT('rjSub') : prT('grnSub')}
    >
      {mode?.kind === 'GRN' && <GrnForm onClose={onClose} {...rest} />}
      {mode?.kind === 'REJECTION_OUT' && <RejectionForm grnId={mode.grnId} onClose={onClose} {...rest} />}
    </Modal>
  );
}

type Rest = Omit<GrnModalProps, 'mode'>;

function GrnForm({ vendors, orders, purchases, notes, onVendorCreated, onClose, onSaved }: Rest) {
  const [vendorId, setVendorId] = useState('');
  const [date, setDate] = useState(todayInput());
  const [poId, setPoId] = useState('');
  const [challan, setChallan] = useState('');
  const [pos, setPos] = useState('');
  const [lines, setLines] = useState<PurchaseLine[]>([blankPurchaseLine()]);
  const [remarks, setRemarks] = useState('');
  const [error, setError] = useState('');
  const vendor = vendors.find((v) => v.id === vendorId);
  const openPos = useMemo(
    () => orders.filter((o) => !o.closed_on && (!vendorId || o.vendor_id === vendorId) && poFulfilment(o, purchases).state !== 'Received'),
    [orders, purchases, vendorId],
  );

  const pickPo = (id: string) => {
    setPoId(id);
    const po = orders.find((o) => o.id === id);
    if (!po) return;
    if (po.vendor_id) setVendorId(po.vendor_id);
    if (po.place_of_supply) setPos(po.place_of_supply);
    // Pending on the PO, less what open GRNs of it already received.
    const onGrn = new Map<string, number>();
    for (const g of notes) {
      if (g.kind !== 'GRN' || g.po_id !== po.id) continue;
      for (const s of grnStatus(g, purchases, notes).lines) if (s.line.po_line_id) onGrn.set(s.line.po_line_id, (onGrn.get(s.line.po_line_id) ?? 0) + s.pending);
    }
    const next = poFulfilment(po, purchases)
      .lines.map((l) => ({ l, left: Math.max(l.pending - (onGrn.get(l.line.id) ?? 0), 0) }))
      .filter((x) => x.left > 0)
      .map(({ l, left }) => ({ id: generateId(), name: l.line.name, hsn: l.line.hsn, unit: l.line.unit, quantity: left, rate: num(l.line.rate), tax_rate: num(l.line.tax_rate), po_line_id: l.line.id, ...(l.line.item_id ? { item_id: l.line.item_id } : {}), ...(l.line.unit_factor ? { unit_factor: l.line.unit_factor } : {}) }));
    if (next.length) setLines(next);
  };

  const submit = () => {
    setError('');
    try {
      const saved = receiptNotesDb.save(
        {
          kind: 'GRN',
          date,
          vendor_id: vendor?.id,
          vendor_name: vendor?.name ?? '',
          vendor_gstin: vendor?.gstin,
          place_of_supply: pos || (vendor ? resolveStateCode({ code: vendor.state_code, gstin: vendor.gstin }) : '') || undefined,
          po_id: poId || undefined,
          challan_no: challan.trim() || undefined,
          lines: lines
            .filter((l) => l.name.trim() || num(l.quantity) > 0)
            .map((l): ReceiptNoteLine => ({ id: l.id, name: l.name, hsn: l.hsn, unit: l.unit, quantity: num(l.quantity), rate: num(l.rate), tax_rate: num(l.tax_rate), ...(l.po_line_id ? { po_line_id: l.po_line_id } : {}), ...(l.item_id ? { item_id: l.item_id } : {}), ...(l.unit_factor ? { unit_factor: l.unit_factor } : {}) })),
          notes: remarks.trim() || undefined,
        },
        purchases,
      );
      onSaved(prT('grnSaved', { number: saved.number }));
    } catch (err) {
      setError(errText(err));
    }
  };

  return (
    <form className={styles.form} onKeyDown={GRN_KEYS} onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <VendorPicker id="grn-vendor" vendors={vendors} value={vendorId} onCreated={onVendorCreated} onSelect={(v) => setVendorId(v?.id ?? '')} />
      <div className={controls.row3}>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="grn-date">{prT('grnDate')}</label>
          <DateField id="grn-date" className={controls.input} value={date} onChange={(e) => setDate(e.target.value)} />
          <span className={controls.hint}>{prT('noteNumber', { number: receiptNotesDb.nextNumber('GRN', date) })}</span>
        </div>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="grn-po">{prT('againstPo')}</label>
          <SelectField id="grn-po" className={controls.select} value={poId} onChange={(e) => pickPo(e.target.value)}>
            <option value="">{prT('noPo')}</option>
            {openPos.map((o) => (
              <option key={o.id} value={o.id}>{o.po_number} · {o.vendor_name} · {formatDate(o.date)}</option>
            ))}
          </SelectField>
        </div>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="grn-challan">{prT('challanNo')}</label>
          <input id="grn-challan" className={controls.input} value={challan} onChange={(e) => setChallan(e.target.value)} />
        </div>
      </div>
      <h3 className={styles.sectionTitle}>{prT('goodsReceived')}</h3>
      <LineItemsEditor lines={lines} onChange={setLines} />
      <SizeGridSlot lines={lines} onChange={setLines} date={date} />
      <div className={controls.field}>
        <label className={controls.label} htmlFor="grn-notes">{prT('narration')}</label>
        <textarea id="grn-notes" className={controls.textarea} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
      </div>
      <p className={styles.note}>{prT('grnNote')}</p>
      {error && <p className={styles.formError} role="alert">{error}</p>}
      <div className={styles.inlineActions}>
        <button type="button" className={controls.btnOutline} onClick={onClose}>{prT('cancel')}</button>
        <button type="submit" className={controls.btnPrimary}>{prT('saveGrn')}</button>
      </div>
    </form>
  );
}

function RejectionForm({ grnId, purchases, notes, onClose, onSaved }: Rest & { grnId?: string }) {
  const grns = useMemo(() => notes.filter((n) => n.kind === 'GRN' && grnStatus(n, purchases, notes).lines.some((l) => l.pending > 0)), [notes, purchases]);
  const [id, setId] = useState(grnId ?? '');
  const grn = grns.find((g) => g.id === id);
  const [date, setDate] = useState(todayInput());
  const [qty, setQty] = useState<Record<string, number>>({});
  const [remarks, setRemarks] = useState('');
  const [error, setError] = useState('');
  const avail = useMemo(() => (grn ? rejectionLinesFromGrn(grn, purchases, notes) : []), [grn, purchases, notes]);

  const submit = () => {
    setError('');
    if (!grn) return setError(prT('errGrn'));
    const lines = avail.filter((l) => num(qty[l.grn_line_id ?? '']) > 0).map((l) => ({ ...l, quantity: num(qty[l.grn_line_id ?? '']) }));
    if (!lines.length) return setError(prT('errRejectQty'));
    try {
      const saved = receiptNotesDb.save(
        { kind: 'REJECTION_OUT', date, grn_id: grn.id, vendor_id: grn.vendor_id, vendor_name: grn.vendor_name, vendor_gstin: grn.vendor_gstin, lines, notes: remarks.trim() || undefined },
        purchases,
      );
      onSaved(prT('rjSaved', { number: saved.number }));
    } catch (err) {
      setError(errText(err));
    }
  };

  return (
    <form className={styles.form} onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <div className={controls.row}>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="rj-grn">{prT('fromGrn')}</label>
          <SelectField id="rj-grn" className={controls.select} value={id} onChange={(e) => { setId(e.target.value); setQty({}); }}>
            <option value="">{prT('chooseGrn')}</option>
            {grns.map((g) => (
              <option key={g.id} value={g.id}>{g.number} · {g.vendor_name} · {formatDate(g.date)}</option>
            ))}
          </SelectField>
        </div>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="rj-date">{prT('rjDate')}</label>
          <DateField id="rj-date" className={controls.input} value={date} min={grn?.date} onChange={(e) => setDate(e.target.value)} />
          <span className={controls.hint}>{prT('noteNumber', { number: receiptNotesDb.nextNumber('REJECTION_OUT', date) })}</span>
        </div>
      </div>
      {grn && (
        <div className={surface.tableWrap}>
          <table className={surface.table}>
            <thead>
              <tr>
                <th>{prT('thItem')}</th>
                <th className={surface.numeric}>{prT('thUnbilled')}</th>
                <th className={surface.numeric}>{prT('thRejectQty')}</th>
              </tr>
            </thead>
            <tbody>
              {avail.map((l) => (
                <tr key={l.grn_line_id}>
                  <td className={local.name}>{l.name}</td>
                  <td className={surface.numeric}>{l.quantity} {l.unit ?? ''}</td>
                  <td className={surface.numeric}>
                    <NumberInput
                      className={`${controls.input} ${local.qty}`}
                      value={num(qty[l.grn_line_id ?? ''])}
                      aria-label={prT('qtyFor', { item: l.name })}
                      onChange={(v) => setQty((q) => ({ ...q, [l.grn_line_id ?? '']: Math.min(Math.max(v, 0), l.quantity) }))}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className={controls.field}>
        <label className={controls.label} htmlFor="rj-notes">{prT('rjReason')}</label>
        <textarea id="rj-notes" className={controls.textarea} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
      </div>
      {error && <p className={styles.formError} role="alert">{error}</p>}
      <div className={styles.inlineActions}>
        <button type="button" className={controls.btnOutline} onClick={onClose}>{prT('cancel')}</button>
        <button type="submit" className={controls.btnPrimary}>{prT('saveRj')}</button>
      </div>
    </form>
  );
}
