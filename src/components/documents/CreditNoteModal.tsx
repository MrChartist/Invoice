import { useMemo, useState } from 'react';
import { Modal } from '../ui/Modal';
import { formatCurrency } from '../../lib/utils';
import { num, round2 } from '../../lib/invoice-calc';
import {
  CREDIT_REASONS,
  buildCreditNote,
  createCreditNote,
  creditableLines,
  readLinks,
} from '../../lib/documents';
import { localDb } from '../../lib/localDb';
import type { InvoiceRecord } from '../../types/invoice';
import controls from '../../styles/controls.module.css';
import styles from './documents.module.css';

export interface CreditNoteModalProps {
  invoice: InvoiceRecord;
  open: boolean;
  onClose: () => void;
  onCreated: (record: InvoiceRecord) => void;
}

export function CreditNoteModal(props: CreditNoteModalProps) {
  // Remount on open so the form always starts fresh against current data.
  if (!props.open) return null;
  return <CreditNoteForm {...props} />;
}

function CreditNoteForm({ invoice, onClose, onCreated }: CreditNoteModalProps) {
  const [links] = useState(() => readLinks());
  const [all] = useState(() => localDb.invoices.getAll());
  const [qty, setQty] = useState<Record<string, string>>({});
  const [reason, setReason] = useState<string>(CREDIT_REASONS[0]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const lines = useMemo(() => creditableLines(invoice, links, all), [invoice, links, all]);

  const preview = useMemo(
    () =>
      buildCreditNote(
        invoice,
        {
          reason,
          lines: lines.map((l) => ({ itemId: l.item.id, quantity: num(qty[l.item.id]) })),
        },
        links,
        all,
        { id: 'preview', invoice_number: 'preview', today: invoice.issue_date },
      ),
    [invoice, reason, lines, qty, links, all],
  );

  const rec = preview.record;
  const anyEntered = lines.some((l) => num(qty[l.item.id]) > 0);
  const currency = invoice.currency || 'INR';
  const fmt = (n: number) => formatCurrency(n, currency);
  const nothingLeft = lines.every((l) => l.remainingQty <= 0);

  const submit = () => {
    setTouched(true);
    if (!rec) return;
    try {
      const saved = createCreditNote(invoice, {
        reason,
        lines: lines.map((l) => ({ itemId: l.item.id, quantity: num(qty[l.item.id]) })),
      });
      onCreated(saved);
      onClose();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not save the credit note.');
    }
  };

  const showErrors = (touched || anyEntered) && preview.errors.length > 0;

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="Create credit note"
      subtitle={`Against ${invoice.invoice_number} · ${invoice.client?.name ?? ''}`}
      footer={
        <>
          <button type="button" className={controls.btnOutline} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={controls.btnPrimary}
            onClick={submit}
            disabled={!rec || nothingLeft}
          >
            Create credit note
          </button>
        </>
      }
    >
      <div className={styles.stack}>
        {nothingLeft ? (
          <p className={styles.empty}>Every line of this invoice has already been fully credited.</p>
        ) : (
          <>
            <div className={styles.tableScroll}>
              <table className={styles.table}>
                <caption className={styles.srOnly}>Lines available to credit</caption>
                <thead>
                  <tr>
                    <th scope="col">Item</th>
                    <th scope="col" className={styles.num}>Rate</th>
                    <th scope="col" className={styles.num}>Invoiced</th>
                    <th scope="col" className={styles.num}>Credited</th>
                    <th scope="col" className={styles.num}>Credit qty</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => {
                    const id = `cn-qty-${l.item.id}`;
                    return (
                      <tr key={l.item.id}>
                        <td>
                          <span className={styles.itemName}>{l.item.name || 'Item'}</span>
                          <span className={styles.itemMeta}>
                            {l.item.hsn ? `HSN/SAC ${l.item.hsn} · ` : ''}
                            GST {num(l.item.tax_rate)}%
                          </span>
                        </td>
                        <td className={styles.num} data-label="Rate">{fmt(num(l.item.rate))}</td>
                        <td className={styles.num} data-label="Invoiced">
                          {l.originalQty} {l.item.unit ?? ''}
                        </td>
                        <td className={styles.num} data-label="Credited">{l.creditedQty}</td>
                        <td className={`${styles.num} ${styles.qtyCell}`} data-label="Credit qty">
                          <label htmlFor={id} className={styles.srOnly}>
                            Quantity to credit for {l.item.name || 'item'}
                          </label>
                          <input
                            id={id}
                            type="number"
                            inputMode="decimal"
                            min={0}
                            max={l.remainingQty}
                            step="any"
                            className={`${controls.input} ${styles.qtyInput}`}
                            value={qty[l.item.id] ?? ''}
                            placeholder="0"
                            disabled={l.remainingQty <= 0}
                            onChange={(e) => setQty((q) => ({ ...q, [l.item.id]: e.target.value }))}
                          />
                          {l.remainingQty > 0 ? (
                            <button
                              type="button"
                              className={styles.fullBtn}
                              onClick={() => setQty((q) => ({ ...q, [l.item.id]: String(l.remainingQty) }))}
                            >
                              Max {l.remainingQty}
                            </button>
                          ) : (
                            <span className={styles.itemMeta}>Fully credited</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className={controls.field}>
              <label className={controls.label} htmlFor="cn-reason">
                Reason
              </label>
              <select
                id="cn-reason"
                className={controls.select}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              >
                {CREDIT_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              <span className={controls.hint}>
                Tax is recalculated using the invoice&apos;s GST mode and place of supply.
              </span>
            </div>

            <div className={styles.totals} aria-live="polite">
              <div className={styles.totalRow}>
                <span>Taxable value</span>
                <span>{fmt(rec?.taxable_value ?? 0)}</span>
              </div>
              {rec && rec.cgst_amount > 0 && (
                <>
                  <div className={styles.totalRow}>
                    <span>CGST</span>
                    <span>{fmt(rec.cgst_amount)}</span>
                  </div>
                  <div className={styles.totalRow}>
                    <span>SGST</span>
                    <span>{fmt(rec.sgst_amount)}</span>
                  </div>
                </>
              )}
              {rec && rec.igst_amount > 0 && (
                <div className={styles.totalRow}>
                  <span>IGST</span>
                  <span>{fmt(rec.igst_amount)}</span>
                </div>
              )}
              {rec && rec.round_off !== 0 && (
                <div className={styles.totalRow}>
                  <span>Round off</span>
                  <span>{fmt(rec.round_off)}</span>
                </div>
              )}
              <div className={styles.totalRowStrong}>
                <span>Credit total</span>
                <span>{fmt(rec?.total ?? 0)}</span>
              </div>
              <div className={styles.totalRow}>
                <span>Invoice total</span>
                <span>{fmt(round2(num(invoice.total)))}</span>
              </div>
            </div>
          </>
        )}

        {showErrors && (
          <ul className={styles.errors} role="alert">
            {preview.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
        {submitError && (
          <p className={styles.errors} role="alert">
            {submitError}
          </p>
        )}
      </div>
    </Modal>
  );
}
