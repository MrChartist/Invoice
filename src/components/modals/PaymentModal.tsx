import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Heart, Lock, Receipt, Trash2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { round2 } from '../../lib/invoice-calc';
import { localDb } from '../../lib/localDb';
import { getLockUntil, isLocked, prettyDay } from '../../lib/period-lock';
import { readLinks, totalCredited } from '../../lib/documents';
import { useInvoiceStore } from '../../store/useInvoiceStore';
import { formatCurrency, formatDate, todayInput } from '../../lib/utils';
import { buildReceipt, receiptHtml, referenceLabel } from '../../lib/receipts';
import { downloadText } from '../../lib/download';
import { ReminderModal } from '../share/ReminderModal';
import type { InvoiceRecord, Payment } from '../../types/invoice';
import { realisedFx } from '../../lib/fx-gain';
import { fxRate, isForeignCurrency } from '../../lib/fx';
import controls from '../../styles/controls.module.css';
import styles from './PaymentModal.module.css';

const METHODS = ['UPI', 'Bank transfer', 'Cash', 'Cheque', 'Card', 'Other'];

export interface PaymentModalProps {
  invoice: InvoiceRecord | null;
  onClose: () => void;
  /** Called after any change so the caller can refresh its list. */
  onChanged: (message?: string) => void;
}

/**
 * Open a printable receipt in its own window (script-free HTML, so the CSP allows it).
 * A blocked pop-up falls back to saving the receipt as an HTML file.
 */
function openReceipt(invoice: InvoiceRecord, payment: Payment) {
  const data = buildReceipt(invoice, payment, localDb.payments.getAll());
  const html = receiptHtml(data);
  const w = window.open('', '_blank');
  if (w) {
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
    w.print();
  } else {
    downloadText(`${data.number.replace(/\//g, '-')}.html`, html, 'text/html');
  }
}

/** If the invoice is open in the editor, reload it so the screen shows the new paid amount. */
function refreshEditor(id: string) {
  const store = useInvoiceStore.getState();
  if (store.id === id) store.loadInvoice(id);
}

export function PaymentModal({ invoice, onClose, onChanged }: PaymentModalProps) {
  const [version, setVersion] = useState(0);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState(METHODS[0]);
  const [date, setDate] = useState(todayInput());
  const [reference, setReference] = useState('');
  /** Realised rate (₹ per unit) on a foreign-currency receipt (6.19). */
  const [realised, setRealised] = useState('');
  const [error, setError] = useState('');
  /** Set right after a payment clears the balance: offer the receipt and a thank-you. */
  const [settled, setSettled] = useState<Payment | null>(null);
  const [thanksOpen, setThanksOpen] = useState(false);

  // Always read the live row — a payment changes the balance under us.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const live = useMemo(() => (invoice ? localDb.invoices.getById(invoice.id) ?? invoice : null), [invoice, version]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const payments = useMemo(() => (invoice ? localDb.payments.listFor(invoice.id) : []), [invoice, version]);
  // What is really still owed: the stored balance (already net of TDS) less any credit notes issued against it.
  const credited = live ? totalCredited(live.id, readLinks(), localDb.invoices.getAll()) : 0;
  const balance = live ? Math.max(round2((live.balance_due ?? live.total - (live.amount_paid ?? 0)) - credited), 0) : 0;

  useEffect(() => {
    if (!invoice) return;
    setAmount(balance > 0 ? String(round2(balance)) : '');
    setMethod(METHODS[0]);
    setDate(todayInput());
    setReference('');
    setRealised('');
    setError('');
    setSettled(null);
    // Reset the form only when a different document is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice?.id]);

  if (!invoice || !live) return null;
  // Period lock: a frozen document takes no new payments and loses none.
  const locked = isLocked(live);
  const foreign = isForeignCurrency(live) && fxRate(live) !== null;
  const preview = foreign ? realisedFx({ amount: Number(amount) || 0, realised_rate: Number(realised) || undefined }, live) : null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (locked) return setError('This document is in a locked period.');
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) return setError('Enter an amount above zero.');
    if (value > balance + 0.005) return setError(`This is more than the balance of ${formatCurrency(balance, live.currency)}.`);
    try {
      const rate = Number(realised);
      if (realised.trim() && !(rate > 0)) return setError('Enter the realised rate in rupees, or leave it blank.');
      const payment = localDb.payments.record({ invoiceId: live.id, amount: value, method, reference: reference.trim() || undefined, date, realisedRate: foreign && rate > 0 ? rate : undefined });
      setVersion((v) => v + 1);
      refreshEditor(live.id);
      setError('');
      const cleared = value >= balance - 0.005;
      onChanged(cleared ? `${live.invoice_number} marked as paid` : `Recorded ${formatCurrency(value, live.currency)}`);
      if (cleared) setSettled(payment);
      else setAmount(String(Math.max(round2(balance - value), 0)));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const removePayment = (id: string) => {
    try {
      localDb.payments.remove(id);
    } catch (err) {
      setError((err as Error).message);
      return;
    }
    setVersion((v) => v + 1);
    if (live) refreshEditor(live.id);
    onChanged('Payment removed');
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title="Record payment"
      subtitle={`${live.invoice_number} · ${live.client?.name ?? ''}`}
      footer={
        <>
          <button type="button" className={controls.btnOutline} onClick={onClose}>
            Close
          </button>
          <button type="submit" form="payment-form" className={controls.btnPrimary} disabled={balance <= 0 || locked}>
            Record payment
          </button>
        </>
      }
    >
      <dl className={styles.summary}>
        <div>
          <dt>Total</dt>
          <dd>{formatCurrency(live.total, live.currency)}</dd>
        </div>
        <div>
          <dt>Received</dt>
          <dd className={styles.good}>{formatCurrency(live.amount_paid ?? 0, live.currency)}</dd>
        </div>
        <div>
          <dt>Balance</dt>
          <dd className={balance > 0 ? styles.due : styles.good}>{formatCurrency(balance, live.currency)}</dd>
        </div>
      </dl>

      {locked && (
        <div className={styles.lockBanner} role="alert">
          <Lock size={18} aria-hidden="true" />
          <div className={styles.lockText}>
            <strong>Locked period</strong>
            <span>
              Books are locked up to {prettyDay(getLockUntil())} and this document is dated {prettyDay(live.issue_date)}, so payments can&apos;t be added or removed.{' '}
              <Link to={`/invoice/${live.id}`} onClick={onClose}>
                Open it to unlock with your PIN
              </Link>
              .
            </span>
          </div>
        </div>
      )}

      {balance > 0 && !locked ? (
        <form id="payment-form" onSubmit={submit} className={styles.form} noValidate>
          <div className={controls.row}>
            <label className={controls.field}>
              <span className={controls.label}>Amount</span>
              <input
                className={controls.inputNumeric + ' ' + controls.input}
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                aria-invalid={Boolean(error) || undefined}
                autoFocus
              />
            </label>
            <label className={controls.field}>
              <span className={controls.label}>Date received</span>
              <input className={controls.input} type="date" value={date} max={todayInput()} onChange={(e) => setDate(e.target.value)} />
            </label>
          </div>
          <div className={controls.row}>
            <label className={controls.field}>
              <span className={controls.label}>Method</span>
              <select className={controls.select} value={method} onChange={(e) => setMethod(e.target.value)}>
                {METHODS.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </label>
            <label className={controls.field}>
              <span className={controls.label}>{referenceLabel(method)} (optional)</span>
              <input className={controls.input} value={reference} onChange={(e) => setReference(e.target.value.trimStart())} placeholder={method === 'Cash' ? 'Receipt book no.' : 'e.g. 412345678901'} />
            </label>
          </div>
          {foreign && (
            <label className={controls.field}>
              <span className={controls.label}>Rate realised, ₹ per {live.currency} (optional)</span>
              <input
                className={controls.inputNumeric + ' ' + controls.input}
                type="number"
                min="0"
                step="0.0001"
                inputMode="decimal"
                value={realised}
                onChange={(e) => setRealised(e.target.value)}
                placeholder={`Invoice rate ${fxRate(live)}`}
              />
              <span className={controls.hint}>
                {preview
                  ? `Exchange ${preview.gain >= 0 ? 'gain' : 'loss'} of ₹${Math.abs(preview.gain).toFixed(2)} (₹${preview.realisedInr.toFixed(2)} received vs ₹${preview.bookInr.toFixed(2)} at the invoice rate) — posted to the ledger. GST keeps the invoice rate.`
                  : 'The rate your bank converted at (see the FIRC / bank advice). The difference from the invoice rate is booked as exchange gain or loss.'}
              </span>
            </label>
          )}
          {error && <p className={controls.error} role="alert">{error}</p>}
        </form>
      ) : locked ? null : settled ? (
        <div className={styles.paidPanel} role="status">
          <strong>Paid in full</strong>
          <span>{live.invoice_number} is settled. Send the client a receipt or a quick thank-you.</span>
          <div className={styles.paidActions}>
            <button type="button" className={controls.btnPrimary} onClick={() => openReceipt(live, settled)}>
              <Receipt size={16} /> Receipt
            </button>
            <button type="button" className={controls.btnOutline} onClick={() => setThanksOpen(true)}>
              <Heart size={16} /> Send thank-you
            </button>
          </div>
        </div>
      ) : (
        <p className={controls.ok}>Fully paid. Nothing is outstanding.</p>
      )}
      {thanksOpen && <ReminderModal invoice={live} open onClose={() => setThanksOpen(false)} />}

      {payments.length > 0 && (
        <div>
          <div className={styles.historyLabel}>Payment history</div>
          <ul className={styles.history}>
            {payments.map((p) => (
              <li key={p.id}>
                <div>
                  <strong>{formatCurrency(p.amount, live.currency)}</strong>
                  <span>
                    {p.method} · {formatDate(p.date)}
                    {p.reference ? ` · ${p.reference}` : ''}
                    {p.realised_rate ? ` · realised @ ₹${p.realised_rate}` : ''}
                  </span>
                </div>
                <button type="button" className={controls.btnIcon} onClick={() => openReceipt(live, p)} aria-label={`Receipt for ${formatCurrency(p.amount, live.currency)}`} title="Print receipt">
                  <Receipt size={15} />
                </button>
                <button type="button" className={controls.btnDanger} disabled={locked} onClick={() => removePayment(p.id)} aria-label={`Remove payment of ${formatCurrency(p.amount, live.currency)}`}>
                  <Trash2 size={15} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  );
}
