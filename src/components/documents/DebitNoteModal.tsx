import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { createDebitNote, type DebitLine } from '../../lib/documents';
import { GST_SLABS } from '../../lib/tax-rules';
import { round2 } from '../../lib/invoice-calc';
import { formatCurrency } from '../../lib/utils';
import type { InvoiceRecord } from '../../types/invoice';
import controls from '../../styles/controls.module.css';
import styles from './documents.module.css';

export interface DebitNoteModalProps {
  invoice: InvoiceRecord;
  open: boolean;
  onClose: () => void;
  onCreated: (rec: InvoiceRecord) => void;
}

/** Raise a debit note (extra charge / upward rate revision) against an issued invoice. */
export function DebitNoteModal({ invoice, open, onClose, onCreated }: DebitNoteModalProps) {
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
      title="Create debit note"
      subtitle={`Against ${invoice.invoice_number} · adds to what ${invoice.client?.name || 'the client'} owes`}
      footer={
        <>
          <button type="button" className={controls.btnOutline} onClick={onClose}>Cancel</button>
          <button type="button" className={controls.btnPrimary} onClick={create}>Create draft</button>
        </>
      }
    >
      <div className={styles.form}>
        <label className={controls.field}>
          <span className={controls.label}>Reason *</span>
          <input className={controls.input} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Rate revision, short billing, extra freight…" />
        </label>
        {lines.map((l, i) => (
          <div key={i} className={controls.row3}>
            <input className={controls.input} aria-label={`Line ${i + 1} description`} value={l.name} onChange={(e) => set(i, { name: e.target.value })} placeholder="Description" />
            <input className={controls.input} aria-label={`Line ${i + 1} quantity`} type="number" min={0} step="any" value={l.quantity} onChange={(e) => set(i, { quantity: Number(e.target.value) })} />
            <input className={controls.input} aria-label={`Line ${i + 1} rate`} type="number" min={0} step="any" value={l.rate || ''} onChange={(e) => set(i, { rate: Number(e.target.value) })} placeholder="Rate" />
            <select className={controls.select} aria-label={`Line ${i + 1} GST`} value={l.tax_rate} onChange={(e) => set(i, { tax_rate: Number(e.target.value) })}>
              {GST_SLABS.map((r) => <option key={r} value={r}>{r}%</option>)}
            </select>
            {lines.length > 1 && (
              <button type="button" className={controls.btnDanger} aria-label={`Remove line ${i + 1}`} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                <Trash2 size={15} />
              </button>
            )}
          </div>
        ))}
        <button type="button" className={controls.btnGhost} onClick={() => setLines((ls) => [...ls, blank()])}>
          <Plus size={15} /> Add line
        </button>
        <p className={controls.hint}>
          Taxable {formatCurrency(taxable, invoice.currency)} · reported in GSTR-1 as a debit note (CDNR / CDNUR) against
          {' '}{invoice.invoice_number}. Verify with your CA.
        </p>
        {error && <p className={controls.error} role="alert">{error}</p>}
      </div>
    </Modal>
  );
}
