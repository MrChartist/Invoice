import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { createDebitNote, type DebitLine } from '../../lib/documents';
import { gstRateOptions } from '../../lib/tax-rules';
import { round2 } from '../../lib/invoice-calc';
import { formatCurrency } from '../../lib/utils';
import type { InvoiceRecord } from '../../types/invoice';
import { useT } from '../../i18n';
import { salesT } from '../../i18n/areas/sales';
import controls from '../../styles/controls.module.css';
import styles from './documents.module.css';
import { SelectField } from '../ui/SelectField';

export interface DebitNoteModalProps {
  invoice: InvoiceRecord;
  open: boolean;
  onClose: () => void;
  onCreated: (rec: InvoiceRecord) => void;
}

/** Raise a debit note (extra charge / upward rate revision) against an issued invoice. */
export function DebitNoteModal({ invoice, open, onClose, onCreated }: DebitNoteModalProps) {
  useT(); // re-render on a language switch (5.4)
  const defaultRate = invoice.items?.[0]?.tax_rate ?? 18;
  const blank = (): DebitLine => ({ name: '', quantity: 1, rate: 0, tax_rate: defaultRate });
  const [lines, setLines] = useState<DebitLine[]>([blank()]);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const taxable = round2(lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.rate) || 0), 0));
  const set = (i: number, p: Partial<DebitLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...p } : l)));

  const create = () => {
    try {
      onCreated(createDebitNote(invoice, { lines, reason }));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={salesT('dn.title')}
      subtitle={salesT('dn.sub', { number: invoice.invoice_number, client: invoice.client?.name || salesT('dn.theClient') })}
      footer={
        <>
          <button type="button" className={controls.btnOutline} onClick={onClose}>{salesT('cancel')}</button>
          <button type="button" className={controls.btnPrimary} onClick={create}>{salesT('dn.create')}</button>
        </>
      }
    >
      <div className={styles.form}>
        <label className={controls.field}>
          <span className={controls.label}>{salesT('dn.reason')}</span>
          <input className={controls.input} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={salesT('dn.reasonPh')} />
        </label>
        {lines.map((l, i) => (
          <div key={i} className={controls.row3}>
            <input className={controls.input} aria-label={salesT('dn.lineDesc', { n: i + 1 })} value={l.name} onChange={(e) => set(i, { name: e.target.value })} placeholder={salesT('dn.descPh')} />
            <input className={controls.input} aria-label={salesT('dn.lineQty', { n: i + 1 })} type="number" min={0} step="any" value={l.quantity} onChange={(e) => set(i, { quantity: Number(e.target.value) })} />
            <input className={controls.input} aria-label={salesT('dn.lineRate', { n: i + 1 })} type="number" min={0} step="any" value={l.rate || ''} onChange={(e) => set(i, { rate: Number(e.target.value) })} placeholder={salesT('rate')} />
            <SelectField className={controls.select} aria-label={salesT('dn.lineGst', { n: i + 1 })} value={l.tax_rate} onChange={(e) => set(i, { tax_rate: Number(e.target.value) })}>
              {gstRateOptions(undefined, l.tax_rate).map((r) => <option key={r} value={r}>{r}%</option>)}
            </SelectField>
            {lines.length > 1 && (
              <button type="button" className={controls.btnDanger} aria-label={salesT('dn.removeLine', { n: i + 1 })} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                <Trash2 size={15} />
              </button>
            )}
          </div>
        ))}
        <button type="button" className={controls.btnGhost} onClick={() => setLines((ls) => [...ls, blank()])}>
          <Plus size={15} /> {salesT('addLine')}
        </button>
        <p className={controls.hint}>
          {salesT('dn.hint', { amount: formatCurrency(taxable, invoice.currency), number: invoice.invoice_number })}
        </p>
        {error && <p className={controls.error} role="alert">{error}</p>}
      </div>
    </Modal>
  );
}
