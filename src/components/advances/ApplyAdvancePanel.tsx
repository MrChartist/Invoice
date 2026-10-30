import { useMemo, useState } from 'react';
import { HandCoins } from 'lucide-react';
import {
  AdvanceError,
  applyAdvance,
  canApplyTo,
  invoiceOpen,
  loadAdvances,
  openAdvancesFor,
  samePartyAs,
  advanceBalance,
} from '../../lib/advances';
import { localDb } from '../../lib/localDb';
import { round2 } from '../../lib/invoice-calc';
import { formatCurrency, formatDate, todayInput } from '../../lib/utils';
import type { AdvanceRecord } from '../../types/advances';
import type { InvoiceRecord } from '../../types/invoice';
import controls from '../../styles/controls.module.css';
import { useT } from '../../i18n';
import { rcvT } from '../../i18n/areas/receivables';
import styles from './advances.module.css';
import { SelectField } from '../ui/SelectField';
import { DateField } from '../ui/DateField';

export interface ApplyAdvancePanelProps {
  /** Apply one of this invoice's client's advances to it (payment dialog)… */
  invoice?: InvoiceRecord;
  /** …or apply this advance to one of the client's invoices (advances register). */
  advance?: AdvanceRecord;
  /** Bumped by the caller after other payment changes, so the lists re-read. */
  version?: number;
  onApplied: (message: string, invoiceId: string) => void;
  /** Rendered without the outer box (inside a modal). */
  bare?: boolean;
}

/** "Apply advance": adjusts an advance against an invoice through the payments API. */
export function ApplyAdvancePanel({ invoice, advance, version = 0, onApplied, bare }: ApplyAdvancePanelProps) {
  useT(); // re-render on a language switch (5.4)
  const [tick, setTick] = useState(0);
  // Re-read on every change: the balances move under us.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const data = useMemo(() => ({ advances: loadAdvances(), payments: localDb.payments.getAll(), invoices: localDb.invoices.getAll() }), [version, tick]);

  const advanceOptions = useMemo(
    () => (invoice ? openAdvancesFor(invoice.client, data.advances, data.payments, data.invoices) : []),
    [invoice, data],
  );
  const invoiceOptions = useMemo(() => {
    if (!advance) return [];
    return data.invoices
      .filter((i) => !canApplyTo(i) && samePartyAs(advance.client, i.client) && invoiceOpen(i) > 0.004)
      .sort((a, b) => String(a.issue_date).localeCompare(String(b.issue_date)));
  }, [advance, data]);

  const [picked, setPick] = useState('');
  /** What the user typed, kept only while it belongs to the same advance × invoice pair. */
  const [typed, setTyped] = useState<{ key: string; amount?: string; date?: string }>({ key: '' });
  const [error, setError] = useState('');

  // Default the choice to the oldest advance / invoice still available.
  const valid = (id: string) => (invoice ? advanceOptions.some((o) => o.advance.id === id) : invoiceOptions.some((i) => i.id === id));
  const pick = picked && valid(picked) ? picked : (invoice ? advanceOptions[0]?.advance.id : invoiceOptions[0]?.id) ?? '';

  const chosenAdvance = advance ? data.advances.find((a) => a.id === advance.id) : advanceOptions.find((o) => o.advance.id === pick)?.advance;
  const chosenInvoice = invoice ? data.invoices.find((i) => i.id === invoice.id) : invoiceOptions.find((i) => i.id === pick);
  const open = chosenAdvance ? advanceBalance(chosenAdvance, data.payments, data.invoices).open : 0;
  const owed = chosenInvoice ? invoiceOpen(chosenInvoice) : 0;

  // Amount and date default from the pair: the most that can go across, on the later of the two dates.
  const pairKey = `${chosenAdvance?.id ?? ''}|${chosenInvoice?.id ?? ''}|${open}|${owed}`;
  const mine = typed.key === pairKey ? typed : { key: pairKey };
  const invDay = chosenInvoice?.issue_date?.slice(0, 10) ?? '';
  const advDay = chosenAdvance?.date ?? '';
  const later = invDay > advDay ? invDay : advDay;
  const amount = mine.amount ?? (chosenAdvance && chosenInvoice ? String(round2(Math.min(open, owed))) : '');
  const date = mine.date ?? (later && later <= todayInput() ? later : todayInput());
  const setAmount = (v: string) => setTyped({ ...mine, amount: v });
  const setDate = (v: string) => setTyped({ ...mine, date: v });

  const noChoices = invoice ? advanceOptions.length === 0 : invoiceOptions.length === 0;
  if (invoice && noChoices) return null;

  const submit = () => {
    if (!chosenAdvance || !chosenInvoice) return setError(invoice ? rcvT('apChooseAdv') : rcvT('apChooseInv'));
    try {
      const value = Number(amount);
      applyAdvance({ advanceId: chosenAdvance.id, invoiceId: chosenInvoice.id, amount: value, date });
      setTick((t) => t + 1);
      onApplied(rcvT('apApplied', { amount: formatCurrency(value, 'INR'), advance: chosenAdvance.number, invoice: chosenInvoice.invoice_number }), chosenInvoice.id);
    } catch (err) {
      setError(err instanceof AdvanceError ? err.message : (err as Error).message);
    }
  };

  const body = (
    <>
      {!bare && (
        <p className={styles.panelTitle}>
          <HandCoins size={16} aria-hidden="true" /> {rcvT('apTitle')}
        </p>
      )}
      {noChoices ? (
        <p className={controls.hint}>{rcvT('apNone', { client: advance?.client.name ?? '' })}</p>
      ) : (
        <>
          <label className={controls.field}>
            <span className={controls.label}>{invoice ? rcvT('apAdvance') : rcvT('apInvoice')}</span>
            <SelectField className={controls.select} value={pick} onChange={(e) => { setPick(e.target.value); setError(''); }}>
              {invoice
                ? advanceOptions.map((o) => (
                    <option key={o.advance.id} value={o.advance.id}>
                      {rcvT('apAdvOption', { number: o.advance.number, date: formatDate(o.advance.date), amount: formatCurrency(o.balance.open, 'INR') })}
                    </option>
                  ))
                : invoiceOptions.map((i) => (
                    <option key={i.id} value={i.id}>
                      {rcvT('apInvOption', { number: i.invoice_number, date: formatDate(i.issue_date), amount: formatCurrency(invoiceOpen(i), 'INR') })}
                    </option>
                  ))}
            </SelectField>
          </label>
          <div className={controls.row}>
            <label className={controls.field}>
              <span className={controls.label}>{rcvT('apAmount')}</span>
              <input className={`${controls.input} ${controls.inputNumeric}`} type="number" min="0" step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </label>
            <label className={controls.field}>
              <span className={controls.label}>{rcvT('apDate')}</span>
              <DateField className={controls.input} value={date} max={todayInput()} onChange={(e) => setDate(e.target.value)} />
            </label>
          </div>
          <span className={controls.hint}>
            {rcvT('apHint', { max: formatCurrency(Math.min(open, owed), 'INR'), open: formatCurrency(open, 'INR'), owed: formatCurrency(owed, 'INR') })}
          </span>
          {error && <p className={controls.error} role="alert">{error}</p>}
          <div>
            <button type="button" className={`${controls.btn} ${controls.btnPrimary} ${controls.btnSm}`} onClick={submit}>
              {rcvT('apTitle')}
            </button>
          </div>
        </>
      )}
    </>
  );
  return bare ? <div className={styles.form}>{body}</div> : <section className={styles.panel} aria-label={rcvT('apTitle')}>{body}</section>;
}

export default ApplyAdvancePanel;
