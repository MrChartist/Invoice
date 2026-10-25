import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { HandCoins } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useInvoiceStore } from '../../store/useInvoiceStore';
import { pick } from '../../store/pick';
import { applyAdvance, canApplyTo, invoiceOpen, loadAdvances, openAdvancesFor } from '../../lib/advances';
import { localDb } from '../../lib/localDb';
import { can } from '../../lib/access';
import { round2 } from '../../lib/invoice-calc';
import { formatCurrency } from '../../lib/utils';
import styles from './StockWarnings.module.css';

/**
 * Unadjusted advances of the client (5.3), offered on the invoice: one click applies them oldest
 * first up to the balance (each through the payments API). Loaded lazily by the editor.
 */
export function AdvanceNotice({ onApplied }: { onApplied?: (message: string) => void }) {
  const s = useInvoiceStore(useShallow((st) => pick(st, ['client', 'id', 'dirty', 'doc_type', 'amount_paid'])));
  const [tick, setTick] = useState(0);
  const [error, setError] = useState('');
  const clientId = s.client?.id;
  const clientName = s.client?.name;
  const context = useMemo(() => {
    if (!clientName?.trim() && !clientId) return null;
    const invoices = localDb.invoices.getAll();
    const open = openAdvancesFor({ id: clientId, name: clientName }, loadAdvances(), localDb.payments.getAll(), invoices);
    if (!open.length) return null;
    return { open, stored: s.id ? invoices.find((i) => i.id === s.id) : undefined };
    // amount_paid changes after an apply; tick after our own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, clientName, s.id, s.amount_paid, tick]);
  if (!context || (s.doc_type !== 'INVOICE' && s.doc_type !== 'TAX_INVOICE')) return null;

  const total = round2(context.open.reduce((t, o) => t + o.balance.open, 0));
  const stored = context.stored;
  const ready = stored && !s.dirty && can('payment.record') && !canApplyTo(stored) && invoiceOpen(stored) > 0.004;
  const applicable = ready ? round2(Math.min(total, invoiceOpen(stored))) : 0;

  const apply = () => {
    if (!stored) return;
    let left = invoiceOpen(stored);
    try {
      for (const o of context.open) {
        if (left <= 0.004) break;
        const amt = round2(Math.min(o.balance.open, left));
        applyAdvance({ advanceId: o.advance.id, invoiceId: stored.id, amount: amt });
        left = round2(left - amt);
      }
      setError('');
      useInvoiceStore.getState().loadInvoice(stored.id);
      setTick((t) => t + 1);
      onApplied?.(`Advance of ${formatCurrency(applicable, 'INR')} applied to ${stored.invoice_number}`);
    } catch (err) {
      setError((err as Error).message);
      setTick((t) => t + 1);
    }
  };

  return (
    <div className={styles.wrap} role="status" aria-label="Unadjusted advances">
      <p className={styles.line}>
        <HandCoins size={14} aria-hidden="true" />
        <span>
          {clientName} has {formatCurrency(total, 'INR')} of advances not yet adjusted ({context.open.map((o) => o.advance.number).join(', ')}).{' '}
          {ready ? (
            <button type="button" className={styles.inlineBtn} onClick={apply}>Apply {formatCurrency(applicable, 'INR')} to this invoice</button>
          ) : (
            <>Save and issue the invoice, then apply it here or from Record payment.</>
          )}{' '}
          <Link to={`/receivables?tab=advances${clientId ? `&party=${encodeURIComponent(clientId)}` : ''}`}>View advances</Link>
        </span>
      </p>
      {error && <p className={styles.line} role="alert">{error}</p>}
    </div>
  );
}

export default AdvanceNotice;
