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
import { reasonReturnsGoods } from '../../lib/credit-restock';
import type { InvoiceRecord } from '../../types/invoice';
import { useT } from '../../i18n';
import { salesT } from '../../i18n/areas/sales';
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
  useT(); // re-render on a language switch (5.4)
  const [links] = useState(() => readLinks());
  const [all] = useState(() => localDb.invoices.getAll());
  const [qty, setQty] = useState<Record<string, string>>({});
  const [reason, setReason] = useState<string>(CREDIT_REASONS[0]);
  // null = follow the reason (on only for a sales return); a tick / untick by the user wins.
  const [restockChoice, setRestockChoice] = useState<boolean | null>(null);
  const goodsReturned = restockChoice ?? reasonReturnsGoods(reason);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const lines = useMemo(() => creditableLines(invoice, links, all), [invoice, links, all]);

  const preview = useMemo(
    () =>
      buildCreditNote(
        invoice,
        {
          reason,
          goodsReturned,
          lines: lines.map((l) => ({ itemId: l.item.id, quantity: num(qty[l.item.id]) })),
        },
        links,
        all,
        { id: 'preview', invoice_number: 'preview', today: invoice.issue_date },
      ),
    [invoice, reason, goodsReturned, lines, qty, links, all],
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
        goodsReturned,
        lines: lines.map((l) => ({ itemId: l.item.id, quantity: num(qty[l.item.id]) })),
      });
      onCreated(saved);
      onClose();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : salesT('cr.saveFailed'));
    }
  };

  const showErrors = (touched || anyEntered) && preview.errors.length > 0;

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={salesT('cr.title')}
      subtitle={salesT('cr.against', { number: invoice.invoice_number, client: invoice.client?.name ?? '' })}
      footer={
        <>
          <button type="button" className={controls.btnOutline} onClick={onClose}>
            {salesT('cancel')}
          </button>
          <button
            type="button"
            className={controls.btnPrimary}
            onClick={submit}
            disabled={!rec || nothingLeft}
          >
            {salesT('cr.title')}
          </button>
        </>
      }
    >
      <div className={styles.stack}>
        {nothingLeft ? (
          <p className={styles.empty}>{salesT('cr.allCredited')}</p>
        ) : (
          <>
            <div className={styles.tableScroll}>
              <table className={styles.table}>
                <caption className={styles.srOnly}>{salesT('cr.caption')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{salesT('item')}</th>
                    <th scope="col" className={styles.num}>{salesT('rate')}</th>
                    <th scope="col" className={styles.num}>{salesT('cr.invoiced')}</th>
                    <th scope="col" className={styles.num}>{salesT('cr.credited')}</th>
                    <th scope="col" className={styles.num}>{salesT('cr.creditQty')}</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => {
                    const id = `cn-qty-${l.item.id}`;
                    return (
                      <tr key={l.item.id}>
                        <td>
                          <span className={styles.itemName}>{l.item.name || salesT('item')}</span>
                          <span className={styles.itemMeta}>
                            {l.item.hsn ? `HSN/SAC ${l.item.hsn} · ` : ''}
                            GST {num(l.item.tax_rate)}%
                          </span>
                        </td>
                        <td className={styles.num} data-label={salesT('rate')}>{fmt(num(l.item.rate))}</td>
                        <td className={styles.num} data-label={salesT('cr.invoiced')}>
                          {l.originalQty} {l.item.unit ?? ''}
                        </td>
                        <td className={styles.num} data-label={salesT('cr.credited')}>{l.creditedQty}</td>
                        <td className={`${styles.num} ${styles.qtyCell}`} data-label={salesT('cr.creditQty')}>
                          <label htmlFor={id} className={styles.srOnly}>
                            {salesT('cr.qtyFor', { name: l.item.name || salesT('cr.itemLower') })}
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
                              {salesT('cr.max', { n: l.remainingQty })}
                            </button>
                          ) : (
                            <span className={styles.itemMeta}>{salesT('cr.fully')}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <p className={controls.hint}>
              {salesT('cr.linesOnly')}
            </p>

            <div className={controls.field}>
              <label className={controls.label} htmlFor="cn-reason">
                {salesT('reason')}
              </label>
              <select
                id="cn-reason"
                className={controls.select}
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  setRestockChoice(null);
                }}
              >
                {CREDIT_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {salesT(`reason.${r}`)}
                  </option>
                ))}
              </select>
              <span className={controls.hint}>
                {salesT('cr.taxHint')}
              </span>
            </div>

            <label className={controls.check}>
              <input type="checkbox" checked={goodsReturned} onChange={(e) => setRestockChoice(e.target.checked)} />
              {salesT('cr.restock')}
            </label>
            <p className={controls.hint}>
              {salesT('cr.restockHint')}
            </p>

            <div className={styles.totals} aria-live="polite">
              <div className={styles.totalRow}>
                <span>{salesT('cr.taxable')}</span>
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
                  <span>{salesT('cr.roundOff')}</span>
                  <span>{fmt(rec.round_off)}</span>
                </div>
              )}
              <div className={styles.totalRowStrong}>
                <span>{salesT('cr.creditTotal')}</span>
                <span>{fmt(rec?.total ?? 0)}</span>
              </div>
              <div className={styles.totalRow}>
                <span>{salesT('cr.invoiceTotal')}</span>
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
