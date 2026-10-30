import { lazy, Suspense, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal } from '../ui/Modal';
import { can } from '../../lib/access';
import { localDb } from '../../lib/localDb';
import { savePartyReceipt } from '../../lib/bill-allocation';
import { fifoAllocate, openBillRefs, quickReceiptIssues, type QuickAllocation } from '../../lib/khata';
import { givenModeFor, recordCreditGiven } from '../../lib/khata-actions';
import type { PartyReceivable } from '../../lib/receivables';
import type { Client } from '../../types/invoice';
import { formatCurrency, todayInput } from '../../lib/utils';
import { round2 } from '../../lib/invoice-calc';
import { useT } from '../../i18n';
import { khataT } from '../../i18n/areas/khata';
import controls from '../../styles/controls.module.css';
import styles from './khata.module.css';
import type { SettleValue } from '../collections/SettleRestFields';
import { colT } from '../../i18n/areas/collections';
import { DateField } from '../ui/DateField';

// R2-A2: "Settle the rest" of a partly paid bill, loaded only when a bill is left partly open.
const SettleRestFields = lazy(() => import('../collections/SettleRestFields'));

export type QuickEntryMode = 'received' | 'given';

export interface QuickEntrySheetProps {
  mode: QuickEntryMode;
  client: Client;
  /** The party's receivables row (open bills, balance); absent for a party with no history. */
  party?: PartyReceivable;
  onClose: () => void;
  /** Called after a save with a message for the toast. */
  onSaved: (message: string) => void;
}

const METHODS = [
  { id: 'Cash', label: () => khataT('cash') },
  { id: 'UPI', label: () => khataT('upi') },
  { id: 'Bank transfer', label: () => khataT('bank') },
] as const;

const parseAmount = (v: string) => round2(Number(v.replace(/[,₹\s]/g, '')) || 0);
const signed = (n: number) => (n < -0.004 ? `${formatCurrency(-n, 'INR')} Cr` : formatCurrency(n, 'INR'));

/**
 * "₹ Received" / "₹ Given" (8.2): a two-field sheet — amount (auto-focused numeric keypad) and mode —
 * with date, reference and note. Received money is split over the open bills oldest first (editable)
 * and the rest stays on account; it saves through `savePartyReceipt` (all or nothing). Given credit
 * is a one-line bill for composition / non-GST profiles, or opens the invoice editor for a GST profile.
 */
export function QuickEntrySheet({ mode, client, party, onClose, onSaved }: QuickEntrySheetProps) {
  useT();
  const navigate = useNavigate();
  const [amountText, setAmountText] = useState('');
  const [method, setMethod] = useState<string>('Cash');
  const [reference, setReference] = useState('');
  const [date, setDate] = useState(todayInput());
  const [note, setNote] = useState('');
  const [edited, setEdited] = useState<Record<string, string> | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [settle, setSettle] = useState<SettleValue>({ choice: 'leave', amount: '', gst: false });

  const bills = useMemo(() => openBillRefs(party), [party]);
  const amount = parseAmount(amountText);
  const fifo = useMemo(() => fifoAllocate(bills, amount), [bills, amount]);
  // Edited amounts win until the total changes (then the sheet re-splits oldest first).
  const allocations: QuickAllocation[] = useMemo(() => {
    if (!edited) return fifo.allocations;
    return bills
      .map((b) => ({ bill_id: b.id, ref: b.ref, amount: parseAmount(edited[b.id] ?? '') }))
      .filter((a) => a.amount > 0);
  }, [edited, fifo, bills]);
  const allocated = round2(allocations.reduce((s, a) => s + a.amount, 0));
  // R2-A2: the bill this receipt leaves partly open (the oldest one), if it is an invoice.
  const partial = useMemo(() => {
    for (const b of bills) {
      const a = allocations.find((x) => x.bill_id === b.id)?.amount ?? 0;
      if (a > 0 && a < b.outstanding - 0.004) {
        const inv = localDb.invoices.getById(b.id);
        return inv ? { bill: b, invoice: inv, paid: a } : null;
      }
    }
    return null;
  }, [bills, allocations]);
  const onAccount = round2(Math.max(amount - allocated, 0));
  const net = party?.net ?? 0;
  const givenMode = givenModeFor(localDb.settings.activeProfile());
  const title = mode === 'received' ? khataT('receivedTitle', { name: client.name }) : khataT('givenTitle', { name: client.name });

  const allowed = mode === 'received' ? can('payment.record') : can('doc.create');

  const setAlloc = (id: string, value: string) => {
    const base: Record<string, string> = edited ?? Object.fromEntries(fifo.allocations.map((a) => [a.bill_id, String(a.amount)]));
    setEdited({ ...base, [id]: value });
  };

  const save = async () => {
    if (busy) return;
    setErrors([]);
    if (mode === 'received') {
      const issues = quickReceiptIssues(amount, allocations, bills);
      if (issues.length) return setErrors(issues);
      setBusy(true);
      try {
        const receipt = () => savePartyReceipt({
          client: { id: client.id, name: client.name },
          amount, method, reference: reference.trim() || undefined, note: note.trim() || undefined, date, allocations,
        });
        const settleAmount = partial && settle.choice !== 'leave' ? round2(Math.min(Number(settle.amount) || 0, partial.bill.outstanding - partial.paid)) : 0;
        let extra = '';
        if (partial && settleAmount > 0 && settle.choice !== 'leave') {
          const m = await import('../collections/settle-actions');
          extra = m.settleAfter(receipt, { invoiceId: partial.bill.id, reason: settle.choice, amount: settleAmount, date, gst: settle.gst }).message;
        } else {
          receipt();
        }
        const msg = khataT('savedReceived', { amount: formatCurrency(amount, 'INR'), name: client.name });
        onSaved(extra ? `${msg} ${extra}` : msg);
        onClose();
      } catch (err) {
        setErrors([(err as Error).message || khataT('couldNotSave')]);
      } finally {
        setBusy(false);
      }
      return;
    }
    if (!(amount > 0)) return setErrors([khataT('amount')]);
    setBusy(true);
    try {
      const saved = recordCreditGiven({ client, amount, note, date });
      onSaved(khataT('savedGiven', { amount: formatCurrency(amount, 'INR'), name: client.name, number: saved.invoice_number }));
      onClose();
    } catch (err) {
      setErrors([(err as Error).message || khataT('couldNotSave')]);
    } finally {
      setBusy(false);
    }
  };

  const gstEditor = mode === 'given' && givenMode === 'editor';
  const footer = (
    <>
      <button type="button" className={`${controls.btn} ${controls.btnGhost}`} onClick={onClose}>{khataT('cancel')}</button>
      {gstEditor ? (
        <button type="button" className={`${controls.btn} ${controls.btnPrimary}`} disabled={!allowed}
          onClick={() => { onClose(); navigate(client.id ? `/invoice?party=${encodeURIComponent(client.id)}` : '/invoice'); }}>
          {khataT('openEditor')}
        </button>
      ) : (
        <button type="button" className={`${controls.btn} ${controls.btnPrimary}`} onClick={() => void save()} disabled={busy || !allowed || !(amount > 0)}>
          {khataT('save')}
        </button>
      )}
    </>
  );

  return (
    <Modal open onClose={onClose} title={title} size="sm" footer={footer}>
      <form className={styles.sheet} onSubmit={(e) => { e.preventDefault(); if (!gstEditor) void save(); }}>
        {!allowed && <p className={controls.error} role="alert">{mode === 'received' ? khataT('noAccess') : khataT('noCreateAccess')}</p>}
        {gstEditor ? (
          <p className={styles.notice}>{khataT('givenGst', { name: client.name })}</p>
        ) : (
          <>
            <label className={controls.field}>
              <span className={controls.label}>{khataT('amount')}</span>
              <input
                className={`${controls.input} ${styles.amountInput}`}
                inputMode="decimal"
                autoComplete="off"
                data-autofocus
                value={amountText}
                onChange={(e) => { setAmountText(e.target.value); setEdited(null); }}
                aria-label={khataT('amount')}
              />
            </label>
            <div className={styles.balances}>
              <span>{khataT('balanceNow')} <strong>{signed(net)}</strong></span>
              {amount > 0 && (
                <span>{khataT('balanceAfter')} <strong data-balance-after>{signed(round2(net + (mode === 'received' ? -amount : amount)))}</strong></span>
              )}
            </div>
            {mode === 'received' && (
              <div className={controls.field}>
                <span className={controls.label}>{khataT('mode')}</span>
                <div className={controls.segment} role="radiogroup" aria-label={khataT('mode')}>
                  {METHODS.map((m) => (
                    <button key={m.id} type="button" role="radio" aria-checked={method === m.id}
                      className={method === m.id ? controls.segmentBtnActive : controls.segmentBtn} onClick={() => setMethod(m.id)}>
                      {m.label()}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className={styles.grid2}>
              <label className={controls.field}>
                <span className={controls.label}>{khataT('date')}</span>
                <DateField className={controls.input} value={date} onChange={(e) => setDate(e.target.value)} />
              </label>
              {mode === 'received' && method !== 'Cash' ? (
                <label className={controls.field}>
                  <span className={controls.label}>{khataT('reference')}</span>
                  <input className={controls.input} value={reference} onChange={(e) => setReference(e.target.value)} />
                </label>
              ) : (
                <label className={controls.field}>
                  <span className={controls.label}>{mode === 'given' ? khataT('itemNote') : khataT('note')}</span>
                  <input className={controls.input} value={note} onChange={(e) => setNote(e.target.value)} maxLength={120} />
                </label>
              )}
            </div>
            {mode === 'received' && method !== 'Cash' && (
              <label className={controls.field}>
                <span className={controls.label}>{khataT('note')}</span>
                <input className={controls.input} value={note} onChange={(e) => setNote(e.target.value)} maxLength={120} />
              </label>
            )}
            {mode === 'given' && (
              <p className={controls.hint}>{givenMode === 'bos' ? khataT('givenBos') : khataT('givenPlain')}</p>
            )}
            {mode === 'received' && amount > 0 && (
              <div className={styles.alloc}>
                {bills.length ? (
                  <>
                    <span className={styles.allocHead}>{khataT('allocTitle')}</span>
                    {bills.map((b) => {
                      const a = allocations.find((x) => x.bill_id === b.id);
                      const value = edited ? edited[b.id] ?? '' : a ? String(a.amount) : '';
                      return (
                        <label key={b.id} className={styles.allocRow}>
                          <span className={styles.allocRef}>{b.ref}<span className={styles.allocSub}>{khataT('dueOf', { amount: formatCurrency(b.outstanding, 'INR') })}</span></span>
                          <input className={`${controls.input} ${styles.allocInput}`} inputMode="decimal" value={value}
                            aria-label={khataT('billAmount', { ref: b.ref })} onChange={(e) => setAlloc(b.id, e.target.value)} />
                        </label>
                      );
                    })}
                    <span className={controls.hint}>{khataT('allocHint')}</span>
                  </>
                ) : (
                  <span className={styles.onAccount}>{khataT('noBills')}</span>
                )}
                {onAccount > 0 && bills.length > 0 && <span className={styles.onAccount}>{khataT('onAccount', { amount: formatCurrency(onAccount, 'INR') })}</span>}
              </div>
            )}
            {mode === 'received' && partial && can('payment.record') && (
              <Suspense fallback={null}>
                <SettleRestFields invoice={partial.invoice} due={partial.bill.outstanding} amount={partial.paid} date={date} value={settle} onChange={setSettle}
                  caption={colT('settleBill', { number: partial.bill.ref })} />
              </Suspense>
            )}
          </>
        )}
        {errors.length > 0 && (
          <div className={controls.error} role="alert">{errors.map((e) => <div key={e}>{e}</div>)}</div>
        )}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

export default QuickEntrySheet;
