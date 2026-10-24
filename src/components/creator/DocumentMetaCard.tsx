import { useDeferredValue, useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
import { pick } from '../../store/pick';
import { useShallow } from 'zustand/react/shallow';
import { useInvoiceStore } from '../../store/useInvoiceStore';
import { ForexFields } from './ForexFields';
import { localDb } from '../../lib/localDb';
import { STATUS_OPTIONS } from '../../lib/invoice-status';
import { addDaysInput, CURRENCIES, cn } from '../../lib/utils';
import { DOCUMENT_LABELS, type DocumentType, type InvoiceStatus } from '../../types/invoice';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from '../../pages/InvoiceCreator.module.css';

const DOC_TYPES = Object.keys(DOCUMENT_LABELS) as DocumentType[];
const DUE_PRESETS = [0, 7, 15, 30, 45];

interface Props {
  editing: boolean;
  /** Bumps after each save so the number checks re-read storage. */
  saveTick: number;
}

/** "1 · Document": type, number (with the GST Rule 46 uniqueness/gap check), dates, currency, status. */
export function DocumentMetaCard({ editing, saveTick }: Props) {
  const s = useInvoiceStore(
    useShallow((st) => pick(st, ['currency', 'doc_type', 'due_date', 'id', 'invoice_number', 'issue_date', 'patch', 'po_number', 'reverse_charge', 'sender', 'setCurrency', 'setDates', 'setDocType', 'setInvoiceNumber', 'setReverseCharge', 'setStatus', 'status'])),
  );

  const nextNumber = useMemo(
    () => (s.invoice_number ? '' : localDb.invoices.nextNumber(s.issue_date, s.doc_type, s.sender?.invoicePrefix || undefined)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s.invoice_number, s.issue_date, s.doc_type, s.sender?.invoicePrefix, s.id],
  );

  // GST Rule 46: live uniqueness check of a hand-typed number (deferred so typing stays snappy).
  const typedNumber = useDeferredValue(s.invoice_number);
  const numberCheck = useMemo(
    () => (typedNumber.trim() ? localDb.invoices.checkNumber(typedNumber, s.id || undefined) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [typedNumber, s.id, saveTick],
  );
  const numberTaken = numberCheck && !numberCheck.ok ? numberCheck.clash : undefined;

  return (
    <section className={surface.card}>
      <div className={surface.cardHead}>1 · Document</div>
      <div className={surface.cardBody}>
        <div className={controls.row3}>
          <label className={controls.field}>
            <span className={controls.label}>Type</span>
            <select className={controls.select} value={s.doc_type} onChange={(e) => s.setDocType(e.target.value as DocumentType)} disabled={editing && Boolean(s.invoice_number)}>
              {DOC_TYPES.map((t) => (
                <option key={t} value={t}>
                  {DOCUMENT_LABELS[t]}
                </option>
              ))}
            </select>
          </label>
          <label className={controls.field}>
            <span className={controls.label}>Number</span>
            <input
              className={`${controls.input} ${controls.inputMono}`}
              style={{ textTransform: 'none' }}
              value={s.invoice_number}
              onChange={(e) => s.setInvoiceNumber(e.target.value)}
              placeholder={nextNumber || 'Auto'}
              aria-invalid={numberTaken ? true : undefined}
              aria-describedby="number-hint"
            />
            <span id="number-hint" aria-live="polite">
              {numberTaken ? (
                <span className={cn(styles.numberHint, styles.numberBad)}>
                  <AlertTriangle size={13} aria-hidden="true" />
                  <span>
                    Already used by {numberTaken.invoice_number}
                    {numberTaken.client?.name ? ` (${numberTaken.client.name})` : ''}. Every document needs its own number (GST Rule 46).
                  </span>
                </span>
              ) : numberCheck?.gap ? (
                <span className={cn(styles.numberHint, styles.numberGap)}>
                  <AlertTriangle size={13} aria-hidden="true" />
                  <span>
                    This skips {numberCheck.gap.missingNumbers.slice(0, 3).join(', ')}
                    {numberCheck.gap.missingCount > 3 ? ` and ${numberCheck.gap.missingCount - 3} more` : ''}. Allowed, but a gap in the series may need explaining at filing.
                  </span>
                </span>
              ) : !editing ? (
                <span className={controls.hint}>Leave blank to number automatically.</span>
              ) : null}
            </span>
          </label>
          <label className={controls.field}>
            <span className={controls.label}>PO / reference no.</span>
            <input className={controls.input} value={s.po_number ?? ''} onChange={(e) => s.patch({ po_number: e.target.value })} placeholder="Optional" />
          </label>
        </div>
        <div className={controls.row3}>
          <label className={controls.field}>
            <span className={controls.label}>Issue date</span>
            <input className={controls.input} type="date" value={s.issue_date} onChange={(e) => s.setDates(e.target.value, s.due_date)} />
          </label>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="due-date">Due date</label>
            <input id="due-date" className={controls.input} type="date" value={s.due_date} min={s.issue_date} onChange={(e) => s.setDates(s.issue_date, e.target.value)} />
            <div className={styles.chips}>
              {DUE_PRESETS.map((d) => (
                <button key={d} type="button" aria-label={d === 0 ? 'Due on receipt' : `Due in ${d} days`} className={styles.chip} onClick={() => s.setDates(s.issue_date, addDaysInput(d, s.issue_date))}>
                  {d === 0 ? 'Now' : `${d}d`}
                </button>
              ))}
            </div>
          </div>
          <div className={styles.pair}>
            <label className={controls.field}>
              <span className={controls.label}>Currency</span>
              <select className={controls.select} value={s.currency} onChange={(e) => s.setCurrency(e.target.value)}>
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.symbol} {c.code}
                  </option>
                ))}
              </select>
            </label>
            <label className={controls.field}>
              <span className={controls.label}>Status</span>
              <select className={controls.select} value={s.status === 'Overdue' ? 'Sent' : s.status} onChange={(e) => s.setStatus(e.target.value as InvoiceStatus)}>
                {STATUS_OPTIONS.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            </label>
          </div>
        </div>
        <label className={controls.check}>
          <input type="checkbox" checked={s.reverse_charge} onChange={(e) => s.setReverseCharge(e.target.checked)} />
          Tax is payable on reverse charge
        </label>
        <ForexFields />
      </div>
    </section>
  );
}
