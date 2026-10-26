/**
 * R5-B5: the payment dialog's RA block (loaded lazily, only for a bill with `ra_deductions` and the works pack on):
 * shows the deductions and net payable, pre-fills cash = what is due now, and records the deduction rows by kind.
 */
import { useEffect, useMemo } from 'react';
import { twT } from '../../i18n/areas/packs-transport-works-r5';
import type { InvoiceRecord, Payment } from '../../types/invoice';
import { isPackOn } from '../../lib/industry-packs';
import { localDb } from '../../lib/localDb';
import { peekTable } from '../../lib/storage';
import { amountDue } from '../../lib/amount-due';
import { receiptPlan, recordDeductionRow, recoverAdvance } from '../../lib/works/ra-receivable';
import { B, errText, fmtMoney, today } from '../transport/shared';
import styles from '../transport/transport.module.css';
import own from './works.module.css';

export default function RaReceiptPanel({ invoice, version, onPrefill, onDone, onError }: { invoice: InvoiceRecord; version: number; onPrefill: (amount: number) => void; onDone: (msg: string) => void; onError: (msg: string) => void }) {
  const on = isPackOn(localDb.settings.get(), 'works');
  // `version` moves after every payment change, so the plan re-reads the receipts.
  const plan = useMemo(() => receiptPlan(invoice, peekTable<Payment>('transactions'), amountDue(invoice, 0)), [invoice, version]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (on) onPrefill(plan.cash);
    // Pre-fill once per change of the plan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, plan.cash]);
  if (!on) return null;
  const run = (fn: () => unknown) => {
    try {
      fn();
      onDone(twT('saved'));
    } catch (e) {
      onError(errText(e));
    }
  };
  return (
    <div className={styles.box} data-ra-receipt>
      <div className={own.sum}>
        {(invoice.ra_deductions ?? []).map((d) => <span key={d.kind + d.label}>{twT('less')} {d.label}: {fmtMoney(d.amount)}</span>)}
        <strong>{twT('netPayable')}: {fmtMoney(invoice.ra_net_payable ?? invoice.total)}</strong>
      </div>
      {plan.rows.map((r) => (
        <div key={r.kind} className={styles.toolbar}>
          <span>{r.label}: {fmtMoney(r.amount)}</span>
          <button type="button" className={B.gs} onClick={() => run(() => (r.kind === 'advance_recovery' ? recoverAdvance(invoice.id, { date: today() }) : recordDeductionRow(invoice.id, r.kind as 'gst_tds' | 'labour_cess', { date: today() })))}>{r.kind === 'advance_recovery' ? twT('recoverAdvance') : twT('recordDeducted')}</button>
        </div>
      ))}
      {plan.held.length > 0 && <p className={styles.note}>{twT('heldNote', { list: plan.held.map((h) => `${h.label} ${fmtMoney(h.amount)}`).join(', ') })}</p>}
    </div>
  );
}
