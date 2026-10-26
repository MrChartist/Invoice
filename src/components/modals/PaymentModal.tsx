import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Heart, Lock, Receipt, Trash2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { round2 } from '../../lib/invoice-calc';
import { localDb } from '../../lib/localDb';
import { can } from '../../lib/access';
import { getLockUntil, isLocked, prettyDay } from '../../lib/period-lock';
import { getTable } from '../../lib/storage';
import { amountDue, linkedCredits, type CreditLinkRow } from '../../lib/amount-due';
import { useInvoiceStore } from '../../store/useInvoiceStore';
import { formatCurrency, formatDate, todayInput } from '../../lib/utils';
import { buildReceipt, receiptHtml, referenceLabel } from '../../lib/receipts';
import { downloadText } from '../../lib/download';
import { ReminderModal } from '../share/ReminderModal';
import type { InvoiceRecord, Payment } from '../../types/invoice';
import type { SettleValue } from '../collections/SettleRestFields';
import { realisedFx } from '../../lib/fx-gain';
import { fxRate, isForeignCurrency } from '../../lib/fx';
import { BankAccountSelect } from '../bank/BankAccountSelect';
import { tNodes, useT } from '../../i18n';
import '../../i18n/en-pages'; // page strings (5.4)
import { methodLabel } from '../../i18n/labels';
import controls from '../../styles/controls.module.css';
import styles from './PaymentModal.module.css';

const METHODS = ['UPI', 'Bank transfer', 'Cash', 'Cheque', 'Card', 'Other'];

// "Apply advance" (5.3) and the advances maths load only when this dialog opens.
const ApplyAdvancePanel = lazy(() => import('../advances/ApplyAdvancePanel'));
// R2-A2 / A3: "Settle the rest" and the bad-debt recovery offer load only when they apply.
const SettleRestFields = lazy(() => import('../collections/SettleRestFields'));
const RecoveryOffer = lazy(() => import('../collections/RecoveryOffer'));

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
  const { t } = useT();
  const [version, setVersion] = useState(0);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState(METHODS[0]);
  const [bankAccountId, setBankAccountId] = useState('');
  const [date, setDate] = useState(todayInput());
  const [reference, setReference] = useState('');
  /** Realised rate (₹ per unit) on a foreign-currency receipt (6.19). */
  const [realised, setRealised] = useState('');
  const [error, setError] = useState('');
  /** Set right after a payment clears the balance: offer the receipt and a thank-you. */
  const [settled, setSettled] = useState<Payment | null>(null);
  const [thanksOpen, setThanksOpen] = useState(false);
  /** R2-A2: settle what this receipt leaves open with a financial credit note. */
  const [settle, setSettle] = useState<SettleValue>({ choice: 'leave', amount: '', gst: false });

  // Always read the live row — a payment changes the balance under us.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const live = useMemo(() => (invoice ? localDb.invoices.getById(invoice.id) ?? invoice : null), [invoice, version]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const payments = useMemo(() => (invoice ? localDb.payments.listFor(invoice.id) : []), [invoice, version]);
  // What is really still owed: the stored balance (already net of TDS, and of the recipient's GST on
  // reverse charge) less the live credit notes issued against it (src/lib/amount-due.ts).
  const credited = live
    ? linkedCredits(getTable<CreditLinkRow>('doc_links').filter((l) => l.from_id === live.id), localDb.invoices.getAll()).get(live.id) ?? 0
    : 0;
  const balance = live ? amountDue(live, credited) : 0;

  useEffect(() => {
    if (!invoice) return;
    setAmount(balance > 0 ? String(round2(balance)) : '');
    setMethod(METHODS[0]);
    setDate(todayInput());
    setReference('');
    setRealised('');
    setError('');
    setSettled(null);
    setSettle({ choice: 'leave', amount: '', gst: false });
    // Reset the form only when a different document is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice?.id]);

  if (!invoice || !live) return null;
  // Period lock: a frozen document takes no new payments and loses none.
  const locked = isLocked(live);
  const foreign = isForeignCurrency(live) && fxRate(live) !== null;
  const preview = foreign ? realisedFx({ amount: Number(amount) || 0, realised_rate: Number(realised) || undefined }, live) : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (locked) return setError(t('pay.errLocked'));
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) return setError(t('pay.errAmount'));
    if (value > balance + 0.005) return setError(t('pay.errMore', { amount: formatCurrency(balance, live.currency) }));
    try {
      const rate = Number(realised);
      if (realised.trim() && !(rate > 0)) return setError(t('pay.errRate'));
      const base = { invoiceId: live.id, amount: value, method, reference: reference.trim() || undefined, date, realisedRate: foreign && rate > 0 ? rate : undefined, bankAccountId: bankAccountId || undefined };
      const settleAmount = settle.choice !== 'leave' && value < balance - 0.005 ? round2(Math.min(Number(settle.amount) || 0, balance - value)) : 0;
      let payment: Payment;
      let note = '';
      if (settleAmount > 0 && settle.choice !== 'leave') {
        // R2-A2: receipt + financial credit note in one all-or-nothing step.
        const m = await import('../collections/settle-actions');
        const r = m.receiveAndSettle({ ...base, settle: { reason: settle.choice, amount: settleAmount, gst: settle.gst } }, live.currency);
        payment = r.payment;
        note = r.message;
      } else {
        payment = localDb.payments.record(base);
      }
      setVersion((v) => v + 1);
      refreshEditor(live.id);
      setError('');
      setSettle({ choice: 'leave', amount: '', gst: false });
      const cleared = value + settleAmount >= balance - 0.005;
      const msg = cleared ? t('pay.markedPaid', { number: live.invoice_number }) : t('pay.recorded', { amount: formatCurrency(value, live.currency) });
      onChanged(note ? `${msg} ${note}` : msg);
      if (cleared) setSettled(payment);
      else setAmount(String(Math.max(round2(balance - value - settleAmount), 0)));
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
    onChanged(t('pay.removed'));
    // R2-A2 (8): removing a receipt never cancels its settlement note by itself — offer it.
    if (live && localDb.invoices.getAll().some((i) => i.note_kind === 'financial' && i.po_number === live.invoice_number && i.status !== 'Cancelled')) {
      void import('../collections/settle-actions').then((m) => {
        try {
          const done = m.offerCancelSettlement(live.id);
          if (done.length) {
            setVersion((v) => v + 1);
            refreshEditor(live.id);
            onChanged(done.join(' '));
          }
        } catch (err) {
          setError((err as Error).message);
        }
      });
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title={t('pay.title')}
      subtitle={`${live.invoice_number} · ${live.client?.name ?? ''}`}
      footer={
        <>
          <button type="button" className={controls.btnOutline} onClick={onClose}>
            {t('common.close')}
          </button>
          <button type="submit" form="payment-form" className={controls.btnPrimary} disabled={balance <= 0 || locked}>
            {t('pay.submit')}
          </button>
        </>
      }
    >
      <dl className={styles.summary}>
        <div>
          <dt>{t('pay.total')}</dt>
          <dd>{formatCurrency(live.total, live.currency)}</dd>
        </div>
        <div>
          <dt>{t('pay.received')}</dt>
          <dd className={styles.good}>{formatCurrency(live.amount_paid ?? 0, live.currency)}</dd>
        </div>
        <div>
          <dt>{t('pay.balance')}</dt>
          <dd className={balance > 0 ? styles.due : styles.good}>{formatCurrency(balance, live.currency)}</dd>
        </div>
      </dl>

      {locked && (
        <div className={styles.lockBanner} role="alert">
          <Lock size={18} aria-hidden="true" />
          <div className={styles.lockText}>
            <strong>{t('pay.lockedTitle')}</strong>
            <span>
              {tNodes('pay.lockedText', { until: prettyDay(getLockUntil()), date: prettyDay(live.issue_date) })}{' '}
              <Link to={`/invoice/${live.id}`} onClick={onClose}>
                {t('pay.openToUnlock')}
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
              <span className={controls.label}>{t('pay.amount')}</span>
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
              <span className={controls.label}>{t('pay.dateReceived')}</span>
              <input className={controls.input} type="date" value={date} max={todayInput()} onChange={(e) => setDate(e.target.value)} />
            </label>
          </div>
          <div className={controls.row}>
            <label className={controls.field}>
              <span className={controls.label}>{t('pay.method')}</span>
              <select className={controls.select} value={method} onChange={(e) => setMethod(e.target.value)}>
                {METHODS.map((m) => (
                  <option key={m} value={m}>{methodLabel(m)}</option>
                ))}
              </select>
            </label>
            <label className={controls.field}>
              <span className={controls.label}>{t('pay.referenceOptional', { label: referenceLabel(method) })}</span>
              <input className={controls.input} value={reference} onChange={(e) => setReference(e.target.value.trimStart())} placeholder={method === 'Cash' ? t('pay.refPhCash') : t('pay.refPh')} />
            </label>
          </div>
          <BankAccountSelect id="pay-bank-account" label={t('pay.receivedInto')} method={method} value={bankAccountId} onChange={setBankAccountId} />
          {foreign && (
            <label className={controls.field}>
              <span className={controls.label}>{t('pay.rateRealised', { currency: live.currency })}</span>
              <input
                className={controls.inputNumeric + ' ' + controls.input}
                type="number"
                min="0"
                step="0.0001"
                inputMode="decimal"
                value={realised}
                onChange={(e) => setRealised(e.target.value)}
                placeholder={t('pay.invoiceRate', { rate: String(fxRate(live)) })}
              />
              <span className={controls.hint}>
                {preview
                  ? t(preview.gain >= 0 ? 'pay.fxGain' : 'pay.fxLoss', {
                      amount: Math.abs(preview.gain).toFixed(2),
                      realised: preview.realisedInr.toFixed(2),
                      book: preview.bookInr.toFixed(2),
                    })
                  : t('pay.fxHint')}
              </span>
            </label>
          )}
          {can('payment.record') && Number(amount) > 0 && Number(amount) < balance - 0.005 && (
            <Suspense fallback={null}>
              <SettleRestFields invoice={live} due={balance} amount={Number(amount)} date={date} value={settle} onChange={setSettle} />
            </Suspense>
          )}
          {error && <p className={controls.error} role="alert">{error}</p>}
        </form>
      ) : locked ? null : settled ? (
        <div className={styles.paidPanel} role="status">
          <strong>{t('pay.paidFull')}</strong>
          <span>{t('pay.settled', { number: live.invoice_number })}</span>
          <div className={styles.paidActions}>
            <button type="button" className={controls.btnPrimary} onClick={() => openReceipt(live, settled)}>
              <Receipt size={16} /> {t('pay.receipt')}
            </button>
            <button type="button" className={controls.btnOutline} onClick={() => setThanksOpen(true)}>
              <Heart size={16} /> {t('pay.thanks')}
            </button>
          </div>
        </div>
      ) : (
        <p className={controls.ok}>{t('pay.fullyPaid')}</p>
      )}
      {thanksOpen && <ReminderModal invoice={live} open onClose={() => setThanksOpen(false)} />}
      {/* R2-A3: money received on a written-off bill is recorded as a bad debt recovery (owner). */}
      {balance <= 0 && !locked && payments.some((p) => p.write_off) && can('doc.deleteIssued') && (
        <Suspense fallback={null}>
          <RecoveryOffer invoice={live} onDone={(message) => { setVersion((v) => v + 1); refreshEditor(live.id); onChanged(message); }} />
        </Suspense>
      )}

      {balance > 0 && !locked && can('payment.record') && (live.currency || 'INR').toUpperCase() === 'INR' && (
        <Suspense fallback={null}>
          <ApplyAdvancePanel
            invoice={live}
            version={version}
            onApplied={(message) => {
              setVersion((v) => v + 1);
              refreshEditor(live.id);
              setError('');
              onChanged(message);
            }}
          />
        </Suspense>
      )}

      {payments.length > 0 && (
        <div>
          <div className={styles.historyLabel}>{t('pay.history')}</div>
          <ul className={styles.history}>
            {payments.map((p) => (
              <li key={p.id}>
                <div>
                  <strong>{formatCurrency(p.amount, live.currency)}</strong>
                  <span>
                    {p.advance_id ? t('pay.advanceAdjusted', { ref: p.reference ?? '' }) : methodLabel(p.method)} · {formatDate(p.date)}
                    {p.reference && !p.advance_id ? ` · ${p.reference}` : ''}
                    {p.realised_rate ? ` · ${t('pay.realisedAt', { rate: p.realised_rate })}` : ''}
                  </span>
                </div>
                {!p.advance_id && (
                  <button type="button" className={controls.btnIcon} onClick={() => openReceipt(live, p)} aria-label={t('pay.receiptFor', { amount: formatCurrency(p.amount, live.currency) })} title={t('pay.printReceipt')}>
                    <Receipt size={15} />
                  </button>
                )}
                <button type="button" className={controls.btnDanger} disabled={locked} onClick={() => removePayment(p.id)} aria-label={t('pay.removeFor', { amount: formatCurrency(p.amount, live.currency) })}>
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
