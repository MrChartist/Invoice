import { useMemo, useState } from 'react';
import type { NoteReasonCode, PurchaseNoteKind, PurchaseRecord, PurchaseReturn, PurchaseReturnLine, Vendor } from '../../types/purchases';
import { GST_NOTE_REASONS } from '../../types/purchases';
import {
  noteGstMode,
  noteLineFrom,
  freeUnitsReturned,
  noteTotals,
  notedValue,
  purchaseReturnsDb,
  reasonReturnsGoods,
  returnableLines,
  type NoteDraft,
} from '../../lib/purchase-returns';
import { generateId } from '../../lib/storage';
import { isVoidStatus, readPurchase } from '../../lib/purchase-normalize';
import { num, round2 } from '../../lib/invoice-calc';
import { formatCurrency, formatDate, todayInput } from '../../lib/utils';
import { gstRateOptions } from '../../lib/tax-rules';
import { Modal } from '../ui/Modal';
import { NumberInput } from '../ui/NumberInput';
import { useT } from '../../i18n';
import { prT, prReason } from '../../i18n/areas/purchase-returns';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './purchases.module.css';
import local from './returns.module.css';
import { defineArea } from '../../i18n/area';

const freeRetT = defineArea({ msg: '{n} free unit(s) go back at zero value.' } as const, { msg: '{n} फ़्री इकाई शून्य मूल्य पर वापस जाएँगी।' }); // R9 (RT-A4)

export interface ReturnModalProps {
  /** Which entry to record; null = closed. */
  kind: PurchaseNoteKind | null;
  purchases: PurchaseRecord[];
  vendors: Vendor[];
  notes: PurchaseReturn[];
  /** Pre-select a bill. */
  billId?: string;
  /** R6-C1: quantities to return per bill line id (a QC reject's pre-filled debit note). */
  initialQty?: Record<string, number>;
  onClose: () => void;
  onSaved: (message: string) => void;
}

/** Debit note (purchase return) / supplier credit note received — Tally's "Debit Note" on the purchase side. */
export function ReturnModal({ kind, onClose, ...rest }: ReturnModalProps) {
  useT();
  return (
    <Modal
      open={kind !== null}
      onClose={onClose}
      size="xl"
      title={kind === 'SUPPLIER_CN' ? prT('cnTitle') : prT('dnTitle')}
      subtitle={kind === 'SUPPLIER_CN' ? prT('cnSub') : prT('dnSub')}
    >
      {kind !== null && <ReturnForm key={kind} kind={kind} onClose={onClose} {...rest} />}
    </Modal>
  );
}

type FormProps = Omit<ReturnModalProps, 'kind'> & { kind: PurchaseNoteKind };

function ReturnForm({ kind, purchases, vendors, notes, billId, initialQty, onClose, onSaved }: FormProps) {
  const bills = useMemo(
    () =>
      purchases
        .filter((p) => {
          const c = readPurchase(p);
          return !!c && !isVoidStatus(c.status);
        })
        .sort((a, b) => b.date.localeCompare(a.date)),
    [purchases],
  );
  const [purchaseId, setPurchaseId] = useState(billId ?? '');
  const bill = bills.find((b) => b.id === purchaseId);
  const [date, setDate] = useState(todayInput());
  const [reason, setReason] = useState<NoteReasonCode>(kind === 'DEBIT_NOTE' ? '01' : '02');
  const [goods, setGoods] = useState(kind === 'DEBIT_NOTE');
  const [qty, setQty] = useState<Record<string, number>>(() => ({ ...(initialQty ?? {}) }));
  const [rates, setRates] = useState<Record<string, number>>({});
  const [valueName, setValueName] = useState('');
  const [value, setValue] = useState(0);
  const [valueRate, setValueRate] = useState(18);
  const [supNo, setSupNo] = useState('');
  const [supDate, setSupDate] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [mode, setMode] = useState<'IGST' | 'CGST_SGST'>('CGST_SGST');
  const [remarks, setRemarks] = useState('');
  const [error, setError] = useState('');

  const returnable = useMemo(() => (bill ? returnableLines(bill, notes) : []), [bill, notes]);
  const room = bill ? round2(num(bill.total) - notedValue(bill, notes)) : 0;
  const vendor = vendors.find((v) => v.id === vendorId);
  // R9 (RT-A4): free units in this return go back at zero value (paid units go first).
  const freeBack = useMemo(() => returnable.reduce((s, r) => s + freeUnitsReturned(r, num(qty[r.line.id])), 0), [returnable, qty]);

  const lines: PurchaseReturnLine[] = useMemo(() => {
    if (goods && bill) {
      return returnable
        .filter((r) => num(qty[r.line.id]) > 0)
        .map((r) => ({ ...noteLineFrom(r, num(qty[r.line.id])), ...(rates[r.line.id] !== undefined ? { rate: round2(num(rates[r.line.id])) } : {}) }));
    }
    if (!(value > 0)) return [];
    const first = bill?.lines?.[0];
    return [{ id: 'value', name: valueName.trim() || prReason(reason), quantity: 1, rate: round2(value), tax_rate: num(valueRate), ...(first?.hsn ? { hsn: first.hsn } : {}) }];
  }, [goods, bill, returnable, qty, rates, value, valueName, valueRate, reason]);
  const gstMode = bill ? noteGstMode(bill) : mode;
  const totals = useMemo(() => noteTotals(lines, gstMode), [lines, gstMode]);

  const pickBill = (id: string) => {
    setPurchaseId(id);
    setQty({});
    setRates({});
    const b = bills.find((x) => x.id === id);
    if (b?.lines?.[0]) setValueRate(num(b.lines[0].tax_rate));
  };
  const pickReason = (r: NoteReasonCode) => {
    setReason(r);
    setGoods(reasonReturnsGoods(r));
  };

  const submit = () => {
    setError('');
    if (kind === 'DEBIT_NOTE' && !bill) return setError(prT('errBill'));
    if (!bill && !vendor) return setError(prT('errVendor'));
    const draft: NoteDraft = {
      kind,
      date,
      purchaseId: bill?.id,
      vendorId: bill ? undefined : vendor?.id,
      vendorName: bill ? undefined : vendor?.name,
      vendorGstin: bill ? undefined : vendor?.gstin,
      supplierNoteNumber: supNo,
      supplierNoteDate: supDate || undefined,
      reason,
      goodsReturned: goods && !!bill,
      lines: lines.map((l) => (l.id === 'value' ? { ...l, id: generateId() } : l)),
      notes: remarks,
      ...(bill ? {} : { mode, itcEligible: true }),
    };
    try {
      const saved = purchaseReturnsDb.create(draft);
      onSaved(prT('saved', { number: saved.note_number, amount: formatCurrency(saved.total) }));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <form
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className={controls.row}>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="rn-bill">{prT('againstBill')}</label>
          <select id="rn-bill" className={controls.select} value={purchaseId} onChange={(e) => pickBill(e.target.value)}>
            <option value="">{kind === 'DEBIT_NOTE' ? prT('chooseBill') : prT('noBill')}</option>
            {bills.map((b) => (
              <option key={b.id} value={b.id}>
                {b.vendor_name} · {b.bill_number || '—'} · {formatDate(b.date)} · {formatCurrency(b.total)}
              </option>
            ))}
          </select>
          {bill && <span className={controls.hint}>{prT('billHint', { room: formatCurrency(Math.max(room, 0)), itc: bill.itc_eligible ? prT('itcClaimed') : prT('itcNotClaimed') })}</span>}
        </div>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="rn-date">{prT('noteDate')}</label>
          <input id="rn-date" type="date" className={controls.input} value={date} min={bill?.date} onChange={(e) => setDate(e.target.value)} />
          <span className={controls.hint}>{prT('noteNumber', { number: purchaseReturnsDb.nextNumber(date) })}</span>
        </div>
      </div>

      {!bill && kind === 'SUPPLIER_CN' && (
        <div className={controls.row}>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="rn-vendor">{prT('supplier')}</label>
            <select id="rn-vendor" className={controls.select} value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
              <option value="">{prT('chooseSupplier')}</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>{v.name}{v.gstin ? ` · ${v.gstin}` : ''}</option>
              ))}
            </select>
            <span className={controls.hint}>{prT('onAccountHint')}</span>
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="rn-mode">{prT('taxType')}</label>
            <select id="rn-mode" className={controls.select} value={mode} onChange={(e) => setMode(e.target.value as 'IGST' | 'CGST_SGST')}>
              <option value="CGST_SGST">CGST + SGST</option>
              <option value="IGST">IGST</option>
            </select>
          </div>
        </div>
      )}

      <div className={controls.row}>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="rn-supno">{kind === 'SUPPLIER_CN' ? prT('supNoRequired') : prT('supNoOptional')}</label>
          <input id="rn-supno" className={controls.input} value={supNo} onChange={(e) => setSupNo(e.target.value)} />
        </div>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="rn-supdate">{prT('supDate')}</label>
          <input id="rn-supdate" type="date" className={controls.input} value={supDate} onChange={(e) => setSupDate(e.target.value)} />
        </div>
      </div>

      <div className={controls.row}>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="rn-reason">{prT('reason')}</label>
          <select id="rn-reason" className={controls.select} value={reason} onChange={(e) => pickReason(e.target.value as NoteReasonCode)}>
            {GST_NOTE_REASONS.map((r) => (
              <option key={r.value} value={r.value}>{r.value} — {prReason(r.value)}</option>
            ))}
          </select>
        </div>
        <div className={controls.field}>
          <span className={controls.label}>{prT('stock')}</span>
          <label className={controls.check}>
            <input type="checkbox" checked={goods && !!bill} disabled={!bill} onChange={(e) => setGoods(e.target.checked)} />
            {prT('goodsReturned')}
          </label>
          <span className={controls.hint}>{goods && bill ? prT('goodsHint') : prT('valueHint')}</span>
        </div>
      </div>

      {goods && bill ? (
        <div className={surface.tableWrap}>
          <table className={surface.table}>
            <thead>
              <tr>
                <th>{prT('thItem')}</th>
                <th className={surface.numeric}>{prT('thBilled')}</th>
                <th className={surface.numeric}>{prT('thReturned')}</th>
                <th className={surface.numeric}>{prT('thAvailable')}</th>
                <th className={surface.numeric}>{prT('thReturnQty')}</th>
                <th className={surface.numeric}>{prT('thRate')}</th>
              </tr>
            </thead>
            <tbody>
              {returnable.map((r) => (
                <tr key={r.line.id}>
                  <td>
                    <div className={local.name}>{r.line.name}</div>
                    <div className={local.sub}>{[r.line.hsn, r.line.batch_no && prT('batch', { batch: r.line.batch_no }), `${num(r.line.tax_rate)}%`].filter(Boolean).join(' · ')}</div>
                  </td>
                  <td className={surface.numeric}>{r.billed}</td>
                  <td className={surface.numeric}>{r.returned}</td>
                  <td className={surface.numeric}>{r.available}</td>
                  <td className={surface.numeric}>
                    <NumberInput
                      className={`${controls.input} ${local.qty}`}
                      value={num(qty[r.line.id])}
                      min={0}
                      max={r.available}
                      aria-label={prT('qtyFor', { item: r.line.name })}
                      disabled={r.available <= 0}
                      onChange={(v) => setQty((q) => ({ ...q, [r.line.id]: Math.min(Math.max(v, 0), r.available) }))}
                    />
                  </td>
                  <td className={surface.numeric}>
                    <NumberInput
                      className={`${controls.input} ${local.rate}`}
                      value={rates[r.line.id] ?? round2(r.unitCost)}
                      min={0}
                      aria-label={prT('rateFor', { item: r.line.name })}
                      onChange={(v) => setRates((x) => ({ ...x, [r.line.id]: Math.max(v, 0) }))}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className={controls.row3}>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="rn-vname">{prT('description')}</label>
            <input id="rn-vname" className={controls.input} value={valueName} placeholder={prReason(reason)} onChange={(e) => setValueName(e.target.value)} />
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="rn-value">{prT('taxableValue')}</label>
            <NumberInput id="rn-value" className={controls.input} value={value} min={0} onChange={(v) => setValue(Math.max(v, 0))} />
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="rn-rate">{prT('gstRate')}</label>
            <select id="rn-rate" className={controls.select} value={valueRate} onChange={(e) => setValueRate(Number(e.target.value))}>
              {gstRateOptions(date, valueRate).map((s) => (
                <option key={s} value={s}>{s}%</option>
              ))}
            </select>
          </div>
        </div>
      )}

      <div className={styles.totals} aria-live="polite">
        <div className={styles.totalRow}><span>{prT('taxable')}</span><span>{formatCurrency(totals.taxable)}</span></div>
        {gstMode === 'IGST' ? (
          <div className={styles.totalRow}><span>IGST</span><span>{formatCurrency(totals.igst)}</span></div>
        ) : gstMode === 'CGST_SGST' ? (
          <>
            <div className={styles.totalRow}><span>CGST</span><span>{formatCurrency(totals.cgst)}</span></div>
            <div className={styles.totalRow}><span>SGST</span><span>{formatCurrency(totals.sgst)}</span></div>
          </>
        ) : null}
        <div className={styles.totalGrand}><span>{prT('noteTotal')}</span><span>{formatCurrency(totals.total)}</span></div>
      </div>

      <div className={controls.field}>
        <label className={controls.label} htmlFor="rn-notes">{prT('narration')}</label>
        <textarea id="rn-notes" className={controls.textarea} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
      </div>
      <p className={styles.note}>{prT('effectNote')}</p>

      {goods && freeBack > 0 && <p className={styles.formError} role="status" data-return-free>{freeRetT('msg', { n: freeBack })}</p>}
      {error && <p className={styles.formError} role="alert">{error}</p>}
      <div className={styles.inlineActions}>
        <button type="button" className={controls.btnOutline} onClick={onClose}>{prT('cancel')}</button>
        <button type="submit" className={controls.btnPrimary}>{kind === 'SUPPLIER_CN' ? prT('saveCn') : prT('saveDn')}</button>
      </div>
    </form>
  );
}
