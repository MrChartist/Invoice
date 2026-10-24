import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useInvoiceStore } from '../../store/useInvoiceStore';
import { pick } from '../../store/pick';
import { creditCheck, masterFor, type BounceLike } from '../../lib/credit-limit';
import { localDb } from '../../lib/localDb';
import { getTable } from '../../lib/storage';
import { todayInput } from '../../lib/utils';
import styles from './StockWarnings.module.css';

/**
 * Credit-limit notice (6.25): the client master's limit / credit days vs what they owe plus this
 * document. Advisory only — saving is never blocked.
 */
export function CreditWarning() {
  const s = useInvoiceStore(
    useShallow((st) => pick(st, ['client', 'id', 'doc_type', 'status', 'currency', 'exchange_rate', 'amount_paid', 'totals'])),
  );
  const clientId = s.client?.id;
  const clientName = s.client?.name;
  // The master, the other documents and the cheque register only change on other screens.
  const context = useMemo(() => {
    const master = masterFor({ id: clientId, name: clientName ?? '' }, localDb.clients.getAll());
    if (!master) return null;
    return { master, invoices: localDb.invoices.getAll(), cheques: getTable<BounceLike>('cheques') };
  }, [clientId, clientName]);
  if (!context) return null;
  const check = creditCheck({
    client: context.master,
    draft: {
      id: s.id,
      doc_type: s.doc_type,
      status: s.status,
      total: s.totals.total,
      tds_amount: s.totals.tds_amount,
      amount_paid: s.amount_paid,
      currency: s.currency,
      exchange_rate: s.exchange_rate,
    },
    invoices: context.invoices,
    today: todayInput(),
    cheques: context.cheques,
  });
  if (!check.warnings.length) return null;
  return (
    <div className={styles.wrap} role="status" aria-label="Credit check">
      {check.warnings.map((w) => (
        <p key={w} className={styles.line}>
          <ShieldAlert size={14} aria-hidden="true" /> {w}
        </p>
      ))}
      <p className={styles.line}>
        <span>
          You can still save.{' '}
          <Link to={`/receivables?tab=statements&party=${encodeURIComponent(context.master.id ?? '')}`}>View statement</Link>
        </span>
      </p>
    </div>
  );
}
