import { lazy, Suspense, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useInvoiceStore } from '../../store/useInvoiceStore';
import { pick } from '../../store/pick';
import { belongsTo, masterFor, type BounceLike } from '../../lib/credit-limit';
import { canOverrideCredit, creditStatus, readCreditPolicy } from '../../lib/credit-policy';
import { localDb } from '../../lib/localDb';
import { getTable, peekTable } from '../../lib/storage';
import { todayInput } from '../../lib/utils';
import type { InvoiceRecord } from '../../types/invoice';
import { useT } from '../../i18n';
import { edT } from '../../i18n/areas/editor';
import { crT } from '../../i18n/areas/credit';
import styles from './StockWarnings.module.css';

// R2-A7: the customer's payment grade, loaded on demand with the scoring code.
const CreditScoreLine = lazy(() => import('../collections/CreditScoreLine'));

/**
 * Credit-limit notice (6.25 / 8.80): the client master's limit / credit days vs what they owe plus this
 * document (and open sales orders, when the policy counts them). Warn: advisory. Block: a clerk's save
 * is held for the owner's approval; the owner's save is an audited override (`approval-gate.ts`).
 */
export function CreditWarning() {
  useT(); // re-render on a language switch (5.4)
  const s = useInvoiceStore(
    useShallow((st) => pick(st, ['client', 'id', 'doc_type', 'status', 'currency', 'exchange_rate', 'amount_paid', 'totals'])),
  );
  const clientId = s.client?.id;
  const clientName = s.client?.name;
  // The master, the other documents and the cheque register only change on other screens.
  const context = useMemo(() => {
    const master = masterFor({ id: clientId, name: clientName ?? '' }, localDb.clients.getAll());
    if (!master) return null;
    // Only this client's documents (the credit check skips the rest anyway), so a keystroke that changes
    // the draft total walks a handful of rows, not the whole table; read-only, so no re-parse either.
    const invoices = peekTable<InvoiceRecord>('invoices').filter((inv) => belongsTo(inv, master));
    const links = getTable<{ from_id: string; to_id: string; relation: string }>('doc_links');
    return { master, invoices, links, cheques: getTable<BounceLike>('cheques'), policy: readCreditPolicy() };
  }, [clientId, clientName]);
  if (!context) return null;
  const scoreLine = (slowOnly: boolean) => (
    <Suspense fallback={null}>
      <CreditScoreLine master={context.master} invoices={context.invoices} links={context.links} slowOnly={slowOnly}
        wrapClass={styles.wrap} lineClass={styles.line} ariaLabel={edT('cwAria')} />
    </Suspense>
  );
  const status = creditStatus(
    {
      id: s.id, client: s.client, doc_type: s.doc_type, status: s.status, total: s.totals.total, tds_amount: s.totals.tds_amount,
      amount_paid: s.amount_paid, currency: s.currency, exchange_rate: s.exchange_rate,
    },
    { master: context.master, policy: context.policy, invoices: context.invoices, links: context.links, cheques: context.cheques, day: todayInput() },
  );
  // Without credit warnings only a slow payer (grade C / D) gets a notice.
  if (!status || !status.check.warnings.length) return context.master.id ? scoreLine(true) : null;
  return (
    <div className={styles.wrap} role="status" aria-label={edT('cwAria')} data-credit-mode={status.mode}>
      {scoreLine(false)}
      {status.check.warnings.map((w) => (
        <p key={w} className={styles.line}>
          <ShieldAlert size={14} aria-hidden="true" /> {w}
        </p>
      ))}
      <p className={styles.line}>
        <span>
          {status.blocked ? (canOverrideCredit() ? crT('blockedOwner') : crT('blockedClerk')) : edT('cwSave')}{' '}
          <Link to={`/receivables?tab=statements&party=${encodeURIComponent(context.master.id ?? '')}`}>{edT('cwStatement')}</Link>
        </span>
      </p>
    </div>
  );
}
