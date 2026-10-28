import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { HandCoins } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useInvoiceStore } from '../../store/useInvoiceStore';
import { pick } from '../../store/pick';
import { applyAdvance, canApplyTo, invoiceOpen, loadAdvances, openAdvancesFor, samePartyAs } from '../../lib/advances';
import { KEYS, peekTable } from '../../lib/storage';
import type { InvoiceRecord, Payment } from '../../types/invoice';
import { can } from '../../lib/access';
import { round2 } from '../../lib/invoice-calc';
import { cn, formatCurrency } from '../../lib/utils';
import { useT } from '../../i18n';
import { edT } from '../../i18n/areas/editor';
import styles from './StockWarnings.module.css';
import controls from '../../styles/controls.module.css';
import { NumberInput } from '../ui/NumberInput';
import { uxT } from '../../i18n/areas/invoicing-ux';

/**
 * Unadjusted advances of the client (5.3), offered on the invoice: one click applies them oldest
 * first up to the balance (each through the payments API). Loaded lazily by the editor.
 */
export function AdvanceNotice({ onApplied }: { onApplied?: (message: string) => void }) {
  useT(); // re-render on a language switch (5.4)
  const s = useInvoiceStore(useShallow((st) => pick(st, ['client', 'id', 'dirty', 'doc_type', 'amount_paid'])));
  const [tick, setTick] = useState(0);
  const [error, setError] = useState('');
  // 8.100: apply part of the advances (blank = everything applicable).
  const [part, setPart] = useState<number | null>(null);
  const clientId = s.client?.id;
  const clientName = s.client?.name;
  const isInvoice = s.doc_type === 'INVOICE' || s.doc_type === 'TAX_INVOICE';
  const context = useMemo(() => {
    if (!isInvoice || (!clientName?.trim() && !clientId)) return null;
    // PERF-2: typing the client name re-runs this per key. Most parties have no advance at all: answer from
    // the small advances table and only then look at invoices / payments (shared read-only rows).
    const party = { id: clientId, name: clientName };
    const advances = loadAdvances().filter((a) => samePartyAs(a.client, party));
    if (!advances.length) return null;
    const invoices = peekTable<InvoiceRecord>(KEYS.invoices);
    const open = openAdvancesFor(party, advances, peekTable<Payment>(KEYS.transactions), invoices);
    if (!open.length) return null;
    return { open, stored: s.id ? invoices.find((i) => i.id === s.id) : undefined };
    // amount_paid changes after an apply; tick after our own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isInvoice, clientId, clientName, s.id, s.amount_paid, tick]);
  if (!context || !isInvoice) return null;

  const total = round2(context.open.reduce((t, o) => t + o.balance.open, 0));
  const stored = context.stored;
  const ready = stored && !s.dirty && can('payment.record') && !canApplyTo(stored) && invoiceOpen(stored) > 0.004;
  const applicable = ready ? round2(Math.min(total, invoiceOpen(stored))) : 0;

  const want = part !== null && part > 0 ? round2(Math.min(part, applicable)) : applicable;
  const apply = () => {
    if (!stored) return;
    let left = round2(Math.min(invoiceOpen(stored), want));
    try {
      for (const o of context.open) {
        if (left <= 0.004) break;
        const amt = round2(Math.min(o.balance.open, left));
        applyAdvance({ advanceId: o.advance.id, invoiceId: stored.id, amount: amt });
        left = round2(left - amt);
      }
      setError('');
      setPart(null);
      useInvoiceStore.getState().loadInvoice(stored.id);
      setTick((t) => t + 1);
      onApplied?.(edT('anApplied', { amount: formatCurrency(want, 'INR'), number: stored.invoice_number }));
    } catch (err) {
      setError((err as Error).message);
      setTick((t) => t + 1);
    }
  };

  return (
    <div className={styles.wrap} role="status" aria-label={edT('anAria')}>
      <p className={styles.line}>
        <HandCoins size={14} aria-hidden="true" />
        <span>
          {edT('anText', { client: clientName ?? '', amount: formatCurrency(total, 'INR'), list: context.open.map((o) => o.advance.number).join(', ') })}{' '}
          {ready ? (
            <>
              <label>
                {uxT('advPart')}{' '}
                <NumberInput className={cn(controls.input, controls.inputNumeric)} style={{ width: '8em' }} value={part ?? applicable} onChange={(n) => setPart(n)} aria-label={uxT('advPart')} />
              </label>{' '}
              <button type="button" className={styles.inlineBtn} onClick={apply} disabled={!(want > 0)}>{edT('anApply', { amount: formatCurrency(want, 'INR') })}</button>
            </>
          ) : (
            <>{edT('anLater')}</>
          )}{' '}
          <Link to={`/receivables?tab=advances${clientId ? `&party=${encodeURIComponent(clientId)}` : ''}`}>{edT('anView')}</Link>
        </span>
      </p>
      {error && <p className={styles.line} role="alert">{error}</p>}
    </div>
  );
}

export default AdvanceNotice;
